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

// Export « opérations » Boursorama : la colonne du montant s'appelle « Solde »
// et une 2e colonne « Solde » contient le solde du compte.
const BOURSO_OPS = [
  '"Date Opération";"Date Valeur";Libellé;"Libellé Suggéré";Catégorie;"Catégorie Parente";Solde;Commentaire;"Numéro Compte";"Libellé Compte";Solde;Pointage',
  '2026-07-09;2026-07-09;"PRLV SEPA BOUYGUES TELECOM";"Bouygues Telecom";"Téléphonie";"Abonnements";-9,99;;0004;BoursoBank;2582.15;Non',
  '2026-07-07;2026-07-07;"TDF EMIS VIA CB WESTERN";"Tdf";"Transfert";"Services";-969,99;;0004;BoursoBank;2592.14;Oui',
  '2026-07-06;2026-07-06;"CARTE 04/07/26 IKEA VELIZY 4 CB*8344";IKEA;"Mobilier";"Vie quotidienne";-149,65;;0004;BoursoBank;3975.12;Non',
  '2026-07-06;2026-07-04;"VIR Secu2";"Vir Secu2";"Virements reçus de comptes à comptes";"Mouvements internes créditeurs";"1 600,00";;0004;BoursoBank;524.77;Non',
  '2026-07-06;2026-07-04;"VIR Secu1 - LIVRET DEVELOPPEMENT DUR";"Vir";"Virements reçus";"Mouvements internes créditeurs";"2 000,00";;0004;BoursoBank;524.77;Non',
].join('\n');
const LIVRET_OPS = [
  '"Date Opération";"Date Valeur";Libellé;"Libellé Suggéré";Catégorie;"Catégorie Parente";Solde;Commentaire;"Numéro Compte";"Libellé Compte";Solde;Pointage',
  '2026-07-06;2026-07-06;"VIR Secu2";"Vir Secu2";"Virements émis de comptes à comptes";"Mouvements internes débiteurs";"-1 600,00";;0002;"LIVRET A";300;Non',
].join('\n');

describe('import CSV : export « opérations » Boursorama', () => {
  it('prend la 1re colonne « Solde » comme montant, le pointage, et relie les virements entre comptes', async () => {
    const { u, acc } = await setup();
    const livret = (await api.post(`/api/users/${u}/accounts`).send({ name: 'Livret A', type: 'livret_a', currency: 'EUR', initial_balance: 0, initial_balance_date: '2026-01-01' }).expect(201)).body.id as number;

    const r1 = (await api.post(`/api/users/${u}/import.csv`).send({ csv: BOURSO_OPS, account_id: acc }).expect(200)).body;
    expect(r1.imported).toBe(5);
    const lines = await db.transactionLine.findMany({ where: { user_id: u, account_id: acc }, include: { transaction: true } });
    expect(Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100).toBe(2470.37); // -9,99 -969,99 -149,65 +1600 +2000
    expect(lines.find((l) => l.amount === -969.99)?.transaction.cleared).toBe(true);

    const r2 = (await api.post(`/api/users/${u}/import.csv`).send({ csv: LIVRET_OPS, account_id: livret }).expect(200)).body;
    expect(r2.linked_transfers).toHaveLength(1);
    expect(r2.imported).toBe(0);
    const secu2 = await db.transaction.findFirst({ where: { user_id: u, description: 'VIR Secu2' }, include: { lines: true } });
    expect(secu2?.kind).toBe('transfer');
    expect(secu2?.lines.map((l) => [l.account_id, l.amount]).sort()).toEqual([[acc, 1600], [livret, -1600]].sort());
    // Ni revenu ni dépense : le virement disparaît des flux du mois.
    const dash = (await api.get(`/api/users/${u}/dashboard?month=2026-07&currency=EUR`).expect(200)).body;
    expect(dash.income).toBe(2000); // Secu1 (contrepartie LDDS non importée) reste un revenu
  });

  it('« Solde (2) » désigne la 2e colonne Solde (le solde du compte), refusée comme montant', async () => {
    const { acc } = await setup();
    const u = (await db.account.findUniqueOrThrow({ where: { id: acc } })).user_id;
    const res = await api.post(`/api/users/${u}/import.csv`)
      .send({ csv: BOURSO_OPS, account_id: acc, mapping: { date: 'Date Opération', amount: 'Solde (2)', description: 'Libellé' } })
      .expect(400);
    expect(res.body.error).toMatch(/ressemble à un solde/);
  });
});
