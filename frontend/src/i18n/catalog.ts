// Catalogues de traduction au format CSV `keys,fr,en` (même convention que
// les fichiers `localization/*.csv` du jeu) : une ligne par texte, toutes les
// langues côte à côte, clé stable du type `budgets.hero.remaining`.
//
// Module pur (aucun import de Vite ni d'i18next) : partagé par le chargeur
// (`index.ts`), les tests et l'outil `tools/i18n-check.mjs`.

export type CatalogRow = { key: string; values: Record<string, string>; line: number };
export type Catalog = { name: string; langs: string[]; rows: CatalogRow[] };

/** Clé stable : segments en minuscules séparés par des points (au moins deux). */
export const KEY_RX = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;

/**
 * Découpe un CSV (RFC 4180) : virgule comme séparateur, champs entre
 * guillemets pour les virgules / retours à la ligne, `""` pour un guillemet.
 * Tolère le BOM UTF-8 et les fins de ligne CRLF. Chaque ligne garde son numéro
 * de début (1 = en-tête) pour des messages d'erreur précis.
 */
export function parseCsv(text: string): Array<{ cells: string[]; line: number }> {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: Array<{ cells: string[]; line: number }> = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  let fieldStarted = false;
  const endField = () => { cells.push(field); field = ''; fieldStarted = false; };
  const endRecord = () => {
    endField();
    // Ligne vide : ignorée.
    if (!(cells.length === 1 && cells[0] === '')) records.push({ cells, line: recordLine });
    cells = [];
  };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else {
        if (c === '\n') line += 1;
        field += c;
      }
      continue;
    }
    if (c === '"' && !fieldStarted) { quoted = true; fieldStarted = true; continue; }
    if (c === ',') { endField(); continue; }
    if (c === '\r' && src[i + 1] === '\n') continue;
    if (c === '\n') { endRecord(); line += 1; recordLine = line; continue; }
    field += c;
    fieldStarted = true;
  }
  if (quoted) throw new Error(`guillemet non fermé (ligne ${recordLine})`);
  if (field !== '' || cells.length > 0) endRecord();
  return records;
}

/** Lit un catalogue `keys,<langue>,<langue>…` ; lève une erreur sur un en-tête ou une ligne mal formés. */
export function parseCatalog(text: string, name: string): Catalog {
  const records = parseCsv(text);
  const header = records[0];
  if (!header || header.cells[0] !== 'keys' || header.cells.length < 2) {
    throw new Error(`${name} : l'en-tête doit être « keys,fr,en »`);
  }
  const langs = header.cells.slice(1).map((l) => l.trim());
  const rows: CatalogRow[] = [];
  for (const { cells, line } of records.slice(1)) {
    if (cells.length !== header.cells.length) {
      throw new Error(`${name}:${line} : ${cells.length} colonnes au lieu de ${header.cells.length} (virgule non protégée par des guillemets ?)`);
    }
    const values: Record<string, string> = {};
    langs.forEach((lang, i) => { values[lang] = cells[i + 1]!; });
    rows.push({ key: cells[0]!.trim(), values, line });
  }
  return { name, langs, rows };
}

export type CatalogIssue = { file: string; line: number; message: string };

/** Problèmes bloquants : clé mal formée, en double (dans un ou plusieurs catalogues), case vide, langue manquante. */
export function catalogIssues(catalogs: Catalog[], langs: readonly string[]): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const seen = new Map<string, string>();
  for (const cat of catalogs) {
    for (const lang of langs) {
      if (!cat.langs.includes(lang)) issues.push({ file: cat.name, line: 1, message: `colonne « ${lang} » absente` });
    }
    for (const row of cat.rows) {
      const where = `${cat.name}:${row.line}`;
      if (!KEY_RX.test(row.key)) issues.push({ file: cat.name, line: row.line, message: `clé « ${row.key} » mal formée (attendu : domaine.sous_partie.nom)` });
      const prev = seen.get(row.key);
      if (prev) issues.push({ file: cat.name, line: row.line, message: `clé « ${row.key} » déjà définie (${prev})` });
      else seen.set(row.key, where);
      for (const lang of langs) {
        if (cat.langs.includes(lang) && !row.values[lang]?.trim()) {
          issues.push({ file: cat.name, line: row.line, message: `« ${row.key} » : traduction ${lang} vide` });
        }
      }
    }
  }
  return issues;
}

/**
 * Ressources i18next par langue. Les catalogues CSV priment ; l'ancien
 * dictionnaire `i18n_data.json` (clé = phrase française) reste chargé tant que
 * la migration des écrans n'est pas terminée. Une traduction absente retombe
 * sur le français (i18next `fallbackLng`).
 */
export function buildResources(
  catalogs: Catalog[],
  legacy: Record<string, Record<string, string>>,
  langs: readonly string[],
): Record<string, { translation: Record<string, string> }> {
  return Object.fromEntries(langs.map((lang) => {
    const translation: Record<string, string> = {};
    for (const [key, values] of Object.entries(legacy)) {
      const v = values[lang];
      if (v) translation[key] = v;
    }
    for (const cat of catalogs) {
      for (const row of cat.rows) {
        const v = row.values[lang];
        if (v) translation[row.key] = v;
      }
    }
    return [lang, { translation }];
  }));
}
