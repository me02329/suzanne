import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prismaBase as db } from '../prisma';

const app = createApp();
const api = request(app);
const here = path.dirname(fileURLToPath(import.meta.url));

async function createUser(name: string) {
  return (await api.post('/api/users').send({ name }).expect(201)).body.id as number;
}

const cashOf = async (account_id: number) =>
  Math.round((await db.transactionLine.aggregate({ where: { account_id, transaction: { deleted_at: null } }, _sum: { amount: true } }))._sum.amount! * 100) / 100;

describe('ordres de bourse et espèces', () => {
  it("un achat débite les espèces d'un compte d'investissement, une vente les crédite", async () => {
    const u = await createUser('Bourse');
    const pea = (await api.post(`/api/users/${u}/accounts`).send({ name: 'PEA test', type: 'pea', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body;
    expect(pea.orders_affect_cash).toBe(true);
    await api.post(`/api/users/${u}/transactions`).send({ type: 'transfer', amount: 1000, date: '2026-01-05', account_id: (await db.account.findFirst({ where: { user_id: u, type: 'checking' } }))!.id, to_account_id: pea.id }).expect(201);
    const holding = (await api.post(`/api/users/${u}/holdings`).send({ account_id: pea.id, symbol: 'CW8.PA', name: 'MSCI World', asset_class: 'etf' }).expect(201)).body;

    // Fraction d'ETF : la précision est conservée (plus d'arrondi à 2 décimales).
    const afterBuy = (await api.post(`/api/users/${u}/holdings/${holding.id}/orders`).send({ side: 'buy', date: '2026-01-10', quantity: 1.23456, unit_price: 500.1234, fee: 2 }).expect(201)).body;
    expect(afterBuy.orders[0]).toMatchObject({ quantity: 1.23456, unit_price: 500.1234 });
    expect(await cashOf(pea.id)).toBe(Math.round((1000 - (1.23456 * 500.1234 + 2)) * 100) / 100);

    const trade = await db.transaction.findFirst({ where: { user_id: u, kind: 'trade' } });
    expect(trade?.description).toContain('Achat');
    // Le mouvement d'espèces n'est ni une dépense ni modifiable directement.
    const dash = (await api.get(`/api/users/${u}/dashboard?month=2026-01&currency=EUR`).expect(200)).body;
    expect(dash.expenses).toBe(0);
    await api.patch(`/api/users/${u}/transactions/${trade!.id}`).send({ amount: 1 }).expect(400);
    await api.delete(`/api/users/${u}/transactions/${trade!.id}`).expect(404);

    await api.post(`/api/users/${u}/holdings/${holding.id}/orders`).send({ side: 'sell', date: '2026-02-10', quantity: 1, unit_price: 520, fee: 1 }).expect(201);
    expect(await cashOf(pea.id)).toBe(Math.round((1000 - (1.23456 * 500.1234 + 2) + 519) * 100) / 100);

    // Modifier l'ordre met à jour son mouvement ; le supprimer le retire.
    const buyId = afterBuy.orders[0].id as number;
    await api.patch(`/api/users/${u}/holdings/${holding.id}/orders/${buyId}`).send({ quantity: 2, unit_price: 500, fee: 0 }).expect(200);
    expect(await cashOf(pea.id)).toBe(1000 - 1000 + 519);
  });

  it('refuse une vente supérieure aux titres détenus, même via la suppression d\'un achat', async () => {
    const u = await createUser('Garde');
    const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'CTO', type: 'securities', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body;
    const h = (await api.post(`/api/users/${u}/holdings`).send({ account_id: acc.id, symbol: 'AAPL', name: 'Apple' }).expect(201)).body;
    const bought = (await api.post(`/api/users/${u}/holdings/${h.id}/orders`).send({ side: 'buy', date: '2026-01-10', quantity: 5, unit_price: 100 }).expect(201)).body;
    await api.post(`/api/users/${u}/holdings/${h.id}/orders`).send({ side: 'sell', date: '2026-01-05', quantity: 1, unit_price: 100 }).expect(400);
    await api.post(`/api/users/${u}/holdings/${h.id}/orders`).send({ side: 'sell', date: '2026-02-01', quantity: 5, unit_price: 110 }).expect(201);
    await api.delete(`/api/users/${u}/holdings/${h.id}/orders/${bought.orders[0].id}`).expect(400);
  });

  it("activer l'option sur un compte existant génère les mouvements des ordres passés", async () => {
    const u = await createUser('Bascule');
    const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Vieux PEA', type: 'pea', currency: 'EUR', initial_balance: 500, initial_balance_date: '2026-01-01', orders_affect_cash: false }).expect(201)).body;
    const h = (await api.post(`/api/users/${u}/holdings`).send({ account_id: acc.id, symbol: 'ESE.PA', name: 'S&P 500' }).expect(201)).body;
    await api.post(`/api/users/${u}/holdings/${h.id}/orders`).send({ side: 'buy', date: '2026-01-10', quantity: 10, unit_price: 30 }).expect(201);
    expect(await cashOf(acc.id)).toBe(0); // ancien comportement : pas de mouvement
    await api.patch(`/api/users/${u}/accounts/${acc.id}`).send({ orders_affect_cash: true }).expect(200);
    expect(await cashOf(acc.id)).toBe(-300);
    await api.patch(`/api/users/${u}/accounts/${acc.id}`).send({ orders_affect_cash: false }).expect(200);
    expect(await cashOf(acc.id)).toBe(0);
  });
});

describe('comptes', () => {
  it('refuse de supprimer un compte qui porte des opérations (archivage proposé)', async () => {
    const u = await createUser('Suppr');
    const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Livret X', type: 'savings', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body;
    await api.post(`/api/users/${u}/transactions`).send({ type: 'income', amount: 10, date: '2026-01-02', account_id: acc.id }).expect(201);
    const res = await api.delete(`/api/users/${u}/accounts/${acc.id}`).expect(409);
    expect(res.body.error).toMatch(/archiv/i);
    // La suppression de l'utilisateur, elle, emporte tout.
    await api.delete(`/api/users/${u}`).expect(200);
  });
});

describe('migration njord', () => {
  it('importe le PEA njord (positions, ordres, versements, espèces) de façon idempotente', async () => {
    const payload = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'njord-demo-export.json'), 'utf8'));
    const u = await createUser('Njord');
    await api.post(`/api/users/${u}/import.json`).send({ payload }).expect(200);
    const second = (await api.post(`/api/users/${u}/import.json`).send({ payload }).expect(200)).body;
    expect(second.transactions.created).toBe(0);
    expect(second.holding_orders.created).toBe(0);

    const pea = (await db.account.findFirst({ where: { user_id: u, name: 'PEA' } }))!;
    expect(pea).toMatchObject({ type: 'pea', orders_affect_cash: true });
    expect(pea.fiscal_start_date?.toISOString().slice(0, 10)).toBe('2022-01-09');
    expect(await db.holdingOrder.count({ where: { user_id: u } })).toBe(12);
    expect(await db.transaction.count({ where: { user_id: u, kind: 'trade' } })).toBe(12);
    // Espèces calculées = versements (3600) − achats (3559).
    expect(await cashOf(pea.id)).toBe(41);
    // Le relevé njord (12,50 €) fait foi pour le solde affiché.
    expect((await db.accountSnapshot.findFirst({ where: { account_id: pea.id } }))?.balance).toBe(12.5);
  });
});
