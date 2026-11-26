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

describe('prêts : rattacher une opération existante', () => {
  it('une mensualité apportée par la banque devient le remboursement, intérêts à part', async () => {
    const { u, account, courant, maison, tx, loans } = await setup();
    const auto = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Prêt auto', type: 'loan', currency: 'EUR', initial_balance: -12000, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
    void account;
    // Arrivée de la banque comme une dépense, déjà catégorisée par erreur.
    const bank = (await tx({ type: 'expense', amount: 312.4, date: '2026-10-05', account_id: courant, category_id: maison, description: 'PRLV ORGANISME CREDIT' })).body.id as number;
    const balanceBefore = (await api.get(`/api/users/${u}/accounts`).expect(200)).body.find((a: { id: number }) => a.id === courant);

    const candidates = (await api.get(`/api/users/${u}/loans/${auto}/candidates`).expect(200)).body as Array<{ transaction_id: number }>;
    expect(candidates.map((c) => c.transaction_id)).toContain(bank);

    const linked = (await api.post(`/api/users/${u}/loans/${auto}/link`).send({ transaction_id: bank, interest_amount: 40.15, interest_category_id: maison }).expect(200)).body;
    expect(linked).toMatchObject({ principal: 272.25, interest: 40.15 });

    const moved = (await api.get(`/api/users/${u}/transactions/${bank}`).expect(200)).body;
    expect(moved).toMatchObject({ type: 'transfer', amount: 272.25, account_id: courant, to_account_id: auto, description: 'PRLV ORGANISME CREDIT' });
    const loan = (await loans()).find((l) => l.account_id === auto)!;
    expect(loan).toMatchObject({ outstanding: 11727.75, repaid: 272.25 });
    // Le compte courant n'a pas bougé : 272,25 de virement + 40,15 de dépense.
    const balanceAfter = (await api.get(`/api/users/${u}/accounts`).expect(200)).body.find((a: { id: number }) => a.id === courant);
    expect(balanceAfter?.balance ?? null).toEqual(balanceBefore?.balance ?? null);
    const all = (await api.get(`/api/users/${u}/transactions?period=all`).expect(200)).body as Array<{ type: string; amount: number; category_id: number | null }>;
    expect(all.filter((t) => t.type === 'expense')).toEqual([expect.objectContaining({ amount: 40.15, category_id: maison })]);

    // Déjà rattachée : plus proposée, et refusée une seconde fois.
    const again = (await api.get(`/api/users/${u}/loans/${auto}/candidates`).expect(200)).body as Array<{ transaction_id: number }>;
    expect(again.map((c) => c.transaction_id)).not.toContain(bank);
    await api.post(`/api/users/${u}/loans/${auto}/link`).send({ transaction_id: bank }).expect(400);
  });

  it('refuse le mauvais sens et des intérêts supérieurs à la mensualité', async () => {
    const { u, courant, tx } = await setup();
    const auto = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Prêt', type: 'loan', currency: 'EUR', initial_balance: -1000, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
    const salary = (await tx({ type: 'income', amount: 100, date: '2026-10-01', account_id: courant, description: 'Salaire' })).body.id as number;
    await api.post(`/api/users/${u}/loans/${auto}/link`).send({ transaction_id: salary }).expect(400);
    const pay = (await tx({ type: 'expense', amount: 100, date: '2026-10-02', account_id: courant, description: 'Mensualité' })).body.id as number;
    await api.post(`/api/users/${u}/loans/${auto}/link`).send({ transaction_id: pay, interest_amount: 100 }).expect(400);
  });
});
