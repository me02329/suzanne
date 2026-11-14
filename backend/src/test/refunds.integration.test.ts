import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
const api = request(app);

async function setup() {
  const u = (await api.post('/api/users').send({ name: 'Rembourse' }).expect(201)).body.id as number;
  const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Courant R', type: 'checking', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
  const cat = async (name: string, type: 'expense' | 'income' = 'expense') =>
    (await api.post(`/api/users/${u}/categories`).send({ name, type, color: '#111111' }).expect(201)).body.id as number;
  const sante = await cat('R Santé');
  const transport = await cat('R Transport');
  const loisirs = await cat('R Loisirs');
  const autre = await cat('R Autre revenu', 'income');
  const expense = (await api.post(`/api/users/${u}/transactions`).send({ type: 'expense', amount: 100, date: '2026-03-02', account_id: acc, category_id: sante }).expect(201)).body.id as number;
  const refund = (await api.post(`/api/users/${u}/transactions`).send({ type: 'income', amount: 60, date: '2026-03-20', account_id: acc, refunds_transaction_id: expense }).expect(201)).body.id as number;
  const refundLines = async () => (await api.get(`/api/users/${u}/transactions/${refund}`).expect(200)).body.lines as Array<{ category_id: number; amount: number; refund: boolean; refund_of_id: number }>;
  return { u, acc, sante, transport, loisirs, autre, expense, refund, refundLines };
}

describe('remboursements : toujours dans la catégorie de la dépense', () => {
  it('suit le changement de catégorie de la dépense', async () => {
    const { u, transport, expense, refundLines } = await setup();
    await api.patch(`/api/users/${u}/transactions/${expense}`).send({ category_id: transport }).expect(200);
    const lines = await refundLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ category_id: transport, amount: 60, refund: true, refund_of_id: expense });
  });

  it('suit la ventilation de la dépense, au prorata', async () => {
    const { u, sante, loisirs, expense, refundLines } = await setup();
    await api.patch(`/api/users/${u}/transactions/${expense}`)
      .send({ splits: [{ category_id: sante, amount: 75 }, { category_id: loisirs, amount: 25 }] }).expect(200);
    const lines = (await refundLines()).sort((a, b) => b.amount - a.amount);
    expect(lines.map((l) => [l.category_id, l.amount])).toEqual([[sante, 45], [loisirs, 15]]);
    expect(lines.every((l) => l.refund && l.refund_of_id === expense)).toBe(true);
  });

  it('la modification en lot ne change pas la catégorie d\'un remboursement, mais la dépense l\'entraîne', async () => {
    const { u, sante, transport, autre, expense, refund, refundLines } = await setup();
    await api.post(`/api/users/${u}/transactions/bulk-update`).send({ ids: [refund], category_id: autre }).expect(200);
    expect((await refundLines())[0]).toMatchObject({ category_id: sante, refund: true });
    await api.post(`/api/users/${u}/transactions/bulk-update`).send({ ids: [expense], category_id: transport }).expect(200);
    expect((await refundLines())[0]).toMatchObject({ category_id: transport, amount: 60, refund: true });
  });
});
