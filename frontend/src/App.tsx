import { Suspense, lazy, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, Plus, Search, X } from 'lucide-react';
import {
  REPORT_CURRENCIES,
  type Account,
  type AccountSnapshot,
  type Alert,
  type BillsStatusSummary,
  type Budget,
  type BudgetStatus,
  type Category,
  type CategoryRule,
  type DashboardSummary,
  type Holding,
  type Institution,
  type RecurringTransaction,
  type SavingsGoal,
  type Tag,
  type Transaction,
  type TriggeredAlert,
  type User,
} from '@suzanne/shared';
import { api } from './lib/api';
import { currentMonthIso } from './lib/format';
import { MONTH_TABS, navItems, navSections, normalizeTab, pathForTab, sectionForTab, tabFromPath, tabLabel, type Tab } from './lib/nav';
import type { Run } from './lib/run';
import { usePersistedState } from './lib/storage';
import { useGlobalShortcuts } from './lib/useGlobalShortcuts';
import { Modal } from './components/Modal';
import { MonthPicker } from './components/MonthPicker';
import { SearchBox } from './components/SearchBox';
import { BankSyncButton } from './components/BankSyncButton';
import { TouchGestures, type SwipeZone } from './components/TouchGestures';
import { addButtonIndex, useTabbar } from './lib/tabbar';
import { SuzanneMark } from './components/SuzanneMark';
import { ThemeToggle, useTheme } from './components/ThemeToggle';
import { Toast } from './components/Toast';
import { TokenModal } from './components/TokenModal';
import { onUnauthorized } from './lib/authToken';
import { readActiveProfile, writeActiveProfile } from './lib/activeProfile';
import { activeBackend } from './local/mode';
import { initialAssistantMessages, type ChatMessage } from './lib/assistantState';

// Pages are code-split: each becomes its own chunk so the initial bundle no
// longer ships every page (and Recharts/react-markdown) up front. The active
// page loads on demand behind a Suspense fallback. Named exports are remapped
// to a default so React.lazy keeps each component's prop types.
const Assistant = lazy(() => import('./pages/Assistant').then((m) => ({ default: m.Assistant })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Wealth = lazy(() => import('./pages/Wealth').then((m) => ({ default: m.Wealth })));
const Statistics = lazy(() => import('./pages/Statistics').then((m) => ({ default: m.Statistics })));
const Transactions = lazy(() => import('./pages/Transactions').then((m) => ({ default: m.Transactions })));
const Guide = lazy(() => import('./pages/Guide').then((m) => ({ default: m.Guide })));
const Accounts = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.Accounts })));
const AccountDetail = lazy(() => import('./pages/AccountDetail').then((m) => ({ default: m.AccountDetail })));
const Categories = lazy(() => import('./pages/Categories').then((m) => ({ default: m.Categories })));
const Bills = lazy(() => import('./pages/Bills').then((m) => ({ default: m.Bills })));
const Budgets = lazy(() => import('./pages/Budgets').then((m) => ({ default: m.Budgets })));
const Recurring = lazy(() => import('./pages/Recurring').then((m) => ({ default: m.Recurring })));
const Forecast = lazy(() => import('./pages/Forecast').then((m) => ({ default: m.Forecast })));
const Health = lazy(() => import('./pages/Health').then((m) => ({ default: m.Health })));
const Goals = lazy(() => import('./pages/Goals').then((m) => ({ default: m.Goals })));
const Loans = lazy(() => import('./pages/Loans').then((m) => ({ default: m.Loans })));
const Bank = lazy(() => import('./pages/Bank').then((m) => ({ default: m.Bank })));
const Diversification = lazy(() => import('./pages/Diversification').then((m) => ({ default: m.Diversification })));
const Investments = lazy(() => import('./pages/Investments').then((m) => ({ default: m.Investments })));
const Alerts = lazy(() => import('./pages/Alerts').then((m) => ({ default: m.Alerts })));
const Anomalies = lazy(() => import('./pages/Anomalies').then((m) => ({ default: m.Anomalies })));
const Rules = lazy(() => import('./pages/Rules').then((m) => ({ default: m.Rules })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Tags = lazy(() => import('./pages/Tags').then((m) => ({ default: m.Tags })));
const Tools = lazy(() => import('./pages/Tools').then((m) => ({ default: m.Tools })));
const Simulator = lazy(() => import('./pages/Simulator').then((m) => ({ default: m.Simulator })));
const UsersPage = lazy(() => import('./pages/Users').then((m) => ({ default: m.UsersPage })));

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  // `month` resets to the current month on each session — the previously-viewed
  // month is rarely what you want to land on tomorrow.
  const [month, setMonth] = useState<string>(() => currentMonthIso());
  const [reportCurrency, setReportCurrency] = usePersistedState('report_currency', 'EUR');
  // The URL is the source of truth for the active page; we mirror it into a
  // persisted value only to decide where "/" should land on next launch.
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const tab = tabFromPath(location.pathname);
  // Sens du glissement entre pages : vers la gauche quand on avance dans les
  // onglets (ordre de la navigation), vers la droite quand on revient.
  const tabIndex = navItems.findIndex((item) => item.tab === tab);
  const lastTabIndex = useRef(tabIndex);
  const pageDir = useRef<'forward' | 'back' | undefined>(undefined);
  if (lastTabIndex.current !== tabIndex) {
    pageDir.current = tabIndex > lastTabIndex.current ? 'forward' : 'back';
    lastTabIndex.current = tabIndex;
  }
  const [lastTab, setLastTab] = usePersistedState<Tab>('active_tab', 'dashboard');
  // Barre du bas (téléphone) : pages et ordre choisis par l'utilisateur.
  const tabbarIds = useTabbar();
  const [theme, setTheme] = useTheme();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [unassignedTransactions, setUnassignedTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus[]>([]);
  const [billsStatus, setBillsStatus] = useState<BillsStatusSummary | null>(null);
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState<TriggeredAlert[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Le toast de succès peut porter une action (ex. « Annuler » après une
  // suppression) — voir run() et l'option `undo`.
  const [notice, setNotice] = useState<{ message: string; action?: { label: string; onClick: () => void } } | null>(null);
  const [loading, setLoading] = useState(false);
  // Mobile : feuille « Plus » (sections hors barre d'onglets + réglages rapides).
  const [moreOpen, setMoreOpen] = useState(false);
  // Mobile : la recherche est repliée derrière une icône.
  const [searchOpen, setSearchOpen] = useState(false);
  // Barre d'onglets défilante (mobile) : l'onglet actif est ramené à l'écran.
  const subnavRef = useRef<HTMLElement | null>(null);
  const [transactionIssueFilter, setTransactionIssueFilter] = useState<'unassigned_account' | null>(null);
  const [tokenPromptOpen, setTokenPromptOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The assistant conversation lives here (not in the Assistant page) so it
  // survives tab switches AND full reloads — re-asking the model the same thing
  // burns tokens for nothing. Persisted alongside the user it belongs to so we
  // never show one user's chat to another. Streaming/abort live here too so a
  // tab switch mid-stream keeps the cancel button working.
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiChat, setAiChat] = usePersistedState<{ userId: number | null; messages: ChatMessage[] }>(
    // App : un profil du téléphone et un du serveur peuvent avoir le même id.
    activeBackend() === 'phone' ? 'ai_chat_phone' : 'ai_chat',
    { userId: null, messages: initialAssistantMessages() },
    { pause: aiStreaming },
  );
  const aiAbortRef = useRef<AbortController | null>(null);
  const aiMessages = aiChat.userId === userId ? aiChat.messages : initialAssistantMessages();
  const setAiMessages: Dispatch<SetStateAction<ChatMessage[]>> = (update) => {
    setAiChat((prev) => {
      const base = prev.userId === userId ? prev.messages : initialAssistantMessages();
      const next = typeof update === 'function' ? (update as (p: ChatMessage[]) => ChatMessage[])(base) : update;
      return { userId, messages: next };
    });
  };
  // Bumped on every successful reload. Children that fetch derived data not
  // covered by the main reload (e.g. Dashboard's wealth history) observe this
  // to re-fetch after snapshots/transactions are created.
  const [dataVersion, setDataVersion] = useState(0);

  // Version tokens: every reload bumps its stream's token; only the latest
  // in-flight reload of that stream writes into React state, so rapid changes
  // never resurrect stale data. Static (per-user) and month-scoped data are
  // tracked separately so paging months doesn't refetch the whole app.
  const staticVersion = useRef(0);
  const monthVersion = useRef(0);
  // Re-entry guard for run(): a rapid double-click on a primary button could
  // otherwise fire the same mutation twice and create duplicates server-side.
  // Cheaper than passing a `pending` flag to every page/form.
  const runInFlight = useRef(false);

  const ctxRef = useRef({ userId, month, reportCurrency });
  ctxRef.current = { userId, month, reportCurrency };

  const reloadUsers = async () => {
    const rows = await api.users();
    setUsers(rows);
    // Au démarrage : le profil retenu sur cet appareil (s'il est de ce côté).
    const saved = readActiveProfile();
    const remembered = saved?.backend === activeBackend() ? saved.userId : null;
    setUserId((current) => {
      const wanted = current ?? remembered;
      return rows.some((u) => u.id === wanted) ? wanted : rows[0]?.id ?? null;
    });
  };

  // Profil choisi : retenu pour le prochain lancement.
  useEffect(() => {
    if (userId != null) writeActiveProfile({ backend: activeBackend(), userId });
  }, [userId]);

  // Month-independent data: only refetched when the user changes (or after a
  // mutation), never on month navigation. Bumps dataVersion because accounts /
  // snapshots changing means the wealth-history chart must refetch.
  const reloadStatic = async () => {
    const { userId } = ctxRef.current;
    if (!userId) return;
    const version = ++staticVersion.current;
    const [unassignedTxs, accs, insts, cats, recs, rls, gls, hlds, alrts, snaps, tgs] = await Promise.all([
      api.transactions(userId, undefined, 'unassigned_account'),
      api.accounts(userId),
      api.institutions(userId),
      api.categories(userId),
      api.recurring(userId),
      api.rules(userId),
      api.goals(userId),
      api.holdings(userId),
      api.alerts(userId),
      api.snapshots(userId),
      api.tags(userId),
    ]);
    if (version !== staticVersion.current) return;
    setUnassignedTransactions(unassignedTxs);
    setAccounts(accs);
    setInstitutions(insts);
    setCategories(cats);
    setRecurring(recs);
    setRules(rls);
    setGoals(gls);
    setHoldings(hlds);
    setAlerts(alrts);
    setSnapshots(snaps);
    setTags(tgs);
    setDataVersion((v) => v + 1);
  };

  // Month-scoped data: the only thing paging months refetches. Drives the
  // loading spinner. Deliberately does NOT bump dataVersion, so the (expensive,
  // month-independent) wealth-history chart isn't re-fetched on month nav.
  const reloadMonth = async () => {
    const { userId, month, reportCurrency } = ctxRef.current;
    if (!userId) return;
    const version = ++monthVersion.current;
    setLoading(true);
    try {
      const [dash, txs, bds, bdStatus, bls] = await Promise.all([
        api.dashboard(userId, month, reportCurrency),
        api.transactions(userId, month),
        api.budgets(userId, month),
        api.budgetsStatus(userId, month, reportCurrency),
        api.billsStatus(userId, month),
      ]);
      if (version !== monthVersion.current) return;
      setSummary(dash);
      setTransactions(txs);
      setBudgets(bds);
      setBudgetStatus(bdStatus);
      setBillsStatus(bls);
    } finally {
      if (version === monthVersion.current) setLoading(false);
    }
  };

  // Full refresh after a mutation: anything could have changed.
  const reload = async () => {
    await Promise.all([reloadStatic(), reloadMonth()]);
  };

  // Le backend peut exiger un APP_TOKEN : sur un 401, on ouvre le modal de saisie.
  useEffect(() => {
    onUnauthorized(() => setTokenPromptOpen(true));
  }, []);

  const shiftMonth = (delta: number) => setMonth((current) => {
    const [year, monthNum] = current.split('-').map(Number);
    const index = (monthNum - 1) + delta;
    const nextYear = year + Math.floor(index / 12);
    const nextMonth = ((index % 12) + 12) % 12;
    return `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}`;
  });

  useGlobalShortcuts({
    goto: (nextTab) => setActiveTab(nextTab),
    prevMonth: () => shiftMonth(-1),
    nextMonth: () => shiftMonth(1),
    focusSearch: () => (document.querySelector('.search-box input') as HTMLInputElement | null)?.focus(),
    showHelp: () => setShortcutsOpen(true),
    // `n` : saisie rapide — la page Transactions consomme ?focus=quick et
    // place le curseur dans le champ montant.
    newTransaction: () => navigate('/transactions?focus=quick'),
  });

  useEffect(() => {
    reloadUsers().catch((e) => setError((e as Error).message));
  }, []);

  // Static data follows the user only; month data follows month/currency. On a
  // user change both fire (disjoint sets, no double-fetch); on month navigation
  // only the month effect runs.
  useEffect(() => {
    setError(null);
    reloadStatic().catch((e) => setError((e as Error).message));
  }, [userId]);

  useEffect(() => {
    setError(null);
    reloadMonth().catch((e) => setError((e as Error).message));
  }, [userId, month, reportCurrency]);

  // Alertes déclenchées : évaluées à la volée par le backend. Dépendent à la
  // fois du mois/devise et de l'état (dataVersion bumpé par reloadStatic), donc
  // effet dédié. Échec silencieux : une alerte indisponible ne doit pas bloquer.
  useEffect(() => {
    if (!userId) { setTriggeredAlerts([]); return; }
    let cancelled = false;
    api.triggeredAlerts(userId, reportCurrency, month)
      .then((rows) => { if (!cancelled) setTriggeredAlerts(rows); })
      .catch(() => { if (!cancelled) setTriggeredAlerts([]); });
    return () => { cancelled = true; };
  }, [userId, month, reportCurrency, dataVersion]);

  // A stream can't survive a reload: clear any persisted "streaming" flag once
  // on mount so a restored conversation doesn't show a stuck cursor.
  useEffect(() => {
    setAiChat((prev) => ({
      ...prev,
      messages: prev.messages.map((m) => m.streaming ? { ...m, streaming: false, content: m.content || '(interrompu)' } : m),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const institutionById = useMemo(() => new Map(institutions.map((i) => [i.id, i])), [institutions]);

  // The Toast component handles its own auto-dismiss timer; we just keep the
  // last error/notice in state and clear them when the toast tells us to.
  // Both run/runUsers gate on runInFlight so a rapid double-click silently
  // drops the second invocation instead of duplicating the mutation.
  // `message` can be a function that derives the toast text from the
  // operation's return value (used by batch snapshots to say "X créés, Y
  // mis à jour" instead of a generic count).
  const resolveMessage = (message: string | ((result: unknown) => string) | undefined, result: unknown) =>
    typeof message === 'function' ? message(result) : (message ?? 'Enregistré');

  const run: Run = async (fn, message, options) => {
    if (runInFlight.current) {
      // Ne pas avaler silencieusement l'action : l'utilisateur doit savoir
      // que son clic a été ignoré (sinon une édition rapide se perd sans trace).
      setError('Une action est déjà en cours, réessaie dans un instant.');
      return false;
    }
    runInFlight.current = true;
    let result: unknown;
    try {
      setError(null);
      result = await fn();
    } catch (e) {
      setError((e as Error).message);
      runInFlight.current = false;
      return false;
    }
    try {
      await reload();
    } catch {
      setError('Enregistré, mais l\'actualisation a échoué : recharge la page.');
    } finally {
      runInFlight.current = false;
    }
    const undo = options?.undo;
    setNotice({
      message: resolveMessage(message, result),
      action: undo ? { label: 'Annuler', onClick: () => { void run(undo, 'Action annulée'); } } : undefined,
    });
    return true;
  };

  const runUsers: Run = async (fn, message) => {
    if (runInFlight.current) {
      setError('Une action est déjà en cours, réessaie dans un instant.');
      return false;
    }
    runInFlight.current = true;
    try {
      setError(null);
      const result = await fn();
      await reloadUsers();
      setNotice({ message: resolveMessage(message, result) });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      runInFlight.current = false;
    }
  };

  const section = sectionForTab(tab);
  useEffect(() => {
    const active = subnavRef.current?.querySelector<HTMLElement>('.subnav-tab.active');
    active?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [tab]);
  // Remember the current page so a fresh "/" reopens where the user left off.
  // Skip "/" itself (it only redirects) so it can't overwrite the saved tab.
  // Also drop the transaction issue filter on any route change away from
  // Transactions — navigation can happen through <Link>s and back/forward,
  // not only setActiveTab.
  useEffect(() => {
    if (location.pathname !== '/') setLastTab(tab);
    if (tab !== 'transactions') setTransactionIssueFilter(null);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const setActiveTab = (nextTab: Tab) => {
    navigate(pathForTab(nextTab));
    setMoreOpen(false);
  };
  // Glisser à gauche / à droite (tactile) : en haut de l'écran, sous-page
  // voisine dans la section ; en bas, position voisine dans la barre du bas
  // (pages choisies, puis « Plus », qui ouvre le menu plutôt que d'enchaîner des
  // pages invisibles dans la barre). Une page de « Plus » compte comme « Plus ».
  const neighbourTab = (direction: 'next' | 'prev', zone: SwipeZone): Tab | 'more' | undefined => {
    const step = direction === 'next' ? 1 : -1;
    if (zone === 'sections') {
      const positions = [...tabbarIds, 'more'];
      const here = tabbarIds.includes(section.id) ? positions.indexOf(section.id) : positions.length - 1;
      const target = positions[here + step];
      // Sur une page de « Plus », glisser encore vers la gauche rouvre le menu.
      if (target === undefined) return here === positions.length - 1 && step > 0 ? 'more' : undefined;
      if (target === 'more') return 'more';
      return navSections.find((s) => s.id === target)?.tabs[0]?.tab;
    }
    const index = section.tabs.findIndex((item) => item.tab === tab);
    return index < 0 ? undefined : section.tabs[index + step]?.tab;
  };
  const addButton = (
    <button key="add" type="button" className="tabbar-add" aria-label={t('ui.app.new_transaction')} onClick={() => navigate('/transactions?focus=quick')}>
      <Plus size={24} strokeWidth={2.25} />
    </button>
  );
  const goNeighbour = (direction: 'next' | 'prev', zone: SwipeZone) => {
    const next = neighbourTab(direction, zone);
    if (next === 'more') setMoreOpen(true);
    else if (next) setActiveTab(next);
  };
  const openUnassignedTransactions = () => {
    setTransactionIssueFilter('unassigned_account');
    setActiveTab('transactions');
  };

  const controls = (
    <>
      {MONTH_TABS.has(tab) && <MonthPicker value={month} onChange={setMonth} />}
    </>
  );
  const settingsControls = (
    <>
      {users.length > 1 && (
        <label className="field-inline">
          <span>{t('ui.app.profile')}</span>
          <select value={userId ?? ''} onChange={(e) => setUserId(Number(e.target.value))}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      )}
      <label className="field-inline">
        <span>{t('ui.app.currency')}</span>
        <select value={reportCurrency} onChange={(e) => setReportCurrency(e.target.value)}>
          {REPORT_CURRENCIES.map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}
        </select>
      </label>
      <ThemeToggle theme={theme} onChange={setTheme} />
    </>
  );

  return (
    <div className="shell">
      <TouchGestures
        canSwipe={(direction, zone) => neighbourTab(direction, zone) !== undefined}
        onSwipe={goNeighbour}
        onRefresh={() => reload().catch((e) => setError((e as Error).message))}
      />
      <aside className="rail" aria-label={t('ui.app.main_navigation')}>
        <div className="rail-brand">
          <span className="rail-mark" aria-hidden><SuzanneMark size={24} /></span>
          <span className="rail-name">Suzanne</span>{/* i18n-ignore : nom de l'application */}
        </div>
        <nav className="rail-nav">
          {navSections.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === section.id ? 'rail-link active' : 'rail-link'}
              aria-current={s.id === section.id ? 'page' : undefined}
              onClick={() => setActiveTab(s.tabs[0]!.tab)}
            >
              {s.icon}
              <span>{t(s.label)}</span>
            </button>
          ))}
        </nav>
        <div className="rail-foot">{settingsControls}</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-kicker">{t(section.label)}</span>
            <h1>{t(tabLabel(tab))}</h1>
          </div>
          <div className={searchOpen ? 'topbar-tools search-open' : 'topbar-tools'}>
            <button type="button" className="icon-ghost topbar-search-toggle" aria-label={t('ui.app.search')} aria-expanded={searchOpen} onClick={() => setSearchOpen((v) => !v)}>
              {searchOpen ? <X size={18} /> : <Search size={18} />}
            </button>
            {userId && <SearchBox userId={userId} onNavigate={(next) => { setSearchOpen(false); setActiveTab(next); }} />}
            {userId && section.id === 'ops' && <BankSyncButton userId={userId} run={run} />}
            {controls}
            {loading && <span className="spinner" aria-label={t('ui.app.loading')} />}
          </div>
        </header>
        {section.tabs.length > 1 && (
          <nav className="subnav" aria-label={t(section.label)} ref={subnavRef}>
            {section.tabs.map((item) => (
              <button
                key={item.tab}
                type="button"
                className={item.tab === tab ? 'subnav-tab active' : 'subnav-tab'}
                aria-current={item.tab === tab ? 'page' : undefined}
                onClick={() => setActiveTab(item.tab)}
              >
                {t(item.label)}
              </button>
            ))}
          </nav>
        )}

        <main className="content">
        <Suspense fallback={<div className="page-loading">{t('ui.app.loading_2')}</div>}>
        {/* Keyed by pathname so the wrapper remounts on every navigation and
            replays the fade — whatever element the page uses as its root. */}
        <div className="page-fade" key={location.pathname} data-dir={pageDir.current}>
        <Routes>
          <Route path="/" element={<Navigate to={pathForTab(normalizeTab(lastTab))} replace />} />
          <Route
            path="/dashboard"
            element={(
              <Dashboard
                summary={summary}
                transactions={transactions}
                budgets={budgets}
                recurring={recurring}
                billsStatus={billsStatus}
                reportCurrency={reportCurrency}
                categoryById={categoryById}
                accountById={accountById}
                userId={userId}
                budgetStatus={budgetStatus}
              />
            )}
          />
          <Route
            path="/wealth"
            element={(
              <Wealth
                userId={userId}
                summary={summary}
                accounts={accounts}
                reportCurrency={reportCurrency}
                dataVersion={dataVersion}
                onOpenUnassignedTransactions={openUnassignedTransactions}
              />
            )}
          />
          <Route
            path="/assistant"
            element={userId ? (
              <Assistant userId={userId} month={month} currency={reportCurrency} run={run} messages={aiMessages} setMessages={setAiMessages} streaming={aiStreaming} setStreaming={setAiStreaming} abortRef={aiAbortRef} />
            ) : null}
          />
          <Route
            path="/transactions"
            element={userId ? (
              <Transactions
                userId={userId}
                month={month}
                transactions={transactions}
                unassignedTransactions={unassignedTransactions}
                issueFilter={transactionIssueFilter}
                onClearIssueFilter={() => setTransactionIssueFilter(null)}
                recurring={recurring}
                accounts={accounts}
                categories={categories}
                tags={tags}
                categoryById={categoryById}
                accountById={accountById}
                onMonthChange={setMonth}
                run={run}
              />
            ) : null}
          />
          <Route path="/tags" element={userId ? <Tags userId={userId} tags={tags} run={run} /> : null} />
          <Route path="/statistics" element={userId ? <Statistics userId={userId} reportCurrency={reportCurrency} accountById={accountById} tags={tags} /> : null} />
          <Route path="/accounts" element={userId ? <Accounts userId={userId} accounts={accounts} institutions={institutions} snapshots={snapshots} institutionById={institutionById} summary={summary} run={run} /> : null} />
          <Route path="/accounts/:id" element={userId ? <AccountDetail userId={userId} accounts={accounts} summary={summary} snapshots={snapshots} categoryById={categoryById} reportCurrency={reportCurrency} run={run} /> : null} />
          <Route path="/categories" element={userId ? <Categories userId={userId} categories={categories} run={run} /> : null} />
          <Route path="/budgets" element={userId ? <Budgets userId={userId} month={month} categories={categories} tags={tags} run={run} reportCurrency={reportCurrency} dataVersion={dataVersion} /> : null} />
          <Route path="/recurring" element={userId ? <Recurring userId={userId} recurring={recurring} accounts={accounts} categories={categories} categoryById={categoryById} accountById={accountById} summary={summary} reportCurrency={reportCurrency} run={run} /> : null} />
          <Route path="/bills" element={userId ? <Bills userId={userId} month={month} billsStatus={billsStatus} accounts={accounts} categories={categories} accountById={accountById} run={run} /> : null} />
          <Route path="/forecast" element={userId ? <Forecast recurring={recurring} accounts={accounts} goals={goals} summary={summary} reportCurrency={reportCurrency} categoryById={categoryById} accountById={accountById} /> : null} />
          <Route path="/health" element={userId ? <Health userId={userId} summary={summary} recurring={recurring} budgets={budgets} reportCurrency={reportCurrency} categoryById={categoryById} accountById={accountById} /> : null} />
          <Route path="/loans" element={userId ? <Loans userId={userId} accounts={accounts} institutions={institutions} categories={categories} dataVersion={dataVersion} run={run} /> : null} />
          <Route path="/diversification" element={userId ? <Diversification userId={userId} accounts={accounts} institutions={institutions} summary={summary} reportCurrency={reportCurrency} run={run} /> : null} />
          <Route path="/bank/*" element={userId ? <Bank userId={userId} accounts={accounts} run={run} /> : null} />
          <Route path="/goals" element={userId ? <Goals userId={userId} goals={goals} accounts={accounts} accountById={accountById} run={run} /> : null} />
          <Route path="/investments" element={userId ? <Investments userId={userId} holdings={holdings} accounts={accounts} accountById={accountById} reportCurrency={reportCurrency} dataVersion={dataVersion} run={run} /> : null} />
          <Route path="/alerts" element={userId ? <Alerts userId={userId} alerts={alerts} triggered={triggeredAlerts} accounts={accounts} goals={goals} accountById={accountById} run={run} /> : null} />
          <Route path="/anomalies" element={userId ? <Anomalies userId={userId} accounts={accounts} accountById={accountById} categories={categories} categoryById={categoryById} dataVersion={dataVersion} run={run} /> : null} />
          <Route path="/rules" element={userId ? <Rules userId={userId} rules={rules} categories={categories} categoryById={categoryById} tags={tags} dataVersion={dataVersion} run={run} /> : null} />
          <Route path="/tools" element={userId ? <Tools userId={userId} accounts={accounts} run={run} /> : null} />
          <Route path="/users" element={<UsersPage users={users} currentUserId={userId} run={runUsers} onOpen={setUserId} />} />
          <Route path="/simulator" element={userId ? <Simulator userId={userId} accounts={accounts} institutions={institutions} summary={summary} reportCurrency={reportCurrency} /> : null} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="*" element={<Navigate to={pathForTab(normalizeTab(lastTab))} replace />} />
        </Routes>
        </div>
        </Suspense>
        </main>
      </div>

      {/* Barre du bas : pages choisies dans Réglages › Préférences (2 à 4, dans
          leur ordre), « + » au milieu, « Plus » au bout. */}
      <nav className="tabbar" aria-label={t('ui.app.navigation')} style={{ ['--tabbar-cols' as string]: tabbarIds.length + 2 }}>
        {tabbarIds.flatMap((id, index) => {
          const s = navSections.find((x) => x.id === id);
          if (!s) return [];
          const item = (
            <button key={s.id} type="button" className={s.id === section.id ? 'tabbar-item active' : 'tabbar-item'} onClick={() => setActiveTab(s.tabs[0]!.tab)}>
              {s.icon}<span>{t(s.short)}</span>
            </button>
          );
          return index === addButtonIndex(tabbarIds.length) ? [addButton, item] : [item];
        })}
        {addButtonIndex(tabbarIds.length) >= tabbarIds.length && addButton}
        <button type="button" className={moreOpen || !tabbarIds.includes(section.id) ? 'tabbar-item active' : 'tabbar-item'} onClick={() => setMoreOpen(true)}>
          <MoreHorizontal size={20} strokeWidth={1.75} /><span>{t('ui.app.more')}</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={t('ui.app.more')} onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <strong>{t('ui.app.more')}</strong>
              <button type="button" className="icon-ghost" aria-label={t('ui.app.close')} onClick={() => setMoreOpen(false)}><X size={18} /></button>
            </div>
            <div className="sheet-grid">
              {navSections.filter((s) => !tabbarIds.includes(s.id)).map((s) => (
                <button key={s.id} type="button" className={s.id === section.id ? 'sheet-link active' : 'sheet-link'} onClick={() => setActiveTab(s.tabs[0]!.tab)}>
                  {s.icon}<span>{t(s.label)}</span>
                </button>
              ))}
            </div>
            <div className="sheet-settings">{settingsControls}</div>
          </div>
        </div>
      )}

      {shortcutsOpen && (
        <Modal title={t('ui.app.keyboard_shortcuts')} onClose={() => setShortcutsOpen(false)}>
          <div className="shortcuts-help">
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>d</kbd></span>  {t('ui.app.overview')}</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>w</kbd></span>  {t('ui.app.net_worth')}</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>t</kbd></span>  {t('ui.app.transactions')}</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>s</kbd></span>  {t('ui.app.statistics')}</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>a</kbd></span>  {t('ui.app.accounts')}</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>b</kbd></span>  {t('ui.app.budgets')}</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>c</kbd></span>  {t('ui.app.categories')}</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>g</kbd></span>  {t('ui.app.goals')}</div>
            <div className="shortcuts-row"><span><kbd>n</kbd></span>  {t('ui.app.new_transaction_2')}</div>
            <div className="shortcuts-row"><span><kbd>/</kbd></span>  {t('ui.app.search')}</div>
            <div className="shortcuts-row"><span><kbd>[</kbd> <kbd>]</kbd></span>  {t('ui.app.previous_next_month')}</div>
            <div className="shortcuts-row"><span><kbd>?</kbd></span>  {t('ui.app.this_help')}</div>
          </div>
        </Modal>
      )}

      {tokenPromptOpen && (
        <TokenModal
          onClose={() => setTokenPromptOpen(false)}
          onSaved={() => {
            setTokenPromptOpen(false);
            setError(null);
            reloadUsers().catch((e) => setError((e as Error).message));
            reload().catch((e) => setError((e as Error).message));
          }}
        />
      )}

      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {error && <Toast kind="error" message={error} onDismiss={() => setError(null)} />}
        {notice && <Toast kind="success" message={notice.message} action={notice.action} onDismiss={() => setNotice(null)} />}
      </div>
    </div>
  );
}

