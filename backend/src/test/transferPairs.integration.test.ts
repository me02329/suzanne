import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const api = request(createApp());

async function setup() {
  const u = (await api.post('/api/users').send({ name: 'Virements' }).expect(201)).body.id as number;
  const account = async (name: string) => (await api.post(`/api/users/${u}/accounts`).send({ name, type: 'checking', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
  const tx = async (body: Record<string, unknown>) => (await api.post(`/api/users/${u}/transactions`).send(body).expect(201)).body.id as number;
  return { u, account, tx };
}

describe('virements à relier', () => {
  it('propose la paire, la relie en un virement, ni dépense ni revenu', async () => {
    const { u, account, tx } = await setup();
    const a = await account('Banque A');
    const b = await account('Banque B');
    const tag = (await api.post(`/api/users/${u}/tags`).send({ name: 'épargne' }).expect(201)).body.id as number;
    const out = await tx({ type: 'expense', amount: 300, date: '2026-10-03', account_id: a, description: 'VIR VERS B' });
    const inc = await tx({ type: 'income', amount: 300, date: '2026-10-04', account_id: b, description: 'VIR DE A', tag_ids: [tag] });

    const report = (await api.get(`/api/users/${u}/anomalies`).expect(200)).body as { transfer_pairs: Array<{ out: { id: number }; in: { id: number } }> };
    expect(report.transfer_pairs.map((p) => [p.out.id, p.in.id])).toEqual([[out, inc]]);

    await api.post(`/api/users/${u}/transfer-pairs/link`).send({ out_id: out, in_id: inc }).expect(200);
    const merged = (await api.get(`/api/users/${u}/transactions/${out}`).expect(200)).body;
    expect(merged).toMatchObject({ type: 'transfer', account_id: a, to_account_id: b, amount: 300 });
    expect(merged.tags.map((t: { id: number }) => t.id)).toContain(tag);
    await api.get(`/api/users/${u}/transactions/${inc}`).expect(404);
    const after = (await api.get(`/api/users/${u}/anomalies`).expect(200)).body as { transfer_pairs: unknown[] };
    expect(after.transfer_pairs).toEqual([]);
  });

  it('refuse deux sorties, un même compte, des montants différents ; « pas un virement » masque la paire', async () => {
    const { u, account, tx } = await setup();
    const a = await account('A2');
    const b = await account('B2');
    const o1 = await tx({ type: 'expense', amount: 10, date: '2026-10-01', account_id: a });
    const o2 = await tx({ type: 'expense', amount: 10, date: '2026-10-01', account_id: b });
    await api.post(`/api/users/${u}/transfer-pairs/link`).send({ out_id: o1, in_id: o2 }).expect(400);
    const i1 = await tx({ type: 'income', amount: 12, date: '2026-10-01', account_id: b });
    await api.post(`/api/users/${u}/transfer-pairs/link`).send({ out_id: o1, in_id: i1 }).expect(400);
    const i2 = await tx({ type: 'income', amount: 10, date: '2026-10-01', account_id: b });
    await api.post(`/api/users/${u}/transfer-pairs/dismiss`).send({ out_id: o1, in_id: i2 }).expect(200);
    const report = (await api.get(`/api/users/${u}/anomalies`).expect(200)).body as { transfer_pairs: Array<{ out: { id: number }; in: { id: number } }> };
    expect(report.transfer_pairs.some((p) => p.out.id === o1 && p.in.id === i2)).toBe(false);
  });
});
