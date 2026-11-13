import type { AccountWithInvestment } from '../../lib/api-accounts';
import type { EnvelopeFlow } from '../../lib/pea';
import type { EnvelopeHistory } from './useEnvelopeHistory';

export type PeaTab = 'overview' | 'tracking' | 'performance' | 'orders' | 'recap';

export const PEA_TABS: Array<{ id: PeaTab; label: string }> = [
  { id: 'overview', label: 'Vue d’ensemble' },
  { id: 'tracking', label: 'Suivi' },
  { id: 'performance', label: 'Performance' },
  { id: 'orders', label: 'Ordres' },
  { id: 'recap', label: 'Récap' },
];

export interface InsightProps {
  userId: number;
  account: AccountWithInvestment;
  /** Versements (+) / retraits (−), du plus récent au plus ancien. */
  flows: EnvelopeFlow[];
  incomes: EnvelopeFlow[];
  history: EnvelopeHistory;
  currentValue: number;
  asOf: string;
  ccy: string;
  fmt: (v: number) => string;
}
