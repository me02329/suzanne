import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { EnableBankingClient } from '../lib/enableBanking';
import { runScheduledBankSync, setBankClientForTests, signState } from '../lib/bankSync';
import { prisma } from '../prisma';

const app = createApp();
const api = request(app);

// Banque simulée : une session avec deux comptes, des opérations et un solde.
const transactions = [
  { entry_reference: 'R1', transaction_amount: { amount: '31.20', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-12', remittance_information: ['CARTE 10/10/26 EPICERIE DU COIN CB*0000'] },
  { entry_reference: 'R2', transaction_amount: { amount: '500.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-10-21', remittance_information: ['VIR SEPA MR DUPONT JEAN', 'Cadeau anniversaire 012026000000000000000001 Réf 00000NA000000000000000000'] },
  { entry_reference: 'R3', transaction_amount: { amount: '14.99', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-25', remittance_information: ['PRLV SEPA OPERATEUR MOBILE', 'FR00000000000000 RUM AB0000000000'] },
  { entry_reference: 'R4', transaction_amount: { amount: '120.00', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-16', remittance_information: ['VIR Virement vers compte pro'] },
  { entry_reference: 'avis-1', transaction_amount: { amount: '48.10', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'PDNG', transaction_date: '2026-11-13', remittance_information: ['BOUTIQUE EN LIGNE\\PARIS\\ FR'] },
];
// Compte 2 (ex. compte pro) : reçoit le virement de 120 € envoyé depuis le compte 1 (R4).
const transactionsAcc2 = [
  { entry_reference: 'P1', transaction_amount: { amount: '120.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-10-16', remittance_information: ['VIR Virement de Jean DUPONT'] },
];
// Comportement de la banque simulée pour la synchro automatique : normal,
// quota dépassé (429) ou accès révoqué (401). Appels enregistrés.
let bankMode: 'ok' | 'rate_limited' | 'revoked' = 'ok';
const calls: string[] = [];
const fakeFetch = async (url: string) => {
  const { pathname: path, searchParams } = new URL(url);
  calls.push(path);
  if (path.startsWith('/accounts/') && bankMode === 'rate_limited') return { ok: false, status: 429, text: async () => '{"code":429,"error":"ASPSP_RATE_LIMIT_EXCEEDED"}' };
  if (path.startsWith('/accounts/') && bankMode === 'revoked') return { ok: false, status: 401, text: async () => '{"code":401,"error":"EXPIRED_SESSION"}' };
  // Comme Boursorama : pas plus de 90 jours d'historique.
  if (path.endsWith('/transactions') && (searchParams.get('date_from') ?? '') < '2026-08-17') {
    return { ok: false, status: 422, text: async () => JSON.stringify({ code: 422, error: 'WRONG_TRANSACTIONS_PERIOD', detail: { date_from: '2026-08-17' } }) };
  }
  const body = path === '/sessions'
    ? { session_id: 'sess-1', access: { valid_until: '2027-05-01T00:00:00Z' }, aspsp: { name: 'Banque Test', country: 'FR' }, accounts: [{ uid: 'acc-1', name: 'Compte courant', account_id: { iban: 'FR7600001111' }, currency: 'EUR' }, { uid: 'acc-2', name: 'Carte' }] }
    : path === '/accounts/acc-2/transactions' ? { transactions: transactionsAcc2, continuation_key: null }
    : path.endsWith('/transactions') ? { transactions, continuation_key: null }
    : path.endsWith('/balances') ? { balances: [{ balance_type: 'XPCD', balance_amount: { amount: '1180.00', currency: 'EUR' } }, { balance_type: 'CLBD', balance_amount: { amount: '1250.00', currency: 'EUR' }, reference_date: '2026-11-14' }] }
    : {};
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};
const config = { appId: 'app', privateKeyPem: generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey, redirectUrl: 'https://suzanne.test/bank/callback' };

beforeAll(() => setBankClientForTests(new EnableBankingClient(config, fakeFetch), config));
afterAll(() => setBankClientForTests(null));

describe('synchronisation bancaire', () => {
  it('connexion, association, reprise de l\'existant, import, solde, sans doublon', async () => {
    const u = (await api.post('/api/users').send({ name: 'Banque' }).expect(201)).body.id as number;
    const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Courant B', type: 'checking', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
    // Déjà importée en CSV, libellé tronqué à 40 caractères.
    const old = (await api.post(`/api/users/${u}/transactions`).send({ type: 'income', amount: 500, date: '2026-10-21', account_id: acc, description: 'VIR SEPA MR DUPONT JEAN' }).expect(201)).body.id as number;

    const status0 = (await api.get(`/api/users/${u}/bank`).expect(200)).body;
    expect(status0).toMatchObject({ configured: true, redirect_url: 'https://suzanne.test/bank/callback', connections: [] });

    // Un state signé pour un autre profil est refusé.
    await api.post(`/api/users/${u}/bank/callback`).send({ code: 'c', state: signState({ u: u + 999, a: 'Banque Test', c: 'FR' }) }).expect(403);
    const connection = (await api.post(`/api/users/${u}/bank/callback`).send({ code: 'c', state: signState({ u, a: 'Banque Test', c: 'FR' }) }).expect(201)).body;
    expect(connection.session_id).toBeUndefined();
    expect(connection.links).toHaveLength(2);
    expect(connection.links[0]).toMatchObject({ remote_name: 'Compte courant', iban_last4: '1111', account_id: null });

    await api.patch(`/api/users/${u}/bank/links/${connection.links[0].id}`).send({ account_id: acc, sync_from: '2026-01-01' }).expect(200); // plus ancien que la limite de la banque
    // Un compte Suzanne ne peut être associé qu'une fois.
    await api.patch(`/api/users/${u}/bank/links/${connection.links[1].id}`).send({ account_id: acc }).expect(409);

    const [result] = (await api.post(`/api/users/${u}/bank/connections/${connection.id}/sync`).expect(200)).body.results;
    expect(result).toMatchObject({ fetched: 5, pending: 1, adopted: 1, imported: 3, balance: { amount: 1250, date: '2026-11-14', type: 'CLBD' } });

    const txs = (await api.get(`/api/users/${u}/transactions?account_id=${acc}`).expect(200)).body as Array<{ id: number; description: string; amount: number }>;
    expect(txs).toHaveLength(4);
    // L'opération CSV est reprise (pas dupliquée) et gagne le libellé complet, sans les références.
    expect(txs.find((t) => t.id === old)!.description).toBe('VIR SEPA MR DUPONT JEAN — Cadeau anniversaire');
    expect(txs.map((t) => t.description)).toContain('PRLV SEPA OPERATEUR MOBILE');
    // Données bancaires conservées pour la fiche de l'opération (même reprise d'un import CSV).
    const detail = (await api.get(`/api/users/${u}/transactions/${old}`).expect(200)).body;
    expect(detail.bank_data).toEqual([expect.objectContaining({ source: 'enable_banking', bank: 'Banque Test', account_id: acc, entry_reference: 'R2', booking_date: '2026-10-21', remittance_information: ['VIR SEPA MR DUPONT JEAN', expect.stringContaining('Cadeau anniversaire')] })]);

    // Deuxième synchro : rien de nouveau.
    const [again] = (await api.post(`/api/users/${u}/bank/connections/${connection.id}/sync`).expect(200)).body.results;
    expect(again).toMatchObject({ imported: 0, adopted: 0 });
    expect((await api.get(`/api/users/${u}/transactions?account_id=${acc}`).expect(200)).body).toHaveLength(4);

    // Virement entre deux comptes synchronisés : le compte 2 relié ensuite, puis
    // les deux synchronisés à nouveau, sans jamais dupliquer le virement.
    const pro = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Pro B', type: 'other', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
    await api.patch(`/api/users/${u}/bank/links/${connection.links[1].id}`).send({ account_id: pro }).expect(200);
    const [proSync] = (await api.post(`/api/users/${u}/bank/links/${connection.links[1].id}/sync`).expect(200)).body.results;
    expect(proSync).toMatchObject({ imported: 0, linked_transfers: 1 });
    await api.post(`/api/users/${u}/bank/connections/${connection.id}/sync`).expect(200);
    await api.post(`/api/users/${u}/bank/connections/${connection.id}/sync`).expect(200);
    const all = (await api.get(`/api/users/${u}/transactions`).expect(200)).body as Array<{ type: string; amount: number }>;
    expect(all.filter((t) => Math.abs(t.amount) === 120)).toEqual([expect.objectContaining({ type: 'transfer' })]);

    // Alerte automatique quand l'accès expire bientôt (et aucune avant).
    const bankAlertsOf = async () => ((await api.get(`/api/users/${u}/alerts/triggered?month=2026-11`).expect(200)).body as Array<{ type: string; message: string }>).filter((a) => a.type === 'bank');
    expect(await bankAlertsOf()).toEqual([]);
    await prisma.bankConnection.update({ where: { id: connection.id }, data: { valid_until: new Date(Date.now() + 3 * 86400_000) } });
    expect((await bankAlertsOf())[0]!.message).toMatch(/expire dans 3 jours/);

    await api.delete(`/api/users/${u}/bank/connections/${connection.id}`).expect(200);
    expect((await api.get(`/api/users/${u}/bank`).expect(200)).body.connections).toEqual([]);
  });
});

describe('synchronisation bancaire automatique', () => {
  const paris = { hours: [7, 19], timeZone: 'Europe/Paris', warnings: [] };
  const DAY = 86400_000;

  it('synchronise aux créneaux, une tentative par créneau, gère quota, révocation, réglage du profil et synchros simultanées', async () => {
    const u = (await api.post('/api/users').send({ name: 'Banque auto' }).expect(201)).body.id as number;
    const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Courant auto', type: 'checking', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
    const connection = await prisma.bankConnection.create({
      data: {
        user_id: u, aspsp_name: 'Banque Auto', aspsp_country: 'FR', session_id: `sess-auto-${u}`, valid_until: new Date(Date.now() + 60 * DAY),
        links: { create: [{ user_id: u, remote_uid: `auto-${u}`, remote_name: 'Compte', account_id: acc, sync_from: new Date('2026-09-01T00:00:00Z') }] },
      },
    });
    const state = () => prisma.bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    const ownCalls = () => calls.filter((c) => c.includes(`auto-${u}`)).length;
    const txCount = async () => ((await api.get(`/api/users/${u}/transactions?account_id=${acc}`).expect(200)).body as unknown[]).length;
    // Passage au créneau suivant : la dernière tentative recule d'un jour.
    const nextSlot = () => prisma.bankConnection.update({ where: { id: connection.id }, data: { last_attempt_at: new Date(Date.now() - DAY) } });

    // 1. Jamais synchronisée : synchro automatique, opérations et solde importés.
    await runScheduledBankSync(new Date(), paris);
    let s = await state();
    expect(s).toMatchObject({ status: 'active', last_error: null });
    expect(s.last_sync_at).not.toBeNull();
    expect(s.last_attempt_at).not.toBeNull();
    expect(await txCount()).toBe(4); // R1 à R4 (l'opération en attente est ignorée)
    const afterFirst = ownCalls();
    expect(afterFirst).toBeGreaterThan(0);

    // 2. Même créneau : aucun nouvel appel à la banque.
    await runScheduledBankSync(new Date(), paris);
    expect(ownCalls()).toBe(afterFirst);

    // 3. Quota de la banque dépassé : connexion en erreur, message clair, pas de plantage…
    bankMode = 'rate_limited';
    await nextSlot();
    await runScheduledBankSync(new Date(), paris);
    s = await state();
    expect(s.status).toBe('error');
    expect(s.last_error).toMatch(/limite le nombre de synchronisations/);
    // … et pas de nouvel essai avant le créneau suivant (le quota n'est pas épuisé en boucle).
    const afterRate = ownCalls();
    await runScheduledBankSync(new Date(), paris);
    expect(ownCalls()).toBe(afterRate);
    // Le bouton « Synchroniser » renvoie un 429 lisible.
    const manual = await api.post(`/api/users/${u}/bank/connections/${connection.id}/sync`).expect(429);
    expect(JSON.stringify(manual.body)).toMatch(/limite/);

    // 4. Créneau suivant, banque rétablie : la connexion redevient active, sans doublon.
    bankMode = 'ok';
    await nextSlot();
    await runScheduledBankSync(new Date(), paris);
    expect(await state()).toMatchObject({ status: 'active', last_error: null });
    expect(await txCount()).toBe(4);

    // 5. Synchro automatique désactivée par le profil : plus aucun appel.
    const off = (await api.put(`/api/users/${u}/bank/schedule`).send({ hours: [], time_zone: 'Europe/Paris' }).expect(200)).body;
    expect(off).toMatchObject({ hours: [], custom: true, next_at: null });
    await nextSlot();
    const beforeOff = ownCalls();
    await runScheduledBankSync(new Date(), paris);
    expect(ownCalls()).toBe(beforeOff);
    // Heures choisies : validées (3 au plus, sans doublon, fuseau connu), prochaine synchro calculée.
    await api.put(`/api/users/${u}/bank/schedule`).send({ hours: [1, 2, 3, 4] }).expect(400);
    await api.put(`/api/users/${u}/bank/schedule`).send({ hours: [8, 8] }).expect(400);
    await api.put(`/api/users/${u}/bank/schedule`).send({ hours: [8], time_zone: 'Nulle/Part' }).expect(400);
    const custom = (await api.put(`/api/users/${u}/bank/schedule`).send({ hours: [21, 6], time_zone: 'Europe/Paris' }).expect(200)).body;
    expect(custom).toMatchObject({ hours: [6, 21], custom: true });
    expect(new Date(custom.next_at).getTime()).toBeGreaterThan(Date.now());
    expect((await api.get(`/api/users/${u}/bank`).expect(200)).body.auto_sync).toMatchObject({ hours: [6, 21], custom: true });
    // Retour au réglage du serveur.
    expect((await api.put(`/api/users/${u}/bank/schedule`).send({ hours: null }).expect(200)).body).toMatchObject({ custom: false });

    // 6. Deux synchros simultanées (bouton et synchro automatique, double clic) : une seule passe.
    const both = await Promise.all([
      api.post(`/api/users/${u}/bank/connections/${connection.id}/sync`),
      api.post(`/api/users/${u}/bank/connections/${connection.id}/sync`),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await txCount()).toBe(4);

    // 7. Accès révoqué par la banque : connexion expirée, plus de synchro automatique.
    bankMode = 'revoked';
    await nextSlot();
    await runScheduledBankSync(new Date(), paris);
    expect(await state()).toMatchObject({ status: 'expired' });
    bankMode = 'ok';
    await nextSlot();
    const beforeRevoked = ownCalls();
    await runScheduledBankSync(new Date(), paris);
    expect(ownCalls()).toBe(beforeRevoked);

    await prisma.bankConnection.delete({ where: { id: connection.id } });
  });
});
