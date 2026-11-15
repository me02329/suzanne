// Pyramide de l'épargne et diagnostic de diversification (calcul pur).
//
// Repères courants de la gestion de patrimoine (épargne de précaution
// d'environ 3 à 6 mois de dépenses, placements classés par horizon, risque
// et liquidité, part spéculative limitée à 5-10 %, garanties des dépôts par
// établissement). Chaque compte — et, dans un compte de placement, chaque
// position — est rangé sur un étage et dans une classe d'actifs.
import type { AccountType, AssetClass } from '../index.js';

export type PyramidLayer = 'safety' | 'secure' | 'growth' | 'speculative';
export type AssetBucket = 'cash' | 'bonds' | 'equities' | 'real_estate' | 'alternative';

export const PYRAMID_LAYERS: readonly PyramidLayer[] = ['speculative', 'growth', 'secure', 'safety'];
export const ASSET_BUCKETS: readonly AssetBucket[] = ['cash', 'bonds', 'equities', 'real_estate', 'alternative'];

export interface PyramidPosition {
  symbol: string;
  name: string;
  asset_class: AssetClass;
  /** Valeur dans la devise de reporting. */
  value: number;
}

export interface PyramidAccount {
  id: number;
  name: string;
  type: AccountType;
  professional?: boolean;
  institution?: string | null;
  /** Solde dans la devise de reporting (positif = actif). */
  balance: number;
  /** Positions valorisées du compte (comptes de placement). */
  positions?: PyramidPosition[];
}

export interface PyramidItem {
  account_id: number;
  label: string;
  layer: PyramidLayer;
  bucket: AssetBucket;
  amount: number;
}

export type DiagnosticLevel = 'ok' | 'info' | 'warn';
export interface Diagnostic {
  id:
    | 'emergency_missing' | 'emergency_low' | 'emergency_ok' | 'emergency_high'
    | 'speculative_high' | 'speculative_ok'
    | 'growth_low'
    | 'concentration'
    | 'guarantee_deposits' | 'guarantee_insurer'
    | 'open_life_insurance' | 'open_pea';
  level: DiagnosticLevel;
  params?: Record<string, string | number>;
}

export interface PyramidResult {
  /** Patrimoine rangé dans la pyramide (hors société et dettes). */
  total: number;
  layers: Array<{ layer: PyramidLayer; amount: number; share: number; items: PyramidItem[] }>;
  buckets: Array<{ bucket: AssetBucket; amount: number; share: number }>;
  /** Épargne de précaution en mois de dépenses (null sans dépenses connues). */
  emergencyMonths: number | null;
  /** Hors pyramide : comptes professionnels et dettes (montants positifs). */
  excluded: { business: number; debts: number };
  diagnostics: Diagnostic[];
}

/** Plafonds de garantie (FGDR / assurance) : dépôts par banque, contrats par assureur. */
export const GUARANTEE = { deposits: 100_000, insurer: 70_000 };

const SAFETY_TYPES = new Set<AccountType>(['checking', 'cash', 'savings', 'livret_a', 'ldds', 'lep']);
const SECURE_TYPES = new Set<AccountType>(['pel', 'cel', 'receivable', 'other']);
const DEBT_TYPES = new Set<AccountType>(['credit', 'loan']);

function positionPlace(asset: AssetClass): { layer: PyramidLayer; bucket: AssetBucket } {
  switch (asset) {
    case 'equity':
    case 'etf':
    case 'fund':
      return { layer: 'growth', bucket: 'equities' };
    case 'bond':
      return { layer: 'secure', bucket: 'bonds' };
    case 'crypto':
    case 'commodity':
      return { layer: 'speculative', bucket: 'alternative' };
    case 'cash':
      return { layer: 'secure', bucket: 'cash' };
    default:
      return { layer: 'growth', bucket: 'equities' };
  }
}

/** Part non investie d'un compte de placement : fonds euros (assurance-vie, PER), espèces (PEA, CTO), crypto. */
function remainderPlace(type: AccountType): { layer: PyramidLayer; bucket: AssetBucket } {
  if (type === 'life_insurance' || type === 'retirement') return { layer: 'secure', bucket: 'bonds' };
  if (type === 'crypto') return { layer: 'speculative', bucket: 'alternative' };
  return { layer: 'secure', bucket: 'cash' };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function buildPyramid(accounts: PyramidAccount[], monthlyExpenses: number | null): PyramidResult {
  const items: PyramidItem[] = [];
  let business = 0;
  let debts = 0;
  for (const a of accounts) {
    if (a.professional) { business += Math.max(0, a.balance); continue; }
    if (DEBT_TYPES.has(a.type)) { debts += Math.abs(a.balance); continue; }
    if (Math.abs(a.balance) < 0.005 && !(a.positions ?? []).length) continue;
    const push = (label: string, place: { layer: PyramidLayer; bucket: AssetBucket }, amount: number) => {
      if (amount > 0.005) items.push({ account_id: a.id, label, ...place, amount: round2(amount) });
    };
    if (SAFETY_TYPES.has(a.type)) push(a.name, { layer: 'safety', bucket: 'cash' }, a.balance);
    else if (SECURE_TYPES.has(a.type)) push(a.name, { layer: 'secure', bucket: 'cash' }, a.balance);
    else if (a.type === 'real_estate') push(a.name, { layer: 'growth', bucket: 'real_estate' }, a.balance);
    else if (a.type === 'valuable') push(a.name, { layer: 'speculative', bucket: 'alternative' }, a.balance);
    else {
      // Compte de placement : chaque position à sa place, le reste selon l'enveloppe.
      const positions = a.positions ?? [];
      for (const p of positions) push(`${a.name} · ${p.name || p.symbol}`, positionPlace(p.asset_class), p.value);
      const invested = positions.reduce((s, p) => s + p.value, 0);
      push(a.name, remainderPlace(a.type), a.balance - invested);
    }
  }

  const total = items.reduce((s, i) => s + i.amount, 0);
  const share = (v: number) => (total > 0 ? v / total : 0);
  const layers = PYRAMID_LAYERS.map((layer) => {
    const list = items.filter((i) => i.layer === layer).sort((x, y) => y.amount - x.amount);
    const amount = list.reduce((s, i) => s + i.amount, 0);
    return { layer, amount: round2(amount), share: share(amount), items: list };
  });
  const buckets = ASSET_BUCKETS.map((bucket) => {
    const amount = items.filter((i) => i.bucket === bucket).reduce((s, i) => s + i.amount, 0);
    return { bucket, amount: round2(amount), share: share(amount) };
  });

  const amountOf = (layer: PyramidLayer) => layers.find((l) => l.layer === layer)!.amount;
  const safety = amountOf('safety');
  const emergencyMonths = monthlyExpenses && monthlyExpenses > 0 ? safety / monthlyExpenses : null;
  const diagnostics: Diagnostic[] = [];

  // 1. Épargne de précaution : 3 à 6 mois de dépenses ; au-delà de 12, de l'argent qui dort.
  if (emergencyMonths == null) diagnostics.push({ id: 'emergency_missing', level: 'info' });
  else if (emergencyMonths < 3) diagnostics.push({ id: 'emergency_low', level: 'warn', params: { months: round1(emergencyMonths), target: round2((monthlyExpenses ?? 0) * 3) } });
  else if (emergencyMonths > 12) diagnostics.push({ id: 'emergency_high', level: 'info', params: { months: round1(emergencyMonths), surplus: round2(safety - (monthlyExpenses ?? 0) * 6) } });
  else diagnostics.push({ id: 'emergency_ok', level: 'ok', params: { months: round1(emergencyMonths) } });

  // 2. Part spéculative : 5 à 10 % au maximum.
  const spec = share(amountOf('speculative'));
  if (spec > 0.1) diagnostics.push({ id: 'speculative_high', level: 'warn', params: { pct: pct(spec) } });
  else if (spec > 0) diagnostics.push({ id: 'speculative_ok', level: 'ok', params: { pct: pct(spec) } });

  // 3. Croissance long terme quasi absente alors que la précaution est constituée.
  if (total > 0 && share(amountOf('growth')) < 0.1 && (emergencyMonths ?? 0) >= 3) {
    diagnostics.push({ id: 'growth_low', level: 'info', params: { pct: pct(share(amountOf('growth'))) } });
  }

  // 4. Concentration : une action individuelle pèse plus de 10 % du patrimoine.
  for (const a of accounts) {
    for (const p of a.positions ?? []) {
      if (p.asset_class === 'equity' && total > 0 && p.value / total > 0.1) {
        diagnostics.push({ id: 'concentration', level: 'warn', params: { name: p.name || p.symbol, pct: pct(p.value / total) } });
      }
    }
  }

  // 5. Garanties : dépôts par banque (100 000 €), contrats d'assurance par assureur (70 000 €).
  const byInstitution = new Map<string, { deposits: number; insurance: number }>();
  for (const a of accounts) {
    if (a.professional || !a.institution || a.balance <= 0) continue;
    const row = byInstitution.get(a.institution) ?? { deposits: 0, insurance: 0 };
    if (SAFETY_TYPES.has(a.type) || a.type === 'pel' || a.type === 'cel') row.deposits += a.balance;
    if (a.type === 'life_insurance' || a.type === 'retirement') row.insurance += a.balance;
    byInstitution.set(a.institution, row);
  }
  for (const [institution, row] of byInstitution) {
    if (row.deposits > GUARANTEE.deposits) diagnostics.push({ id: 'guarantee_deposits', level: 'warn', params: { institution, amount: round2(row.deposits) } });
    if (row.insurance > GUARANTEE.insurer) diagnostics.push({ id: 'guarantee_insurer', level: 'warn', params: { institution, amount: round2(row.insurance) } });
  }

  // 6. Enveloppes à ouvrir tôt (l'ancienneté fiscale court dès l'ouverture).
  const has = (type: AccountType) => accounts.some((a) => a.type === type && !a.professional);
  if (!has('life_insurance')) diagnostics.push({ id: 'open_life_insurance', level: 'info' });
  if (!has('pea')) diagnostics.push({ id: 'open_pea', level: 'info' });

  return { total: round2(total), layers, buckets, emergencyMonths, excluded: { business: round2(business), debts: round2(debts) }, diagnostics };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const pct = (v: number) => Math.round(v * 1000) / 10;
