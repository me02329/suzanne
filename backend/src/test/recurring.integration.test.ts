import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { generateDueRecurringTransactions } from '../routes/recurring';
import { prisma } from '../prisma';

const api = request(createApp());
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function setup(name: string) {
  const u = (await api.post('/api/users').send({ name }).expect(201)).body.id as number;
  const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Courant', type: 'checking', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
  const cat = (await api.post(`/api/users/${u}/categories`).send({ name: 'Abonnements', type: 'expense', color: '#123456' }).expect(201)).body.id as number;
  // Mensuel le 5, déjà exécuté en septembre : prochaine occurrence le 5 octobre.
  const rec = (await api.post(`/api/users/${u}/recurring-transactions`).send({
    account_id: acc, category_id: cat, amount: 49.9, type: 'expense', description: 'Box internet', frequency: 'monthly', interval: 1, day_of_month: 5,
  }).expect(201)).body.id as number;
  await prisma.recurringTransaction.update({ where: { id: rec }, data: { last_executed: day('2026-09-05') } });
  return { u, acc, cat, rec };
}

const occurrences = (u: number) => prisma.transaction.findMany({
  where: { user_id: u },
  select: { id: true, date: true, description: true, recurring_transaction_id: true, lines: { select: { amount: true, category_id: true } } },
});

async function linkToBank(u: number, acc: number) {
  const connection = await prisma.bankConnection.create({ data: { user_id: u, aspsp_name: 'Banque Test', aspsp_country: 'FR', session_id: `s-${u}`, valid_until: day('2027-01-01') } });
  await prisma.bankLink.create({ data: { user_id: u, connection_id: connection.id, remote_uid: `r-${u}`, account_id: acc } });
}

describe('récurrents : pas de doublon avec une opération déjà là', () => {
  it('rattache l’opération arrivée avant la date prévue au lieu d’en créer une seconde', async () => {
    const { u, acc, cat, rec } = await setup('Récurrent après banque');
    // La banque a déjà apporté le prélèvement le 3, sans catégorie.
    const bank = (await api.post(`/api/users/${u}/transactions`).send({ type: 'expense', amount: 49.9, date: '2026-10-03', account_id: acc, description: 'PRLV SEPA FOURNISSEUR BOX' }).expect(201)).body.id as number;

    expect(await generateDueRecurringTransactions(u, day('2026-10-20'))).toBe(0);
    const txs = await occurrences(u);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ id: bank, description: 'PRLV SEPA FOURNISSEUR BOX', recurring_transaction_id: rec });
    expect(txs[0]!.lines[0]!.category_id).toBe(cat); // complétée par le modèle
    expect((await prisma.recurringTransaction.findUnique({ where: { id: rec } }))!.last_executed).toEqual(day('2026-10-05'));
  });

  it('ne rattache pas un montant différent ni une opération déjà liée', async () => {
    const { u, acc } = await setup('Récurrent montant différent');
    await api.post(`/api/users/${u}/transactions`).send({ type: 'expense', amount: 52.3, date: '2026-10-05', account_id: acc, description: 'Autre chose' }).expect(201);
    expect(await generateDueRecurringTransactions(u, day('2026-10-20'))).toBe(1);
    expect(await occurrences(u)).toHaveLength(2);
  });
});

describe('récurrents : compte synchronisé, on attend la banque', () => {
  it('ne crée rien tant que la banque peut encore apporter l’opération, puis la rattache', async () => {
    const { u, acc, rec } = await setup('Récurrent attend');
    await linkToBank(u, acc);

    // Le 7 : rien encore de la banque → on attend, aucune opération inventée.
    expect(await generateDueRecurringTransactions(u, day('2026-10-07'))).toBe(0);
    expect(await occurrences(u)).toHaveLength(0);
    expect((await prisma.recurringTransaction.findUnique({ where: { id: rec } }))!.last_executed).toEqual(day('2026-09-05'));

    // Le 8, la banque apporte le prélèvement (daté du 6) : rattaché.
    await api.post(`/api/users/${u}/transactions`).send({ type: 'expense', amount: 49.9, date: '2026-10-06', account_id: acc, description: 'PRLV BOX' }).expect(201);
    expect(await generateDueRecurringTransactions(u, day('2026-10-08'))).toBe(0);
    const txs = await occurrences(u);
    expect(txs).toHaveLength(1);
    expect(txs[0]!.recurring_transaction_id).toBe(rec);
  });

  it('crée l’occurrence si la banque n’a toujours rien apporté 5 jours après', async () => {
    const { u, acc } = await setup('Récurrent filet');
    await linkToBank(u, acc);
    expect(await generateDueRecurringTransactions(u, day('2026-10-10'))).toBe(0);
    expect(await generateDueRecurringTransactions(u, day('2026-10-11'))).toBe(1);
    expect(await occurrences(u)).toHaveLength(1);
  });
});
