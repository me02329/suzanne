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

  it('allocates one refund income across multiple expenses', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId);
    // Noms distincts des catégories par défaut seedées par createUser (cf. en-tête).
    const groceries = await api.post(`/api/users/${userId}/categories`)
      .send({ name: 'Courses partagées', type: 'expense', color: '#22c55e' })
      .expect(201);
    const home = await api.post(`/api/users/${userId}/categories`)
      .send({ name: 'Maison partagée', type: 'expense', color: '#f97316' })
      .expect(201);
    const expenseA = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, category_id: groceries.body.id, amount: 100, type: 'expense', date: '2026-03-10', description: 'Carrefour courses' })
      .expect(201);
    const expenseB = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, category_id: home.body.id, amount: 110, type: 'expense', date: '2026-03-11', description: 'Carrefour maison' })
      .expect(201);

    const refund = await api.post(`/api/users/${userId}/transactions`)
      .send({
        account_id: accountId,
        amount: 90,
        type: 'income',
        date: '2026-03-12',
        description: 'Remboursement Carrefour',
        refund_allocations: [
          { expense_transaction_id: expenseA.body.id, amount: 40 },
          { expense_transaction_id: expenseB.body.id, amount: 50 },
        ],
      })
      .expect(201);
    expect(refund.body.refund_allocations).toHaveLength(2);
    expect(refund.body.refunds_transaction_id).toBeNull();

    const list = await api.get(`/api/users/${userId}/transactions?month=2026-03`).expect(200);
    const refreshedA = list.body.find((t: { id: number }) => t.id === expenseA.body.id);
    const refreshedB = list.body.find((t: { id: number }) => t.id === expenseB.body.id);
    expect(refreshedA.refunded_by[0]).toMatchObject({ id: refund.body.id, amount: 40 });
    expect(refreshedB.refunded_by[0]).toMatchObject({ id: refund.body.id, amount: 50 });

    const dash = await api.get(`/api/users/${userId}/dashboard?month=2026-03&currency=EUR`).expect(200);
    expect(dash.body.income).toBe(0);
    expect(dash.body.expenses).toBe(120);

    const stats = await api.get(`/api/users/${userId}/statistics?range=custom&from=2026-03-01&to=2026-03-31&currency=EUR`).expect(200);
    expect(stats.body.total_expenses).toBe(120);
    expect(stats.body.by_category.find((c: { name: string }) => c.name === 'Courses partagées').amount).toBe(60);
    expect(stats.body.by_category.find((c: { name: string }) => c.name === 'Maison partagée').amount).toBe(60);
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

  it('returns cashflow scoped to the custom statistics range', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId);
    await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 1000, type: 'income', date: '2026-02-10' })
      .expect(201);
    await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 2000, type: 'income', date: '2026-03-05' })
      .expect(201);
    const expense = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 500, type: 'expense', date: '2026-03-10', description: 'Achat remboursé' })
      .expect(201);
    await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 50, type: 'income', date: '2026-03-12', refunds_transaction_id: expense.body.id })
      .expect(201);
    await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 3000, type: 'income', date: '2026-04-01' })
      .expect(201);

    const stats = await api
      .get(`/api/users/${userId}/statistics?range=custom&from=2026-03-01&to=2026-03-31&currency=EUR&exclude_uncategorized=false`)
      .expect(200);

    expect(stats.body.cashflow.monthly).toEqual([{
      month: '2026-03',
      income: 2000,
      expenses: 450,
      expenses_signed: -450,
      net: 1550,
      cumulative_net: 1550,
    }]);
    expect(stats.body.cashflow.yearly).toEqual([{ year: '2026', income: 2000, expenses: 450, net: 1550 }]);
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

describe('budgets reconduits', () => {
  async function createExpenseCategory(userId: number, name: string) {
    const res = await api.post(`/api/users/${userId}/categories`)
      .send({ name, type: 'expense', color: '#123456' })
      .expect(201);
    return res.body.id as number;
  }

  it('reconduit sur le mois suivant et conserve le flag quand recurring est omis', async () => {
    const userId = await createUser();
    const categoryId = await createExpenseCategory(userId, 'Budget reconduit');
    await api.post(`/api/users/${userId}/budgets`)
      .send({ category_id: categoryId, month: '2026-06', amount_limit: 200, recurring: true })
      .expect(200);

    // Le mois suivant est matérialisé à l'affichage.
    const july = await api.get(`/api/users/${userId}/budgets?month=2026-07`).expect(200);
    expect(july.body.find((b: { category_id: number }) => b.category_id === categoryId))
      .toMatchObject({ amount_limit: 200, recurring: true });

    // Re-saisir la limite SANS le champ recurring ne coupe pas la reconduction.
    await api.post(`/api/users/${userId}/budgets`)
      .send({ category_id: categoryId, month: '2026-06', amount_limit: 250 })
      .expect(200);
    const june = await api.get(`/api/users/${userId}/budgets?month=2026-06`).expect(200);
    expect(june.body.find((b: { category_id: number }) => b.category_id === categoryId))
      .toMatchObject({ amount_limit: 250, recurring: true });
  });

  it("décocher la reconduction sur le dernier mois arrête la propagation", async () => {
    const userId = await createUser();
    const categoryId = await createExpenseCategory(userId, 'Budget stoppé');
    await api.post(`/api/users/${userId}/budgets`)
      .send({ category_id: categoryId, month: '2026-06', amount_limit: 100, recurring: true })
      .expect(200);
    await api.get(`/api/users/${userId}/budgets?month=2026-07`).expect(200);
    // Juillet décoché : août ne doit plus être créé, même si juin reste true.
    await api.post(`/api/users/${userId}/budgets`)
      .send({ category_id: categoryId, month: '2026-07', amount_limit: 100, recurring: false })
      .expect(200);
    const august = await api.get(`/api/users/${userId}/budgets?month=2026-08`).expect(200);
    expect(august.body.some((b: { category_id: number }) => b.category_id === categoryId)).toBe(false);
  });

  it('supprimer un budget reconduit ne le fait pas renaître au rechargement', async () => {
    const userId = await createUser();
    const categoryId = await createExpenseCategory(userId, 'Budget supprimé');
    await api.post(`/api/users/${userId}/budgets`)
      .send({ category_id: categoryId, month: '2026-06', amount_limit: 100, recurring: true })
      .expect(200);
    const july = await api.get(`/api/users/${userId}/budgets?month=2026-07`).expect(200);
    const materialized = july.body.find((b: { category_id: number }) => b.category_id === categoryId);
    await api.delete(`/api/users/${userId}/budgets/${materialized.id}`).expect(200);

    const reloaded = await api.get(`/api/users/${userId}/budgets?month=2026-07`).expect(200);
    expect(reloaded.body.some((b: { category_id: number }) => b.category_id === categoryId)).toBe(false);
  });
});

describe('filtres de drill-down sur GET transactions', () => {
  it('filtre par catégorie (splits inclus) et par plage de dates', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId);
    const cat = await api.post(`/api/users/${userId}/categories`)
      .send({ name: 'Drill courses', type: 'expense', color: '#111111' }).expect(201);
    const other = await api.post(`/api/users/${userId}/categories`)
      .send({ name: 'Drill loisirs', type: 'expense', color: '#222222' }).expect(201);
    const direct = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 30, type: 'expense', date: '2026-03-10', category_id: cat.body.id })
      .expect(201);
    const viaSplit = await api.post(`/api/users/${userId}/transactions`)
      .send({
        account_id: accountId, amount: 100, type: 'expense', date: '2026-04-02',
        splits: [
          { category_id: cat.body.id, amount: 60 },
          { category_id: other.body.id, amount: 40 },
        ],
      })
      .expect(201);
    await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 15, type: 'expense', date: '2026-03-15', category_id: other.body.id })
      .expect(201);

    const byCategory = await api
      .get(`/api/users/${userId}/transactions?category_id=${cat.body.id}`)
      .expect(200);
    expect(byCategory.body.map((t: { id: number }) => t.id).sort()).toEqual([direct.body.id, viaSplit.body.id].sort());

    const ranged = await api
      .get(`/api/users/${userId}/transactions?category_id=${cat.body.id}&from=2026-03-01&to=2026-03-31`)
      .expect(200);
    expect(ranged.body).toHaveLength(1);
    expect(ranged.body[0].id).toBe(direct.body.id);
  });
});

describe('splits & garde-fous', () => {
  it("bulk-update n'écrase pas la catégorie d'une transaction ventilée", async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId);
    const catA = await api.post(`/api/users/${userId}/categories`)
      .send({ name: 'Ventilée A', type: 'expense', color: '#111111' }).expect(201);
    const catB = await api.post(`/api/users/${userId}/categories`)
      .send({ name: 'Ventilée B', type: 'expense', color: '#222222' }).expect(201);
    const splitTx = await api.post(`/api/users/${userId}/transactions`)
      .send({
        account_id: accountId, amount: 100, type: 'expense', date: '2026-03-10',
        splits: [
          { category_id: catA.body.id, amount: 60 },
          { category_id: catB.body.id, amount: 40 },
        ],
      })
      .expect(201);
    const plainTx = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 50, type: 'expense', date: '2026-03-11' })
      .expect(201);

    const bulk = await api.post(`/api/users/${userId}/transactions/bulk-update`)
      .send({ ids: [splitTx.body.id, plainTx.body.id], category_id: catA.body.id })
      .expect(200);
    expect(bulk.body.updated).toBe(1); // seule la transaction non ventilée

    const list = await api.get(`/api/users/${userId}/transactions?month=2026-03`).expect(200);
    const refreshedSplit = list.body.find((t: { id: number }) => t.id === splitTx.body.id);
    expect(refreshedSplit.category_id).toBeNull();
    expect(refreshedSplit.splits).toHaveLength(2);
  });

  it('borne le cumul des remboursements au montant de la dépense', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId);
    const expense = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 50, type: 'expense', date: '2026-03-10', description: 'Petite dépense' })
      .expect(201);

    // Allocation directe supérieure à la dépense → refus.
    await api.post(`/api/users/${userId}/transactions`)
      .send({
        account_id: accountId, amount: 80, type: 'income', date: '2026-03-12',
        refund_allocations: [{ expense_transaction_id: expense.body.id, amount: 80 }],
      })
      .expect(400);

    // 30 puis 25 : le second dépasse le cumul (50) → refus.
    await api.post(`/api/users/${userId}/transactions`)
      .send({
        account_id: accountId, amount: 30, type: 'income', date: '2026-03-12',
        refund_allocations: [{ expense_transaction_id: expense.body.id, amount: 30 }],
      })
      .expect(201);
    await api.post(`/api/users/${userId}/transactions`)
      .send({
        account_id: accountId, amount: 25, type: 'income', date: '2026-03-13',
        refund_allocations: [{ expense_transaction_id: expense.body.id, amount: 25 }],
      })
      .expect(400);
    // 20, lui, complète exactement → accepté.
    await api.post(`/api/users/${userId}/transactions`)
      .send({
        account_id: accountId, amount: 20, type: 'income', date: '2026-03-13',
        refund_allocations: [{ expense_transaction_id: expense.body.id, amount: 20 }],
      })
      .expect(201);
  });
});

describe('opérations de masse sur transactions', () => {
  it('ajoute un tag à la sélection puis la supprime en masse', async () => {
    const userId = await createUser();
    const accountId = await createAccount(userId);
    const tag = await api.post(`/api/users/${userId}/tags`).send({ name: 'Vacances', color: '#33aa33' }).expect(201);
    const t1 = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 10, type: 'expense', date: '2026-04-01' }).expect(201);
    const t2 = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 20, type: 'expense', date: '2026-04-02' }).expect(201);

    const tagged = await api.post(`/api/users/${userId}/transactions/bulk-update`)
      .send({ ids: [t1.body.id, t2.body.id], add_tag_id: tag.body.id })
      .expect(200);
    expect(tagged.body.updated).toBe(2);

    let list = await api.get(`/api/users/${userId}/transactions?month=2026-04`).expect(200);
    expect(list.body.every((t: { tags: Array<{ id: number }> }) => t.tags.some((tg) => tg.id === tag.body.id))).toBe(true);

    // Re-taguer ne duplique pas le lien (skipDuplicates).
    await api.post(`/api/users/${userId}/transactions/bulk-update`)
      .send({ ids: [t1.body.id], add_tag_id: tag.body.id }).expect(200);
    list = await api.get(`/api/users/${userId}/transactions?month=2026-04`).expect(200);
    const refreshed = list.body.find((t: { id: number }) => t.id === t1.body.id);
    expect(refreshed.tags).toHaveLength(1);

    const removed = await api.post(`/api/users/${userId}/transactions/bulk-update`)
      .send({ ids: [t1.body.id, t2.body.id], remove_tag_id: tag.body.id }).expect(200);
    expect(removed.body.updated).toBe(2);

    const deleted = await api.post(`/api/users/${userId}/transactions/bulk-delete`)
      .send({ ids: [t1.body.id, t2.body.id] }).expect(200);
    expect(deleted.body.deleted).toBe(2);
    list = await api.get(`/api/users/${userId}/transactions?month=2026-04`).expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('bulk-delete ne touche pas les transactions d\'un autre utilisateur', async () => {
    const userId = await createUser('Bulk owner');
    const otherId = await createUser('Bulk other');
    const otherAccount = await createAccount(otherId);
    const foreign = await api.post(`/api/users/${otherId}/transactions`)
      .send({ account_id: otherAccount, amount: 5, type: 'expense', date: '2026-04-03' }).expect(201);
    const wiped = await api.post(`/api/users/${userId}/transactions/bulk-delete`)
      .send({ ids: [foreign.body.id] }).expect(200);
    expect(wiped.body.deleted).toBe(0);
    await api.get(`/api/users/${otherId}/transactions?month=2026-04`).expect(200)
      .then((res) => expect(res.body).toHaveLength(1));
  });
});

describe('factures : rapprochement manuel', () => {
  it('compte une dépense liée manuellement même quand le motif ne matche pas', async () => {
    const userId = await createUser('Bill match');
    const accountId = await createAccount(userId);
    const bill = await api.post(`/api/users/${userId}/bills`)
      .send({ name: 'Électricité', amount_min: 80, amount_max: 130, start_date: '2026-06-05', frequency: 'monthly', interval: 1, pattern: 'EDF' })
      .expect(201);
    // Dépense au libellé qui NE contient PAS « EDF » → pas de match auto.
    const tx = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 95, type: 'expense', date: '2026-06-04', description: 'Prélèvement énergie' })
      .expect(201);

    let status = await api.get(`/api/users/${userId}/bills/status?month=2026-06`).expect(200);
    let entry = status.body.bills.find((e: { bill: { id: number } }) => e.bill.id === bill.body.id);
    expect(entry.paid_amount).toBe(0);

    await api.post(`/api/users/${userId}/bills/${bill.body.id}/matches`).send({ transaction_id: tx.body.id }).expect(201);

    status = await api.get(`/api/users/${userId}/bills/status?month=2026-06`).expect(200);
    entry = status.body.bills.find((e: { bill: { id: number } }) => e.bill.id === bill.body.id);
    expect(entry.paid_amount).toBe(95);
    expect(entry.status).toBe('paid');
    expect(entry.matched_transactions.find((t: { id: number }) => t.id === tx.body.id).manual).toBe(true);

    await api.delete(`/api/users/${userId}/bills/${bill.body.id}/matches/${tx.body.id}`).expect(200);
    status = await api.get(`/api/users/${userId}/bills/status?month=2026-06`).expect(200);
    entry = status.body.bills.find((e: { bill: { id: number } }) => e.bill.id === bill.body.id);
    expect(entry.paid_amount).toBe(0);
  });
});

describe('récurrents : date de fin & saut', () => {
  it('ne génère rien après la date de fin et se désactive', async () => {
    const userId = await createUser('Recur end');
    const accountId = await createAccount(userId);
    // Mensuel le 1er, démarré sans last_executed, fin au 2026-02-28.
    const rec = await api.post(`/api/users/${userId}/recurring-transactions`)
      .send({ account_id: accountId, amount: 9.99, type: 'expense', description: 'Abo 12 mois',
        frequency: 'monthly', interval: 1, day_of_month: 1, end_date: '2026-02-28', active: true })
      .expect(201);
    expect(rec.body.end_date).toBeTruthy();

    // Génère à une date bien postérieure à la fin : occurrences jan + fév uniquement, puis désactivation.
    await api.post(`/api/users/${userId}/recurring-transactions/generate`).expect(200);
    const list = await api.get(`/api/users/${userId}/recurring-transactions`).expect(200);
    const refreshed = list.body.find((r: { id: number }) => r.id === rec.body.id);
    expect(refreshed.active).toBe(false);
    const txs = await api.get(`/api/users/${userId}/transactions`).expect(200);
    const generated = txs.body.filter((t: { recurring_transaction_id: number | null }) => t.recurring_transaction_id === rec.body.id);
    expect(generated.every((t: { date: string }) => t.date <= '2026-02-28')).toBe(true);
  });

  it('saute la prochaine occurrence en avançant last_executed', async () => {
    const userId = await createUser('Recur skip');
    const rec = await api.post(`/api/users/${userId}/recurring-transactions`)
      .send({ amount: 20, type: 'expense', description: 'Sans compte',
        frequency: 'monthly', interval: 1, day_of_month: 15, active: true })
      .expect(201);
    const skipped = await api.post(`/api/users/${userId}/recurring-transactions/${rec.body.id}/skip`).expect(200);
    expect(skipped.body.last_executed).toBeTruthy();
  });
});

describe('retrait d\'objectif', () => {
  it('décrémente la progression, crée le transfert retour et refuse au-delà du solde', async () => {
    const userId = await createUser('Withdraw');
    const account = await createAccount(userId);
    const goalAccount = await createAccount(userId, { name: 'Livret objectif' });
    const goal = await api.post(`/api/users/${userId}/savings-goals`)
      .send({ name: 'Voyage', target_amount: 1000, current_amount: 0, color: '#123456', account_id: goalAccount }).expect(201);
    await api.post(`/api/users/${userId}/savings-goals/${goal.body.id}/contribute`)
      .send({ amount: 300, date: '2026-05-01', source_account_id: account }).expect(200);

    // Retrait supérieur au solde épargné → refus.
    await api.post(`/api/users/${userId}/savings-goals/${goal.body.id}/withdraw`)
      .send({ amount: 500, date: '2026-05-10', destination_account_id: account }).expect(400);

    const res = await api.post(`/api/users/${userId}/savings-goals/${goal.body.id}/withdraw`)
      .send({ amount: 120, date: '2026-05-10', destination_account_id: account }).expect(200);
    expect(res.body.goal.current_amount).toBe(180);
    expect(res.body.transaction_id).not.toBeNull();

    // Le retrait apparaît comme contribution négative dans la timeline.
    const contribs = await api.get(`/api/users/${userId}/savings-goals/${goal.body.id}/contributions`).expect(200);
    expect(contribs.body.some((c: { amount: number }) => c.amount === -120)).toBe(true);
  });
});

describe('fusion de catégories', () => {
  it('réaffecte transactions et budgets puis supprime la source', async () => {
    const userId = await createUser('Merge');
    const accountId = await createAccount(userId);
    const source = await api.post(`/api/users/${userId}/categories`).send({ name: 'Courses bio', type: 'expense', color: '#111111' }).expect(201);
    const target = await api.post(`/api/users/${userId}/categories`).send({ name: 'Alimentation maison', type: 'expense', color: '#222222' }).expect(201);
    const income = await api.post(`/api/users/${userId}/categories`).send({ name: 'Prime annuelle', type: 'income', color: '#333333' }).expect(201);
    const tx = await api.post(`/api/users/${userId}/transactions`)
      .send({ account_id: accountId, amount: 30, type: 'expense', date: '2026-05-02', category_id: source.body.id }).expect(201);
    // Budget sur le même mois côté source ET cible → la collision d'unicité doit être gérée.
    await api.post(`/api/users/${userId}/budgets`).send({ category_id: source.body.id, month: '2026-05', amount_limit: 100 }).expect(200);
    await api.post(`/api/users/${userId}/budgets`).send({ category_id: target.body.id, month: '2026-05', amount_limit: 200 }).expect(200);

    // Type différent → refus.
    await api.post(`/api/users/${userId}/categories/${source.body.id}/merge`)
      .send({ target_category_id: income.body.id }).expect(400);

    await api.post(`/api/users/${userId}/categories/${source.body.id}/merge`)
      .send({ target_category_id: target.body.id }).expect(200);

    // Source supprimée, transaction réaffectée, un seul budget (celui de la cible) sur le mois.
    const cats = await api.get(`/api/users/${userId}/categories`).expect(200);
    expect(cats.body.find((c: { id: number }) => c.id === source.body.id)).toBeUndefined();
    const list = await api.get(`/api/users/${userId}/transactions?month=2026-05`).expect(200);
    expect(list.body.find((t: { id: number }) => t.id === tx.body.id).category_id).toBe(target.body.id);
    const budgets = await api.get(`/api/users/${userId}/budgets?month=2026-05`).expect(200);
    const targetBudgets = budgets.body.filter((b: { category_id: number }) => b.category_id === target.body.id);
    expect(targetBudgets).toHaveLength(1);
    expect(targetBudgets[0].amount_limit).toBe(200);
  });
});

describe('per-user scoping', () => {
  it("refuse un snapshot sur le compte d'un autre utilisateur", async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceAccount = await createAccount(alice);
    await api.post(`/api/users/${bob}/account-snapshots`)
      .send({ account_id: aliceAccount, date: '2026-02-01', balance: 999 })
      .expect(400);
    await api.post(`/api/users/${bob}/account-snapshots/batch`)
      .send({ date: '2026-02-01', balances: [{ account_id: aliceAccount, balance: 999 }] })
      .expect(400);
  });

  it("refuse une transaction référençant le compte ou la catégorie d'un autre utilisateur", async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const aliceAccount = await createAccount(alice);
    const aliceCategory = await api.post(`/api/users/${alice}/categories`)
      .send({ name: 'Privée', type: 'expense', color: '#000000' })
      .expect(201);

    await api.post(`/api/users/${bob}/transactions`)
      .send({ account_id: aliceAccount, amount: 10, type: 'expense', date: '2026-03-01' })
      .expect(400);
    await api.post(`/api/users/${bob}/transactions`)
      .send({ category_id: aliceCategory.body.id, amount: 10, type: 'expense', date: '2026-03-01' })
      .expect(400);
  });
});

describe('ai settings', () => {
  it('ne supprime pas la clé stockée quand api_key est omis de la mise à jour', async () => {
    await api.put('/api/settings/ai').send({ api_key: 'sk-test-123' }).expect(200);
    const after = await api.put('/api/settings/ai').send({ model: 'modele-test' }).expect(200);
    expect(after.body.source).toBe('database');
    expect(after.body.model).toBe('modele-test');
    // null efface explicitement la clé stockée en base.
    const cleared = await api.put('/api/settings/ai').send({ api_key: null }).expect(200);
    expect(cleared.body.source).not.toBe('database');
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
