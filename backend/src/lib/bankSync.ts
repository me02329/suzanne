// Synchronisation bancaire (Enable Banking) : autorisation, connexions, et
// import des opérations par le pipeline existant (règles de catégorie,
// virements entre comptes, projections de récurrents). Voir docs/ENABLE-BANKING.md.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma.js';
import { HttpError } from '../middleware/errors.js';
import { round2 } from './money.js';
import {
  EnableBankingClient, EnableBankingError, enableBankingConfigFromEnv, toBankRow,
  type Aspsp, type BankBalance, type BankTransaction, type EnableBankingConfig, type SessionAccount,
} from './enableBanking.js';
import { dedupeAndInsert, loadRules, matchRule, type ParsedImportRow } from '../routes/import_export.js';
import { generateDueRecurringTransactions } from '../routes/recurring.js';
import { bankScheduleKey, isSyncDue, parseSyncSchedule, scheduleFromSetting, type SyncSchedule } from './bankSchedule.js';

const DAY = 86400_000;
/** Recouvrement à chaque synchro : une opération peut être comptabilisée avec quelques jours de retard. */
const OVERLAP_DAYS = 10;
/** Première synchro sans date choisie : 90 jours d'historique. */
const DEFAULT_HISTORY_DAYS = 90;

let cached: { config: EnableBankingConfig | null; error: string | null } | null = null;

/** Configuration serveur (lue une fois) ; null si la fonction n'est pas activée. */
export function bankConfig(): { config: EnableBankingConfig | null; error: string | null } {
  if (!cached) {
    try {
      cached = { config: enableBankingConfigFromEnv(), error: null };
    } catch (error) {
      cached = { config: null, error: `Clé privée illisible : ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  return cached;
}

/** Pour les tests : configuration et client injectés. */
let clientOverride: EnableBankingClient | null = null;
export function setBankClientForTests(client: EnableBankingClient | null, config: EnableBankingConfig | null = null) {
  clientOverride = client;
  cached = client ? { config, error: null } : null;
}

export function bankClient(): EnableBankingClient {
  if (clientOverride) return clientOverride;
  const { config, error } = bankConfig();
  if (!config) throw new HttpError(503, error ?? 'Synchronisation bancaire non configurée sur ce serveur (voir Réglages → Données).');
  return new EnableBankingClient(config);
}

// ---- État signé de l'autorisation (anti-CSRF, lié au profil) ---------------

const stateSecret = () => {
  const { config } = bankConfig();
  return createHash('sha256').update(`suzanne-bank-state|${config?.privateKeyPem ?? 'test'}`).digest();
};

export function signState(payload: { u: number; a: string; c: string }): string {
  const body = Buffer.from(JSON.stringify({ ...payload, t: Date.now(), n: randomUUID() })).toString('base64url');
  const mac = createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyState(state: string, user_id: number): { a: string; c: string } {
  const [body, mac] = state.split('.');
  if (!body || !mac) throw new HttpError(400, 'Retour de la banque invalide (state).');
  const expected = createHmac('sha256', stateSecret()).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(400, 'Retour de la banque invalide (signature).');
  const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as { u: number; a: string; c: string; t: number };
  if (data.u !== user_id) throw new HttpError(403, 'Cette autorisation a été demandée par un autre profil.');
  if (Date.now() - data.t > 60 * 60_000) throw new HttpError(400, 'Autorisation expirée : recommence la connexion.');
  return { a: data.a, c: data.c };
}

// ---- Banques ---------------------------------------------------------------

const aspspCache = new Map<string, { at: number; list: Aspsp[] }>();
export async function listAspsps(country: string): Promise<Aspsp[]> {
  const hit = aspspCache.get(country);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.list;
  const list = (await bankClient().aspsps(country)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  aspspCache.set(country, { at: Date.now(), list });
  return list;
}

export async function startAuthorization(user_id: number, aspsp_name: string, country: string) {
  const bank = (await listAspsps(country)).find((b) => b.name === aspsp_name);
  if (!bank) throw new HttpError(404, `Banque inconnue : ${aspsp_name}`);
  const maxDays = bank.maximum_consent_validity ? Math.floor(bank.maximum_consent_validity / 86400) : 90;
  const validUntil = new Date(Date.now() + maxDays * DAY);
  const { url } = await bankClient().startAuth({ name: bank.name, country }, { state: signState({ u: user_id, a: bank.name, c: country }), validUntil });
  return { url, valid_until: validUntil.toISOString() };
}

const linkFields = (acc: SessionAccount) => ({
  remote_uid: acc.uid,
  remote_name: acc.name ?? acc.product ?? acc.details ?? null,
  iban_last4: acc.account_id?.iban ? acc.account_id.iban.slice(-4) : null,
  currency: acc.currency && /^[A-Z]{3}$/.test(acc.currency) && acc.currency !== 'XXX' ? acc.currency : null,
});

/**
 * Comptes d'une session. Normalement donnés par POST /sessions ; certaines
 * banques (vu avec Revolut) renvoient une liste vide alors que l'utilisateur a
 * choisi ses comptes chez elles. Repli : la session relue (identifiants des
 * comptes), puis le détail de chacun.
 */
async function sessionAccounts(client: EnableBankingClient, sessionId: string, given: SessionAccount[] | undefined): Promise<SessionAccount[]> {
  if (given && given.length > 0) return given;
  const session = await client.getSession(sessionId);
  const raw = Array.isArray(session.accounts) ? session.accounts : [];
  // accounts_data : autre forme de la liste (objets { uid }), au cas où.
  const data = Array.isArray(session.accounts_data) ? session.accounts_data : [];
  const uids = [...new Set([...raw, ...data].map((a) => (typeof a === 'string' ? a : (a as { uid?: string })?.uid)).filter((u): u is string => typeof u === 'string' && u.length > 0))];
  if (uids.length === 0) {
    // Diagnostic (sans données personnelles) : état de la session chez Enable Banking.
    console.warn(`[bank] session ${sessionId} sans compte : status=${String(session.status)} authorized=${String(session.authorized ?? '?')} aspsp=${JSON.stringify((session as { aspsp?: unknown }).aspsp ?? null)}`);
  }
  const out: SessionAccount[] = [];
  for (const uid of uids) {
    const details = await client.accountDetails(uid).catch(() => ({})) as Partial<SessionAccount>;
    out.push({ ...details, uid });
  }
  return out;
}

/** Retour de la banque : crée la connexion et un lien par compte autorisé. */
export async function completeAuthorization(user_id: number, code: string, state: string) {
  const { a, c } = verifyState(state, user_id);
  const client = bankClient();
  const session = await client.createSession(code);
  const accounts = await sessionAccounts(client, session.session_id, session.accounts);
  const validUntil = session.access?.valid_until ? new Date(session.access.valid_until) : new Date(Date.now() + DEFAULT_HISTORY_DAYS * DAY);
  const connection = await prisma.bankConnection.create({
    data: {
      user_id,
      aspsp_name: session.aspsp?.name ?? a,
      aspsp_country: session.aspsp?.country ?? c,
      session_id: session.session_id,
      valid_until: validUntil,
      links: { create: accounts.map((acc) => ({ user_id, ...linkFields(acc) })) },
    },
    include: { links: true },
  });
  if (accounts.length === 0) console.warn(`[bank] ${connection.aspsp_name} : aucun compte renvoyé pour la session ${session.session_id}`);
  return connection;
}

/**
 * Relit chez la banque la liste des comptes d'une connexion et ajoute ceux qui
 * manquent (connexion créée sans compte, ou compte ajouté depuis). Les liens
 * existants et leurs associations ne bougent pas.
 */
export async function refreshConnectionAccounts(user_id: number, connectionId: number) {
  const connection = await prisma.bankConnection.findFirst({ where: { id: connectionId, user_id }, include: { links: true } });
  if (!connection) throw new HttpError(404, 'Connexion bancaire introuvable');
  let accounts: SessionAccount[];
  try {
    accounts = await sessionAccounts(bankClient(), connection.session_id, undefined);
  } catch (error) {
    throw new HttpError(isRateLimited(error) ? 429 : 502, syncErrorMessage(error));
  }
  const known = new Set(connection.links.map((l) => l.remote_uid));
  const fresh = accounts.filter((acc) => !known.has(acc.uid));
  if (fresh.length > 0) {
    await prisma.bankLink.createMany({ data: fresh.map((acc) => ({ user_id, connection_id: connection.id, ...linkFields(acc) })) });
  }
  return { found: accounts.length, added: fresh.length };
}

// ---- Synchronisation -------------------------------------------------------

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Libellé lisible : 1re ligne du libellé bancaire + motif, sans les références
 * techniques (Réf, RUM, identifiants de mandat ou de commande). Le texte
 * complet est conservé en note de ligne.
 */
export function readableLabel(tx: BankTransaction): { description: string; note: string | null } {
  const row = toBankRow(tx);
  const lines = (tx.remittance_information ?? []).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const full = lines.join(' ');
  if (lines.length === 0) return { description: row.description, note: null };
  const strip = (s: string) => s
    .replace(/\bR[ée]f\.?\s*:?\s*[-\w/.]+/gi, '')
    .replace(/\bRUM\b.*$/i, '')
    .replace(/\b(?=[\w/.()-]*\d)[\w/.()-]{14,}/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—:/]\s*$/, '')
    .trim();
  const head = lines[0]!;
  const motif = strip(lines.slice(1).join(' '));
  const description = motif && !normalize(head).includes(normalize(motif)) ? `${head} — ${motif}` : head;
  return { description: description.slice(0, 250), note: full !== description ? full.slice(0, 1000) : null };
}

interface SyncResult {
  account_id: number;
  fetched: number;
  pending: number;
  imported: number;
  adopted: number;
  duplicates: number;
  linked_transfers: number;
  balance: { amount: number; date: string; type: string } | null;
  from: string;
}

function pickBalance(balances: BankBalance[]): BankBalance | null {
  for (const type of ['CLBD', 'ITBD', 'OPBD', 'XPCD', 'ITAV', 'CLAV']) {
    const b = balances.find((x) => x.balance_type === type);
    if (b) return b;
  }
  return balances[0] ?? null;
}

/**
 * Les opérations déjà présentes sur le compte (import CSV/OFX, saisie) sont
 * reconnues (même date, même montant, une seule fois chacune) plutôt que
 * dupliquées : elles prennent l'empreinte bancaire, et le libellé complet si
 * l'ancien n'en était que le début (libellé de relevé tronqué, jamais un
 * libellé modifié à la main).
 */
async function adoptExisting(user_id: number, account_id: number, rows: Array<ParsedImportRow & { fingerprint: string }>) {
  if (rows.length === 0) return { rest: rows, adopted: 0 };
  const knownRows = await prisma.transaction.findMany({
    where: { user_id, import_fingerprint: { in: rows.map((r) => r.fingerprint) } },
    select: { id: true, import_fingerprint: true, bank_data: true },
  });
  const known = new Set(knownRows.map((t) => t.import_fingerprint));
  // Déjà synchronisées avant que les données bancaires soient conservées : on les complète.
  const rowByFingerprint = new Map(rows.map((r) => [r.fingerprint, r]));
  for (const t of knownRows) {
    const data = rowByFingerprint.get(t.import_fingerprint!)?.bank_data;
    if (data && t.bank_data == null) await prisma.transaction.update({ where: { id: t.id }, data: { bank_data: [data] as Prisma.InputJsonValue } });
  }
  const fresh = rows.filter((r) => !known.has(r.fingerprint));
  if (fresh.length === 0) return { rest: [], adopted: 0 };
  const times = fresh.map((r) => r.date.getTime());
  // Empreintes de ce compte bancaire : « eb:<compte>:<id> ». Une opération déjà
  // synchronisée depuis un AUTRE compte (virement entre deux comptes liés) reste
  // reconnaissable ; seules celles de ce compte-ci sont exclues (déjà connues).
  const ownPrefix = fresh[0]!.fingerprint.split(':').slice(0, 2).join(':') + ':';
  const candidates = await prisma.transaction.findMany({
    where: {
      user_id,
      date: { gte: new Date(Math.min(...times) - 3 * DAY), lte: new Date(Math.max(...times) + 3 * DAY) },
      lines: { some: { account_id } },
      OR: [{ import_fingerprint: null }, { NOT: { import_fingerprint: { startsWith: ownPrefix } } }],
    },
    select: { id: true, date: true, description: true, import_fingerprint: true, bank_data: true, lines: { select: { account_id: true, amount: true } } },
  });
  const used = new Set<number>();
  const rest: typeof fresh = [];
  let adopted = 0;
  for (const tolerance of [0, 3]) {
    const pending = tolerance === 0 ? fresh : rest.splice(0);
    for (const row of pending) {
      const signed = row.type === 'income' ? row.amount : -row.amount;
      const match = candidates
        .filter((c) => !used.has(c.id)
          && Math.abs(c.date.getTime() - row.date.getTime()) <= tolerance * DAY
          && Math.abs(c.lines.filter((l) => l.account_id === account_id).reduce((s, l) => s + l.amount, 0) - signed) < 0.005)
        .sort((x, y) => Math.abs(x.date.getTime() - row.date.getTime()) - Math.abs(y.date.getTime() - row.date.getTime()))[0];
      if (!match) { rest.push(row); continue; }
      used.add(match.id);
      adopted += 1;
      // Déjà synchronisée depuis l'autre compte du virement : on ajoute seulement
      // les données bancaires de ce côté-ci (une fois).
      if (match.import_fingerprint?.startsWith('eb:')) {
        const entries = Array.isArray(match.bank_data) ? match.bank_data as Array<Record<string, unknown>> : [];
        if (row.bank_data && !entries.some((e) => e.account_id === account_id)) {
          await prisma.transaction.update({ where: { id: match.id }, data: { bank_data: [...entries, row.bank_data] as Prisma.InputJsonValue } });
        }
        continue;
      }
      const old = normalize(match.description ?? '');
      const upgrade = old.length > 0 && normalize(row.description).startsWith(old) && row.description.length > (match.description ?? '').length;
      await prisma.transaction.update({
        where: { id: match.id },
        data: {
          import_fingerprint: row.fingerprint,
          ...(upgrade ? { description: row.description } : {}),
          ...(row.bank_data ? { bank_data: [row.bank_data] as Prisma.InputJsonValue } : {}),
        },
      });
    }
  }
  return { rest, adopted };
}

/**
 * Les banques limitent l'historique accessible (Boursorama : 90 jours). Une
 * date trop ancienne est refusée (422 WRONG_TRANSACTIONS_PERIOD) avec la date
 * la plus ancienne autorisée : on recommence à partir de celle-ci.
 */
async function fetchWithinBankLimit(client: EnableBankingClient, uid: string, dateFrom: string): Promise<BankTransaction[]> {
  try {
    return await client.transactions(uid, { dateFrom });
  } catch (error) {
    if (!(error instanceof EnableBankingError) || error.status !== 422) throw error;
    let earliest: string | undefined;
    try { earliest = (JSON.parse(error.body) as { detail?: { date_from?: string } }).detail?.date_from; } catch { /* corps non JSON */ }
    if (!earliest || !/^\d{4}-\d{2}-\d{2}$/.test(earliest) || earliest <= dateFrom) throw error;
    return client.transactions(uid, { dateFrom: earliest });
  }
}

/**
 * Données bancaires conservées pour la fiche de l'opération : tout ce que la
 * banque fournit d'utile (dates, références, contrepartie, motif complet…),
 * sans les champs vides.
 */
export function bankDataOf(tx: BankTransaction, bank: string, account_id: number): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    source: 'enable_banking',
    bank,
    account_id,
    synced_at: new Date().toISOString(),
    entry_reference: tx.entry_reference,
    transaction_id: tx.transaction_id,
    status: tx.status,
    booking_date: tx.booking_date,
    value_date: tx.value_date,
    transaction_date: tx.transaction_date,
    remittance_information: tx.remittance_information,
    creditor_name: tx.creditor?.name,
    debtor_name: tx.debtor?.name,
    creditor_iban: tx.creditor_account?.iban,
    debtor_iban: tx.debtor_account?.iban,
    bank_transaction_code: tx.bank_transaction_code?.description ?? tx.bank_transaction_code?.code,
    merchant_category_code: tx.merchant_category_code,
    reference_number: tx.reference_number,
    note: tx.note,
    balance_after: tx.balance_after_transaction ? Number(tx.balance_after_transaction.amount) : undefined,
    exchange_rate: (tx as { exchange_rate?: unknown }).exchange_rate,
  };
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)));
}

// ---- Verrou par connexion ----------------------------------------------------
// Une seule synchro à la fois par connexion (bouton et synchro automatique
// simultanés, double clic) : deux synchros parallèles liraient les mêmes
// opérations avant que l'une ou l'autre les enregistre. Le serveur est un seul
// processus : un verrou en mémoire suffit.
const syncing = new Set<number>();

export class SyncBusyError extends HttpError {
  constructor() { super(409, 'Une synchronisation de cette banque est déjà en cours : réessaie dans un instant.'); }
}

async function withConnectionLock<T>(connectionId: number, fn: () => Promise<T>): Promise<T> {
  if (syncing.has(connectionId)) throw new SyncBusyError();
  syncing.add(connectionId);
  try {
    return await fn();
  } finally {
    syncing.delete(connectionId);
  }
}

/** La banque (ou Enable Banking) refuse pour cause de quota d'accès dépassé. */
export function isRateLimited(error: unknown): boolean {
  return error instanceof EnableBankingError
    && (error.status === 429 || /RATE_LIMIT|rate limit|too many requests|ACCESS_EXCEEDED/i.test(error.body));
}

/** Accès révoqué ou expiré côté banque : il faut reconnecter. */
export function isConsentGone(error: unknown): boolean {
  if (!(error instanceof EnableBankingError) || isRateLimited(error)) return false;
  return error.status === 401 || error.status === 403 || /expired|revoked|invalid session|EXPIRED_SESSION|CLOSED_SESSION/i.test(error.body);
}

/** Message affiché (et enregistré) pour une synchro qui échoue. */
export function syncErrorMessage(error: unknown): string {
  if (isRateLimited(error)) return 'La banque limite le nombre de synchronisations par jour : nouvel essai au prochain créneau automatique.';
  if (isConsentGone(error)) return 'L\'accès à la banque a expiré ou a été révoqué : reconnecte la banque.';
  if (error instanceof EnableBankingError) return `La banque a refusé la synchronisation : ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export async function syncLink(user_id: number, linkId: number): Promise<SyncResult> {
  const link = await prisma.bankLink.findFirst({ where: { id: linkId, user_id }, select: { connection_id: true } });
  if (!link) throw new HttpError(404, 'Compte bancaire introuvable');
  return withConnectionLock(link.connection_id, async () => {
    try {
      return await syncLinkUnlocked(user_id, linkId);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(isRateLimited(error) ? 429 : 502, syncErrorMessage(error));
    }
  });
}

async function syncLinkUnlocked(user_id: number, linkId: number): Promise<SyncResult> {
  const link = await prisma.bankLink.findFirst({ where: { id: linkId, user_id }, include: { connection: true } });
  if (!link) throw new HttpError(404, 'Compte bancaire introuvable');
  if (link.account_id == null) throw new HttpError(400, 'Associe d\'abord ce compte bancaire à un compte Suzanne.');
  const account_id = link.account_id;
  const client = bankClient();
  const today = new Date();
  const from = link.last_sync_at
    ? new Date(Math.max(link.last_sync_at.getTime() - OVERLAP_DAYS * DAY, link.sync_from?.getTime() ?? 0))
    : link.sync_from ?? new Date(today.getTime() - DEFAULT_HISTORY_DAYS * DAY);
  const [txs, balances] = await Promise.all([
    fetchWithinBankLimit(client, link.remote_uid, isoDay(from)),
    client.balances(link.remote_uid).catch(() => [] as BankBalance[]),
  ]);
  const rules = await loadRules(user_id);
  const booked = txs.filter((t) => (t.status ?? 'BOOK') === 'BOOK');
  const rows: Array<ParsedImportRow & { fingerprint: string }> = [];
  booked.forEach((tx, index) => {
    const base = toBankRow(tx);
    if (!base.fingerprint || !base.date || !(base.amount > 0)) return;
    if (link.sync_from && base.date < isoDay(link.sync_from)) return;
    const { description, note } = readableLabel(tx);
    rows.push({
      line: index + 1,
      user_id,
      account_id,
      category_id: matchRule(rules, description)?.category_id ?? null,
      date: new Date(`${base.date}T00:00:00.000Z`),
      type: base.type,
      amount: round2(base.amount),
      description,
      note,
      fingerprint: `eb:${link.remote_uid.slice(0, 8)}:${base.fingerprint.slice(3)}`.slice(0, 190),
      cleared: true,
      bank_data: bankDataOf(tx, link.connection.aspsp_name, account_id),
    });
  });
  const { rest, adopted } = await adoptExisting(user_id, account_id, rows);
  const inserted = await dedupeAndInsert(user_id, account_id, rest, 0);
  // Récurrents de ce compte qui attendaient la banque : l'opération arrivée
  // est rattachée et complétée (catégorie) tout de suite.
  await generateDueRecurringTransactions(user_id, today).catch((error) => console.error('[bank] récurrents après synchro', error));

  // Solde comptabilisé → relevé (le rapprochement compare aux opérations).
  const bal = pickBalance(balances);
  let balance: SyncResult['balance'] = null;
  if (bal) {
    const date = new Date(`${(bal.reference_date ?? isoDay(today)).slice(0, 10)}T00:00:00.000Z`);
    const amount = round2(Number(bal.balance_amount.amount));
    if (Number.isFinite(amount)) {
      await prisma.accountSnapshot.upsert({
        where: { account_id_date: { account_id, date } },
        create: { user_id, account_id, date, balance: amount },
        update: { balance: amount },
      });
      balance = { amount, date: isoDay(date), type: bal.balance_type };
    }
  }
  const result: SyncResult = {
    account_id,
    fetched: txs.length,
    pending: txs.length - booked.length,
    imported: inserted.imported,
    adopted,
    duplicates: inserted.duplicates_count,
    linked_transfers: inserted.linked_transfers.length,
    balance,
    from: isoDay(from),
  };
  await prisma.bankLink.update({ where: { id: link.id }, data: { last_sync_at: today, last_result: result as object } });
  return result;
}

/**
 * Synchronise tous les comptes associés d'une connexion ; met à jour son état.
 * Un compte en échec n'empêche pas les autres d'être synchronisés ; l'erreur
 * est enregistrée puis renvoyée. Seul un accès expiré ou révoqué arrête tout.
 */
export async function syncConnection(user_id: number, connectionId: number) {
  const exists = await prisma.bankConnection.findFirst({ where: { id: connectionId, user_id }, select: { id: true } });
  if (!exists) throw new HttpError(404, 'Connexion bancaire introuvable');
  return withConnectionLock(connectionId, () => syncConnectionUnlocked(user_id, connectionId));
}

async function syncConnectionUnlocked(user_id: number, connectionId: number) {
  const connection = await prisma.bankConnection.findFirst({ where: { id: connectionId, user_id }, include: { links: true } });
  if (!connection) throw new HttpError(404, 'Connexion bancaire introuvable');
  const now = new Date();
  if (connection.valid_until.getTime() < now.getTime()) {
    await prisma.bankConnection.update({ where: { id: connection.id }, data: { status: 'expired', last_attempt_at: now } });
    throw new HttpError(409, 'Le consentement a expiré : reconnecte la banque.');
  }
  // Tentative notée AVANT d'appeler la banque : un plantage en cours de route
  // ne doit pas faire retenter la synchro automatique en boucle.
  await prisma.bankConnection.update({ where: { id: connection.id }, data: { last_attempt_at: now } });
  const results: SyncResult[] = [];
  let firstError: unknown = null;
  for (const link of connection.links.filter((l) => l.account_id != null)) {
    try {
      results.push(await syncLinkUnlocked(user_id, link.id));
    } catch (error) {
      firstError ??= error;
      // Accès perdu ou quota atteint : les autres comptes de la même banque
      // échoueraient pareil (et consommeraient du quota) ; on s'arrête là.
      if (isConsentGone(error) || isRateLimited(error)) break;
    }
  }
  if (firstError == null) {
    await prisma.bankConnection.update({ where: { id: connection.id }, data: { status: 'active', last_sync_at: new Date(), last_error: null } });
    return results;
  }
  const message = syncErrorMessage(firstError);
  await prisma.bankConnection.update({
    where: { id: connection.id },
    data: {
      status: isConsentGone(firstError) ? 'expired' : 'error',
      last_error: message.slice(0, 500),
      // Une partie des comptes est à jour : on le note quand même.
      ...(results.length > 0 ? { last_sync_at: new Date() } : {}),
    },
  });
  if (firstError instanceof HttpError) throw firstError;
  throw new HttpError(isRateLimited(firstError) ? 429 : 502, message);
}

export async function deleteConnection(user_id: number, connectionId: number) {
  const connection = await prisma.bankConnection.findFirst({ where: { id: connectionId, user_id } });
  if (!connection) throw new HttpError(404, 'Connexion bancaire introuvable');
  // Révocation côté Enable Banking (au mieux : une session expirée n'existe plus).
  await bankClient().deleteSession(connection.session_id).catch(() => undefined);
  await prisma.bankConnection.delete({ where: { id: connection.id } });
}

// ---- Synchro automatique ---------------------------------------------------

/** Créneaux de la synchro automatique (lus une fois, avertissements affichés au démarrage). */
let scheduleCache: SyncSchedule | null = null;
export function bankSyncSchedule(): SyncSchedule {
  scheduleCache ??= parseSyncSchedule();
  return scheduleCache;
}

/**
 * Un passage de la synchro automatique : synchronise les connexions dont le
 * créneau est passé (voir isSyncDue). Ne lève jamais : une erreur de base ou de
 * banque est journalisée et le passage suivant réessaiera.
 */
/** Créneaux d'un profil : ses heures choisies, sinon celles du serveur. */
export async function userSyncSchedule(user_id: number, fallback: SyncSchedule = bankSyncSchedule()) {
  const row = await prisma.setting.findUnique({ where: { key: bankScheduleKey(user_id) } });
  return scheduleFromSetting(row?.value, fallback);
}

export async function runScheduledBankSync(now = new Date(), fallback: SyncSchedule = bankSyncSchedule()): Promise<{ due: number; ok: number; failed: number }> {
  const out = { due: 0, ok: 0, failed: 0 };
  let candidates: Array<{ id: number; user_id: number; status: string; valid_until: Date; last_attempt_at: Date | null }>;
  const schedules = new Map<number, SyncSchedule>();
  try {
    candidates = await prisma.bankConnection.findMany({
      where: { status: { in: ['active', 'error'] }, valid_until: { gt: now } },
      select: { id: true, user_id: true, status: true, valid_until: true, last_attempt_at: true },
      orderBy: { id: 'asc' },
    });
    const users = [...new Set(candidates.map((c) => c.user_id))];
    const rows = users.length > 0 ? await prisma.setting.findMany({ where: { key: { in: users.map(bankScheduleKey) } } }) : [];
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    for (const u of users) schedules.set(u, scheduleFromSetting(byKey.get(bankScheduleKey(u)), fallback));
  } catch (error) {
    console.error('[suzanne] bank sync: lecture des connexions impossible', error instanceof Error ? error.message : error);
    return out;
  }
  for (const c of candidates) {
    if (!isSyncDue(c, now, schedules.get(c.user_id) ?? fallback)) continue;
    out.due += 1;
    try {
      await syncConnection(c.user_id, c.id);
      out.ok += 1;
    } catch (error) {
      // Déjà en cours (bouton « Synchroniser ») : rien à faire, ce n'est pas un échec.
      if (error instanceof SyncBusyError) { out.due -= 1; continue; }
      out.failed += 1;
      console.error(`[suzanne] bank sync ${c.id} failed:`, error instanceof Error ? error.message : error);
    }
  }
  if (out.due > 0) console.log(`[suzanne] bank sync: ${out.ok} ok, ${out.failed} en échec`);
  return out;
}

const CHECK_EVERY_MS = 15 * 60_000;

/**
 * Synchro automatique : vérification toutes les 15 minutes, synchro aux
 * créneaux BANK_SYNC_HOURS (7 h et 19 h, heure de Paris, par défaut). Un
 * créneau manqué (serveur arrêté) est rattrapé une fois au redémarrage.
 */
export function startBankSyncScheduler(): void {
  if (!bankConfig().config) return;
  const schedule = bankSyncSchedule();
  for (const warning of schedule.warnings) console.warn(`[suzanne] ${warning}`);
  console.log(`[suzanne] bank sync auto (défaut, modifiable par profil) : ${schedule.hours.map((h) => `${h} h`).join(', ')} (${schedule.timeZone})`);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runScheduledBankSync(new Date(), schedule);
    } catch (error) {
      console.error('[suzanne] bank sync scheduler failed', error);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void tick(), 60_000).unref?.();
  setInterval(() => void tick(), CHECK_EVERY_MS).unref?.();
}

/**
 * Alertes automatiques (non configurables) des connexions bancaires : accès
 * expiré, expirant dans 7 jours, ou synchronisation en erreur. Identifiants
 * négatifs comme les alertes de budget.
 */
export async function bankAlerts(user_id: number): Promise<Array<{ id: number; type: 'bank'; severity: 'warning' | 'info'; message: string }>> {
  const connections = await prisma.bankConnection.findMany({ where: { user_id }, select: { id: true, aspsp_name: true, valid_until: true, status: true } });
  const out: Array<{ id: number; type: 'bank'; severity: 'warning' | 'info'; message: string }> = [];
  for (const c of connections) {
    const days = Math.ceil((c.valid_until.getTime() - Date.now()) / DAY);
    const id = -100_000 - c.id;
    if (days <= 0 || c.status === 'expired') {
      out.push({ id, type: 'bank', severity: 'warning', message: `L'accès à ${c.aspsp_name} a expiré : plus de synchronisation. Renouvelle-le dans Réglages → Données.` });
    } else if (days <= 7) {
      out.push({ id, type: 'bank', severity: 'info', message: `L'accès à ${c.aspsp_name} expire dans ${days} jour${days > 1 ? 's' : ''} : renouvelle-le dans Réglages → Données.` });
    } else if (c.status === 'error') {
      out.push({ id, type: 'bank', severity: 'warning', message: `La synchronisation de ${c.aspsp_name} a échoué : détails dans Réglages → Données.` });
    }
  }
  return out;
}
