import { Suspense, lazy, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Menu, X } from 'lucide-react';
import {
  REPORT_CURRENCIES,
  type Account,
  type AccountSnapshot,
  type Budget,
  type Category,
  type CategoryRule,
  type DashboardSummary,
  type Institution,
  type RecurringTransaction,
  type SavingsGoal,
  type Tag,
  type Transaction,
  type User,
} from '@suzanne-lite/shared';
import { api } from './lib/api';
import { currentMonthIso } from './lib/format';
import { navItems, navSections, pathForTab, tabFromPath, type Tab } from './lib/nav';
import type { Run } from './lib/run';
import { usePersistedState } from './lib/storage';
import { useGlobalShortcuts } from './lib/useGlobalShortcuts';
import { Modal } from './components/Modal';
import { MonthPicker } from './components/MonthPicker';
import { SearchBox } from './components/SearchBox';
import { ThemeToggle, useTheme } from './components/ThemeToggle';
import { Toast } from './components/Toast';
import { TokenModal } from './components/TokenModal';
import { onUnauthorized } from './lib/authToken';
import { initialAssistantMessages, type ChatMessage } from './lib/assistantState';

// Pages are code-split: each becomes its own chunk so the initial bundle no
// longer ships every page (and Recharts/react-markdown) up front. The active
// page loads on demand behind a Suspense fallback. Named exports are remapped
// to a default so React.lazy keeps each component's prop types.
const Assistant = lazy(() => import('./pages/Assistant').then((m) => ({ default: m.Assistant })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Statistics = lazy(() => import('./pages/Statistics').then((m) => ({ default: m.Statistics })));
const Transactions = lazy(() => import('./pages/Transactions').then((m) => ({ default: m.Transactions })));
const Accounts = lazy(() => import('./pages/Accounts').then((m) => ({ default: m.Accounts })));
const AccountDetail = lazy(() => import('./pages/AccountDetail').then((m) => ({ default: m.AccountDetail })));
const Categories = lazy(() => import('./pages/Categories').then((m) => ({ default: m.Categories })));
const Budgets = lazy(() => import('./pages/Budgets').then((m) => ({ default: m.Budgets })));
const Recurring = lazy(() => import('./pages/Recurring').then((m) => ({ default: m.Recurring })));
const Forecast = lazy(() => import('./pages/Forecast').then((m) => ({ default: m.Forecast })));
const Health = lazy(() => import('./pages/Health').then((m) => ({ default: m.Health })));
const Goals = lazy(() => import('./pages/Goals').then((m) => ({ default: m.Goals })));
const Rules = lazy(() => import('./pages/Rules').then((m) => ({ default: m.Rules })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Tags = lazy(() => import('./pages/Tags').then((m) => ({ default: m.Tags })));
const Tools = lazy(() => import('./pages/Tools').then((m) => ({ default: m.Tools })));
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
  const tab = tabFromPath(location.pathname);
  const [lastTab, setLastTab] = usePersistedState<Tab>('active_tab', 'dashboard');
  const [theme, setTheme] = useTheme();
  const [openSections, setOpenSections] = usePersistedState<Record<string, boolean>>('nav_sections', {
    pilotage: true,
    structure: true,
    admin: true,
    ai: true,
  });

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [unassignedTransactions, setUnassignedTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [transactionIssueFilter, setTransactionIssueFilter] = useState<'unassigned_account' | null>(null);
  const [tokenPromptOpen, setTokenPromptOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The assistant conversation lives here (not in the Assistant page) so it
  // survives tab switches AND full reloads — re-asking the model the same thing
  // burns tokens for nothing. Persisted alongside the user it belongs to so we
  // never show one user's chat to another. Streaming/abort live here too so a
  // tab switch mid-stream keeps the cancel button working.
  const [aiChat, setAiChat] = usePersistedState<{ userId: number | null; messages: ChatMessage[] }>(
    'ai_chat',
    { userId: null, messages: initialAssistantMessages() },
  );
  const [aiStreaming, setAiStreaming] = useState(false);
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

  // Version token: every reload bumps this; only the latest in-flight reload
  // is allowed to write into React state, so rapid month/currency/user changes
  // never resurrect stale data.
  const reloadVersion = useRef(0);
  // Re-entry guard for run(): a rapid double-click on a primary button could
  // otherwise fire the same mutation twice and create duplicates server-side.
  // Cheaper than passing a `pending` flag to every page/form.
  const runInFlight = useRef(false);

  const reloadUsers = async () => {
    const rows = await api.users();
    setUsers(rows);
    setUserId((current) => rows.some((u) => u.id === current) ? current : rows[0]?.id ?? null);
  };

  const reload = async () => {
    if (!userId) return;
    const version = ++reloadVersion.current;
    setLoading(true);
    try {
      const [dash, txs, unassignedTxs, accs, insts, cats, bds, recs, rls, gls, snaps, tgs] = await Promise.all([
        api.dashboard(userId, month, reportCurrency),
        api.transactions(userId, month),
        api.transactions(userId, undefined, 'unassigned_account'),
        api.accounts(userId),
        api.institutions(userId),
        api.categories(userId),
        api.budgets(userId, month),
        api.recurring(userId),
        api.rules(userId),
        api.goals(userId),
        api.snapshots(userId),
        api.tags(userId),
      ]);
      if (version !== reloadVersion.current) return;
      setSummary(dash);
      setTransactions(txs);
      setUnassignedTransactions(unassignedTxs);
      setAccounts(accs);
      setInstitutions(insts);
      setCategories(cats);
      setBudgets(bds);
      setRecurring(recs);
      setRules(rls);
      setGoals(gls);
      setSnapshots(snaps);
      setTags(tgs);
      setDataVersion((v) => v + 1);
    } finally {
      if (version === reloadVersion.current) setLoading(false);
    }
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
  });

  useEffect(() => {
    reloadUsers().catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    setError(null);
    reload().catch((e) => setError((e as Error).message));
  }, [userId, month, reportCurrency]);

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

  const run: Run = async (fn, message) => {
    if (runInFlight.current) return;
    runInFlight.current = true;
    try {
      setError(null);
      const result = await fn();
      await reload();
      setNotice(resolveMessage(message, result));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      runInFlight.current = false;
    }
  };

  const runUsers: Run = async (fn, message) => {
    if (runInFlight.current) return;
    runInFlight.current = true;
    try {
      setError(null);
      const result = await fn();
      await reloadUsers();
      setNotice(resolveMessage(message, result));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      runInFlight.current = false;
    }
  };

  const activeNav = navItems.find((item) => item.tab === tab);
  // Remember the current page so a fresh "/" reopens where the user left off.
  // Skip "/" itself (it only redirects) so it can't overwrite the saved tab.
  useEffect(() => {
    if (location.pathname !== '/') setLastTab(tab);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const setActiveTab = (nextTab: Tab) => {
    if (nextTab !== 'transactions') setTransactionIssueFilter(null);
    navigate(pathForTab(nextTab));
    setSidebarOpen(false);
  };
  const openUnassignedTransactions = () => {
    setTransactionIssueFilter('unassigned_account');
    setActiveTab('transactions');
  };
  const toggleSection = (id: string) => {
    setOpenSections({ ...openSections, [id]: !(openSections[id] ?? true) });
  };

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="sidebar-backdrop" aria-label="Fermer le menu" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <div>
            <strong>Suzanne</strong>
            <span>Finance quotidienne</span>
          </div>
          <button className="sidebar-close" type="button" aria-label="Fermer le menu" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="nav-list" aria-label="Navigation principale">
          {navSections.map((section) => {
            const open = openSections[section.id] ?? true;
            return (
              <div className="nav-section" key={section.id}>
                <button
                  className="nav-section-toggle"
                  type="button"
                  onClick={() => toggleSection(section.id)}
                  aria-expanded={open}
                >
                  <span>{section.label}</span>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {open && section.items.map((item) => (
                  <TabButton key={item.tab} tab={item.tab} current={tab} setTab={setActiveTab} label={item.label} icon={item.icon} />
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <main className="content">
        <div className="page-head">
          <button className="menu-toggle" type="button" aria-label="Ouvrir le menu" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <div>
            <p className="eyebrow">{activeNav?.label ?? 'Vue générale'}</p>
            <h1>{tab === 'dashboard' ? 'Pilotage financier' : activeNav?.label}</h1>
          </div>
          {loading && <span className="spinner" aria-label="Chargement" />}
        </div>

        {/* Controls live in a compact pill pinned top-right; it floats over the
            content and stays put on scroll, so it no longer eats a full bar on
            every page. On small screens it drops back into the flow. */}
        <div className="floating-controls">
          {userId && <SearchBox userId={userId} onNavigate={setActiveTab} />}
          <select value={userId ?? ''} onChange={(e) => setUserId(Number(e.target.value))} aria-label="Utilisateur">
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={reportCurrency} onChange={(e) => setReportCurrency(e.target.value)} aria-label="Devise d'affichage">
            {REPORT_CURRENCIES.map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}
          </select>
          <MonthPicker value={month} onChange={setMonth} />
          <ThemeToggle theme={theme} onChange={setTheme} />
        </div>

        <Suspense fallback={<div className="page-loading">Chargement…</div>}>
        <Routes>
          <Route path="/" element={<Navigate to={pathForTab(lastTab)} replace />} />
          <Route
            path="/dashboard"
            element={(
              <Dashboard
                userId={userId}
                summary={summary}
                transactions={transactions}
                budgets={budgets}
                recurring={recurring}
                accounts={accounts}
                reportCurrency={reportCurrency}
                categoryById={categoryById}
                accountById={accountById}
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
                run={run}
              />
            ) : null}
          />
          <Route path="/tags" element={userId ? <Tags userId={userId} tags={tags} run={run} /> : null} />
          <Route path="/statistics" element={userId ? <Statistics userId={userId} reportCurrency={reportCurrency} /> : null} />
          <Route path="/accounts" element={userId ? <Accounts userId={userId} accounts={accounts} institutions={institutions} snapshots={snapshots} institutionById={institutionById} summary={summary} run={run} /> : null} />
          <Route path="/accounts/:id" element={userId ? <AccountDetail userId={userId} accounts={accounts} summary={summary} snapshots={snapshots} categoryById={categoryById} reportCurrency={reportCurrency} /> : null} />
          <Route path="/categories" element={userId ? <Categories userId={userId} categories={categories} run={run} /> : null} />
          <Route path="/budgets" element={userId ? <Budgets userId={userId} month={month} categories={categories} budgets={budgets} summary={summary} run={run} /> : null} />
          <Route path="/recurring" element={userId ? <Recurring userId={userId} recurring={recurring} accounts={accounts} categories={categories} categoryById={categoryById} accountById={accountById} run={run} /> : null} />
          <Route path="/forecast" element={userId ? <Forecast recurring={recurring} accounts={accounts} goals={goals} summary={summary} reportCurrency={reportCurrency} categoryById={categoryById} accountById={accountById} /> : null} />
          <Route path="/health" element={userId ? <Health summary={summary} recurring={recurring} budgets={budgets} reportCurrency={reportCurrency} categoryById={categoryById} accountById={accountById} /> : null} />
          <Route path="/goals" element={userId ? <Goals userId={userId} goals={goals} accounts={accounts} accountById={accountById} run={run} /> : null} />
          <Route path="/rules" element={userId ? <Rules userId={userId} rules={rules} categories={categories} categoryById={categoryById} run={run} /> : null} />
          <Route path="/tools" element={userId ? <Tools userId={userId} accounts={accounts} run={run} /> : null} />
          <Route path="/users" element={<UsersPage users={users} currentUserId={userId} run={runUsers} />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to={pathForTab(lastTab)} replace />} />
        </Routes>
        </Suspense>
      </main>

      {shortcutsOpen && (
        <Modal title="Raccourcis clavier" onClose={() => setShortcutsOpen(false)}>
          <div className="shortcuts-help">
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>d</kbd></span> Vue générale</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>t</kbd></span> Transactions</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>s</kbd></span> Statistiques</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>a</kbd></span> Comptes</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>b</kbd></span> Budgets</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>c</kbd></span> Catégories</div>
            <div className="shortcuts-row"><span><kbd>g</kbd> <kbd>g</kbd></span> Objectifs</div>
            <div className="shortcuts-row"><span><kbd>/</kbd></span> Rechercher</div>
            <div className="shortcuts-row"><span><kbd>[</kbd> <kbd>]</kbd></span> Mois précédent / suivant</div>
            <div className="shortcuts-row"><span><kbd>?</kbd></span> Cette aide</div>
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
        {notice && <Toast kind="success" message={notice} onDismiss={() => setNotice(null)} />}
      </div>
    </div>
  );
}

function TabButton({ tab, current, setTab, label, icon }: { tab: Tab; current: Tab; setTab: (tab: Tab) => void; label: string; icon: React.ReactNode }) {
  return <button className={current === tab ? 'active' : ''} onClick={() => setTab(tab)}>{icon}<span>{label}</span></button>;
}
