// Feuille de route de l'épargnant : les étapes dans l'ordre conseillé par les
// guides de finance personnelle, chacune évaluée d'après les données de l'app
// (calcul pur). Ordre : suivre ses dépenses → épargne de précaution →
// assurance-vie ouverte tôt → PEA en ETF → investir régulièrement →
// immobilier → optimisation fiscale (ces deux dernières facultatives).
import type { AccountType, AssetClass } from '../index.js';

export type RoadmapStepId = 'budget' | 'emergency' | 'life_insurance' | 'pea_etf' | 'regular' | 'property' | 'tax';
export type RoadmapStatus = 'done' | 'partial' | 'todo' | 'optional';

export interface RoadmapStep {
  id: RoadmapStepId;
  status: RoadmapStatus;
  /** Avancement 0..1 (étapes partielles). */
  progress: number;
  params?: Record<string, string | number>;
  /** Page où agir. */
  link: string;
}

export interface RoadmapInput {
  accounts: Array<{ type: AccountType; professional?: boolean; archived?: boolean; positions?: Array<{ name: string; asset_class: AssetClass }> }>;
  /** Mois de dépenses en épargne de précaution (pyramide), null si inconnu. */
  emergencyMonths: number | null;
  /** Part des dépenses du mois sans catégorie (0..1), null sans dépenses. */
  uncategorizedShare: number | null;
  /** Nombre de mois, parmi les 3 derniers, avec un versement vers un placement. */
  investingMonths: number;
}

export function buildRoadmap(input: RoadmapInput): { steps: RoadmapStep[]; done: number; total: number; next: RoadmapStepId | null } {
  const personal = input.accounts.filter((a) => !a.professional && !a.archived);
  const has = (type: AccountType) => personal.some((a) => a.type === type);
  const pea = personal.filter((a) => a.type === 'pea');
  const peaFunds = pea.some((a) => (a.positions ?? []).some((p) => p.asset_class === 'etf' || p.asset_class === 'fund'));
  const scpi = personal.some((a) => (a.positions ?? []).some((p) => /\bSCPI\b/i.test(p.name)));

  const steps: RoadmapStep[] = [];
  const u = input.uncategorizedShare;
  steps.push(u == null
    ? { id: 'budget', status: 'todo', progress: 0, link: '/transactions' }
    : { id: 'budget', status: u <= 0.1 ? 'done' : 'partial', progress: Math.max(0, 1 - u), params: { pct: Math.round(u * 100) }, link: '/anomalies' });

  const m = input.emergencyMonths;
  steps.push(m == null
    ? { id: 'emergency', status: 'todo', progress: 0, link: '/diversification' }
    : { id: 'emergency', status: m >= 3 ? 'done' : m > 0 ? 'partial' : 'todo', progress: Math.min(1, m / 3), params: { months: Math.round(m * 10) / 10 }, link: '/diversification' });

  steps.push({ id: 'life_insurance', status: has('life_insurance') ? 'done' : 'todo', progress: has('life_insurance') ? 1 : 0, link: '/accounts' });
  steps.push({ id: 'pea_etf', status: peaFunds ? 'done' : pea.length > 0 ? 'partial' : 'todo', progress: peaFunds ? 1 : pea.length > 0 ? 0.5 : 0, link: pea.length > 0 ? '/investments' : '/accounts' });
  steps.push({ id: 'regular', status: input.investingMonths >= 2 ? 'done' : input.investingMonths === 1 ? 'partial' : 'todo', progress: Math.min(1, input.investingMonths / 2), params: { months: input.investingMonths }, link: '/recurring' });
  const property = has('real_estate') || scpi;
  steps.push({ id: 'property', status: property ? 'done' : 'optional', progress: property ? 1 : 0, link: '/accounts' });
  steps.push({ id: 'tax', status: has('retirement') ? 'done' : 'optional', progress: has('retirement') ? 1 : 0, link: '/accounts' });

  const required = steps.filter((s) => s.status !== 'optional' || s.progress > 0);
  const done = steps.filter((s) => s.status === 'done').length;
  const next = steps.find((s) => s.status === 'todo' || s.status === 'partial')?.id ?? null;
  return { steps, done, total: Math.max(required.length, done), next };
}
