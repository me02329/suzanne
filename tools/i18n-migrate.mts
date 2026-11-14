// Migration des appels t('Phrase française') vers des clés stables (ADR 0007).
//
//   npm run i18n:migrate                # simulation : plan par catalogue, rien n'est écrit
//   npm run i18n:migrate -- --plan      # + la correspondance complète phrase → clé
//   npm run i18n:migrate -- --write     # applique : catalogues CSV, code source, i18n_data.json
//   npm run i18n:migrate -- --missing   # liste JSON des phrases sans anglais, à traduire
//   npm run i18n:migrate -- --translations=en.json --write
//                                       # complète l'anglais ({ "phrase": "English" }) avant de
//                                       # nommer les clés : elles sont alors toutes en anglais
//
// Pour chaque littéral passé à t() qui n'est pas déjà une clé stable :
//  - domaine = celui du fichier qui l'utilise (table DOMAINS), ou `commun` s'il
//    sert dans plusieurs domaines ;
//  - clé = `<domaine>.<mots de la traduction anglaise>` (ou du français à défaut),
//    unique ; une même phrase garde une seule clé ;
//  - fr / en repris de i18n_data.json ; une phrase absente du dictionnaire garde
//    son français et une case anglaise VIDE, que le test des catalogues refuse :
//    il faut la traduire avant de commiter.
// Les entrées de i18n_data.json sont retirées au fur et à mesure (les entrées
// inutilisées aussi). Les clés calculées (t(item.label)) sont listées, pas migrées.
//
// --write refuse de tourner si le frontend a des modifications non commitées
// (pour ne pas réécrire un fichier qu'une autre session est en train de
// modifier) ; --force passe outre.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Catalog } from '../frontend/src/i18n/catalog.ts';
import {
  CATALOG_DIR, LEGACY_FILE, ROOT, SRC, type KeyUse, isStableKey, loadCatalogs, loadLegacy, rel, scanFile, sourceFiles,
} from './i18n-lib.mts';

const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const translationsArg = process.argv.slice(2).find((a) => a.startsWith('--translations='))?.split('=')[1];

/** Domaine (= nom du catalogue) d'un fichier source, d'après son chemin sous frontend/src. */
const DOMAINS: Array<[RegExp, string]> = [
  [/^pages\/(Dashboard)\.tsx$|^components\/(home\/|DashboardSection|CashflowTrends)/, 'accueil'],
  [/^pages\/(Transactions|Recurring|Anomalies|Rules|Categories|Tags)\.tsx$|^components\/(transactions\/|Transaction|TrashModal|AttachmentsModal|StatementImportModal)/, 'operations'],
  [/^pages\/(Accounts|AccountDetail)\.tsx$|^components\/accounts\//, 'comptes'],
  [/^pages\/(Wealth|Investments|Goals)\.tsx$|^components\/(pea\/|SymbolSearch)/, 'patrimoine'],
  [/^pages\/(Budgets|Bills)\.tsx$/, 'budgets'],
  [/^pages\/(Statistics|Forecast|Health|Simulator|Alerts)\.tsx$/, 'analyses'],
  [/^pages\/(Settings|Users|Tools|Assistant)\.tsx$|^components\/(BackupsPanel|AuditLogPanel|TokenModal)/, 'reglages'],
];
function domainOf(file: string): string {
  const p = path.relative(SRC, file).split(path.sep).join('/');
  return DOMAINS.find(([rx]) => rx.test(p))?.[1] ?? 'ui';
}

/** Mots de la phrase en identifiant : sans accents ni ponctuation, 5 mots au plus. */
export function slug(text: string): string {
  const words = text
    .replace(/\{\{\s*(\w+)\s*\}\}/g, ' $1 ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((w, i) => i === 0 || !['the', 'a', 'an', 'of', 'le', 'la', 'les', 'de', 'des', 'du', 'un', 'une'].includes(w));
  return words.slice(0, 5).join('_').slice(0, 40).replace(/_+$/, '') || 'texte';
}

function csvField(value: string): string {
  return /[",\n\r]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
function writeCatalog(file: string, langs: string[], rows: Array<{ key: string; values: Record<string, string> }>) {
  const lines = [['keys', ...langs].join(',')];
  for (const r of [...rows].sort((a, b) => a.key.localeCompare(b.key))) {
    lines.push([r.key, ...langs.map((l) => r.values[l] ?? '')].map(csvField).join(','));
  }
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

function dirtyFrontend(): string[] {
  const out = execFileSync('git', ['status', '--porcelain', '--', 'frontend/src'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((l) => l.slice(3)).filter((f) => !f.startsWith('frontend/src/i18n/'));
}

// ── Collecte ────────────────────────────────────────────────────────────────
const legacy = loadLegacy();
const catalogs: Catalog[] = loadCatalogs();
const uses: KeyUse[] = [];
const dynamicCount = { n: 0 };
for (const file of sourceFiles()) {
  const scan = scanFile(file);
  uses.push(...scan.uses.filter((u) => !isStableKey(u.key)));
  dynamicCount.n += scan.dynamic.length;
}

if (translationsArg) {
  const extra = JSON.parse(fs.readFileSync(path.resolve(translationsArg), 'utf8')) as Record<string, string>;
  for (const [phrase, en] of Object.entries(extra)) {
    if (!en.trim()) continue;
    legacy[phrase] = { fr: legacy[phrase]?.fr || phrase, ...legacy[phrase], en };
  }
}
if (args.has('--missing')) {
  const phrases = [...new Set(uses.map((u) => u.key))].filter((p) => !legacy[p]?.en).sort();
  console.log(JSON.stringify(Object.fromEntries(phrases.map((p) => [p, ''])), null, 2));
  process.exit(0);
}

const domainsByPhrase = new Map<string, Set<string>>();
for (const u of uses) {
  const set = domainsByPhrase.get(u.key) ?? new Set<string>();
  set.add(domainOf(u.file));
  domainsByPhrase.set(u.key, set);
}

const taken = new Set(catalogs.flatMap((c) => c.rows.map((r) => r.key)));
const keyOf = new Map<string, string>();
const newRows = new Map<string, Array<{ key: string; values: Record<string, string> }>>();
for (const phrase of [...domainsByPhrase.keys()].sort()) {
  const domains = domainsByPhrase.get(phrase)!;
  const domain = domains.size > 1 ? 'commun' : [...domains][0]!;
  const entry = legacy[phrase];
  const base = `${domain}.${slug(entry?.en || entry?.fr || phrase)}`;
  let key = base;
  for (let i = 2; taken.has(key); i += 1) key = `${base}_${i}`;
  taken.add(key);
  keyOf.set(phrase, key);
  const rows = newRows.get(domain) ?? [];
  rows.push({ key, values: { fr: entry?.fr || phrase, en: entry?.en ?? '' } });
  newRows.set(domain, rows);
}

// ── Rapport ─────────────────────────────────────────────────────────────────
const untranslated = [...newRows.values()].flat().filter((r) => !r.values.en);
const legacyLeft = Object.keys(legacy).filter((k) => !keyOf.has(k));
console.log(`${uses.length} appels t() sur ${keyOf.size} phrases → clés stables`);
for (const [domain, rows] of [...newRows.entries()].sort()) console.log(`    ${domain.padEnd(12)} ${rows.length} clés`);
console.log(`${untranslated.length} phrases sans traduction anglaise (case vide à compléter)`);
console.log(`${legacyLeft.length} entrées inutilisées de i18n_data.json retirées`);
console.log(`${dynamicCount.n} appels à clé calculée laissés tels quels (à migrer à la main)`);
if (args.has('--plan')) {
  for (const [phrase, key] of keyOf) console.log(`    ${key.padEnd(48)} ← ${phrase}`);
}
if (!write) {
  console.log('\nSimulation : rien n\'a été écrit. Relancer avec --write pour appliquer.');
  process.exit(0);
}

// ── Écriture ────────────────────────────────────────────────────────────────
const dirty = dirtyFrontend();
if (dirty.length > 0 && !args.has('--force')) {
  console.error(`\n✗ ${dirty.length} fichier(s) du frontend ont des modifications non commitées (${dirty.slice(0, 5).join(', ')}${dirty.length > 5 ? '…' : ''}).`);
  console.error('  Commite-les (ou attends la fin de la session qui les modifie), ou relance avec --force.');
  process.exit(1);
}

fs.mkdirSync(CATALOG_DIR, { recursive: true });
for (const [domain, rows] of newRows) {
  const file = path.join(CATALOG_DIR, `${domain}.csv`);
  const existing = catalogs.find((c) => c.name === `${domain}.csv`);
  const langs = existing?.langs ?? ['fr', 'en'];
  writeCatalog(file, langs, [...(existing?.rows ?? []), ...rows]);
}

const byFile = new Map<string, KeyUse[]>();
for (const u of uses) byFile.set(u.file, [...(byFile.get(u.file) ?? []), u]);
for (const [file, list] of byFile) {
  let text = fs.readFileSync(file, 'utf8');
  // De la fin vers le début : les positions restent valables.
  for (const u of [...list].sort((a, b) => b.start - a.start)) {
    text = text.slice(0, u.start) + keyOf.get(u.key)! + text.slice(u.end);
  }
  fs.writeFileSync(file, text);
}

fs.writeFileSync(LEGACY_FILE, `${JSON.stringify({}, null, 2)}\n`);
console.log(`\n✓ ${byFile.size} fichiers réécrits, catalogues dans ${rel(CATALOG_DIR)}/, i18n_data.json vidé.`);
console.log('  Ensuite : traduire les cases anglaises vides, puis npm run i18n:check et npm test.');
