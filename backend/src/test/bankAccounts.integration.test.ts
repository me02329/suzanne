import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { EnableBankingClient } from '../lib/enableBanking';
import { setBankClientForTests, signState } from '../lib/bankSync';
import { prisma } from '../prisma';

const api = request(createApp());

// Banque simulée « à la Revolut » : la création de session ne renvoie aucun
// compte ; la session relue donne leurs identifiants, le détail le reste.
let sessionAccounts: string[] = ['rev-eur'];
const fakeFetch = async (url: string, init?: { method?: string }) => {
  const { pathname: path } = new URL(url);
  const method = init?.method ?? 'GET';
  const body = path === '/sessions' && method === 'POST'
    ? { session_id: 'sess-rev', access: { valid_until: '2027-05-01T00:00:00Z' }, aspsp: { name: 'Revolut', country: 'FR' }, accounts: [] }
    : path === '/sessions/sess-rev' ? { status: 'AUTHORIZED', accounts: sessionAccounts, accounts_data: sessionAccounts.map((uid) => ({ uid })) }
    : path === '/accounts/rev-eur/details' ? { uid: 'rev-eur', name: 'Compte EUR', currency: 'EUR', account_id: { iban: 'LT001234567890121234' } }
    : path === '/accounts/rev-usd/details' ? { uid: 'rev-usd', name: 'Compte USD', currency: 'USD' }
    : {};
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};
const config = { appId: 'app', privateKeyPem: generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey, redirectUrl: 'https://suzanne.test/bank/callback' };

beforeAll(() => setBankClientForTests(new EnableBankingClient(config, fakeFetch), config));
afterAll(() => setBankClientForTests(null));

describe('comptes d’une connexion bancaire', () => {
  it('banque qui ne renvoie aucun compte à la connexion : comptes relus depuis la session', async () => {
    const u = (await api.post('/api/users').send({ name: 'Revolut' }).expect(201)).body.id as number;
    const state = signState({ u, a: 'Revolut', c: 'FR' });
    await api.post(`/api/users/${u}/bank/callback`).send({ code: 'code-1', state }).expect((res) => { if (res.status >= 300) throw new Error(`${res.status} ${JSON.stringify(res.body)}`); });

    const status = (await api.get(`/api/users/${u}/bank`).expect(200)).body;
    expect(status.connections).toHaveLength(1);
    expect(status.connections[0].links).toMatchObject([{ remote_name: 'Compte EUR', iban_last4: '1234', currency: 'EUR' }]);

    // Un compte de plus ouvert chez la banque : « Rafraîchir les comptes » l'ajoute, sans toucher aux autres.
    sessionAccounts = ['rev-eur', 'rev-usd'];
    const connectionId = status.connections[0].id as number;
    const refreshed = (await api.post(`/api/users/${u}/bank/connections/${connectionId}/accounts`).expect(200)).body;
    expect(refreshed).toEqual({ found: 2, added: 1 });
    const links = await prisma.bankLink.findMany({ where: { connection_id: connectionId }, orderBy: { id: 'asc' } });
    expect(links.map((l) => l.remote_name)).toEqual(['Compte EUR', 'Compte USD']);
  });
});
