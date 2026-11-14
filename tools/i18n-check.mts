// Contrôle des traductions (ADR 0007).
//
//   npm run i18n:check                 # résumé
//   npm run i18n:check -- --list       # détail de chaque problème
//   npm run i18n:check -- --strict     # code de sortie 1 s'il reste des clés manquantes ou du texte en dur
//
// Toujours bloquant (code 1) : catalogue CSV mal formé, clé en double, case vide.
// Rapporté (bloquant avec --strict) : clé utilisée absente des catalogues,
// texte visible écrit en dur dans le JSX. Rapporté seulement : clés inutilisées,
// appels t() à clé calculée, entrées restantes de l'ancien i18n_data.json.
import { catalogIssues } from '../frontend/src/i18n/catalog.ts';
import {
  LANGS, type DynamicUse, type KeyUse, hardcodedTexts, isStableKey, loadCatalogs, loadLegacy, rel, scanFile, sourceFiles,
} from './i18n-lib.mts';

const args = new Set(process.argv.slice(2));
const list = args.has('--list');
const strict = args.has('--strict');

let catalogs;
try {
  catalogs = loadCatalogs();
} catch (err) {
  console.error(`✗ catalogue illisible : ${(err as Error).message}`);
  process.exit(1);
}
const legacy = loadLegacy();
const issues = catalogIssues(catalogs, LANGS);
const catalogKeys = new Set(catalogs.flatMap((c) => c.rows.map((r) => r.key)));
for (const key of catalogKeys) {
  if (key in legacy) issues.push({ file: 'i18n_data.json', line: 0, message: `« ${key} » existe aussi dans l'ancien dictionnaire` });
}

const uses: KeyUse[] = [];
const dynamic: DynamicUse[] = [];
const hardcoded: Array<{ file: string; line: number; text: string }> = [];
for (const file of sourceFiles()) {
  const scan = scanFile(file);
  uses.push(...scan.uses);
  dynamic.push(...scan.dynamic);
  for (const h of hardcodedTexts(file)) hardcoded.push({ file, ...h });
}

const known = (key: string) => catalogKeys.has(key) || key in legacy;
const missing = uses.filter((u) => !known(u.key));
const usedKeys = new Set(uses.map((u) => u.key));
const unusedCatalog = [...catalogKeys].filter((k) => !usedKeys.has(k));
const unusedLegacy = Object.keys(legacy).filter((k) => !usedKeys.has(k));
const legacyUses = uses.filter((u) => !isStableKey(u.key));

const where = (x: { file: string; line: number }) => `${rel(x.file)}:${x.line}`;
const section = (title: string, rows: string[], always = false) => {
  const head = `${rows.length === 0 ? '✓' : '•'} ${title} : ${rows.length}`;
  console.log(head);
  if ((list || always) && rows.length > 0) for (const r of rows) console.log(`    ${r}`);
};

console.log(`Catalogues : ${catalogs.map((c) => `${c.name} (${c.rows.length})`).join(', ') || 'aucun'} — ${catalogKeys.size} clés stables`);
console.log(`Ancien dictionnaire i18n_data.json : ${Object.keys(legacy).length} entrées\n`);
section('Problèmes de catalogue (bloquant)', issues.map((i) => `${i.file}${i.line ? `:${i.line}` : ''} — ${i.message}`), true);
section('Clés utilisées absentes de tout catalogue', missing.map((u) => `${where(u)} — « ${u.key} »`));
section('Appels t() encore sur une phrase française (à migrer)', legacyUses.map((u) => `${where(u)} — « ${u.key} »`));
section('Textes visibles écrits en dur', hardcoded.map((h) => `${where(h)} — ${h.text}`));
section('Appels t() à clé calculée (non vérifiables)', dynamic.map((d) => `${where(d)} — ${d.expr}`));
section('Clés de catalogue inutilisées', unusedCatalog);
section('Entrées inutilisées de l\'ancien dictionnaire', unusedLegacy);

if (!list) {
  const perFile = new Map<string, number>();
  for (const x of [...missing, ...hardcoded]) perFile.set(rel(x.file), (perFile.get(rel(x.file)) ?? 0) + 1);
  const top = [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (top.length > 0) {
    console.log('\nFichiers les plus concernés (clés manquantes + texte en dur) :');
    for (const [file, n] of top) console.log(`    ${String(n).padStart(4)}  ${file}`);
  }
  console.log('\nDétail : npm run i18n:check -- --list');
}

const failed = issues.length > 0 || (strict && (missing.length > 0 || hardcoded.length > 0));
process.exit(failed ? 1 : 0);
