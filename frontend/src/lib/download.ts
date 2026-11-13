import type { BackupImportSummary } from '@suzanne/shared';

// Déclenche le téléchargement d'un Blob. L'URL objet est révoquée en différé :
// la révoquer juste après click() annule le téléchargement sur certains
// navigateurs (Firefox, Safari).
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const LABELS: Array<[keyof BackupImportSummary, string]> = [
  ['transactions', 'transactions'],
  ['accounts', 'comptes'],
  ['categories', 'catégories'],
  ['holdings', 'positions'],
  ['holding_orders', 'ordres'],
  ['recurring', 'récurrents'],
  ['budgets', 'budgets'],
  ['goals', 'objectifs'],
  ['bills', 'factures'],
  ['snapshots', 'snapshots'],
  ['attachments', 'pièces jointes'],
];

// Résumé lisible d'un import JSON : ce qui a été créé, et combien de lignes
// déjà présentes ont été reconnues (donc pas dupliquées).
export function summarizeBackupImport(summary: BackupImportSummary): string {
  const created = LABELS
    .map(([key, label]) => [summary[key]?.created ?? 0, label] as const)
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);
  const reused = Object.values(summary).reduce((sum, c) => sum + (c?.reused ?? 0), 0);
  const skipped = Object.values(summary).reduce((sum, c) => sum + (c?.skipped ?? 0), 0);
  const parts = [created.length > 0 ? `Créé : ${created.join(', ')}` : 'Rien de nouveau à importer'];
  if (reused > 0) parts.push(`${reused} déjà présent(s), non dupliqué(s)`);
  if (skipped > 0) parts.push(`${skipped} ligne(s) invalide(s) ignorée(s)`);
  return parts.join(' · ');
}
