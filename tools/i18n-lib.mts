// Fonctions partagées par tools/i18n-check.ts et tools/i18n-migrate.ts :
// lecture des catalogues, du dictionnaire hérité et des appels t('…') du code.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { type Catalog, KEY_RX, parseCatalog } from '../frontend/src/i18n/catalog.ts';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const SRC = path.join(ROOT, 'frontend', 'src');
export const I18N_DIR = path.join(SRC, 'i18n');
export const CATALOG_DIR = path.join(I18N_DIR, 'catalogs');
export const LEGACY_FILE = path.join(I18N_DIR, 'i18n_data.json');
export const LANGS = ['fr', 'en'] as const;

export function rel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

export function loadCatalogs(): Catalog[] {
  if (!fs.existsSync(CATALOG_DIR)) return [];
  return fs.readdirSync(CATALOG_DIR)
    .filter((f) => f.endsWith('.csv'))
    .sort()
    .map((f) => parseCatalog(fs.readFileSync(path.join(CATALOG_DIR, f), 'utf8'), f));
}

export function loadLegacy(): Record<string, Record<string, string>> {
  if (!fs.existsSync(LEGACY_FILE)) return {};
  return JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')) as Record<string, Record<string, string>>;
}

/** Fichiers source du frontend (hors tests et hors dossier i18n). */
export function sourceFiles(): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) {
        if (p !== I18N_DIR) walk(p);
      } else if (/\.(tsx?|jsx?)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) {
        out.push(p);
      }
    }
  })(SRC);
  return out.sort();
}

/** Une chaîne littérale passée à t() : position exacte pour la réécrire. */
export type KeyUse = {
  file: string;
  line: number;
  key: string;
  /** Index du premier caractère du contenu (après le guillemet ouvrant). */
  start: number;
  end: number;
  quote: string;
  /** Littéral d'une alternative `cond ? 'a' : 'b'` dans t(…). */
  inTernary: boolean;
};
export type DynamicUse = { file: string; line: number; expr: string };

const STRING_RX = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

function lineAt(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

/** Fin de l'argument qui commence à `from` (virgule ou parenthèse de niveau 0). */
function argumentEnd(text: string, from: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < text.length; i += 1) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i;
      depth -= 1;
    } else if (c === ',' && depth === 0) return i;
  }
  return text.length;
}

/**
 * Appels `t(…)` / `i18n.t(…)` : chaque littéral du premier argument (une
 * chaîne, ou les deux branches d'un ternaire de chaînes) ; le reste est
 * signalé comme dynamique (clé calculée, non vérifiable statiquement).
 */
export function scanFile(file: string, text = fs.readFileSync(file, 'utf8')): { uses: KeyUse[]; dynamic: DynamicUse[] } {
  const uses: KeyUse[] = [];
  const dynamic: DynamicUse[] = [];
  for (const m of text.matchAll(/(?<![\w$.])(?:i18n\.)?t\(\s*/g)) {
    const argStart = m.index! + m[0].length;
    const argEnd = argumentEnd(text, argStart);
    const arg = text.slice(argStart, argEnd);
    if (!arg.trim()) continue;
    const literals = [...arg.matchAll(STRING_RX)];
    const whole = literals.length === 1 && literals[0]![0] === arg.trim();
    const ternary = !whole && /^[^'"`]*\?\s*(['"`])(?:\\.|(?!\1).)*\1\s*:\s*(['"`])(?:\\.|(?!\2).)*\2\s*$/s.test(arg.trim());
    if (!whole && !ternary) {
      dynamic.push({ file, line: lineAt(text, argStart), expr: arg.trim().replace(/\s+/g, ' ').slice(0, 80) });
      continue;
    }
    const picked = whole ? literals : literals.slice(-2);
    for (const lit of picked) {
      if (lit[1] === '`' && lit[2]!.includes('${')) {
        dynamic.push({ file, line: lineAt(text, argStart), expr: lit[0].slice(0, 80) });
        continue;
      }
      const start = argStart + lit.index! + 1;
      uses.push({
        file, line: lineAt(text, start), key: lit[2]!.replace(/\\(['"`\\])/g, '$1'),
        start, end: start + lit[2]!.length, quote: lit[1]!, inTernary: ternary,
      });
    }
  }
  return { uses, dynamic };
}

const TEXT_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label']);

/**
 * Textes visibles écrits en dur dans le JSX, repérés avec l'analyseur
 * TypeScript : nœuds texte entre balises et attributs placeholder / title /
 * aria-label / alt / label donnés en chaîne. Une ligne contenant `i18n-ignore`
 * est ignorée.
 */
export function hardcodedTexts(file: string, text = fs.readFileSync(file, 'utf8')): Array<{ line: number; text: string }> {
  if (!file.endsWith('.tsx')) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines = text.split('\n');
  const found: Array<{ line: number; text: string }> = [];
  const keep = (node: ts.Node, raw: string) => {
    const s = raw.replace(/\s+/g, ' ').trim();
    if (!/[A-Za-zÀ-ÿ]{2,}/.test(s)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    if (lines[line - 1]?.includes('i18n-ignore')) return;
    found.push({ line, text: s.slice(0, 70) });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) keep(node, node.text);
    else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)
      && TEXT_ATTRS.has(node.name.getText(sf))) keep(node, node.initializer.text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

export function isStableKey(key: string): boolean {
  return KEY_RX.test(key);
}

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
export function domainOf(file: string): string {
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

export function csvField(value: string): string {
  return /[",\n\r]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Ajoute des lignes en fin de catalogue (sans retrier : fusion facile entre sessions). */
export function appendCatalogRows(domain: string, rows: Array<{ key: string; fr: string; en: string }>): void {
  const file = path.join(CATALOG_DIR, `${domain}.csv`);
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'keys,fr,en\n';
  if (!text.endsWith('\n')) text += '\n';
  text += rows.map((r) => [r.key, r.fr, r.en].map(csvField).join(',')).join('\n') + (rows.length ? '\n' : '');
  fs.writeFileSync(file, text);
}
