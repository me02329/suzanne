// Migration des textes écrits en dur dans le JSX vers des clés (ADR 0007).
//
//   npm run i18n:extract -- <fichiers…>
//       → JSON { "texte français": "" } des textes à traduire (stdout)
//   npm run i18n:extract -- --apply --translations=en.json <fichiers…>
//       → remplace chaque texte par t('clé'), ajoute les lignes en fin de catalogue
//
// Textes visés : nœuds texte entre balises et attributs placeholder / title /
// aria-label / alt / label donnés en chaîne (comme i18n:check). Une ligne
// contenant `i18n-ignore` est laissée telle quelle ; un texte sans traduction
// fournie aussi (signalé).
//
// Clé : `<domaine>.<fichier>.<mots de l'anglais>` (ex. budgets.budgets.remaining) —
// le segment fichier évite les collisions entre sessions qui migrent des
// fichiers différents. Accès à t : dans un composant (fonction en PascalCase),
// `const { t } = useTranslation();` est ajouté en tête s'il manque ; hors
// composant, `i18n.t(…)` (import ajouté).
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT, SRC, appendCatalogRows, domainOf, loadCatalogs, rel, slug } from './i18n-lib.mts';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const translationsArg = argv.find((a) => a.startsWith('--translations='))?.split('=')[1];
const files = argv.filter((a) => !a.startsWith('--')).map((f) => path.resolve(ROOT, f));
if (files.length === 0) {
  console.error('usage : npm run i18n:extract -- [--apply --translations=en.json] <fichiers…>');
  process.exit(2);
}

const TEXT_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt', 'label']);
const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#\d+|[a-z]+);/g, (m, e: string) => (e.startsWith('#') ? String.fromCharCode(Number(e.slice(1))) : ENTITIES[e] ?? m));
const clean = (raw: string) => decode(raw.replace(/\s+/g, ' ').trim());
const hasWords = (s: string) => /[A-Za-zÀ-ÿ]{2,}/.test(s);

type Target = { node: ts.Node; kind: 'text' | 'attr'; fr: string; raw: string };

function targetsOf(sf: ts.SourceFile, text: string): Target[] {
  const lines = text.split('\n');
  const out: Target[] = [];
  const ignored = (n: ts.Node) => lines[sf.getLineAndCharacterOfPosition(n.getStart(sf)).line]?.includes('i18n-ignore');
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const fr = clean(node.text);
      if (hasWords(fr) && !ignored(node)) out.push({ node, kind: 'text', fr, raw: node.text });
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)
      && TEXT_ATTRS.has(node.name.getText(sf))) {
      const fr = decode(node.initializer.text.trim());
      if (hasWords(fr) && !ignored(node)) out.push({ node: node.initializer, kind: 'attr', fr, raw: node.initializer.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const parse = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

if (!apply) {
  const all: Record<string, string> = {};
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const t of targetsOf(parse(file, text), text)) all[t.fr] = '';
  }
  console.log(JSON.stringify(all, null, 1));
  process.exit(0);
}

if (!translationsArg) {
  console.error('--apply demande --translations=<fichier.json>');
  process.exit(2);
}
const en = JSON.parse(fs.readFileSync(path.resolve(translationsArg), 'utf8')) as Record<string, string>;
const taken = new Set(loadCatalogs().flatMap((c) => c.rows.map((r) => r.key)));

// ── Portée de t ─────────────────────────────────────────────────────────────
type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const isFn = (n: ts.Node): n is Fn => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
function fnName(fn: Fn): string | null {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn)) && fn.name) return fn.name.getText();
  let p: ts.Node = fn.parent;
  // memo(…) / forwardRef(…) autour de la fonction.
  while (p && ts.isCallExpression(p)) p = p.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  return null;
}
const isComponent = (fn: Fn) => /^[A-Z]/.test(fnName(fn) ?? '');
const declaresT = (fn: Fn, sf: ts.SourceFile) => fn.parameters.some((p) => p.name.getText(sf) === 't'
  || (ts.isObjectBindingPattern(p.name) && p.name.elements.some((e) => e.name.getText(sf) === 't')))
  || (fn.body != null && ts.isBlock(fn.body) && /\bconst\s*\{[^}]*\bt\b[^}]*\}\s*=\s*useTranslation\(/.test(fn.body.getText(sf)));

const summary: string[] = [];
const missing = new Set<string>();
const rowsByDomain = new Map<string, Array<{ key: string; fr: string; en: string }>>();

for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  const sf = parse(file, text);
  const domain = domainOf(file);
  const prefix = path.basename(file).replace(/\.tsx?$/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const keyOf = new Map<string, string>();
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const hookFns = new Set<Fn>();
  let needsI18n = false;
  let done = 0;

  for (const tgt of targetsOf(sf, text)) {
    const translation = en[tgt.fr];
    if (!translation?.trim()) { missing.add(`${rel(file)} — ${tgt.fr}`); continue; }
    let key = keyOf.get(tgt.fr);
    if (!key) {
      const base = `${domain}.${prefix}.${slug(translation)}`;
      key = base;
      for (let i = 2; taken.has(key); i += 1) key = `${base}_${i}`;
      taken.add(key);
      keyOf.set(tgt.fr, key);
      const rows = rowsByDomain.get(domain) ?? [];
      rows.push({ key, fr: tgt.fr, en: translation });
      rowsByDomain.set(domain, rows);
    }
    // Qui fournit t ?
    let call = `i18n.t('${key}')`;
    for (let p: ts.Node | undefined = tgt.node.parent; p; p = p.parent) {
      if (!isFn(p)) continue;
      if (declaresT(p, sf)) { call = `t('${key}')`; break; }
      if (isComponent(p) && p.body && ts.isBlock(p.body)) { hookFns.add(p); call = `t('${key}')`; break; }
    }
    if (call.startsWith('i18n')) needsI18n = true;
    if (tgt.kind === 'text') {
      const lead = tgt.raw.match(/^\s*/)![0];
      const trail = tgt.raw.match(/\s*$/)![0];
      edits.push({ start: tgt.node.getStart(sf), end: tgt.node.end, text: `${lead}{${call}}${trail}` });
    } else {
      edits.push({ start: tgt.node.getStart(sf), end: tgt.node.end, text: `{${call}}` });
    }
    done += 1;
  }

  for (const fn of hookFns) {
    const body = fn.body as ts.Block;
    edits.push({ start: body.getStart(sf) + 1, end: body.getStart(sf) + 1, text: '\n  const { t } = useTranslation();' });
  }
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const afterImports = imports.length ? imports[imports.length - 1]!.end : 0;
  const newImports: string[] = [];
  if (hookFns.size > 0 && !/import\s*\{[^}]*\buseTranslation\b[^}]*\}\s*from\s*'react-i18next'/.test(text)) {
    newImports.push("import { useTranslation } from 'react-i18next';");
  }
  if (needsI18n && !/import\s+i18n\s+from\s+'[^']*i18n'/.test(text)) {
    let r = path.relative(path.dirname(file), path.join(SRC, 'i18n')).split(path.sep).join('/');
    if (!r.startsWith('.')) r = `./${r}`;
    newImports.push(`import i18n from '${r}';`);
  }
  if (newImports.length) edits.push({ start: afterImports, end: afterImports, text: `\n${newImports.join('\n')}` });

  for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    text = text.slice(0, e.start) + e.text + text.slice(e.end);
  }
  fs.writeFileSync(file, text);
  summary.push(`${rel(file).padEnd(56)} ${String(done).padStart(4)} textes, ${keyOf.size} clés${hookFns.size ? `, useTranslation ajouté ×${hookFns.size}` : ''}${needsI18n ? ', i18n.t' : ''}`);
}

for (const [domain, rows] of rowsByDomain) appendCatalogRows(domain, rows);
console.log(summary.join('\n'));
if (missing.size) {
  console.log(`\n${missing.size} textes sans traduction, laissés tels quels :`);
  for (const m of missing) console.log(`    ${m}`);
}
