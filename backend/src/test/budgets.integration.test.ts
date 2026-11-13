import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
const api = request(app);

async function setup() {
  const u = (await api.post('/api/users').send({ name: 'Budget' }).expect(201)).body.id as number;
  const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Courant B', type: 'checking', currency: 'EUR', initial_balance: 0, initial_balance_date: '2025-01-01' }).expect(201)).body.id as number;
  const cat = async (name: string) => (await api.post(`/api/users/${u}/categories`).send({ name, type: 'expense', color: '#111111' }).expect(201)).body.id as number;
  const courses = await cat('B Courses');
  const vacances = await cat('B Vacances');
  const spend = (amount: number, date: string, category_id: number) =>
    api.post(`/api/users/${u}/transactions`).send({ type: 'expense', amount, date, account_id: acc, category_id }).expect(201);
  return { u, acc, courses, vacances, spend };
}

describe('budgets : vue d\'ensemble, global, rythme', () => {
  it('calcule le reste à vivre, la reconduction du global et le statut des enveloppes', async () => {
    const { u, courses, spend } = await setup();
    await api.put(`/api/users/${u}/budgets/global`).send({ month: '2026-03', amount_limit: 1000 }).expect(200);
    await api.post(`/api/users/${u}/budgets`).send({ category_id: courses, month: '2026-03', amount_limit: 200 }).expect(200);
    await spend(150, '2026-03-05', courses);
    await spend(90, '2026-03-20', courses);

    const march = (await api.get(`/api/users/${u}/budgets/overview?month=2026-03&currency=EUR`).expect(200)).body;
    expect(march.total_spent).toBe(240);
    expect(march.global).toMatchObject({ amount_limit: 1000, spent: 240, remaining: 760 });
    expect(march.categories[0]).toMatchObject({ spent: 240, pace: { status: 'over' } });

    // Le budget global est reconduit au mois suivant.
    const april = (await api.get(`/api/users/${u}/budgets/overview?month=2026-04&currency=EUR`).expect(200)).body;
    expect(april.global?.amount_limit).toBe(1000);

    // Alerte automatique de dépassement, sans configuration.
    const alerts = (await api.get(`/api/users/${u}/alerts/triggered?month=2026-03&currency=EUR`).expect(200)).body;
    expect(alerts.some((a: { type: string; message: string }) => a.type === 'budget' && a.message.includes('B Courses'))).toBe(true);

    // Supprimer le global arrête la reconduction.
    await api.delete(`/api/users/${u}/budgets/global/2026-05`).expect(200);
    const june = (await api.get(`/api/users/${u}/budgets/overview?month=2026-06&currency=EUR`).expect(200)).body;
    expect(june.global).toBeNull();
  });

  it('suggère des plafonds (médiane des 6 derniers mois) et donne l\'historique', async () => {
    const { u, courses, spend } = await setup();
    for (const [m, a] of [['2025-09', 210], ['2025-10', 190], ['2025-11', 205], ['2025-12', 900], ['2026-01', 198], ['2026-02', 202]] as const) {
      await spend(a, `${m}-10`, courses);
    }
    const s = (await api.get(`/api/users/${u}/budgets/suggestions?month=2026-03&currency=EUR`).expect(200)).body;
    expect(s.categories.find((c: { name: string }) => c.name === 'B Courses')).toMatchObject({ suggested: 205, months_used: 6 });
    const h = (await api.get(`/api/users/${u}/budgets/history?month=2026-02&months=3&currency=EUR`).expect(200)).body;
    expect(h.map((x: { month: string; total_spent: number }) => [x.month, x.total_spent])).toEqual([['2025-12', 900], ['2026-01', 198], ['2026-02', 202]]);
  });

  it('suit une provision : cagnotte lissée moins les dépenses du cycle', async () => {
    const { u, vacances, spend } = await setup();
    await api.post(`/api/users/${u}/sinking-funds`).send({ name: 'Vacances', category_id: vacances, target_amount: 1200, period_months: 12, start_month: '2026-01' }).expect(201);
    await spend(250, '2026-02-15', vacances);
    const o = (await api.get(`/api/users/${u}/budgets/overview?month=2026-04&currency=EUR`).expect(200)).body;
    expect(o.sinking_funds[0]).toMatchObject({ name: 'Vacances', monthly_contribution: 100, accrued: 400, spent: 250, available: 150 });
    // Une provision ne se rattache qu'à une catégorie de dépense possédée.
    await api.post(`/api/users/${u}/sinking-funds`).send({ name: 'X', category_id: 999999, target_amount: 10, start_month: '2026-01' }).expect(400);
  });
});

describe('budgets dans la sauvegarde', () => {
  it('exporte et restaure budget global et provisions sans doublon', async () => {
    const { u, vacances } = await setup();
    await api.put(`/api/users/${u}/budgets/global`).send({ month: '2026-03', amount_limit: 1500 }).expect(200);
    await api.post(`/api/users/${u}/sinking-funds`).send({ name: 'Vacances', category_id: vacances, target_amount: 1200, start_month: '2026-01' }).expect(201);
    const payload = (await api.get(`/api/users/${u}/export.json`).expect(200)).body;
    const target = (await api.post('/api/users').send({ name: 'Budget cible' }).expect(201)).body.id as number;
    await api.post(`/api/users/${target}/import.json`).send({ payload }).expect(200);
    const again = (await api.post(`/api/users/${target}/import.json`).send({ payload }).expect(200)).body;
    expect(again.sinking_funds).toMatchObject({ created: 0, reused: 1 });
    const o = (await api.get(`/api/users/${target}/budgets/overview?month=2026-03&currency=EUR`).expect(200)).body;
    expect(o.global?.amount_limit).toBe(1500);
    expect(o.sinking_funds).toHaveLength(1);
    expect(o.sinking_funds[0].category_id).not.toBeNull();
  });
});
