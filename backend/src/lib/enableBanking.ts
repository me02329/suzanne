// Client minimal de l'API Enable Banking (agrégateur DSP2), sans dépendance :
// chaque appel est authentifié par un JWT RS256 signé avec la clé privée de
// l'application (node:crypto). Voir docs/ENABLE-BANKING.md et l'issue #2.
//
// Preuve de concept : pas encore branché sur la base ni sur l'import. Le module
// expose aussi la conversion d'une opération bancaire vers le format d'import
// de Suzanne (toBankRow), pour juger de la qualité des données.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const ENABLE_BANKING_API = 'https://api.enablebanking.com';

export interface EnableBankingConfig {
  appId: string;
  privateKeyPem: string;
  redirectUrl: string;
  baseUrl?: string;
}

/** Configuration depuis l'environnement ; null si la fonction n'est pas configurée. */
export function enableBankingConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EnableBankingConfig | null {
  const appId = env.ENABLE_BANKING_APP_ID?.trim();
  const keyPath = env.ENABLE_BANKING_KEY_PATH?.trim();
  const redirectUrl = env.ENABLE_BANKING_REDIRECT_URL?.trim();
  if (!appId || !keyPath || !redirectUrl) return null;
  return { appId, privateKeyPem: readFileSync(keyPath, 'utf8'), redirectUrl, baseUrl: env.ENABLE_BANKING_API_URL?.trim() || undefined };
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url');

/** JWT RS256 attendu par l'API (kid = id de l'application, durée 1 h). */
export function signEnableBankingJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000), ttlSeconds = 3600): string {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }));
  const payload = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + ttlSeconds }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKeyPem).toString('base64url')}`;
}

// ---- Types (sous-ensemble utile de la référence API) ------------------------

export interface Aspsp {
  name: string;
  country: string;
  bic?: string;
  beta?: boolean;
  psu_types?: string[];
  maximum_consent_validity?: number;
}

export interface Amount { amount: string; currency: string }
interface Party { name?: string | null }
interface PartyAccount { iban?: string | null; other?: { identification?: string } | null }

export interface BankTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: Amount;
  credit_debit_indicator: 'CRDT' | 'DBIT';
  status?: string | null; // BOOK, PDNG…
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  remittance_information?: string[] | null;
  creditor?: Party | null;
  debtor?: Party | null;
  creditor_account?: PartyAccount | null;
  debtor_account?: PartyAccount | null;
  bank_transaction_code?: { description?: string | null; code?: string | null; sub_code?: string | null } | null;
  merchant_category_code?: string | null;
  note?: string | null;
  reference_number?: string | null;
  balance_after_transaction?: Amount | null;
}

export interface BankBalance {
  name?: string | null;
  balance_amount: Amount;
  balance_type: string; // CLBD, ITAV, XPCD…
  reference_date?: string | null;
  last_change_date_time?: string | null;
}

export interface SessionAccount {
  uid: string;
  account_id?: { iban?: string | null } | null;
  name?: string | null;
  details?: string | null;
  product?: string | null;
  currency?: string | null;
  cash_account_type?: string | null;
}

export interface Session {
  session_id: string;
  accounts: SessionAccount[];
  aspsp?: { name: string; country: string };
  access?: { valid_until?: string };
}

export class EnableBankingError extends Error {
  constructor(public status: number, public body: string, path: string) {
    super(`Enable Banking ${status} sur ${path} : ${body.slice(0, 300)}`);
  }
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class EnableBankingClient {
  private readonly baseUrl: string;

  constructor(private readonly config: EnableBankingConfig, private readonly fetchImpl: FetchLike = fetch) {
    this.baseUrl = (config.baseUrl ?? ENABLE_BANKING_API).replace(/\/+$/, '');
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${signEnableBankingJwt(this.config.appId, this.config.privateKeyPem)}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new EnableBankingError(res.status, text, path);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Infos de l'application (vérifie la clé et l'id). */
  application() {
    return this.request<Record<string, unknown>>('GET', '/application');
  }

  async aspsps(country = 'FR'): Promise<Aspsp[]> {
    const out = await this.request<{ aspsps: Aspsp[] }>('GET', `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`);
    return out.aspsps ?? [];
  }

  /** Démarre l'autorisation : renvoie l'URL de la banque où valider l'accès. */
  startAuth(aspsp: { name: string; country: string }, opts: { state: string; validUntil: Date }) {
    return this.request<{ url: string; authorization_id?: string }>('POST', '/auth', {
      access: { valid_until: opts.validUntil.toISOString() },
      aspsp,
      state: opts.state,
      redirect_url: this.config.redirectUrl,
      psu_type: 'personal',
    });
  }

  /** Échange le code reçu sur l'URL de retour contre une session (et la liste des comptes). */
  createSession(code: string) {
    return this.request<Session>('POST', '/sessions', { code });
  }

  getSession(sessionId: string) {
    return this.request<Record<string, unknown>>('GET', `/sessions/${encodeURIComponent(sessionId)}`);
  }

  deleteSession(sessionId: string) {
    return this.request<Record<string, unknown>>('DELETE', `/sessions/${encodeURIComponent(sessionId)}`);
  }

  accountDetails(accountUid: string) {
    return this.request<Record<string, unknown>>('GET', `/accounts/${encodeURIComponent(accountUid)}/details`);
  }

  async balances(accountUid: string): Promise<BankBalance[]> {
    const out = await this.request<{ balances: BankBalance[] }>('GET', `/accounts/${encodeURIComponent(accountUid)}/balances`);
    return out.balances ?? [];
  }

  /** Toutes les opérations depuis une date (pages suivies via continuation_key). */
  async transactions(accountUid: string, opts: { dateFrom?: string; dateTo?: string; maxPages?: number } = {}): Promise<BankTransaction[]> {
    const all: BankTransaction[] = [];
    let continuation: string | undefined;
    for (let page = 0; page < (opts.maxPages ?? 50); page++) {
      const params = new URLSearchParams();
      if (opts.dateFrom) params.set('date_from', opts.dateFrom);
      if (opts.dateTo) params.set('date_to', opts.dateTo);
      if (continuation) params.set('continuation_key', continuation);
      const query = params.toString();
      const out = await this.request<{ transactions?: BankTransaction[]; continuation_key?: string | null }>(
        'GET', `/accounts/${encodeURIComponent(accountUid)}/transactions${query ? `?${query}` : ''}`,
      );
      all.push(...(out.transactions ?? []));
      continuation = out.continuation_key ?? undefined;
      if (!continuation) break;
    }
    return all;
  }
}

// ---- Conversion vers le format d'import de Suzanne --------------------------

export interface BankRow {
  /** Identifiant stable fourni par la banque (empreinte d'import). */
  fingerprint: string | null;
  date: string;
  type: 'expense' | 'income';
  amount: number;
  description: string;
  counterparty: string | null;
  remittance: string | null;
  pending: boolean;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Opération bancaire → ligne d'import. Le libellé combine la contrepartie et
 * le motif complet (remittance_information, jusqu'à 140 caractères en SEPA),
 * sans répéter ce qui y figure déjà.
 */
export function toBankRow(tx: BankTransaction): BankRow {
  const credit = tx.credit_debit_indicator === 'CRDT';
  const counterparty = clean(credit ? tx.debtor?.name : tx.creditor?.name) || null;
  const remittance = clean((tx.remittance_information ?? []).join(' ')) || null;
  const parts: string[] = [];
  if (counterparty && !(remittance ?? '').toLowerCase().includes(counterparty.toLowerCase())) parts.push(counterparty);
  if (remittance) parts.push(remittance);
  if (parts.length === 0) parts.push(clean(tx.bank_transaction_code?.description) || clean(tx.note) || (credit ? 'Crédit' : 'Débit'));
  const amount = Math.abs(Number(tx.transaction_amount.amount));
  const id = clean(tx.entry_reference) || clean(tx.transaction_id);
  return {
    fingerprint: id ? `eb:${id}` : null,
    date: tx.booking_date ?? tx.value_date ?? tx.transaction_date ?? '',
    type: credit ? 'income' : 'expense',
    amount: Math.round(amount * 100) / 100,
    description: parts.join(' — '),
    counterparty,
    remittance,
    pending: (tx.status ?? 'BOOK') !== 'BOOK',
  };
}
