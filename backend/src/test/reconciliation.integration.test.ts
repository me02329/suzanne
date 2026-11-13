import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
const api = request(app);

describe('rapprochement relevés / opérations', () => {
  it('détecte un écart entre deux relevés et le comble par un ajustement hors statistiques', async () => {
    const u = (await api.post('/api/users').send({ name: 'Rappro' }).expect(201)).body.id as number;
    const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Courant R', type: 'checking', currency: 'EUR', initial_balance: 100, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
    const tx = (body: Record<string, unknown>) => api.post(`/api/users/${u}/transactions`).send({ account_id: acc, ...body }).expect(201);
    await tx({ type: 'income', amount: 1000, date: '2026-01-05' });
    await tx({ type: 'expense', amount: 200, date: '2026-01-31' }); // jour du relevé : compté avant lui
    await api.post(`/api/users/${u}/account-snapshots`).send({ account_id: acc, date: '2026-01-31', balance: 900 }).expect(200);
    await tx({ type: 'expense', amount: 50, date: '2026-02-10' });
    // Relevé de fin février : 800, alors que les opérations donnent 850 → 50 € manquants.
    await api.post(`/api/users/${u}/account-snapshots`).send({ account_id: acc, date: '2026-02-28', balance: 800 }).expect(200);

    const r1 = (await api.get(`/api/users/${u}/accounts/${acc}/reconciliation`).expect(200)).body;
    expect(r1.periods.map((p: { gap: number }) => p.gap)).toEqual([0, -50]);
    expect(r1.unreconciled).toBe(1);

    await api.post(`/api/users/${u}/accounts/${acc}/adjustments`).send({ date: '2026-02-28', amount: -50 }).expect(201);
    const r2 = (await api.get(`/api/users/${u}/accounts/${acc}/reconciliation`).expect(200)).body;
    expect(r2.unreconciled).toBe(0);
    expect(r2.periods[1].adjustments).toBe(-50);

    // L'ajustement n'est ni une dépense ni un revenu.
    const dash = (await api.get(`/api/users/${u}/dashboard?month=2026-02&currency=EUR`).expect(200)).body;
    expect(dash.expenses).toBe(50);
  });
});
