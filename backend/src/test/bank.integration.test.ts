import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { EnableBankingClient } from '../lib/enableBanking';
import { setBankClientForTests, signState } from '../lib/bankSync';

const app = createApp();
const api = request(app);

// Banque simulée : une session avec deux comptes, des opérations et un solde.
const transactions = [
  { entry_reference: 'R1', transaction_amount: { amount: '42.35', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-12', remittance_information: ['CARTE 10/10/26 BIGEM INTERMARCHE CB*3277'] },
  { entry_reference: 'R2', transaction_amount: { amount: '500.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-10-21', remittance_information: ['VIR SEPA MR DUPONT JEAN', 'Cadeau amenagement 032026293829854280000001 Réf 03494NA202679312208580'] },
  { entry_reference: 'R3', transaction_amount: { amount: '9.99', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-25', remittance_information: ['PRLV SEPA BOUYGUES TELECOM', 'FR26100763394118 RUM BT1150W8WVC16'] },
  { entry_reference: 'R4', transaction_amount: { amount: '120.00', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-10-16', remittance_information: ['VIR Virement vers compte pro'] },
  { entry_reference: 'avis-1', transaction_amount: { amount: '57.63', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'PDNG', transaction_date: '2026-11-13', remittance_information: ['AMAZON PAYMENTS\\PARIS\\ FR'] },
];
// Compte 2 (ex. compte pro) : reçoit le virement de 120 € envoyé depuis le compte 1 (R4).
const transactionsAcc2 = [
  { entry_reference: 'P1', transaction_amount: { amount: '120.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-10-16', remittance_information: ['VIR Virement de Jean DUPONT'] },
];
const fakeFetch = async (url: string) => {
  const { pathname: path, searchParams } = new URL(url);
  // Comme Boursorama : pas plus de 90 jours d'historique.
  if (path.endsWith('/transactions') && (searchParams.get('date_from') ?? '') < '2026-08-17') {
    return { ok: false, status: 422, text: async () => JSON.stringify({ code: 422, error: 'WRONG_TRANSACTIONS_PERIOD', detail: { date_from: '2026-08-17' } }) };
  }
  const body = path === '/sessions'
    ? { session_id: 'sess-1', access: { valid_until: '2027-05-01T00:00:00Z' }, aspsp: { name: 'Banque Test', country: 'FR' }, accounts: [{ uid: 'acc-1', name: 'Compte courant', account_id: { iban: 'FR7600001111' }, currency: 'EUR' }, { uid: 'acc-2', name: 'Carte' }] }
    : path === '/accounts/acc-2/transactions' ? { transactions: transactionsAcc2, continuation_key: null }
    : path.endsWith('/transactions') ? { transactions, continuation_key: null }
    : path.endsWith('/balances') ? { balances: [{ balance_type: 'XPCD', balance_amount: { amount: '37.31', currency: 'EUR' } }, { balance_type: 'CLBD', balance_amount: { amount: '132.64', currency: 'EUR' }, reference_date: '2026-11-14' }] }
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
    expect(result).toMatchObject({ fetched: 5, pending: 1, adopted: 1, imported: 3, balance: { amount: 132.64, date: '2026-11-14', type: 'CLBD' } });

    const txs = (await api.get(`/api/users/${u}/transactions?account_id=${acc}`).expect(200)).body as Array<{ id: number; description: string; amount: number }>;
    expect(txs).toHaveLength(4);
    // L'opération CSV est reprise (pas dupliquée) et gagne le libellé complet, sans les références.
    expect(txs.find((t) => t.id === old)!.description).toBe('VIR SEPA MR DUPONT JEAN — Cadeau amenagement');
    expect(txs.map((t) => t.description)).toContain('PRLV SEPA BOUYGUES TELECOM');

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

    await api.delete(`/api/users/${u}/bank/connections/${connection.id}`).expect(200);
    expect((await api.get(`/api/users/${u}/bank`).expect(200)).body.connections).toEqual([]);
  });
});
