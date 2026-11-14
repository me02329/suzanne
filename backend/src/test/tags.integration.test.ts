import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
const api = request(app);

// Tags comme 2e classement : règles de tag (import + application), filtre des
// statistiques, exclusion des budgets, sauvegarde.
let seq = 0;
async function setup() {
  seq += 1;
  const u = (await api.post('/api/users').send({ name: `Tags ${seq}` }).expect(201)).body.id as number;
  const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Courant T', type: 'checking', currency: 'EUR', initial_balance: 0, initial_balance_date: '2025-01-01' }).expect(201)).body.id as number;
  const transport = (await api.post(`/api/users/${u}/categories`).send({ name: 'Transport T', type: 'expense', color: '#111111' }).expect(201)).body.id as number;
  const work = (await api.post(`/api/users/${u}/tags`).send({ name: 'Travail' }).expect(201)).body.id as number;
  const spend = (amount: number, description: string, tag_ids: number[] = []) =>
    api.post(`/api/users/${u}/transactions`).send({ type: 'expense', amount, date: '2026-03-10', account_id: acc, category_id: transport, description, tag_ids }).expect(201);
  return { u, acc, transport, work, spend };
}

describe('règles de tag', () => {
  it('posent le tag à l’import et sur les opérations existantes', async () => {
    const { u, acc, work, spend } = await setup();
    await spend(40, 'SNCF Paris Lyon');
    await spend(12, 'Boulangerie');
    await api.post(`/api/users/${u}/tag-rules`).send({ pattern: 'sncf', tag_id: work }).expect(200);

    const applied = (await api.post(`/api/users/${u}/tag-rules/apply`).expect(200)).body;
    expect(applied).toMatchObject({ tagged: 1, links: 1 });
    // Idempotent.
    expect((await api.post(`/api/users/${u}/tag-rules/apply`).expect(200)).body.tagged).toBe(0);

    const csv = 'date;label;amount\n12/03/2026;SNCF Retour;-38,00\n13/03/2026;Cinéma;-9,50\n';
    await api.post(`/api/users/${u}/import.csv`).send({ csv, account_id: acc, mapping: { date: 'date', amount: 'amount', description: 'label' } }).expect(200);
    const summary = (await api.get(`/api/users/${u}/tags/summary`).expect(200)).body;
    expect(summary.find((s: { tag_id: number }) => s.tag_id === work)).toMatchObject({ count: 2, expenses: 78 });
  });

  it('refuse le tag d’un autre utilisateur', async () => {
    const { u } = await setup();
    const other = await setup();
    await api.post(`/api/users/${u}/tag-rules`).send({ pattern: 'x', tag_id: other.work }).expect(400);
  });
});

describe('tags dans les statistiques et les budgets', () => {
  it('filtre les statistiques et sort un tag des budgets', async () => {
    const { u, work, spend } = await setup();
    await spend(100, 'Train séminaire', [work]);
    await spend(30, 'Bus perso');

    const only = (await api.get(`/api/users/${u}/statistics?from=2026-03-01&to=2026-03-31&tag_id=${work}&tag_mode=include`).expect(200)).body;
    const except = (await api.get(`/api/users/${u}/statistics?from=2026-03-01&to=2026-03-31&tag_id=${work}&tag_mode=exclude`).expect(200)).body;
    expect(only.total_expenses).toBe(100);
    expect(except.total_expenses).toBe(30);

    const before = (await api.get(`/api/users/${u}/budgets/overview?month=2026-03&currency=EUR`).expect(200)).body;
    expect(before.total_spent).toBe(130);
    await api.patch(`/api/users/${u}/tags/${work}`).send({ exclude_from_budgets: true }).expect(200);
    const after = (await api.get(`/api/users/${u}/budgets/overview?month=2026-03&currency=EUR`).expect(200)).body;
    expect(after.total_spent).toBe(30);
  });
});

describe('sauvegarde', () => {
  it('conserve les règles de tag et l’exclusion des budgets', async () => {
    const { u, work } = await setup();
    await api.patch(`/api/users/${u}/tags/${work}`).send({ exclude_from_budgets: true }).expect(200);
    await api.post(`/api/users/${u}/tag-rules`).send({ pattern: 'SNCF', tag_id: work }).expect(200);
    const payload = (await api.get(`/api/users/${u}/export.json`).expect(200)).body;
    expect(payload.tag_rules).toEqual([expect.objectContaining({ pattern: 'SNCF', tag_name: 'Travail' })]);

    const target = (await api.post('/api/users').send({ name: 'Tags cible' }).expect(201)).body.id as number;
    const summary = (await api.post(`/api/users/${target}/import.json`).send({ payload }).expect(200)).body;
    expect(summary.tag_rules).toMatchObject({ created: 1 });
    const tags = (await api.get(`/api/users/${target}/tags`).expect(200)).body;
    expect(tags.find((t: { name: string }) => t.name === 'Travail')).toMatchObject({ exclude_from_budgets: true });
    const rules = (await api.get(`/api/users/${target}/tag-rules`).expect(200)).body;
    expect(rules).toHaveLength(1);
    // Réimport : rien de dupliqué.
    const again = (await api.post(`/api/users/${target}/import.json`).send({ payload }).expect(200)).body;
    expect(again.tag_rules).toMatchObject({ created: 0, reused: 1 });
  });
});
