import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma, prismaBase } from '../prisma.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { createImportMappingSchema, csvImportSchema, dateString, idParam, statementImportSchema } from '../lib/validation.js';
import { round2 } from '../lib/money.js';
import { assertAccountOwned } from '../lib/transactionHelpers.js';
import { parseOfx, parseQif } from '../lib/statementParsers.js';
import { legacyView, LINES_ORDERED } from '../lib/ledger.js';
import { backupPayloadSchema, buildExportPayload, EXPORT_ENTITIES, importPayload } from '../lib/backup.js';
import { loadTagRules, tagsForDescription } from '../lib/tagRules.js';

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
  const parsedRows: ParsedImportRow[] = [];
  const occurrences = new Map<string, number>();
  for (const [index, line] of dataLines.entries()) {
    const cells = splitCsv(line, delimiter);
    const rawKey = line.trim().replace(/\s+/g, ' ');
    const occurrence = (occurrences.get(rawKey) ?? 0) + 1;
    occurrences.set(rawKey, occurrence);
    const dateRaw = cell(cells, mapping.date);
    const amountRaw = cell(cells, mapping.amount);
    const descriptionRaw = mapping.description != null ? cell(cells, mapping.description) : '';
    const typeRaw = mapping.type != null ? cell(cells, mapping.type) : undefined;
    const clearedRaw = mapping.cleared != null ? cell(cells, mapping.cleared) : undefined;
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
      fingerprint: fingerprintOf(body.account_id ?? null, `csv:${rawKey}#${occurrence}`),
      cleared: clearedRaw != null && /^(oui|yes|true|1|x)$/i.test(clearedRaw.trim()),
    });
  }
  if (!body.allow_balance_like) assertNotBalanceColumn(mapping.amountIsBoursoSolde ? '' : headers[mapping.amount] ?? '', parsedRows);
  res.json(await dedupeAndInsert(user_id, body.account_id ?? null, parsedRows, skipped));
}));

// Garde-fou : une colonne « solde » prise pour le montant transforme chaque
// achat en revenu égal au solde du jour (cas réel avec le CSV Boursorama, dont
// la colonne `accountbalance` côtoie `amount`). On refuse si l'en-tête dit
// « solde/balance », ou si les « montants » ont la signature d'un solde :
// quasiment tous positifs ET identiques entre les lignes d'une même journée.
export function looksLikeBalanceColumn(header: string, rows: Array<{ date: Date; type: string; amount: number }>): boolean {
  if (/(balance|solde)/i.test(header)) return true;
  if (rows.length < 6) return false;
  const positive = rows.filter((r) => r.type === 'income').length / rows.length;
  if (positive < 0.9) return false;
  const byDay = new Map<string, number[]>();
  for (const r of rows) {
    const k = r.date.toISOString().slice(0, 10);
    const list = byDay.get(k); if (list) list.push(r.amount); else byDay.set(k, [r.amount]);
  }
  const multi = [...byDay.values()].filter((v) => v.length >= 2);
  if (multi.length < 2) return false;
  const constant = multi.filter((v) => v.every((x) => x === v[0])).length;
  return constant / multi.length >= 0.5;
}

function assertNotBalanceColumn(header: string, rows: Array<{ date: Date; type: string; amount: number }>): void {
  if (looksLikeBalanceColumn(header, rows)) {
    throw new HttpError(400, `La colonne « ${header} » ressemble à un solde de compte, pas à un montant d'opération (valeurs identiques pour toutes les opérations d'un même jour). Choisis la colonne du montant (ex. « amount » chez Boursorama).`);
  }
}

// Empreinte d'une ligne de relevé : stable d'un import à l'autre, indépendante
// des modifications faites ensuite dans l'app (libellé, catégorie).
function fingerprintOf(account_id: number | null, raw: string): string {
  return createHash('sha256').update(`${account_id ?? '-'}|${raw}`).digest('hex').slice(0, 40);
}

type ParsedImportRow = {
  fingerprint?: string;
  cleared?: boolean;
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
// Opérations générées automatiquement par un récurrent (libellé et montant du
// modèle) autour des dates importées : une ligne de relevé qui leur correspond
// (même sens, montant à ±20 %, date à ±6 jours) les REMPLACE, sinon le salaire
// ou l'abonnement serait compté deux fois (projection + réel).
async function recurringProjections(user_id: number, account_id: number | null, rows: ParsedImportRow[]) {
  if (account_id == null || rows.length === 0) return [];
  const dates = rows.map((r) => r.date.getTime()).sort((a, b) => a - b);
  const pad = 6 * 86400000;
  const generated = await prisma.transaction.findMany({
    where: {
      user_id,
      kind: 'standard',
      recurring_transaction_id: { not: null },
      date: { gte: new Date(dates[0]! - pad), lte: new Date(dates[dates.length - 1]! + pad) },
      lines: { some: { account_id } },
    },
    select: { id: true, date: true, description: true, recurring_transaction_id: true, lines: { select: { amount: true } }, recurring_transaction: { select: { description: true, amount: true } } },
  });
  return generated
    .filter((t) => t.recurring_transaction && t.lines.length === 1
      && (t.description ?? '') === t.recurring_transaction.description
      && Math.abs(Math.abs(t.lines[0]!.amount) - t.recurring_transaction.amount) < 0.01)
    .map((t) => ({ id: t.id, date: t.date.getTime(), amount: t.lines[0]!.amount, recurring_transaction_id: t.recurring_transaction_id!, description: t.description ?? '' }));
}

async function dedupeAndInsert(user_id: number, account_id: number | null, parsedRows: ParsedImportRow[], baseSkipped: number) {
  const tagRules = await loadTagRules(user_id);
  const duplicateKeys = await existingCsvDuplicateKeys(user_id, account_id, parsedRows);
  const fingerprints = parsedRows.map((r) => r.fingerprint).filter((f): f is string => Boolean(f));
  const knownFingerprints = new Set(fingerprints.length > 0
    ? (await prismaBase.transaction.findMany({ where: { user_id, import_fingerprint: { in: fingerprints } }, select: { import_fingerprint: true } })).map((t) => t.import_fingerprint!)
    : []);
  const projections = await recurringProjections(user_id, account_id, parsedRows);
  const replaced: Array<{ projection_id: number; line: number; description: string; date: string }> = [];
  const recurringLink = new Map<ParsedImportRow, number>();
  const seenInFile = new Set<string>();
  const duplicates: Array<{ line: number; date: string; amount: number; description: string; reason: 'existing' | 'file' }> = [];
  const toCreate = parsedRows.filter((row) => {
    const key = csvDuplicateKey(row);
    // Empreinte connue (même ligne de relevé déjà importée, y compris en
    // corbeille) : doublon certain. Sinon, l'ancienne heuristique (données
    // importées avant les empreintes).
    const reason = row.fingerprint && knownFingerprints.has(row.fingerprint)
      ? 'existing'
      : duplicateKeys.has(key) ? 'existing' : seenInFile.has(key) && !row.fingerprint ? 'file' : null;
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
  });
  // Une seule insertion batch (au lieu d'un INSERT par ligne) : import atomique
  // et beaucoup plus rapide sur les gros relevés.
  const linkedTransfers: Array<{ line: number; transaction_id: number; date: string; amount: number }> = [];
  const transferLink = new Map<ParsedImportRow, number>();
  if (account_id != null && toCreate.length > 0) {
    const TRANSFER_RX = /(\bvir\b|virement|transfert|livret|ldds|secu\d)/i;
    const ts = toCreate.map((r) => r.date.getTime()).sort((a, b) => a - b);
    const pad = 3 * 86400000;
    const candidates = await prisma.transaction.findMany({
      where: {
        user_id,
        kind: 'standard',
        date: { gte: new Date(ts[0]! - pad), lte: new Date(ts[ts.length - 1]! + pad) },
        lines: { some: { account_id: { not: account_id } } },
      },
      select: { id: true, date: true, description: true, lines: { select: { id: true, account_id: true, amount: true } } },
    });
    const used = new Set<number>();
    for (const row of toCreate) {
      if (!TRANSFER_RX.test(row.description)) continue;
      const signed = row.type === 'income' ? row.amount : -row.amount;
      const match = candidates
        .filter((c) => !used.has(c.id) && c.lines.length === 1 && c.lines[0]!.account_id != null && c.lines[0]!.account_id !== account_id
          && Math.abs(c.lines[0]!.amount + signed) < 0.005
          && Math.abs(c.date.getTime() - row.date.getTime()) <= pad
          && TRANSFER_RX.test(c.description ?? ''))
        .sort((a, b) => Math.abs(a.date.getTime() - row.date.getTime()) - Math.abs(b.date.getTime() - row.date.getTime()))[0];
      if (!match) continue;
      used.add(match.id);
      transferLink.set(row, match.id);
      linkedTransfers.push({ line: row.line, transaction_id: match.id, date: row.date.toISOString().slice(0, 10), amount: signed });
    }
  }

  // Chaque projection ne peut être remplacée qu'une fois, par la ligne la plus proche.
  const usedProjections = new Set<number>();
  for (const row of toCreate) {
    if (transferLink.has(row)) continue;
    const signed = row.type === 'income' ? row.amount : -row.amount;
    const candidates = projections
      .filter((p) => !usedProjections.has(p.id) && Math.sign(p.amount) === Math.sign(signed)
        && Math.abs(p.date - row.date.getTime()) <= 6 * 86400000
        && Math.abs(Math.abs(signed) - Math.abs(p.amount)) <= Math.abs(p.amount) * 0.2)
      .sort((a, b) => Math.abs(a.date - row.date.getTime()) - Math.abs(b.date - row.date.getTime()));
    const match = candidates[0];
    if (!match) continue;
    usedProjections.add(match.id);
    recurringLink.set(row, match.recurring_transaction_id);
    replaced.push({ projection_id: match.id, line: row.line, description: match.description, date: new Date(match.date).toISOString().slice(0, 10) });
  }
  if (toCreate.length > 0) {
    // Import atomique : tout ou rien.
    await prisma.$transaction(async (tx) => {
      if (usedProjections.size > 0) await tx.transaction.deleteMany({ where: { id: { in: [...usedProjections] }, user_id } });
      for (const row of toCreate) {
        const counterpart = transferLink.get(row);
        if (counterpart != null) {
          // L'opération existante devient le virement : on lui ajoute la ligne
          // de ce compte et elle perd sa catégorie (ni dépense ni revenu).
          await tx.transactionLine.updateMany({ where: { transaction_id: counterpart }, data: { category_id: null, refund: false } });
          await tx.transactionLine.create({
            data: { user_id: row.user_id, transaction_id: counterpart, account_id: row.account_id, amount: row.type === 'income' ? row.amount : -row.amount, position: 1 },
          });
          await tx.transaction.update({ where: { id: counterpart }, data: { kind: 'transfer', import_fingerprint: row.fingerprint ?? undefined } });
          continue;
        }
        await tx.transaction.create({
          data: {
            user_id: row.user_id,
            kind: 'standard',
            recurring_transaction_id: recurringLink.get(row) ?? null,
            import_fingerprint: row.fingerprint ?? null,
            cleared: row.cleared ?? false,
            date: row.date,
            description: row.description,
            // Règles de tag : toutes celles qui correspondent au libellé.
            tags: { create: tagsForDescription(tagRules, row.description).map((tag_id) => ({ tag_id })) },
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
  return { imported: toCreate.length - linkedTransfers.length, skipped: baseSkipped + duplicates.length, duplicates_count: duplicates.length, duplicates, before_reference, reference_date, recurring_replaced: replaced, linked_transfers: linkedTransfers };
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
  const stmtOccurrences = new Map<string, number>();
  raw.forEach((row, index) => {
    const rawKey = row.externalId ? `fitid:${row.externalId}` : `${body.format}:${row.dateRaw}|${row.amountRaw}|${row.description}`;
    const occurrence = (stmtOccurrences.get(rawKey) ?? 0) + 1;
    stmtOccurrences.set(rawKey, occurrence);
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
      fingerprint: fingerprintOf(body.account_id ?? null, row.externalId ? rawKey : `${rawKey}#${occurrence}`),
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
  // Première occurrence d'un en-tête : l'export Boursorama a DEUX colonnes
  // « Solde » (la 1re est le montant de l'opération, la 2e le solde du compte) ;
  // garder la dernière faisait prendre le solde pour le montant.
  const byName = new Map<string, number>();
  headers.forEach((header, idx) => { const k = normalizeHeader(header); if (!byName.has(k)) byName.set(k, idx); });
  const soldeColumns = headers.map((h, idx) => (normalizeHeader(h) === 'solde' ? idx : -1)).filter((i) => i >= 0);
  const bourso = byName.has('libellecompte') && soldeColumns.length >= 2;
  const find = (names: string[]) => {
    for (const name of names) {
      // « Solde (2) » : n-ième colonne homonyme (convention de l'aperçu du front).
      const nth = name.match(/^(.*) \((\d+)\)$/);
      if (nth) {
        const base = normalizeHeader(nth[1]!);
        const idx = headers.map((h, i) => (normalizeHeader(h) === base ? i : -1)).filter((i) => i >= 0)[Number(nth[2]) - 1];
        if (idx != null) return idx;
      }
      const idx = byName.get(normalizeHeader(name));
      if (idx != null) return idx;
    }
    return -1;
  };
  const mapped = {
    date: mapping?.date ? find([mapping.date]) : find(['date', 'dateOp', 'Date Opération', 'dateVal', 'Date Valeur']),
    amount: mapping?.amount ? find([mapping.amount]) : (() => {
      const named = find(['amount', 'montant']);
      return named >= 0 ? named : bourso ? soldeColumns[0]! : -1;
    })(),
    description: mapping?.description ? find([mapping.description]) : find(['description', 'label', 'Libellé', 'suggestedLabel', 'Libellé Suggéré', 'comment']),
    type: mapping?.type ? find([mapping.type]) : find(['type']),
  };
  const cleared = find(['Pointage', 'cleared']);
  if (mapped.date < 0 || mapped.amount < 0) throw new HttpError(400, 'Colonnes date et montant introuvables dans le CSV');
  return {
    date: mapped.date,
    amount: mapped.amount,
    description: mapped.description >= 0 ? mapped.description : null,
    type: mapped.type >= 0 ? mapped.type : null,
    cleared: cleared >= 0 ? cleared : null,
    // Montant = 1re colonne « Solde » d'un export Boursorama : le nom trompe
    // le garde-fou par en-tête, seule la signature des valeurs compte.
    amountIsBoursoSolde: bourso && mapped.amount === soldeColumns[0],
  };
}

function normalizeHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function cell(cells: string[], index: number | null): string | undefined {
  return index == null ? undefined : cells[index];
}
