import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { createImportMappingSchema, csvImportSchema, dateString, idParam, statementImportSchema } from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { assertAccountOwned } from '../lib/transactionHelpers.js';
import { parseOfx, parseQif } from '../lib/statementParsers.js';
import { legacyView, LINES_ORDERED } from '../lib/ledger.js';
import { backupPayloadSchema, buildExportPayload, EXPORT_ENTITIES, importPayload } from '../lib/backup.js';

export { buildExportPayload, EXPORT_ENTITIES, importPayload };

export const importExportRouter = Router();

const exportSchema = z.object({
  entities: z.array(z.enum(EXPORT_ENTITIES)).min(1).default([...EXPORT_ENTITIES]),
  from: dateString.nullish(),
  to: dateString.nullish(),
});

const importSchema = z.object({ payload: backupPayloadSchema });

const stamp = () => new Date().toISOString().slice(0, 10);

importExportRouter.get('/users/:user_id/export.json', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const payload = await buildExportPayload(user_id, EXPORT_ENTITIES, null, null);
  res.setHeader('Content-Disposition', `attachment; filename="suzanne-export-${stamp()}.json"`);
  res.json(payload);
}));

importExportRouter.post('/users/:user_id/export', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = exportSchema.parse(req.body);
  if (body.from && body.to && body.from > body.to) throw new HttpError(400, 'La date de début est après la date de fin');
  const payload = await buildExportPayload(user_id, body.entities, body.from ?? null, body.to ?? null);
  res.setHeader('Content-Disposition', `attachment; filename="suzanne-export-${stamp()}.json"`);
  res.json(payload);
}));

importExportRouter.post('/users/:user_id/import.json', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = importSchema.parse(req.body);
  res.json(await importPayload(user_id, body.payload));
}));

// Export CSV « tableur » : séparateur `;` et virgule décimale (Excel/LibreOffice
// en locale française), BOM UTF-8 pour les accents, noms lisibles au lieu des
// ids, montant signé. Réimportable tel quel via /import.csv (les virements,
// qui ne peuvent pas être recréés depuis un CSV, sont alors ignorés).
const csvExportQuery = z.object({ from: dateString.optional(), to: dateString.optional() });

importExportRouter.get('/users/:user_id/transactions.csv', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const { from, to } = csvExportQuery.parse(req.query);
  const [rows, accounts, categories] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        user_id,
        ...(from || to ? { date: { ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}), ...(to ? { lte: new Date(`${to}T00:00:00.000Z`) } : {}) } } : {}),
      },
      include: { lines: LINES_ORDERED, tags: { include: { tag: { select: { name: true } } } } },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
    }),
    prisma.account.findMany({ where: { user_id }, select: { id: true, name: true, currency: true } }),
    prisma.category.findMany({ where: { user_id }, select: { id: true, name: true } }),
  ]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const header = ['date', 'type', 'montant', 'devise', 'description', 'compte', 'compte_destination', 'categorie', 'tags', 'pointee'];
  const lines = rows.map((r) => {
    const view = legacyView(r);
    const signed = view.type === 'income' ? view.amount : -view.amount;
    // Ventilation (ou remboursement réparti) : « Courses (30,00) + Loisirs (10,00) ».
    const category = r.lines.length > 1 && view.type !== 'transfer'
      ? r.lines.map((l) => `${l.category_id != null ? categoryName.get(l.category_id) ?? '?' : 'Sans catégorie'} (${formatCsvAmount(Math.abs(l.amount))})`).join(' + ')
      : view.category_id != null ? categoryName.get(view.category_id) ?? '' : '';
    const account = view.account_id != null ? accountById.get(view.account_id) : undefined;
    const toAccount = view.to_account_id != null ? accountById.get(view.to_account_id) : undefined;
    return [
      r.date.toISOString().slice(0, 10),
      view.type,
      formatCsvAmount(signed),
      account?.currency ?? '',
      csvText(r.description ?? ''),
      csvText(account?.name ?? ''),
      csvText(toAccount?.name ?? ''),
      csvText(category),
      csvText(r.tags.map((t) => t.tag.name).join(', ')),
      r.cleared ? 'oui' : 'non',
    ].join(';');
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="suzanne-transactions-${stamp()}.csv"`);
  res.send(`\uFEFF${[header.join(';'), ...lines].join('\r\n')}\r\n`);
}));

function formatCsvAmount(value: number): string {
  return round2(value).toFixed(2).replace('.', ',');
}

// Cellule texte : toujours entre guillemets, et neutralisation de l'injection
// de formule (=, +, -, @, tab, CR en tête) qu'Excel exécuterait à l'ouverture.
function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

importExportRouter.post('/users/:user_id/import.csv', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = csvImportSchema.parse(req.body);
  if (body.account_id) await assertAccountOwned(user_id, body.account_id);
  const rules = await loadRules(user_id);
  const lines = body.csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const delimiter = detectDelimiter(lines[0] ?? '');
  const headers = splitCsv(lines[0] ?? '', delimiter).map((h) => h.trim());
  const dataLines = lines.slice(1);
  const mapping = resolveMapping(headers, body.mapping ?? null);
  let skipped = 0;
  const parsedRows: Array<{
    line: number;
    user_id: number;
    account_id: number | null;
    category_id: number | null;
    date: Date;
    type: 'expense' | 'income';
    amount: number;
    description: string;
  }> = [];
  for (const [index, line] of dataLines.entries()) {
    const cells = splitCsv(line, delimiter);
    const dateRaw = cell(cells, mapping.date);
    const amountRaw = cell(cells, mapping.amount);
    const descriptionRaw = mapping.description != null ? cell(cells, mapping.description) : '';
    const typeRaw = mapping.type != null ? cell(cells, mapping.type) : undefined;
    const date = parseDate(dateRaw, body.date_format);
    const signedAmount = parseSignedAmount(amountRaw);
    if (!date || signedAmount === null || signedAmount === 0) {
      skipped += 1;
      continue;
    }
    // Les virements internes (ex. réimport d'un export Suzanne) ne peuvent pas
    // être recréés depuis un CSV : on les ignore plutôt que d'en faire des dépenses.
    if (typeRaw && /^(transfer|virement interne)$/i.test(typeRaw.trim())) {
      skipped += 1;
      continue;
    }
    const description = unescapeCsvText(descriptionRaw ?? '');
    const matchedRule = matchRule(rules, description);
    const type = typeRaw ? normalizeType(typeRaw, signedAmount) : signedAmount > 0 ? 'income' : 'expense';
    parsedRows.push({
      line: index + 2,
      user_id,
      account_id: body.account_id ?? null,
      category_id: matchedRule?.category_id ?? null,
      date,
      type,
      amount: round2(Math.abs(signedAmount)),
      description,
    });
  }
  res.json(await dedupeAndInsert(user_id, body.account_id ?? null, parsedRows, skipped));
}));

type ParsedImportRow = {
  line: number;
  user_id: number;
  account_id: number | null;
  category_id: number | null;
  date: Date;
  type: 'expense' | 'income';
  amount: number;
  description: string;
};

// Dédoublonne (contre l'existant ET au sein du fichier) puis insère en une seule
// requête batch. Partagé par l'import CSV et l'import de relevé (OFX/QIF).
async function dedupeAndInsert(user_id: number, account_id: number | null, parsedRows: ParsedImportRow[], baseSkipped: number) {
  const duplicateKeys = await existingCsvDuplicateKeys(user_id, account_id, parsedRows);
  const seenInFile = new Set<string>();
  const duplicates: Array<{ line: number; date: string; amount: number; description: string; reason: 'existing' | 'file' }> = [];
  const toCreate = parsedRows.filter((row) => {
    const key = csvDuplicateKey(row);
    const reason = duplicateKeys.has(key) ? 'existing' : seenInFile.has(key) ? 'file' : null;
    if (reason) {
      duplicates.push({
        line: row.line,
        date: row.date.toISOString().slice(0, 10),
        amount: row.type === 'income' ? row.amount : -row.amount,
        description: row.description,
        reason,
      });
      return false;
    }
    seenInFile.add(key);
    return true;
  }).map(({ line: _line, ...row }) => row);
  // Une seule insertion batch (au lieu d'un INSERT par ligne) : import atomique
  // et beaucoup plus rapide sur les gros relevés.
  if (toCreate.length > 0) {
    // Import atomique : tout ou rien.
    await prisma.$transaction(async (tx) => {
      for (const row of toCreate) {
        await tx.transaction.create({
          data: {
            user_id: row.user_id,
            kind: 'standard',
            date: row.date,
            description: row.description,
            lines: {
              create: [{
                user_id: row.user_id,
                account_id: row.account_id,
                category_id: row.category_id,
                amount: row.type === 'income' ? row.amount : -row.amount,
              }],
            },
          },
        });
      }
    }, { timeout: 5 * 60_000, maxWait: 10_000 });
  }
  // Lignes antérieures au premier solde connu du compte (solde initial ou
  // relevé) : elles complètent l'historique sans changer le solde actuel.
  let before_reference = 0;
  let reference_date: string | null = null;
  if (account_id != null && toCreate.length > 0) {
    const [account, firstSnap] = await Promise.all([
      prisma.account.findUnique({ where: { id: account_id }, select: { initial_balance_date: true } }),
      prisma.accountSnapshot.findFirst({ where: { account_id }, orderBy: { date: 'asc' }, select: { date: true } }),
    ]);
    const candidates = [account?.initial_balance_date, firstSnap?.date].filter((d): d is Date => d != null);
    const ref = candidates.sort((a, b) => a.getTime() - b.getTime())[0];
    if (ref) {
      reference_date = ref.toISOString().slice(0, 10);
      before_reference = toCreate.filter((row) => row.date < ref).length;
    }
  }
  return { imported: toCreate.length, skipped: baseSkipped + duplicates.length, duplicates_count: duplicates.length, duplicates, before_reference, reference_date };
}

// Mappings CSV sauvegardés (« profils de banque »).
importExportRouter.get('/users/:user_id/import-mappings', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  res.json(await prisma.importMapping.findMany({ where: { user_id }, orderBy: { name: 'asc' } }));
}));

importExportRouter.post('/users/:user_id/import-mappings', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = createImportMappingSchema.parse(req.body);
  // Upsert par nom : enregistrer un profil existant le met à jour.
  const row = await prisma.importMapping.upsert({
    where: { user_id_name: { user_id, name: body.name } },
    create: { user_id, name: body.name, date_format: body.date_format, columns: body.columns },
    update: { date_format: body.date_format, columns: body.columns },
  });
  res.status(201).json(row);
}));

importExportRouter.delete('/users/:user_id/import-mappings/:id', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const id = idParam.parse(req.params.id);
  const result = await prisma.importMapping.deleteMany({ where: { id, user_id } });
  if (result.count === 0) { res.status(404).json({ error: 'Profil introuvable' }); return; }
  res.json({ deleted: true });
}));

importExportRouter.post('/users/:user_id/import.statement', asyncHandler(async (req, res) => {
  const user_id = idParam.parse(req.params.user_id);
  const body = statementImportSchema.parse(req.body);
  if (body.account_id) await assertAccountOwned(user_id, body.account_id);
  const rules = await loadRules(user_id);
  const raw = body.format === 'ofx' ? parseOfx(body.content) : parseQif(body.content);
  // OFX : date non ambiguë (AAAAMMJJ). QIF : on respecte le format choisi.
  const dateFormat = body.format === 'ofx' ? 'yyyymmdd' as const : body.date_format;

  let skipped = 0;
  const parsedRows: ParsedImportRow[] = [];
  raw.forEach((row, index) => {
    const date = parseDate(row.dateRaw, dateFormat);
    const signedAmount = parseSignedAmount(row.amountRaw);
    if (!date || signedAmount === null || signedAmount === 0) { skipped += 1; return; }
    const description = row.description ?? '';
    const matchedRule = matchRule(rules, description);
    parsedRows.push({
      line: index + 1,
      user_id,
      account_id: body.account_id ?? null,
      category_id: matchedRule?.category_id ?? null,
      date,
      type: signedAmount > 0 ? 'income' : 'expense',
      amount: round2(Math.abs(signedAmount)),
      description,
    });
  });

  res.json(await dedupeAndInsert(user_id, body.account_id ?? null, parsedRows, skipped));
}));

async function existingCsvDuplicateKeys(
  user_id: number,
  account_id: number | null,
  rows: Array<{ account_id: number | null; date: Date; type: 'expense' | 'income'; amount: number; description: string }>,
): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const dates = rows.map((row) => row.date).sort((a, b) => a.getTime() - b.getTime());
  const existing = await prisma.transaction.findMany({
    where: {
      user_id,
      kind: 'standard',
      date: { gte: dates[0], lte: dates[dates.length - 1] },
      lines: { some: { account_id } },
    },
    select: { date: true, description: true, lines: { select: { account_id: true, amount: true } } },
  });
  // Mouvement net de l'opération sur le compte importé (ventilations comprises).
  return new Set(existing.map((t) => {
    const net = t.lines.filter((l) => l.account_id === account_id).reduce((acc, l) => acc + l.amount, 0);
    return csvDuplicateKey({ account_id, date: t.date, type: net > 0 ? 'income' : 'expense', amount: Math.abs(net), description: t.description });
  }));
}

function csvDuplicateKey(row: {
  account_id: number | null;
  date: Date;
  type: string;
  amount: number;
  description: string | null;
}): string {
  const signedAmount = row.type === 'income' ? row.amount : -row.amount;
  return [
    row.account_id ?? 'none',
    row.date.toISOString().slice(0, 10),
    round2(signedAmount).toFixed(2),
    normalizeDuplicateDescription(row.description ?? ''),
  ].join('|');
}

function normalizeDuplicateDescription(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function parseDate(value: string | undefined, format: 'auto' | 'yyyy-mm-dd' | 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'dd-mm-yyyy' | 'yyyymmdd'): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  const dateString = parseDateString(trimmed, format);
  if (!dateString) return null;
  const date = new Date(`${dateString}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateString(value: string, format: 'auto' | 'yyyy-mm-dd' | 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'dd-mm-yyyy' | 'yyyymmdd'): string | null {
  const candidates = format === 'auto'
    ? ['yyyy-mm-dd', 'dd/mm/yyyy', 'dd-mm-yyyy', 'yyyymmdd', 'mm/dd/yyyy'] as const
    : [format] as const;

  for (const candidate of candidates) {
    const parsed = parseDateStringAs(value, candidate);
    if (parsed) return parsed;
  }
  return null;
}

function parseDateStringAs(value: string, format: 'yyyy-mm-dd' | 'dd/mm/yyyy' | 'mm/dd/yyyy' | 'dd-mm-yyyy' | 'yyyymmdd'): string | null {
  if (format === 'yyyy-mm-dd') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? validDateParts(m[1]!, m[2]!, m[3]!) : null;
  }
  if (format === 'dd/mm/yyyy') {
    const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? validDateParts(m[3]!, m[2]!, m[1]!) : null;
  }
  if (format === 'mm/dd/yyyy') {
    const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? validDateParts(m[3]!, m[1]!, m[2]!) : null;
  }
  if (format === 'dd-mm-yyyy') {
    const m = value.match(/^(\d{2})-(\d{2})-(\d{4})/);
    return m ? validDateParts(m[3]!, m[2]!, m[1]!) : null;
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? validDateParts(m[1]!, m[2]!, m[3]!) : null;
}

function validDateParts(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Montant signé tolérant aux formats bancaires : « -1 234,56 € », « 1.234,56 »,
// « 1,234.56 », « (12,50) » (négatif comptable), « 12,50- », espaces insécables.
export function parseSignedAmount(value: string | undefined): number | null {
  if (!value) return null;
  let s = value.trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[\s\u00a0\u202f]/g, '').replace(/[€$£]|EUR|USD|GBP|CHF/gi, '');
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); }
  if (!/^[+-]?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  // Le dernier séparateur rencontré est le décimal ; l'autre sert aux milliers.
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = s.match(/,/g)!.length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const amount = Number(s);
  if (!Number.isFinite(amount)) return null;
  return round2(negative ? -amount : amount);
}

// Colonne « type » : libellé explicite si reconnu, sinon le signe du montant.
function normalizeType(value: string, signedAmount: number): 'expense' | 'income' {
  const v = value.trim().toLowerCase();
  if (/(income|revenu|crédit|credit|recette)/.test(v)) return 'income';
  if (/(expense|dépense|depense|débit|debit)/.test(v)) return 'expense';
  return signedAmount > 0 ? 'income' : 'expense';
}

// Retire l'apostrophe ajoutée par l'export pour neutraliser une formule.
function unescapeCsvText(value: string): string {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

async function loadRules(user_id: number) {
  const rules = await prisma.categoryRule.findMany({ where: { user_id } });
  // Le motif le plus long (le plus spécifique) gagne, de façon déterministe.
  return rules.sort((a, b) => b.pattern.length - a.pattern.length || a.id - b.id);
}

function matchRule<T extends { pattern: string }>(rules: T[], description: string): T | undefined {
  const upper = description.toUpperCase();
  return rules.find((r) => upper.includes(r.pattern));
}

function splitCsv(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(header: string): string {
  const delimiters = ['\t', ';', ','];
  return delimiters
    .map((delimiter) => ({ delimiter, count: header.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ',';
}

function resolveMapping(
  headers: string[],
  mapping: { date?: string; amount?: string; description?: string | null; type?: string | null } | null,
) {
  const byName = new Map(headers.map((header, idx) => [normalizeHeader(header), idx]));
  const find = (names: string[]) => {
    for (const name of names) {
      const idx = byName.get(normalizeHeader(name));
      if (idx != null) return idx;
    }
    return -1;
  };
  const mapped = {
    date: mapping?.date ? find([mapping.date]) : find(['date', 'dateOp', 'dateVal']),
    amount: mapping?.amount ? find([mapping.amount]) : find(['amount', 'montant']),
    description: mapping?.description ? find([mapping.description]) : find(['description', 'label', 'suggestedLabel', 'comment']),
    type: mapping?.type ? find([mapping.type]) : find(['type']),
  };
  if (mapped.date < 0 || mapped.amount < 0) throw new HttpError(400, 'Colonnes date et montant introuvables dans le CSV');
  return {
    date: mapped.date,
    amount: mapped.amount,
    description: mapped.description >= 0 ? mapped.description : null,
    type: mapped.type >= 0 ? mapped.type : null,
  };
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cell(cells: string[], index: number | null): string | undefined {
  return index == null ? undefined : cells[index];
}
