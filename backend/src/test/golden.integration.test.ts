import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

// Test « golden » : un jeu de données couvrant tous les cas délicats (splits,
// remboursements simples / partiels / multiples, virements avec frais, carte de
// crédit, opérations sans compte, relevé en écart, budgets reportés, factures)
// est saisi via l'API, puis TOUS les chiffres calculés sont comparés à une
// capture de référence. Sert de filet pendant les refontes du modèle de données.
//
// GOLDEN=write  → (ré)écrit la capture de référence.
// GOLDEN=skip-seed → ne saisit rien : compare les données déjà en base (ex.
//                    une base restaurée puis migrée — test de la migration).

const app = createApp();
const api = request(app);
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, 'fixtures', 'golden.json');
const mode = process.env.GOLDEN ?? 'compare';

async function post(url: string, body: unknown) {
  const res = await api.post(`/api${url}`).send(body as object);
  if (res.status >= 300) throw new Error(`${url} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function seedGolden(): Promise<number> {
  const u = (await post('/users', { name: 'Golden' })).id as number;
  const acc = async (name: string, type: string, initial_balance: number, initial_balance_date: string) =>
    (await post(`/users/${u}/accounts`, { name, type, currency: 'EUR', initial_balance, initial_balance_date })).id as number;
  const courant = await acc('G Courant', 'checking', 1000, '2026-01-01');
  const livret = await acc('G Livret', 'savings', 5000, '2026-01-01');
  const carte = await acc('G Carte', 'credit', 0, '2026-01-01');
  const especes = await acc('G Espèces', 'cash', 0, '2026-03-01');
  const cat = async (name: string, type: 'expense' | 'income') => (await post(`/users/${u}/categories`, { name, type, color: '#123456' })).id as number;
  const courses = await cat('G Courses', 'expense');
  const loisirs = await cat('G Loisirs', 'expense');
  const sante = await cat('G Santé', 'expense');
  const salaire = await cat('G Salaire', 'income');
  const tag = (await post(`/users/${u}/tags`, { name: 'G vacances', color: '#ff0000' })).id as number;
  const tx = async (body: Record<string, unknown>) => (await post(`/users/${u}/transactions`, body)).id as number;

  for (const m of ['01', '02', '03', '04', '05']) {
    await tx({ type: 'income', amount: 2500, date: `2026-${m}-05`, account_id: courant, category_id: salaire, description: 'Salaire' });
  }
  const t2 = await tx({ type: 'expense', amount: 120, date: '2026-01-10', account_id: courant, category_id: courses, description: 'Supermarché', cleared: true });
  const t3 = await tx({
    type: 'expense', amount: 200, date: '2026-01-12', account_id: courant, description: 'Achat mixte', tag_ids: [tag],
    splits: [{ category_id: courses, amount: 150 }, { category_id: loisirs, amount: 50, note: 'cinéma' }],
  });
  const t4 = await tx({ type: 'expense', amount: 80, date: '2026-01-20', account_id: carte, category_id: sante, description: 'Pharmacie' });
  // Remboursement simple (lien) sans catégorie, partiel (56/80).
  await tx({ type: 'income', amount: 56, date: '2026-02-02', account_id: courant, refunds_transaction_id: t4, description: 'CPAM' });
  // Revenu mixte : 40 de remboursement sur la dépense ventilée, 60 de salaire.
  await tx({ type: 'income', amount: 100, date: '2026-02-05', account_id: courant, category_id: salaire, refund_allocations: [{ expense_transaction_id: t3, amount: 40 }], description: 'Prime + remboursement' });
  await tx({ type: 'transfer', amount: 500, date: '2026-02-10', account_id: courant, to_account_id: livret, description: 'Épargne' });
  // Virement avec frais : 300 débités, 295 crédités.
  await tx({ type: 'transfer', amount: 300, to_amount: 295, date: '2026-03-02', account_id: courant, to_account_id: especes, description: 'Retrait DAB' });
  await tx({ type: 'expense', amount: 30, date: '2026-03-05', account_id: especes, description: 'Marché' });
  await tx({ type: 'expense', amount: 45, date: '2026-03-07', category_id: courses, description: 'Sans compte' });
  const t11 = await tx({ type: 'expense', amount: 60, date: '2026-04-01', account_id: courant, category_id: loisirs, description: 'Concert' });
  // Remboursement multiple sur deux dépenses de catégories différentes.
  await tx({ type: 'income', amount: 70, date: '2026-04-10', account_id: courant, refund_allocations: [{ expense_transaction_id: t2, amount: 20 }, { expense_transaction_id: t11, amount: 50 }], description: 'Remboursements amis' });
  // Remboursement intégral d'une dépense non catégorisée.
  const t14 = await tx({ type: 'expense', amount: 100, date: '2026-04-15', account_id: courant, description: 'Commande' });
  await tx({ type: 'income', amount: 100, date: '2026-04-20', account_id: courant, refunds_transaction_id: t14, description: 'Retour commande' });
  // Paiement de la carte de crédit.
  await tx({ type: 'transfer', amount: 80, date: '2026-04-25', account_id: courant, to_account_id: carte, description: 'Prélèvement carte' });
  await tx({
    type: 'expense', amount: 90, date: '2026-05-03', account_id: carte, description: 'Ventilé en trois',
    splits: [{ category_id: courses, amount: 30 }, { category_id: loisirs, amount: 30 }, { category_id: sante, amount: 30 }],
  });
  for (const [d, a] of [['2026-01-11', 52], ['2026-02-10', 48], ['2026-03-12', 61]] as const) {
    await tx({ type: 'expense', amount: a, date: d, account_id: courant, category_id: sante, description: 'EDF facture' });
  }

  await post(`/users/${u}/account-snapshots`, { account_id: livret, date: '2026-03-31', balance: 5600 });
  await post(`/users/${u}/budgets`, { category_id: courses, month: '2026-01', amount_limit: 300, recurring: true, rollover: true });
  await post(`/users/${u}/budgets`, { category_id: loisirs, month: '2026-02', amount_limit: 100 });
  await post(`/users/${u}/bills`, { name: 'G Électricité', amount_min: 40, amount_max: 65, start_date: '2026-01-10', frequency: 'monthly', pattern: 'EDF', account_id: courant });
  return u;
}

// + champs ajoutés après la capture de référence (absents de celle-ci).
const VOLATILE = new Set(['created_at', 'updated_at', 'exported_at', 'orders_affect_cash', 'fiscal_start_date', 'pace']);
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !VOLATILE.has(k)).map(([k, v]) => [k, scrub(v)]));
  }
  if (typeof value === 'number') return Math.round(value * 100) / 100;
  return value;
}

// Forme stable d'une transaction : indépendante du stockage (lignes ou colonnes).
function txView(t: Record<string, any>) {
  return {
    id: t.id, type: t.type, amount: t.amount, date: t.date, account_id: t.account_id ?? null,
    to_account_id: t.to_account_id ?? null, to_amount: t.type === 'transfer' ? t.to_amount ?? t.amount : null,
    category_id: t.category_id ?? null, description: t.description ?? null, cleared: t.cleared,
    splits: (t.splits ?? []).map((s: any) => ({ category_id: s.category_id, amount: s.amount })),
    tag_ids: (t.tags ?? []).map((x: any) => x.tag_id ?? x.tag?.id ?? x.id).sort(),
  };
}

async function capture(u: number) {
  const get = async (url: string) => {
    const res = await api.get(`/api${url}`);
    if (res.status !== 200) throw new Error(`${url} → ${res.status}`);
    return res.body;
  };
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
  const out: Record<string, unknown> = {};
  for (const m of months) {
    const dash = await get(`/users/${u}/dashboard?month=${m}&currency=EUR`);
    delete dash.yearly_cashflow; // dépend de l'année courante
    out[`dashboard ${m}`] = dash;
    out[`budgets ${m}`] = await get(`/users/${u}/budgets/status?month=${m}&currency=EUR`);
    out[`bills ${m}`] = await get(`/users/${u}/bills/status?month=${m}`);
    out[`transactions ${m}`] = (await get(`/users/${u}/transactions?month=${m}`)).map(txView);
  }
  out.statistics = await get(`/users/${u}/statistics?range=custom&from=2026-01-01&to=2026-06-30&currency=EUR&exclude_uncategorized=false`);
  out.wealth = await get(`/users/${u}/wealth-history?range=custom&from=2026-01-01&to=2026-06-30&granularity=month&currency=EUR`);
  const accounts = await get(`/users/${u}/accounts`);
  out.accounts = accounts;
  for (const a of accounts as Array<{ id: number; name: string }>) {
    const activity = await get(`/users/${u}/accounts/${a.id}/activity?limit=50`);
    out[`activity ${a.name}`] = { ...activity, recent: activity.recent.map(txView) };
  }
  out.unassigned = (await get(`/users/${u}/transactions?issue=unassigned_account`)).map(txView);
  return scrub(out) as Record<string, unknown>;
}

describe('golden', () => {
  it('les chiffres calculés sont identiques à la capture de référence', async () => {
    let u: number;
    if (mode === 'skip-seed') {
      const users = (await api.get('/api/users')).body as Array<{ id: number; name: string }>;
      u = users.find((x) => x.name === 'Golden')!.id;
    } else {
      u = await seedGolden();
    }
    const actual = await capture(u);
    if (mode === 'write') {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 1)}\n`);
      return;
    }
    const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
    // Écarts assumés (corrections de bugs) : clé → raison. Tout autre écart échoue.
    const ACCEPTED: Record<string, string> = {
      // Le budget reconduit perdait son « report » (rollover) au mois suivant.
      'budgets 2026-02': 'rollover conservé à la reconduction',
      'budgets 2026-03': 'rollover conservé à la reconduction',
      'budgets 2026-04': 'rollover conservé à la reconduction',
      'budgets 2026-05': 'rollover conservé à la reconduction',
      'budgets 2026-06': 'rollover conservé à la reconduction',
      // Le solde pointé part du dernier relevé, comme le solde (avant : solde initial).
      'activity G Livret': 'solde pointé ancré sur le dernier relevé',
    };
    // Ordre non significatif (il dépendait de l'ordre de retour SQL) : listes triées des deux côtés.
    const normalize = (v: unknown) => {
      const o = v as { expenses_by_category?: Array<{ category_id: number | null }> } | null;
      if (o && Array.isArray(o.expenses_by_category)) {
        o.expenses_by_category = [...o.expenses_by_category].sort((a, b) => (a.category_id ?? 0) - (b.category_id ?? 0));
      }
      return v;
    };
    for (const key of Object.keys(expected)) { normalize(actual[key]); normalize(expected[key]); }
    const mismatches = Object.keys(expected).filter((key) => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]));
    for (const key of mismatches) {
      if (ACCEPTED[key]) continue;
      expect(actual[key], key).toEqual(expected[key]);
    }
    if (process.env.GOLDEN_VERBOSE) console.log('écarts :', mismatches);
  }, 120_000);
});
