import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Check, CheckCircle2, Clock, Copy, ExternalLink, Landmark, Link2, Loader2, Plus, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import type { Account } from '@suzanne/shared';
import { api, type BankAspsp, type BankAutoSync, type BankCheck, type BankConnection, type BankLink, type BankStatus } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { money } from '../lib/format';
import { serverOrigin } from '../lib/serverOrigin';
import { formatTxDate } from '../components/transactions/txUtils';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/ui/RowMenu';
import type { Run } from '../lib/run';
import '../styles/pages/settings.css';
import '../styles/pages/bank.css';

// Réglages → Données : synchronisation automatique des comptes via Enable
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

// `embedded` : section de la page Réglages → Données (titre, pas de pleine page).
type ConnectionState = 'active' | 'soon' | 'expired' | 'error';

/** État d'une connexion : accès valide, à renouveler bientôt (≤ 7 j), expiré ou en erreur. */
function connectionState(c: BankConnection): ConnectionState {
  const daysLeft = Math.ceil((new Date(c.valid_until).getTime() - Date.now()) / DAY);
  return c.expired || c.status === 'expired' || c.status === 'revoked' ? 'expired' : c.status === 'error' ? 'error' : daysLeft <= 7 ? 'soon' : 'active';
}

/** « il y a 3 h », « hier »… dans la langue de l'interface. */
function timeAgo(iso: string, lang: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

export function Bank({ userId, accounts, run, embedded = false }: { userId: number; accounts: Account[]; run: Run; embedded?: boolean }) {
  const { t, i18n } = useTranslation();
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
    navigate('/tools', { replace: true });
    if (error) setCallbackError(error);
    else if (code && state) void completeCallback(code, state);
  }, [location.pathname, location.search, navigate, completeCallback]);

  if (!status) return <section className="st-page bank-page"><p className="muted"><Loader2 size={16} className="spin-icon" /> {t('reglages.bank.loading')}</p></section>;

  // En-tête : l'état d'ensemble d'abord (tout va bien / quelque chose à faire),
  // puis la dernière synchronisation. Le détail vit dans chaque carte.
  const attention = status.connections.filter((c) => connectionState(c) !== 'active' || !c.links.some((l) => l.account_id != null)).length;
  const lastSync = status.connections.map((c) => c.last_sync_at).filter((d): d is string => d != null).sort().pop() ?? null;
  const connectButton = (
    <button type="button" className="secondary" onClick={() => setConnecting({ country: 'FR' })}><Plus size={16} /> {t('reglages.bank.connect_bank')}</button>
  );

  return (
    <section className={embedded ? 'bank-page bank-embedded' : 'st-page bank-page'} aria-labelledby={embedded ? 'bank-title' : undefined}>
      {embedded && <h2 id="bank-title" className="st-list-title">{t('reglages.bank.section_title')}</h2>}

      {callbackError && (
        <div className="bank-alert error"><TriangleAlert size={16} /> <span>{t('reglages.bank.callback_error', { error: callbackError })}</span></div>
      )}

      {status.configured ? (
        <>
          {status.connections.length === 0 ? (
            <div className="pg-card bank-empty">
              <span className="bank-logo" aria-hidden><Landmark size={20} /></span>
              <p>{t('reglages.bank.no_connection')}</p>
              <button type="button" className="primary" onClick={() => setConnecting({ country: 'FR' })}><Plus size={16} /> {t('reglages.bank.connect_bank')}</button>
            </div>
          ) : (
            <div className="bank-overview">
              <div className="bank-overview-text">
                <strong className={attention > 0 ? 'bank-state warn' : 'bank-state ok'}>
                  {attention > 0 ? <TriangleAlert size={17} aria-hidden /> : <CheckCircle2 size={17} aria-hidden />}
                  {attention > 0 ? t('reglages.bank.overview_attention', { count: attention }) : t('reglages.bank.overview_ok')}
                </strong>
                <span className="muted">
                  {lastSync ? t('reglages.bank.synced_ago', { when: timeAgo(lastSync, i18n.language) }) : t('reglages.bank.never_synced')}
                </span>
              </div>
              {connectButton}
            </div>
          )}
          {status.connections.map((c) => (
            <ConnectionCard key={c.id} userId={userId} connection={c} accounts={accounts} run={run} onChanged={refresh} onRenew={() => setConnecting({ country: c.aspsp_country, bank: c.aspsp_name })} />
          ))}
          {status.auto_sync && status.connections.length > 0 && <AutoSyncCard userId={userId} autoSync={status.auto_sync} run={run} onChanged={refresh} />}
          <div className="bank-more">
            <ServerPanel userId={userId} status={status} onPasted={completeCallback} />
            <SecurityNote />
          </div>
        </>
      ) : (
        <>
          <SetupGuide status={status} />
          <SecurityNote />
        </>
      )}

      {connecting && <ConnectModal userId={userId} initial={connecting} onPasted={completeCallback} onClose={() => { setConnecting(null); refresh(); }} />}
    </section>
  );
}

// ---- Guide d'activation ------------------------------------------------------

/** Heures proposées quand on ajoute un créneau : réparties sur la journée. */
const SUGGESTED_HOURS = [7, 19, 13];
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Synchro automatique : combien de fois par jour (0 à 3, limite DSP2 de 4
 * lectures sans l'utilisateur) et à quelles heures. Enregistré à chaque
 * changement, dans le fuseau du navigateur.
 */
function AutoSyncCard({ userId, autoSync, run, onChanged }: { userId: number; autoSync: BankAutoSync; run: Run; onChanged: () => void }) {
  const { t } = useTranslation();
  const timeZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
  const save = async (hours: number[] | null) => {
    if (await run(() => api.setBankSchedule(userId, hours, timeZone), t('reglages.bank.auto_saved'))) onChanged();
  };
  const setCount = (n: number) => {
    const next = autoSync.hours.slice(0, n);
    for (const h of SUGGESTED_HOURS) if (next.length < n && !next.includes(h)) next.push(h);
    void save(next);
  };
  const setHour = (index: number, hour: number) => {
    if (autoSync.hours.some((h, i) => h === hour && i !== index)) return;
    void save(autoSync.hours.map((h, i) => (i === index ? hour : h)));
  };
  const label = (h: number) => t('reglages.bank.auto_hour', { h });
  const next = autoSync.next_at ? new Date(autoSync.next_at) : null;

  // Une ligne : « Synchro automatique [2 fois par jour] à [7 h] [19 h] », puis
  // la prochaine échéance ; la limite DSP2 en info au survol du titre.
  return (
    <article className="pg-card bank-auto">
      <div className="bank-auto-row">
        <h3 title={t('reglages.bank.auto_hint', { n: autoSync.max_slots })}><Clock size={17} aria-hidden /> {t('reglages.bank.auto_title')}</h3>
        <div className="bank-auto-controls">
          <select value={autoSync.hours.length} onChange={(e) => setCount(Number(e.target.value))} aria-label={t('reglages.bank.auto_frequency')}>
            <option value={0}>{t('reglages.bank.auto_off')}</option>
            {Array.from({ length: autoSync.max_slots }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{t('reglages.bank.auto_times', { count: n })}</option>)}
          </select>
          {autoSync.hours.length > 0 && <span className="muted">{t('reglages.bank.auto_at').toLowerCase()}</span>}
          {autoSync.hours.map((hour, index) => (
            <select key={index} value={hour} onChange={(e) => setHour(index, Number(e.target.value))} aria-label={`${t('reglages.bank.auto_at')} (${index + 1})`}>
              {HOURS.map((h) => <option key={h} value={h} disabled={h !== hour && autoSync.hours.includes(h)}>{label(h)}</option>)}
            </select>
          ))}
        </div>
      </div>
      <p className="muted bank-auto-next">
        {autoSync.hours.length === 0 ? t('reglages.bank.auto_disabled')
          : next ? t('reglages.bank.auto_next', { date: next.toLocaleString(undefined, { weekday: 'long', hour: '2-digit', minute: '2-digit' }) }) : null}
        {autoSync.custom && (
          <> · <button type="button" className="link-button" onClick={() => void save(null)}>{t('reglages.bank.auto_reset', { hours: autoSync.default_hours.map(label).join(', ') })}</button></>
        )}
      </p>
    </article>
  );
}

function SetupGuide({ status }: { status: BankStatus }) {
  const { t } = useTranslation();
  const callback = `${serverOrigin()}/bank/callback`;
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
  const expected = `${serverOrigin()}/bank/callback`;
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
  const { t, i18n } = useTranslation();
  const [syncing, setSyncing] = useState(false);
  const daysLeft = Math.ceil((new Date(c.valid_until).getTime() - Date.now()) / DAY);
  const state = connectionState(c);
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
  const refreshAccounts = () => run(() => api.refreshBankAccounts(userId, c.id), (result) => {
    const r = result as { found: number; added: number };
    return r.found === 0 ? t('reglages.bank.refresh_none') : t('reglages.bank.refresh_done', { found: r.found, added: r.added });
  }).then((ok) => { if (ok) onChanged(); });
  const needsRenew = state !== 'active';
  const disconnect = {
    label: t('reglages.bank.disconnect'), icon: <Trash2 size={16} />, danger: true,
    // Irréversible (consentement révoqué) : confirmation native.
    confirm: t('reglages.bank.confirm_disconnect', { bank: c.aspsp_name }),
    onSelect: () => void run(() => api.deleteBankConnection(userId, c.id), t('reglages.bank.disconnected')).then((ok) => { if (ok) onChanged(); }),
  };

  // En-tête : banque, fraîcheur, état de l'accès, puis Synchroniser (+ Renouveler
  // seulement s'il y a lieu) ; le reste dans « ⋯ ».
  return (
    <article className={`pg-card bank-card is-${state}`}>
      <header className="bank-card-head">
        <span className="bank-logo" aria-hidden><Landmark size={18} /></span>
        <div className="bank-card-title">
          <h3>{c.aspsp_name}</h3>
          <p className="muted" title={c.last_sync_at ? new Date(c.last_sync_at).toLocaleString() : undefined}>
            {c.last_sync_at ? t('reglages.bank.synced_ago', { when: timeAgo(c.last_sync_at, i18n.language) }) : t('reglages.bank.never_synced')}
          </p>
        </div>
        <span className={`bank-pill is-${state}`} title={t('reglages.bank.consent_until', { date: formatTxDate(c.valid_until.slice(0, 10)), n: daysLeft })}>
          {state === 'expired' ? t('reglages.bank.pill_expired')
            : state === 'error' ? t('reglages.bank.status_error')
            : state === 'soon' ? t('reglages.bank.pill_soon', { count: Math.max(1, daysLeft) })
            : t('reglages.bank.pill_until', { date: formatTxDate(c.valid_until.slice(0, 10)) })}
        </span>
        <div className="bank-card-actions">
          {needsRenew && <button type="button" className="secondary" onClick={onRenew}><Link2 size={15} /> {t('reglages.bank.renew')}</button>}
          {state !== 'expired' && (
            <button type="button" className="primary" onClick={() => void sync()} disabled={syncing || linked === 0} title={linked === 0 ? t('reglages.bank.link_first') : undefined}>
              {syncing ? <Loader2 size={15} className="spin-icon" /> : <RefreshCw size={15} />} {t('reglages.bank.sync_now')}
            </button>
          )}
          <RowMenu items={needsRenew ? [disconnect] : [{ label: t('reglages.bank.refresh_accounts'), icon: <RefreshCw size={16} />, onSelect: () => void refreshAccounts() }, { label: t('reglages.bank.renew'), icon: <Link2 size={16} />, onSelect: onRenew }, disconnect]} />
        </div>
      </header>
      {c.last_error && state !== 'active' && <div className="bank-alert error"><TriangleAlert size={16} /> <span>{c.last_error}</span></div>}
      {c.links.length === 0 && state !== 'expired' && (
        // Banque qui n'a renvoyé aucun compte à la connexion (vu avec Revolut).
        <div className="bank-alert info">
          <TriangleAlert size={16} /> <span>{t('reglages.bank.no_accounts')}</span>
          <button type="button" className="secondary" onClick={() => void refreshAccounts()}><RefreshCw size={14} /> {t('reglages.bank.refresh_accounts')}</button>
        </div>
      )}
      {c.links.length > 0 && linked === 0 && state !== 'expired' && (
        <div className="bank-alert info"><Link2 size={16} /> <span>{t('reglages.bank.map_first')}</span></div>
      )}

      <ul className="bank-accounts">
        {c.links.map((l) => <LinkRow key={l.id} userId={userId} link={l} accounts={accounts} run={run} onChanged={onChanged} />)}
      </ul>
    </article>
  );
}

// Un compte bancaire : d'où (banque) → où (compte Suzanne), et ce qu'on en sait
// (solde en grand, résultat de la dernière synchro en petit).
function LinkRow({ userId, link: l, accounts, run, onChanged }: { userId: number; link: BankLink; accounts: Account[]; run: Run; onChanged: () => void }) {
  const { t } = useTranslation();
  const [editingFrom, setEditingFrom] = useState(false);
  const options = pickableAccounts(accounts, l.account_id).filter((a) => !['loan', 'receivable'].includes(a.type));
  const update = async (body: { account_id?: number | null; sync_from?: string | null }) => {
    if (await run(() => api.updateBankLink(userId, l.id, body), t('reglages.bank.link_saved'))) onChanged();
  };
  const r = l.last_result;
  const mapped = l.account_id != null;
  const summary = r == null ? null
    : [
        r.imported > 0 ? t('reglages.bank.res_new', { count: r.imported }) : null,
        r.adopted > 0 ? t('reglages.bank.res_matched', { count: r.adopted }) : null,
        r.pending > 0 ? t('reglages.bank.res_pending', { count: r.pending }) : null,
      ].filter(Boolean).join(' · ') || t('reglages.bank.res_none');
  return (
    <li className={mapped ? 'bank-account' : 'bank-account unmapped'}>
      <div className="bank-account-src">
        <strong>{l.remote_name ?? t('reglages.bank.account')}</strong>
        <span className="muted">{l.iban_last4 ? `···${l.iban_last4}` : ''}{l.currency && l.currency !== 'EUR' ? ` · ${l.currency}` : ''}</span>
        {editingFrom || l.sync_from ? (
          <label className="bank-account-from">
            <span>{t('reglages.bank.sync_from')}</span>
            <input
              type="date"
              value={l.sync_from ?? ''}
              autoFocus={editingFrom && !l.sync_from}
              onChange={(e) => void update({ sync_from: e.target.value || null })}
              onBlur={() => setEditingFrom(false)}
              title={t('reglages.bank.sync_from_hint')}
            />
          </label>
        ) : (
          <button type="button" className="link-button bank-account-from" title={t('reglages.bank.sync_from_hint')} onClick={() => setEditingFrom(true)}>
            {t('reglages.bank.sync_from_set')}
          </button>
        )}
      </div>
      <ArrowRight size={16} className="bank-account-arrow" aria-hidden />
      <div className="bank-account-dest">
        <select value={l.account_id ?? ''} onChange={(e) => void update({ account_id: e.target.value ? Number(e.target.value) : null })} aria-label={t('reglages.bank.suzanne_account')}>
          <option value="">{t('reglages.bank.not_synced')}</option>
          {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {/^(carte|card)\b/i.test(l.remote_name ?? '') && !mapped && <small className="bank-card-hint">{t('reglages.bank.card_hint')}</small>}
      </div>
      <div className="bank-account-result">
        {r?.balance ? (
          <span className="bank-balance" title={t('reglages.bank.balance', { amount: money(r.balance.amount, l.currency ?? 'EUR'), date: formatTxDate(r.balance.date) })}>
            {money(r.balance.amount, l.currency ?? 'EUR')}
          </span>
        ) : null}
        {summary && <span className="muted">{summary}</span>}
      </div>
    </li>
  );
}
