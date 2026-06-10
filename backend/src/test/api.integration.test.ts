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

describe('refunds (remboursements)', () => {
  async function createExpense(userId: number, accountId: number, amount = 100, date = '2026-03-10') {
    const res = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount, type: 'expense', date, description: 'Resto entre amis' })
      .expect(201);
    return res.body.id as number;
  }

  it('links a refund income to an expense and nets the dashboard', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId);
    const expenseId = await createExpense(userId, accountId, 100);
    await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 2000, type: 'income', date: '2026-03-05' })
      .expect(201);

    // Remboursement partiel de 40 lié à la dépense.
    const refund = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 40, type: 'income', date: '2026-03-12', refunds_transaction_id: expenseId })
      .expect(201);
    expect(refund.body.refunds_transaction_id).toBe(expenseId);
    expect(refund.body.refunds_transaction).toMatchObject({ id: expenseId, amount: 100 });

    // La dépense expose les remboursements reçus.
    const list = await api.get(`/api/users/${userId}/transactions?month=2026-03`).expect(200);
    const expense = list.body.find((t: { id: number }) => t.id === expenseId);
    expect(expense.refunded_by).toHaveLength(1);
    expect(expense.refunded_by[0]).toMatchObject({ amount: 40 });

    // Dashboard : le remboursement réduit les dépenses, pas les revenus.
    const dash = await api.get(`/api/users/${userId}/dashboard?month=2026-03&currency=EUR`).expect(200);
    expect(dash.body.income).toBe(2000);
    expect(dash.body.expenses).toBe(60);
    expect(dash.body.net).toBe(1940);
  });

  it('rejects a refund pointing at a non-expense or at another user', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceAccount = await createAccount(alice);
    const bobAccount = await createAccount(bob, { name: 'Compte Bob' });
    const aliceExpense = await createExpense(alice, aliceAccount);
    const aliceIncome = await api.post(`/api/users/${alice}/transactions`)
      .send({ account_id: aliceAccount, amount: 10, type: 'income', date: '2026-03-05' })
      .expect(201);

    // Une dépense ne peut pas porter un lien de remboursement.
    await api.post(`/api/users/${alice}/transactions`)
      .send({ account_id: aliceAccount, amount: 5, type: 'expense', date: '2026-03-13', refunds_transaction_id: aliceExpense })
      .expect(400);
    // La cible doit être une dépense.
    await api.post(`/api/users/${alice}/transactions`)
      .send({ account_id: aliceAccount, amount: 5, type: 'income', date: '2026-03-13', refunds_transaction_id: aliceIncome.body.id })
      .expect(400);
    // La cible doit appartenir au même utilisateur.
    await api.post(`/api/users/${bob}/transactions`)
      .send({ account_id: bobAccount, amount: 5, type: 'income', date: '2026-03-13', refunds_transaction_id: aliceExpense })
      .expect(400);
  });

  it('detaches the link when the income stops being an income, and on PATCH null', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId);
    const expenseId = await createExpense(userId, accountId);
    const refund = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 40, type: 'income', date: '2026-03-12', refunds_transaction_id: expenseId })
      .expect(201);

    // Bascule en dépense → le lien saute.
    const patched = await api.patch(`/api/users/${userId}/transactions/${refund.body.id}`)
      .send({ type: 'expense' })
      .expect(200);
    expect(patched.body.refunds_transaction_id).toBeNull();

    // Re-lie puis délie explicitement.
    await api.patch(`/api/users/${userId}/transactions/${refund.body.id}`)
      .send({ type: 'income', refunds_transaction_id: expenseId })
      .expect(200);
    const unlinked = await api.patch(`/api/users/${userId}/transactions/${refund.body.id}`)
      .send({ refunds_transaction_id: null })
      .expect(200);
    expect(unlinked.body.refunds_transaction_id).toBeNull();
  });

  it('nets statistics by attributing the refund to the expense category', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId);
    const catRes = await api.post(`/api/users/${userId}/categories`)
      .send({ name: 'Restaurants', type: 'expense', color: '#ff0000' })
      .expect(201);
    const today = new Date().toISOString().slice(0, 10);
    const expense = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, category_id: catRes.body.id, amount: 90, type: 'expense', date: today, description: 'Resto partagé' })
      .expect(201);
    await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 30, type: 'income', date: today, refunds_transaction_id: expense.body.id })
      .expect(201);

    const stats = await api.get(`/api/users/${userId}/statistics?range=3m&currency=EUR`).expect(200);
    expect(stats.body.total_expenses).toBe(60);
    const resto = stats.body.by_category.find((c: { name: string }) => c.name === 'Restaurants');
    expect(resto.amount).toBe(60);
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

describe('error handling', () => {
  it('returns a friendly message instead of leaking the Prisma error', async () => {
    const userId = await createUser();
    await api.post(`/api/users/${userId}/categories`).send({ name: 'Doublon', type: 'expense', color: '#000000' }).expect(201);
    const res = await api.post(`/api/users/${userId}/categories`).send({ name: 'Doublon', type: 'expense', color: '#000000' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Cette entrée existe déjà.');
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|invocation|\.create\(/i);
  });
});

describe('ai health', () => {
  it('responds with a configured flag', async () => {
    const res = await api.get('/api/ai/health').expect(200);
    expect(res.body).toHaveProperty('configured');
  });
});
