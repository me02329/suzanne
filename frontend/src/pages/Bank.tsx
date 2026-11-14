import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Copy, ExternalLink, Landmark, Link2, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import type { Account } from '@suzanne/shared';
import { api, type BankAspsp, type BankCheck, type BankConnection, type BankLink, type BankStatus } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { money } from '../lib/format';
import { formatTxDate } from '../components/transactions/txUtils';
import { Modal } from '../components/Modal';
import type { Run } from '../lib/run';
import '../styles/pages/settings.css';
import '../styles/pages/bank.css';

// Réglages → Banque : synchronisation automatique des comptes via Enable
// Banking (DSP2, lecture seule). Guide d'activation tant que le serveur n'est
// pas configuré, puis connexion des banques (redirection), association des
// comptes et synchronisation. Retour de la banque sur /bank/callback.
const COUNTRIES = ['FR', 'BE', 'DE', 'ES', 'IT', 'NL', 'PT', 'LU', 'IE', 'AT', 'FI'];
const DAY = 86400_000;
const CONTROL_PANEL_URL = 'https://enablebanking.com/cp/';
const CONTROL_PANEL_NAME = 'Enable Banking Control Panel';
const CALLBACK_PLACEHOLDER = 'https://…/callback?code=…&state=…';
const BANK_CHANNEL = 'suzanne-bank';

/** code et state d'une adresse de retour collée ; null si elle n'en contient pas. */
function parseReturnUrl(value: string): { code: string; state: string } | null {
  try {
    const url = new URL(value.trim());
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    return code && state ? { code, state } : null;
  } catch {
    return null;
  }
}

export function Bank({ userId, accounts, run }: { userId: number; accounts: Account[]; run: Run }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [connecting, setConnecting] = useState<{ country: string; bank?: string } | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    api.bank(userId).then((s) => { if (!cancelled) setStatus(s); }).catch(() => { if (!cancelled) setStatus(null); });
    return () => { cancelled = true; };
  }, [userId, version]);

  // La banque s'ouvre dans un autre onglet : quand la connexion y est créée
  // (retour sur /bank/callback), cet onglet-ci est prévenu et se met à jour.
  useEffect(() => {
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(BANK_CHANNEL);
    if (channel) channel.onmessage = () => { setConnecting(null); refresh(); };
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { channel?.close(); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  // Retour de la banque : /bank/callback?code=…&state=… (ou ?error=…).
  const handled = useRef(false);
  const completeCallback = useCallback(async (code: string, state: string) => {
    const ok = await run(() => api.bankCallback(userId, code, state), t('reglages.bank.connected'));
    if (ok) {
      refresh();
      setConnecting(null);
      try { const channel = new BroadcastChannel(BANK_CHANNEL); channel.postMessage('connected'); channel.close(); } catch { /* navigateur ancien */ }
    }
    return ok;
  }, [run, t, userId, refresh]);
  useEffect(() => {
    if (handled.current || !location.pathname.startsWith('/bank/callback')) return;
    handled.current = true;
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error_description') ?? params.get('error');
    navigate('/bank', { replace: true });
    if (error) setCallbackError(error);
    else if (code && state) void completeCallback(code, state);
  }, [location.pathname, location.search, navigate, completeCallback]);

  if (!status) return <section className="st-page bank-page"><p className="muted"><Loader2 size={16} className="spin-icon" /> {t('reglages.bank.loading')}</p></section>;

  return (
    <section className="st-page bank-page">
      <div className="st-toolbar">
        <p className="st-summary">
          <strong>{status.connections.length}</strong> {t(status.connections.length > 1 ? 'reglages.bank.connections_n' : 'reglages.bank.connection_1')}
        </p>
        {status.configured && (
          <div className="st-toolbar-actions">
            <button type="button" className="primary" onClick={() => setConnecting({ country: 'FR' })}><Plus size={16} /> {t('reglages.bank.connect_bank')}</button>
          </div>
        )}
      </div>

      {callbackError && (
        <div className="bank-alert error"><TriangleAlert size={16} /> <span>{t('reglages.bank.callback_error', { error: callbackError })}</span></div>
      )}

      {status.configured ? (
        <>
          {status.connections.length === 0 && (
            <div className="pg-card bank-empty">
              <Landmark size={22} aria-hidden />
              <p>{t('reglages.bank.no_connection')}</p>
            </div>
          )}
          {status.connections.map((c) => (
            <ConnectionCard key={c.id} userId={userId} connection={c} accounts={accounts} run={run} onChanged={refresh} onRenew={() => setConnecting({ country: c.aspsp_country, bank: c.aspsp_name })} />
          ))}
          <ServerPanel userId={userId} status={status} onPasted={completeCallback} />
        </>
      ) : (
        <SetupGuide status={status} />
      )}

      <SecurityNote />

      {connecting && <ConnectModal userId={userId} initial={connecting} onPasted={completeCallback} onClose={() => { setConnecting(null); refresh(); }} />}
    </section>
  );
}

// ---- Guide d'activation ------------------------------------------------------

function SetupGuide({ status }: { status: BankStatus }) {
  const { t } = useTranslation();
  const callback = `${window.location.origin}/bank/callback`;
  const env = `ENABLE_BANKING_APP_ID=<id de l'application>\nENABLE_BANKING_KEY_PATH=/run/secrets/enablebanking.pem\nENABLE_BANKING_REDIRECT_URL=${callback}`;
  return (
    <div className="pg-card bank-guide">
      <h2>{t('reglages.bank.guide_title')}</h2>
      <p className="muted">{t('reglages.bank.guide_intro')}</p>
      {status.config_error && <div className="bank-alert error"><TriangleAlert size={16} /> <span>{status.config_error}</span></div>}
      <ol className="bank-steps">
        <li>
          <strong>{t('reglages.bank.step_account')}</strong>
          <span>{t('reglages.bank.step_account_hint')} <a href={CONTROL_PANEL_URL} target="_blank" rel="noreferrer">{CONTROL_PANEL_NAME} <ExternalLink size={12} /></a></span>
        </li>
        <li>
          <strong>{t('reglages.bank.step_app')}</strong>
          <span>{t('reglages.bank.step_app_hint')}</span>
        </li>
        <li>
          <strong>{t('reglages.bank.step_redirect')}</strong>
          <span>{t('reglages.bank.step_redirect_hint')}</span>
          <CopyField value={callback} />
        </li>
        <li>
          <strong>{t('reglages.bank.step_link')}</strong>
          <span>{t('reglages.bank.step_link_hint')}</span>
        </li>
        <li>
          <strong>{t('reglages.bank.step_server')}</strong>
          <span>{t('reglages.bank.step_server_hint')}</span>
          <CopyField value={env} multiline />
        </li>
        <li>
          <strong>{t('reglages.bank.step_restart')}</strong>
          <span>{t('reglages.bank.step_restart_hint')}</span>
        </li>
      </ol>
    </div>
  );
}

function CopyField({ value, multiline }: { value: string; multiline?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); });
  };
  return (
    <div className="bank-copy">
      {multiline ? <pre>{value}</pre> : <code>{value}</code>}
      <button type="button" className="secondary" onClick={copy} title={t('reglages.bank.copy')} aria-label={t('reglages.bank.copy')}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function SecurityNote() {
  const { t } = useTranslation();
  return (
    <details className="pg-card bank-security">
      <summary><ShieldCheck size={16} aria-hidden /> {t('reglages.bank.security_title')}</summary>
      <ul>
        <li>{t('reglages.bank.security_read_only')}</li>
        <li>{t('reglages.bank.security_credentials')}</li>
        <li>{t('reglages.bank.security_key')}</li>
        <li>{t('reglages.bank.security_consent')}</li>
        <li>{t('reglages.bank.security_provider')}</li>
      </ul>
    </details>
  );
}

// ---- Serveur : vérification et retour manuel -------------------------------

function ServerPanel({ userId, status, onPasted }: { userId: number; status: BankStatus; onPasted: (code: string, state: string) => Promise<boolean> }) {
  const { t } = useTranslation();
  const [check, setCheck] = useState<BankCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [pasted, setPasted] = useState('');
  const expected = `${window.location.origin}/bank/callback`;
  const elsewhere = status.redirect_url !== null && status.redirect_url !== expected;
  const runCheck = async () => {
    setChecking(true);
    try { setCheck(await api.bankCheck(userId)); } catch (error) { setCheck({ ok: false, error: error instanceof Error ? error.message : String(error) }); } finally { setChecking(false); }
  };
  const submitPasted = async () => {
    const parsed = parseReturnUrl(pasted);
    if (parsed && await onPasted(parsed.code, parsed.state)) setPasted('');
  };
  return (
    <details className="pg-card bank-server" open={elsewhere || undefined}>
      <summary>{t('reglages.bank.server_title')}</summary>
      <dl>
        <dt>{t('reglages.bank.app_id')}</dt><dd><code>{status.app_id}</code></dd>
        <dt>{t('reglages.bank.redirect_url')}</dt><dd><code>{status.redirect_url}</code></dd>
      </dl>
      <div className="bank-row">
        <button type="button" className="secondary" onClick={() => void runCheck()} disabled={checking}>
          {checking ? <Loader2 size={14} className="spin-icon" /> : <ShieldCheck size={14} />} {t('reglages.bank.check')}
        </button>
        {check && (check.ok
          ? <span className={check.active ? 'bank-ok' : 'bank-warn'}>
              {check.name} · {check.environment} · {check.active ? t('reglages.bank.app_active') : t('reglages.bank.app_inactive')}
              {check.redirect_url_registered === false && ` · ${t('reglages.bank.redirect_not_registered')}`}
            </span>
          : <span className="bank-warn">{check.error}</span>)}
      </div>
      {elsewhere && <p className="muted">{t('reglages.bank.redirect_elsewhere', { expected })}</p>}
      <label className="bank-paste">
        <span>{t('reglages.bank.paste_label')}</span>
        <div className="bank-row">
          <input type="url" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={CALLBACK_PLACEHOLDER} />
          <button type="button" className="secondary" onClick={() => void submitPasted()} disabled={!pasted.includes('code=')}>{t('reglages.bank.paste_submit')}</button>
        </div>
      </label>
    </details>
  );
}

// ---- Connexion d'une banque --------------------------------------------------

function ConnectModal({ userId, initial, onPasted, onClose }: {
  userId: number; initial: { country: string; bank?: string }; onPasted: (code: string, state: string) => Promise<boolean>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [country, setCountry] = useState(initial.country);
  const [banks, setBanks] = useState<BankAspsp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(initial.bank ?? '');
  const [redirecting, setRedirecting] = useState<string | null>(null);
  // Banque ouverte dans un autre onglet : on attend son retour.
  const [waiting, setWaiting] = useState<{ bank: string; url: string } | null>(null);
  const [pasted, setPasted] = useState('');

  useEffect(() => {
    let cancelled = false;
    setBanks(null);
    setError(null);
    api.bankAspsps(userId, country)
      .then((list) => { if (!cancelled) setBanks(list); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [userId, country]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (banks ?? []).filter((b) => !q || b.name.toLowerCase().includes(q));
  }, [banks, query]);

  const go = async (bank: BankAspsp) => {
    // L'onglet est ouvert tout de suite (dans le clic) pour ne pas être bloqué
    // comme popup, puis dirigé vers la banque quand l'URL est connue.
    const tab = window.open('about:blank', '_blank');
    setRedirecting(bank.name);
    setError(null);
    try {
      const { url } = await api.bankAuth(userId, bank.name, country);
      if (tab && !tab.closed) {
        tab.opener = null;
        tab.location.href = url;
        setWaiting({ bank: bank.name, url });
      } else {
        window.location.assign(url);
      }
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRedirecting(null);
    }
  };

  const parsed = parseReturnUrl(pasted);

  if (waiting) {
    return (
      <Modal title={t('reglages.bank.waiting_title', { bank: waiting.bank })} onClose={onClose}>
        <div className="bank-connect">
          <p>{t('reglages.bank.waiting_intro')}</p>
          <p className="muted">
            {t('reglages.bank.waiting_tab_closed')}{' '}
            <a href={waiting.url} target="_blank" rel="noreferrer">{t('reglages.bank.waiting_reopen')} <ExternalLink size={12} /></a>
          </p>
          <label className="bank-paste">
            <span>{t('reglages.bank.waiting_paste')}</span>
            <div className="bank-row">
              <input type="url" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={CALLBACK_PLACEHOLDER} />
              <button type="button" className="primary" disabled={!parsed} onClick={() => { if (parsed) void onPasted(parsed.code, parsed.state); }}>{t('reglages.bank.paste_submit')}</button>
            </div>
          </label>
          <div className="bank-row">
            <button type="button" className="secondary" onClick={onClose}>{t('reglages.bank.waiting_done')}</button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t('reglages.bank.connect_bank')} onClose={onClose}>
      <div className="bank-connect">
        <p className="muted">{t('reglages.bank.connect_intro')}</p>
        <div className="bank-row">
          <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t('reglages.bank.country')}>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('reglages.bank.search_bank')} autoFocus />
        </div>
        {error && <div className="bank-alert error"><TriangleAlert size={16} /> <span>{error}</span></div>}
        {!banks && !error && <p className="muted"><Loader2 size={14} className="spin-icon" /> {t('reglages.bank.loading_banks')}</p>}
        <ul className="bank-list">
          {shown.slice(0, 60).map((b) => (
            <li key={b.name}>
              <button type="button" onClick={() => void go(b)} disabled={redirecting !== null}>
                {b.logo ? <img src={b.logo} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /> : <Landmark size={18} aria-hidden />}
                <span className="bank-name">{b.name}{b.beta && <em>{t('reglages.bank.beta')}</em>}</span>
                <span className="muted">{b.consent_days ? t('reglages.bank.consent_days', { n: b.consent_days }) : ''}</span>
                {redirecting === b.name ? <Loader2 size={14} className="spin-icon" /> : <ExternalLink size={14} aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
        {banks && shown.length === 0 && <p className="muted">{t('reglages.bank.no_bank_found')}</p>}
      </div>
    </Modal>
  );
}

// ---- Une connexion (une banque) ----------------------------------------------

function ConnectionCard({ userId, connection: c, accounts, run, onChanged, onRenew }: {
  userId: number; connection: BankConnection; accounts: Account[]; run: Run; onChanged: () => void; onRenew: () => void;
}) {
  const { t } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const daysLeft = Math.ceil((new Date(c.valid_until).getTime() - Date.now()) / DAY);
  const state = c.expired || c.status === 'expired' ? 'expired' : c.status === 'error' ? 'error' : daysLeft <= 7 ? 'soon' : 'active';
  const linked = c.links.filter((l) => l.account_id != null).length;

  const sync = async () => {
    setSyncing(true);
    await run(() => api.syncBankConnection(userId, c.id), (result) => {
      const rows = (result as { results: Array<{ imported: number; adopted: number }> }).results;
      return t('reglages.bank.synced', { imported: rows.reduce((s, r) => s + r.imported, 0), adopted: rows.reduce((s, r) => s + r.adopted, 0) });
    });
    setSyncing(false);
    onChanged();
  };
  const remove = async () => {
    if (!window.confirm(t('reglages.bank.confirm_disconnect', { bank: c.aspsp_name }))) return;
    if (await run(() => api.deleteBankConnection(userId, c.id), t('reglages.bank.disconnected'))) onChanged();
  };

  return (
    <article className="pg-card bank-card">
      <header>
        <div>
          <h3><Landmark size={18} aria-hidden /> {c.aspsp_name}</h3>
          <p className="muted">
            {c.last_sync_at ? t('reglages.bank.last_sync', { date: new Date(c.last_sync_at).toLocaleString() }) : t('reglages.bank.never_synced')}
          </p>
        </div>
        <span className={`bank-badge ${state}`}>
          {state === 'expired' ? t('reglages.bank.status_expired')
            : state === 'error' ? t('reglages.bank.status_error')
            : t('reglages.bank.consent_until', { date: formatTxDate(c.valid_until.slice(0, 10)), n: daysLeft })}
        </span>
      </header>
      {c.last_error && state !== 'active' && <div className="bank-alert error"><TriangleAlert size={16} /> <span>{c.last_error}</span></div>}
      {linked === 0 && state !== 'expired' && (
        <div className="bank-alert info"><Link2 size={16} /> <span>{t('reglages.bank.map_first')}</span></div>
      )}

      <table className="bank-links">
        <thead>
          <tr><th>{t('reglages.bank.bank_account')}</th><th>{t('reglages.bank.suzanne_account')}</th><th>{t('reglages.bank.sync_from')}</th><th>{t('reglages.bank.last_result')}</th></tr>
        </thead>
        <tbody>
          {c.links.map((l) => <LinkRow key={l.id} userId={userId} link={l} accounts={accounts} run={run} onChanged={onChanged} />)}
        </tbody>
      </table>

      <div className="bank-row bank-actions">
        <button type="button" className="primary" onClick={() => void sync()} disabled={syncing || linked === 0 || state === 'expired'} title={linked === 0 ? t('reglages.bank.link_first') : undefined}>
          {syncing ? <Loader2 size={14} className="spin-icon" /> : <RefreshCw size={14} />} {t('reglages.bank.sync_now')}
        </button>
        {(state === 'expired' || state === 'soon' || state === 'error') && (
          <button type="button" className="secondary" onClick={onRenew}><Link2 size={14} /> {t('reglages.bank.renew')}</button>
        )}
        <button type="button" className="secondary danger" onClick={() => void remove()}><Trash2 size={14} /> {t('reglages.bank.disconnect')}</button>
      </div>
    </article>
  );
}

function LinkRow({ userId, link: l, accounts, run, onChanged }: { userId: number; link: BankLink; accounts: Account[]; run: Run; onChanged: () => void }) {
  const { t } = useTranslation();
  const options = pickableAccounts(accounts, l.account_id).filter((a) => !['loan', 'receivable'].includes(a.type));
  const update = async (body: { account_id?: number | null; sync_from?: string | null }) => {
    if (await run(() => api.updateBankLink(userId, l.id, body), t('reglages.bank.link_saved'))) onChanged();
  };
  const r = l.last_result;
  return (
    <tr>
      <td>
        <strong>{l.remote_name ?? t('reglages.bank.account')}</strong>
        <span className="muted">{l.iban_last4 ? ` ···${l.iban_last4}` : ''}{l.currency ? ` · ${l.currency}` : ''}</span>
        {/^(carte|card)\b/i.test(l.remote_name ?? '') && l.account_id == null && <small className="bank-card-hint">{t('reglages.bank.card_hint')}</small>}
      </td>
      <td>
        <select value={l.account_id ?? ''} onChange={(e) => void update({ account_id: e.target.value ? Number(e.target.value) : null })} aria-label={t('reglages.bank.suzanne_account')}>
          <option value="">{t('reglages.bank.not_synced')}</option>
          {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </td>
      <td>
        <input type="date" value={l.sync_from ?? ''} onChange={(e) => void update({ sync_from: e.target.value || null })} aria-label={t('reglages.bank.sync_from')} title={t('reglages.bank.sync_from_hint')} />
      </td>
      <td className="muted">
        {r ? t('reglages.bank.result', { imported: r.imported, adopted: r.adopted, pending: r.pending })
          + (r.balance ? ` · ${t('reglages.bank.balance', { amount: money(r.balance.amount, l.currency ?? 'EUR'), date: formatTxDate(r.balance.date) })}` : '')
          : '—'}
      </td>
    </tr>
  );
}
