import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
const api = request(app);

// Creating a user seeds a default account ("Compte courant") and default
// categories, so tests use distinct names and assert on presence rather than
// exact counts.
async function createUser(name = 'Test') {
  const res = await api.post('/api/users').send({ name }).expect(201);
  return res.body.id as number;
}

async function createAccount(userId: number, overrides: Record<string, unknown> = {}) {
  const res = await api
    .post(`/api/users/${userId}/accounts`)
    .send({ name: 'Compte test', type: 'checking', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01', ...overrides })
    .expect(201);
  return res.body.id as number;
}

describe('users', () => {
  it('creates, lists and deletes a user', async () => {
    const id = await createUser('Alice');
    const list = await api.get('/api/users').expect(200);
    expect(list.body.map((u: { id: number }) => u.id)).toContain(id);
    await api.delete(`/api/users/${id}`).expect(200);
    const after = await api.get('/api/users').expect(200);
    expect(after.body.map((u: { id: number }) => u.id)).not.toContain(id);
  });
});

describe('accounts', () => {
  it('creates an account scoped to a user', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId, { name: 'Livret', type: 'livret_a' });
    const list = await api.get(`/api/users/${userId}/accounts`).expect(200);
    const created = list.body.find((a: { id: number }) => a.id === accountId);
    expect(created).toMatchObject({ name: 'Livret', type: 'livret_a', user_id: userId });
  });

  it('never leaks another user\'s accounts', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    await createAccount(alice, { name: 'Alice compte' });
    const bobAccounts = await api.get(`/api/users/${bob}/accounts`).expect(200);
    expect(bobAccounts.body.every((a: { user_id: number }) => a.user_id === bob)).toBe(true);
    expect(bobAccounts.body.some((a: { name: string }) => a.name === 'Alice compte')).toBe(false);
  });
});

describe('dashboard', () => {
  it('reports coherent income, expenses and net for the month', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId);

    await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 2000, type: 'income', date: '2026-03-05' })
      .expect(201);
    await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 500, type: 'expense', date: '2026-03-10' })
      .expect(201);

    const dash = await api.get(`/api/users/${userId}/dashboard?month=2026-03&currency=EUR`).expect(200);
    expect(dash.body.income).toBe(2000);
    expect(dash.body.expenses).toBe(500);
    expect(dash.body.net).toBe(1500);
  });
});

describe('institutions', () => {
  it('renames an institution and reassigns an account to it', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId);
    const instRes = await api.post(`/api/users/${userId}/institutions`).send({ name: 'Banque A' }).expect(201);
    const institutionId = instRes.body.id as number;

    const renamed = await api.patch(`/api/users/${userId}/institutions/${institutionId}`).send({ name: 'Banque B' }).expect(200);
    expect(renamed.body.name).toBe('Banque B');

    const updated = await api.patch(`/api/users/${userId}/accounts/${accountId}`).send({ institution_id: institutionId }).expect(200);
    expect(updated.body.institution_id).toBe(institutionId);
  });
});

describe('account snapshot suggestions', () => {
  it('suggests last balance plus the delta of later transactions', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId, { name: 'Épargne', initial_balance: 1000, initial_balance_date: '2026-01-01' });
    await api.post(`/api/users/${userId}/account-snapshots`)
      .send({ account_id: accountId, date: '2026-02-01', balance: 1200 })
      .expect(200);
    // +300 income after the snapshot date.
    await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 300, type: 'income', date: '2026-02-15' })
      .expect(201);

    const res = await api.get(`/api/users/${userId}/account-snapshots/suggestions?date=2026-02-28`).expect(200);
    const suggestion = res.body.find((s: { account_id: number }) => s.account_id === accountId);
    expect(suggestion).toMatchObject({ last_snapshot_balance: 1200, delta: 300, suggested_balance: 1500 });
  });
});

describe('export / import round trip', () => {
  it('re-imports an exported account', async () => {
    const source = await createUser('Source');
    await createAccount(source, { name: 'À exporter', type: 'savings' });
    const exported = await api.post(`/api/users/${source}/export`).send({ entities: ['accounts'] }).expect(200);

    const target = await createUser('Target');
    await api.post(`/api/users/${target}/import.json`).send({ payload: exported.body }).expect(200);
    const accounts = await api.get(`/api/users/${target}/accounts`).expect(200);
    expect(accounts.body.map((a: { name: string }) => a.name)).toContain('À exporter');
  });
});

describe('ai health', () => {
  it('responds with a configured flag', async () => {
    const res = await api.get('/api/ai/health').expect(200);
    expect(res.body).toHaveProperty('configured');
  });
});
