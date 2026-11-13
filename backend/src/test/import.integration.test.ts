import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prismaBase as db } from '../prisma';

const app = createApp();
const api = request(app);

// Extrait au format réel du CSV Boursorama : `amount` (signé) côtoie
// `accountbalance` (solde du jour, identique pour toutes les lignes du jour).
const BOURSO = [
  'dateOp;dateVal;label;category;categoryParent;supplierFound;amount;comment;accountNum;accountLabel;accountbalance',
  '2026-07-20;2026-07-20;CARTE 18/07/26 INTERMARCHE CB*3277;Courses;Alimentation;intermarche;-23,40;;0001;Compte;1408,13',
  '2026-07-20;2026-07-20;PRLV SEPA EDF clients particuliers;Energie;Logement;edf;-61,00;;0001;Compte;1408,13',
  '2026-07-20;2026-07-20;PRLV SEPA PayPal Europe;Achats;Divers;paypal;-12,99;;0001;Compte;1408,13',
  '2026-07-15;2026-07-15;CARTE 13/07/26 AUCHAN VELIZY;Courses;Alimentation;auchan;-48,10;;0001;Compte;1944,73',
  '2026-07-15;2026-07-15;PRLV SEPA NCD FITNESS;Sport;Loisirs;ncd;-29,99;;0001;Compte;1944,73',
  '2026-07-15;2026-07-15;CARTE 12/07/26 LES COULEURS;Restaurant;Loisirs;;-17,50;;0001;Compte;1944,73',
  '2026-07-29;2026-07-29;VIR SEPA HEADMIND PARTNERS FRANCE;Salaire;Revenus;;2319,32;;0001;Compte;2319,32',
].join('\n');

async function setup() {
  const u = (await api.post('/api/users').send({ name: 'Import' }).expect(201)).body.id as number;
  const acc = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Bourso', type: 'checking', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;
  return { u, acc };
}

describe('import CSV : garde-fous', () => {
  it('refuse la colonne solde prise pour le montant (cas Boursorama)', async () => {
    const { u, acc } = await setup();
    const res = await api.post(`/api/users/${u}/import.csv`).send({
      csv: BOURSO, account_id: acc, mapping: { date: 'dateOp', amount: 'accountbalance', description: 'label' },
    }).expect(400);
    expect(res.body.error).toMatch(/solde/);
    expect(await db.transaction.count({ where: { user_id: u } })).toBe(0);
  });

  it('importe correctement avec la colonne amount (signes respectés)', async () => {
    const { u, acc } = await setup();
    const res = await api.post(`/api/users/${u}/import.csv`).send({ csv: BOURSO, account_id: acc }).expect(200);
    expect(res.body.imported).toBe(7);
    const lines = await db.transactionLine.findMany({ where: { user_id: u } });
    expect(lines.filter((l) => l.amount < 0)).toHaveLength(6);
    expect(Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100).toBe(2126.34);
  });

  it('remplace la projection d\'un récurrent par la ligne réelle du relevé', async () => {
    const { u, acc } = await setup();
    const salaire = await db.category.create({ data: { user_id: u, name: 'Salaire I', type: 'income' } });
    const rec = await db.recurringTransaction.create({
      data: { user_id: u, account_id: acc, category_id: salaire.id, amount: 2663.99, type: 'income', description: 'Salaire - Headmind', frequency: 'monthly', day_of_month: 26 },
    });
    // Projection générée par le planificateur (libellé et montant du modèle).
    await db.transaction.create({
      data: { user_id: u, kind: 'standard', date: new Date('2026-07-26'), description: 'Salaire - Headmind', recurring_transaction_id: rec.id, lines: { create: [{ user_id: u, account_id: acc, category_id: salaire.id, amount: 2663.99 }] } },
    });
    const res = await api.post(`/api/users/${u}/import.csv`).send({ csv: BOURSO, account_id: acc }).expect(200);
    expect(res.body.recurring_replaced).toHaveLength(1);
    const salaries = await db.transaction.findMany({ where: { user_id: u, recurring_transaction_id: rec.id }, include: { lines: true } });
    // Une seule opération de salaire : la vraie (2319,32), rattachée au récurrent.
    expect(salaries).toHaveLength(1);
    expect(salaries[0]!.lines[0]!.amount).toBe(2319.32);
  });
});
