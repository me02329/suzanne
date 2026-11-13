import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prismaBase as db } from '../prisma';

const app = createApp();
const api = request(app);

async function setup(name: string) {
  const u = (await api.post('/api/users').send({ name }).expect(201)).body.id as number;
  const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Courant U', type: 'checking', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
  return { u, acc };
}

describe('identité stable (uid) et empreintes d\'import', () => {
  it('une restauration reconnaît comptes et opérations modifiés depuis la sauvegarde', async () => {
    const { u, acc } = await setup('Uid');
    const tx = (await api.post(`/api/users/${u}/transactions`).send({ type: 'expense', amount: 12.5, date: '2026-03-01', account_id: acc, description: 'Boulangerie' }).expect(201)).body;
    const backup = (await api.get(`/api/users/${u}/export.json`).expect(200)).body;
    expect(backup.accounts.find((a: { name: string }) => a.name === 'Courant U').uid).toMatch(/^[0-9a-f-]{36}$/);

    // Après la sauvegarde : compte renommé, opération modifiée (libellé ET montant).
    await api.patch(`/api/users/${u}/accounts/${acc}`).send({ name: 'Bourso courant' }).expect(200);
    await api.patch(`/api/users/${u}/transactions/${tx.id}`).send({ description: 'Boulangerie Paul', amount: 13 }).expect(200);

    const res = (await api.post(`/api/users/${u}/import.json`).send({ payload: backup }).expect(200)).body;
    expect(res.accounts).toMatchObject({ created: 0 });
    expect(res.transactions).toMatchObject({ created: 0 });
    expect(await db.account.count({ where: { user_id: u, name: { in: ['Courant U', 'Bourso courant'] } } })).toBe(1);
    expect(await db.transaction.count({ where: { user_id: u } })).toBe(1);
  });

  it('copier une sauvegarde vers un autre profil donne de nouvelles identités', async () => {
    const { u } = await setup('Uid A');
    const backup = (await api.get(`/api/users/${u}/export.json`).expect(200)).body;
    const other = (await api.post('/api/users').send({ name: 'Uid B' }).expect(201)).body.id as number;
    await api.post(`/api/users/${other}/import.json`).send({ payload: backup }).expect(200);
    const a = await db.account.findFirst({ where: { user_id: u, name: 'Courant U' } });
    const b = await db.account.findFirst({ where: { user_id: other, name: 'Courant U' } });
    expect(b).not.toBeNull();
    expect(b!.uid).not.toBe(a!.uid);
  });

  it('réimporter un relevé ne duplique rien, même après avoir renommé les opérations', async () => {
    const { u, acc } = await setup('Empreinte');
    const csv = 'date;label;amount\n2026-03-02;CARTE CAFE;-2,10\n2026-03-02;CARTE CAFE;-2,10\n2026-03-03;PRLV EDF;-61,00';
    expect((await api.post(`/api/users/${u}/import.csv`).send({ csv, account_id: acc }).expect(200)).body.imported).toBe(3); // deux cafés identiques gardés
    const edf = await db.transaction.findFirst({ where: { user_id: u, description: 'PRLV EDF' } });
    await api.patch(`/api/users/${u}/transactions/${edf!.id}`).send({ description: 'Électricité' }).expect(200);
    const again = (await api.post(`/api/users/${u}/import.csv`).send({ csv, account_id: acc }).expect(200)).body;
    expect(again.imported).toBe(0);
    expect(await db.transaction.count({ where: { user_id: u } })).toBe(3);
  });
});
