import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prismaBase as db } from '../prisma';

const app = createApp();
const api = request(app);

async function createUser(name: string) {
  const res = await api.post('/api/users').send({ name }).expect(201);
  return res.body.id as number;
}

// Jeu de données couvrant toutes les entités d'une sauvegarde complète.
async function seedFullUser(name: string) {
  const user_id = await createUser(name);
  const checking = await db.account.create({
    data: { user_id, name: 'Courant', type: 'checking', initial_balance: 100, initial_balance_date: new Date('2026-01-01') },
  });
  const pea = await db.account.create({
    data: { user_id, name: 'PEA', type: 'pea', initial_balance: 0, initial_balance_date: new Date('2026-01-01') },
  });
  const old = await db.account.create({
    data: { user_id, name: 'Ancien livret', type: 'livret_a', initial_balance: 0, initial_balance_date: new Date('2025-01-01'), archived: true },
  });
  const food = await db.category.create({ data: { user_id, name: 'Export courses', type: 'expense' } });
  const recurring = await db.recurringTransaction.create({
    data: {
      user_id, account_id: checking.id, category_id: food.id, amount: 9.99, type: 'expense', description: 'Abonnement',
      frequency: 'monthly', day_of_month: 5, end_date: new Date('2026-12-31'), last_executed: new Date('2026-03-05'),
    },
  });
  const expense = await db.transaction.create({
    data: { user_id, account_id: checking.id, category_id: food.id, amount: 42.5, type: 'expense', date: new Date('2026-03-10'), description: 'Supermarché' },
  });
  await db.transaction.create({
    data: { user_id, account_id: checking.id, to_account_id: pea.id, amount: 500, type: 'transfer', date: new Date('2026-03-11'), description: 'Versement PEA' },
  });
  await db.transaction.create({
    data: { user_id, account_id: checking.id, recurring_transaction_id: recurring.id, amount: 9.99, type: 'expense', date: new Date('2026-03-05'), description: 'Abonnement' },
  });
  // Transaction dans la corbeille : ne doit pas ressusciter.
  await db.transaction.create({
    data: { user_id, account_id: checking.id, amount: 1, type: 'expense', date: new Date('2026-03-12'), description: 'Supprimée', deleted_at: new Date() },
  });
  const goal = await db.savingsGoal.create({ data: { user_id, account_id: pea.id, name: 'Retraite', target_amount: 10000 } });
  const holding = await db.holding.create({
    data: { user_id, account_id: pea.id, symbol: 'CW8.PA', name: 'Amundi MSCI World', asset_class: 'etf' },
  });
  await db.holdingOrder.create({
    data: { user_id, holding_id: holding.id, side: 'buy', date: new Date('2026-03-12'), quantity: 0.12345, unit_price: 512.3456, fee: 1.5 },
  });
  await db.alert.create({ data: { user_id, type: 'account_balance', account_id: checking.id, operator: 'lt', threshold: 50 } });
  await db.alert.create({ data: { user_id, type: 'goal_behind', goal_id: goal.id } });
  await db.importMapping.create({
    data: { user_id, name: 'Ma banque', date_format: 'dd/mm/yyyy', columns: { date: 'Date', amount: 'Montant', description: 'Libellé', type: null } },
  });
  const bill = await db.bill.create({
    data: { user_id, name: 'Électricité', amount_min: 40, amount_max: 60, start_date: new Date('2026-01-10'), account_id: checking.id },
  });
  await db.billMatch.create({ data: { user_id, bill_id: bill.id, transaction_id: expense.id } });
  await db.attachment.create({
    data: { user_id, transaction_id: expense.id, filename: 'ticket.png', mime_type: 'image/png', size: 3, data: Buffer.from([1, 2, 3]) },
  });
  return { user_id, checking, pea, old, recurring, holding };
}

async function counts(user_id: number) {
  const [transactions, recurring, holdings, orders, alerts, mappings, billMatches, attachments, deleted] = await Promise.all([
    db.transaction.count({ where: { user_id, deleted_at: null } }),
    db.recurringTransaction.count({ where: { user_id } }),
    db.holding.count({ where: { user_id } }),
    db.holdingOrder.count({ where: { user_id } }),
    db.alert.count({ where: { user_id } }),
    db.importMapping.count({ where: { user_id } }),
    db.billMatch.count({ where: { user_id } }),
    db.attachment.count({ where: { user_id } }),
    db.transaction.count({ where: { user_id, deleted_at: { not: null } } }),
  ]);
  return { transactions, recurring, holdings, orders, alerts, mappings, billMatches, attachments, deleted };
}

async function fullExport(user_id: number) {
  const res = await api.get(`/api/users/${user_id}/export.json`).expect(200);
  return res.body;
}

describe('sauvegarde complète', () => {
  it('restaure toutes les entités et tous les champs sur un profil vierge', async () => {
    const source = await seedFullUser('Source');
    const payload = await fullExport(source.user_id);

    const target = await createUser('Cible');
    await api.post(`/api/users/${target}/import.json`).send({ payload }).expect(200);

    expect(await counts(target)).toMatchObject({
      transactions: 3, recurring: 1, holdings: 1, orders: 1, alerts: 2, mappings: 1, billMatches: 1, attachments: 1, deleted: 0,
    });
    const archived = await db.account.findFirst({ where: { user_id: target, name: 'Ancien livret' } });
    expect(archived?.archived).toBe(true);
    const rec = await db.recurringTransaction.findFirst({ where: { user_id: target } });
    expect(rec?.end_date?.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect(rec?.last_executed?.toISOString().slice(0, 10)).toBe('2026-03-05');
    const goal = await db.savingsGoal.findFirst({ where: { user_id: target }, include: { account: true } });
    expect(goal?.account?.name).toBe('PEA');
    const order = await db.holdingOrder.findFirst({ where: { user_id: target } });
    expect(order).toMatchObject({ quantity: 0.12345, unit_price: 512.3456, fee: 1.5 });
    const attachment = await db.attachment.findFirst({ where: { user_id: target } });
    expect(Buffer.from(attachment!.data)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('est idempotente : restaurer deux fois ne duplique rien', async () => {
    const source = await seedFullUser('Source');
    const payload = await fullExport(source.user_id);
    const before = await counts(source.user_id);

    await api.post(`/api/users/${source.user_id}/import.json`).send({ payload }).expect(200);
    await api.post(`/api/users/${source.user_id}/import.json`).send({ payload }).expect(200);

    expect(await counts(source.user_id)).toEqual(before);
  });

  it('restaurer une sauvegarde stockée ne duplique pas les transactions', async () => {
    const source = await seedFullUser('Source');
    const backup = await api.post(`/api/users/${source.user_id}/backups`).send({}).expect(201);
    const before = await counts(source.user_id);
    await api.post(`/api/users/${source.user_id}/backups/${backup.body.id}/restore`).expect(200);
    expect(await counts(source.user_id)).toEqual(before);
  });

  it("un export partiel (transactions seules) garde le lien vers les comptes existants", async () => {
    const source = await seedFullUser('Source');
    const res = await api.post(`/api/users/${source.user_id}/export`).send({ entities: ['transactions'] }).expect(200);
    await db.transaction.deleteMany({ where: { user_id: source.user_id } });

    await api.post(`/api/users/${source.user_id}/import.json`).send({ payload: res.body }).expect(200);
    const restored = await db.transaction.findMany({ where: { user_id: source.user_id } });
    expect(restored).toHaveLength(3);
    expect(restored.every((t) => t.account_id === source.checking.id)).toBe(true);
    expect(restored.find((t) => t.type === 'transfer')?.to_account_id).toBe(source.pea.id);
  });

  it("un import invalide n'écrit rien (atomique)", async () => {
    const target = await createUser('Cible');
    const before = await db.account.count({ where: { user_id: target } });
    const payload = {
      version: 1,
      accounts: [
        { id: 1, name: 'OK', type: 'checking', initial_balance: 0, initial_balance_date: '2026-01-01' },
        { id: 2, name: 'Cassé', type: 'not_a_type', initial_balance: 0, initial_balance_date: '2026-01-01' },
      ],
    };
    await api.post(`/api/users/${target}/import.json`).send({ payload }).expect(400);
    expect(await db.account.count({ where: { user_id: target } })).toBe(before);
  });

  it("refuse une ventilation pointant vers la catégorie d'un autre utilisateur", async () => {
    const other = await createUser('Autre');
    const foreign = await db.category.create({ data: { user_id: other, name: 'Étrangère', type: 'expense' } });
    const target = await createUser('Cible');
    const payload = {
      version: 1,
      transactions: [{
        id: 1, type: 'expense', amount: 10, date: '2026-03-01',
        splits: [{ category_id: foreign.id, amount: 6 }, { category_id: foreign.id, amount: 4 }],
      }],
    };
    await api.post(`/api/users/${target}/import.json`).send({ payload });
    const splits = await db.transactionSplit.findMany({ where: { user_id: target } });
    expect(splits.some((s) => s.category_id === foreign.id)).toBe(false);
  });
});

describe('export CSV', () => {
  it('produit un CSV relisible (montants décimaux, injection de formule neutralisée)', async () => {
    const user_id = await createUser('Csv');
    const account = await db.account.create({
      data: { user_id, name: 'Courant', type: 'checking', initial_balance: 0, initial_balance_date: new Date('2026-01-01') },
    });
    await db.transaction.create({
      data: { user_id, account_id: account.id, amount: 12.5, type: 'expense', date: new Date('2026-03-10'), description: '=HYPERLINK("x")' },
    });
    const res = await api.get(`/api/users/${user_id}/transactions.csv`).expect(200);
    const text: string = res.text.replace(/^﻿/, '');
    const [header, row] = text.trim().split(/\r?\n/);
    const delimiter = header!.includes(';') ? ';' : ',';
    const headers = header!.split(delimiter);
    const cells = row!.split(delimiter);
    expect(cells).toHaveLength(headers.length);
    expect(text).toContain('Courant');
    expect(text).not.toMatch(/(^|[;,])"?=HYPERLINK/m);

    // Round-trip : le CSV exporté se réimporte sans perte.
    await db.transaction.deleteMany({ where: { user_id } });
    const imported = await api.post(`/api/users/${user_id}/import.csv`).send({ csv: res.text, account_id: account.id }).expect(200);
    expect(imported.body.imported).toBe(1);
    const tx = await db.transaction.findFirst({ where: { user_id } });
    expect(tx).toMatchObject({ amount: 12.5, type: 'expense' });
  });
});
