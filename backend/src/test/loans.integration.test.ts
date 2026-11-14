import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
const api = request(app);

async function setup() {
  const u = (await api.post('/api/users').send({ name: 'Prêts' }).expect(201)).body.id as number;
  const account = async (name: string, type: string) =>
    (await api.post(`/api/users/${u}/accounts`).send({ name, type, currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
  const courant = await account('Courant P', 'checking');
  const maison = (await api.post(`/api/users/${u}/categories`).send({ name: 'P Maison', type: 'expense', color: '#111111' }).expect(201)).body.id as number;
  const tx = (body: Record<string, unknown>) => api.post(`/api/users/${u}/transactions`).send(body).expect(201);
  const loans = async () => (await api.get(`/api/users/${u}/loans`).expect(200)).body as Array<Record<string, unknown> & { name: string; movements: unknown[]; series: unknown[] }>;
  return { u, account, courant, maison, tx, loans };
}

describe('prêts : un compte par prêt', () => {
  it('emprunt reçu puis remboursé : principal, remboursé, reste, terminé', async () => {
    const { account, courant, tx, loans } = await setup();
    const papa = await account('Prêt — Papa', 'loan');
    await tx({ type: 'transfer', amount: 2000, date: '2026-02-01', account_id: papa, to_account_id: courant });
    await tx({ type: 'transfer', amount: 500, date: '2026-03-01', account_id: courant, to_account_id: papa });
    let [loan] = await loans();
    expect(loan).toMatchObject({ direction: 'borrowed', principal: 2000, repaid: 500, outstanding: 1500, status: 'active', start_date: '2026-02-01', last_repayment_date: '2026-03-01' });
    await tx({ type: 'transfer', amount: 1500, date: '2026-04-01', account_id: courant, to_account_id: papa });
    [loan] = await loans();
    expect(loan).toMatchObject({ outstanding: 0, status: 'settled', settled_date: '2026-04-01' });
    expect(loan!.series).toHaveLength(3);
  });

  it('achat payé par un proche : la dépense compte, la dette se crée sans virement', async () => {
    const { u, account, courant, maison, tx, loans } = await setup();
    const papa = await account('Prêt — Papa', 'loan');
    await tx({ type: 'expense', amount: 800, date: '2026-02-10', account_id: papa, category_id: maison, description: 'Canapé (payé par Papa)' });
    await tx({ type: 'transfer', amount: 300, date: '2026-03-10', account_id: courant, to_account_id: papa });
    const [loan] = await loans();
    expect(loan).toMatchObject({ principal: 800, repaid: 300, outstanding: 500, status: 'active' });
    const stats = (await api.get(`/api/users/${u}/statistics?range=custom&from=2026-01-01&to=2026-12-31&currency=EUR&exclude_uncategorized=false`).expect(200)).body;
    expect(stats.total_expenses).toBe(800); // le canapé est une vraie dépense, le remboursement n'en est pas une
  });

  it('prêt accordé : on me doit le solde du compte', async () => {
    const { account, courant, tx, loans } = await setup();
    const ami = await account('Prêt à Alex', 'receivable');
    await tx({ type: 'transfer', amount: 300, date: '2026-02-01', account_id: courant, to_account_id: ami });
    await tx({ type: 'transfer', amount: 100, date: '2026-02-20', account_id: ami, to_account_id: courant });
    const [loan] = await loans();
    expect(loan).toMatchObject({ direction: 'lent', principal: 300, repaid: 100, outstanding: 200, status: 'active' });
  });
});
