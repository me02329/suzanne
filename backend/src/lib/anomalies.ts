// Détection d'anomalies de données, pure et testée. Trois familles :
// - sans compte    : transaction de flux (revenu/dépense) non rattachée ;
// - sans catégorie : revenu/dépense sans catégorie (virements, mouvements de
//   bourse et ajustements sont exclus : ils n'ont pas de catégorie) ;
// - doublons probables : même compte, même type, même montant, dates proches
//   (import rejoué, double saisie). Surfacé comme « probable » — l'utilisateur
//   tranche, on ne supprime jamais automatiquement.

export interface AnomalyTx {
  id: number;
  date: Date;
  amount: number;
  type: string;
  description: string | null;
  account_id: number | null;
  category_id: number | null;
}

// Seules les dépenses / revenus portent compte et catégorie à vérifier.
const isFlow = (t: AnomalyTx) => t.type === 'expense' || t.type === 'income';

export interface AnomalyTxRef {
  id: number;
  date: string;
  amount: number;
  type: string;
  description: string | null;
  account_id: number | null;
}

export interface DuplicatePair {
  a: AnomalyTxRef;
  b: AnomalyTxRef;
  days_apart: number;
}

export interface AnomalyReport {
  no_account: AnomalyTxRef[];
  no_category: AnomalyTxRef[];
  duplicates: DuplicatePair[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Fenêtre de proximité pour considérer deux mouvements identiques comme doublon.
const DUPLICATE_WINDOW_DAYS = 2;

const toRef = (t: AnomalyTx): AnomalyTxRef => ({
  id: t.id,
  date: t.date.toISOString().slice(0, 10),
  amount: t.amount,
  type: t.type,
  description: t.description,
  account_id: t.account_id,
});

// Libellé réduit à l'enseigne : sans chiffres (dates, n° de carte), ni
// ponctuation, ni mots génériques de relevé (« CARTE », « CB », « PRLV »…).
const NOISE = new Set(['CARTE', 'CB', 'PRLV', 'SEPA', 'VIR', 'PAIEMENT', 'ACHAT', 'FACTURE', 'X']);
export function merchantKey(description: string | null): string {
  return (description ?? '')
    .toUpperCase()
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[0-9]/g, ' ')
    .replace(/[^A-Z ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE.has(w))
    .join(' ');
}

// Deux libellés renseignés mais d'enseignes différentes (deux cafés au même
// prix) ne font pas un doublon ; sans libellé d'un côté, on reste prudent.
function sameMerchant(a: string | null, b: string | null): boolean {
  const ka = merchantKey(a);
  const kb = merchantKey(b);
  if (!ka || !kb) return true;
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}

export function detectAnomalies(transactions: AnomalyTx[]): AnomalyReport {
  const no_account = transactions
    .filter((t) => isFlow(t) && t.account_id == null)
    .map(toRef);

  const no_category = transactions
    .filter((t) => isFlow(t) && t.category_id == null)
    .map(toRef);

  // Doublons : on regroupe par (compte|type|montant arrondi) puis on apparie les
  // mouvements dont les dates sont à ≤ DUPLICATE_WINDOW_DAYS l'un de l'autre.
  const groups = new Map<string, AnomalyTx[]>();
  for (const t of transactions) {
    if (t.account_id == null) continue; // un orphelin n'est pas un doublon de compte
    const key = `${t.account_id}|${t.type}|${Math.round(t.amount * 100)}`;
    const list = groups.get(key);
    if (list) list.push(t); else groups.set(key, [t]);
  }

  const duplicates: DuplicatePair[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.getTime() - b.date.getTime());
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      const days = Math.round((b.date.getTime() - a.date.getTime()) / DAY_MS);
      if (days <= DUPLICATE_WINDOW_DAYS && sameMerchant(a.description, b.description)) {
        duplicates.push({ a: toRef(a), b: toRef(b), days_apart: days });
      }
    }
  }

  return { no_account, no_category, duplicates };
}
