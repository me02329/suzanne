// Synchronisation bancaire (Enable Banking) : autorisation, connexions, et
// import des opérations par le pipeline existant (règles de catégorie,
// virements entre comptes, projections de récurrents). Voir docs/ENABLE-BANKING.md.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma } from '../prisma.js';
import { HttpError } from '../middleware/errors.js';
import { round2 } from './money.js';
import {
  EnableBankingClient, EnableBankingError, enableBankingConfigFromEnv, toBankRow,
  type Aspsp, type BankBalance, type BankTransaction, type EnableBankingConfig,
} from './enableBanking.js';
import { dedupeAndInsert, loadRules, matchRule, type ParsedImportRow } from '../routes/import_export.js';

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
  if (!config) throw new HttpError(503, error ?? 'Synchronisation bancaire non configurée sur ce serveur (voir Réglages → Banque).');
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

/** Retour de la banque : crée la connexion et un lien par compte autorisé. */
export async function completeAuthorization(user_id: number, code: string, state: string) {
  const { a, c } = verifyState(state, user_id);
  const session = await bankClient().createSession(code);
  const validUntil = session.access?.valid_until ? new Date(session.access.valid_until) : new Date(Date.now() + DEFAULT_HISTORY_DAYS * DAY);
  const connection = await prisma.bankConnection.create({
    data: {
      user_id,
      aspsp_name: session.aspsp?.name ?? a,
      aspsp_country: session.aspsp?.country ?? c,
      session_id: session.session_id,
      valid_until: validUntil,
      links: {
        create: session.accounts.map((acc) => ({
          user_id,
          remote_uid: acc.uid,
          remote_name: acc.name ?? acc.product ?? acc.details ?? null,
          iban_last4: acc.account_id?.iban ? acc.account_id.iban.slice(-4) : null,
          currency: acc.currency && /^[A-Z]{3}$/.test(acc.currency) && acc.currency !== 'XXX' ? acc.currency : null,
        })),
      },
    },
    include: { links: true },
  });
  return connection;
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
  const known = new Set((await prisma.transaction.findMany({
    where: { user_id, import_fingerprint: { in: rows.map((r) => r.fingerprint) } },
    select: { import_fingerprint: true },
  })).map((t) => t.import_fingerprint));
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
    select: { id: true, date: true, description: true, import_fingerprint: true, lines: { select: { account_id: true, amount: true } } },
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
      // Déjà synchronisée depuis l'autre compte du virement : on la garde telle quelle.
      if (match.import_fingerprint?.startsWith('eb:')) continue;
      const old = normalize(match.description ?? '');
      const upgrade = old.length > 0 && normalize(row.description).startsWith(old) && row.description.length > (match.description ?? '').length;
      await prisma.transaction.update({
        where: { id: match.id },
        data: { import_fingerprint: row.fingerprint, ...(upgrade ? { description: row.description } : {}) },
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

export async function syncLink(user_id: number, linkId: number): Promise<SyncResult> {
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
    });
  });
  const { rest, adopted } = await adoptExisting(user_id, account_id, rows);
  const inserted = await dedupeAndInsert(user_id, account_id, rest, 0);

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

/** Synchronise tous les comptes associés d'une connexion ; met à jour son état. */
export async function syncConnection(user_id: number, connectionId: number) {
  const connection = await prisma.bankConnection.findFirst({ where: { id: connectionId, user_id }, include: { links: true } });
  if (!connection) throw new HttpError(404, 'Connexion bancaire introuvable');
  if (connection.valid_until.getTime() < Date.now()) {
    await prisma.bankConnection.update({ where: { id: connection.id }, data: { status: 'expired' } });
    throw new HttpError(409, 'Le consentement a expiré : reconnecte la banque.');
  }
  const results: SyncResult[] = [];
  try {
    for (const link of connection.links.filter((l) => l.account_id != null)) results.push(await syncLink(user_id, link.id));
    await prisma.bankConnection.update({ where: { id: connection.id }, data: { status: 'active', last_sync_at: new Date(), last_error: null } });
  } catch (error) {
    const expired = error instanceof EnableBankingError && (error.status === 401 || error.status === 403 || /expired|revoked|invalid session/i.test(error.body));
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: expired ? 'expired' : 'error', last_error: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
    });
    throw error instanceof EnableBankingError ? new HttpError(502, `La banque a refusé la synchronisation : ${error.message}`) : error;
  }
  return results;
}

export async function deleteConnection(user_id: number, connectionId: number) {
  const connection = await prisma.bankConnection.findFirst({ where: { id: connectionId, user_id } });
  if (!connection) throw new HttpError(404, 'Connexion bancaire introuvable');
  // Révocation côté Enable Banking (au mieux : une session expirée n'existe plus).
  await bankClient().deleteSession(connection.session_id).catch(() => undefined);
  await prisma.bankConnection.delete({ where: { id: connection.id } });
}

/** Synchro quotidienne de toutes les connexions actives (tous profils). */
export function startBankSyncScheduler(): void {
  if (!bankConfig().config) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const since = new Date(Date.now() - 20 * 3600_000);
      const due = await prisma.bankConnection.findMany({
        where: { status: { in: ['active', 'error'] }, valid_until: { gt: new Date() }, OR: [{ last_sync_at: null }, { last_sync_at: { lt: since } }] },
        select: { id: true, user_id: true },
      });
      for (const c of due) {
        await syncConnection(c.user_id, c.id).catch((error) => console.error(`[suzanne] bank sync ${c.id} failed`, error instanceof Error ? error.message : error));
      }
      if (due.length > 0) console.log(`[suzanne] bank sync: ${due.length} connection(s)`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), 60_000).unref?.();
  setInterval(() => void run(), 6 * 3600_000).unref?.();
}
