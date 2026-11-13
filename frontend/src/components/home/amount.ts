// Montant saisi au clavier : accepte la virgule française, les espaces (y
// compris insécables) et le symbole €. Renvoie NaN si la saisie est invalide.
export function parseAmount(raw: FormDataEntryValue | string | null | undefined): number {
  if (raw == null) return NaN;
  const text = String(raw).replace(/[\s  €]/g, '').replace(',', '.');
  if (!text) return NaN;
  return /^-?\d*\.?\d+$/.test(text) ? Number(text) : NaN;
}

/** Montant strictement positif, ou null. */
export function positiveAmount(raw: FormDataEntryValue | string | null | undefined): number | null {
  const n = parseAmount(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Valeur à pré-remplir dans un champ montant (virgule française). */
export function amountInputValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(value).replace('.', ',');
}
