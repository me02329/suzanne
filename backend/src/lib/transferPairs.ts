// Virements à relier : un virement entre deux de tes comptes arrive souvent en
// deux opérations séparées (une sortie sur l'un, une entrée sur l'autre), par
// exemple quand les deux comptes sont synchronisés ou importés séparément. Les
// compter comme une dépense et un revenu fausse les deux. Détection pure et
// prudente : on PROPOSE, l'utilisateur relie (ou écarte) ; rien d'automatique.

export interface PairCandidate {
  id: number;
  date: Date;
  description: string | null;
  account_id: number;
  /** Montant signé dans la devise du compte : < 0 sortie, > 0 entrée. */
  amount: number;
  currency: string;
}

export interface TransferPair { out: PairCandidate; in: PairCandidate }

export const PAIR_WINDOW_DAYS = 3;
const DAY_MS = 86_400_000;

/**
 * Paires (sortie, entrée) : deux comptes différents, même montant au centime
 * (même devise), au plus 3 jours d'écart. Chaque opération sert au plus une
 * fois ; la paire la plus proche en date l'emporte.
 */
export function detectTransferPairs(rows: PairCandidate[], dismissed: Set<string> = new Set()): TransferPair[] {
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const outs = rows.filter((r) => r.amount < 0);
  const ins = rows.filter((r) => r.amount > 0);
  const options: Array<{ out: PairCandidate; in: PairCandidate; gap: number }> = [];
  for (const o of outs) {
    for (const i of ins) {
      if (o.account_id === i.account_id || o.currency !== i.currency) continue;
      if (Math.abs(o.amount + i.amount) >= 0.005) continue;
      const gap = Math.abs(o.date.getTime() - i.date.getTime());
      if (gap > PAIR_WINDOW_DAYS * DAY_MS) continue;
      if (dismissed.has(key(o.id, i.id))) continue;
      options.push({ out: o, in: i, gap });
    }
  }
  options.sort((a, b) => a.gap - b.gap || b.out.date.getTime() - a.out.date.getTime());
  const used = new Set<number>();
  const pairs: TransferPair[] = [];
  for (const p of options) {
    if (used.has(p.out.id) || used.has(p.in.id)) continue;
    used.add(p.out.id);
    used.add(p.in.id);
    pairs.push({ out: p.out, in: p.in });
  }
  return pairs.sort((a, b) => b.out.date.getTime() - a.out.date.getTime());
}
