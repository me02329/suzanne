import { useEffect, useMemo, useRef, useState } from 'react';
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
  type Transaction,
  type User,
} from '@suzanne-lite/shared';
import { api } from './lib/api';
import { currentMonthIso } from './lib/format';
import { navItems, navSections, type Tab } from './lib/nav';
import { usePersistedState } from './lib/storage';
import { SearchBox } from './components/SearchBox';
import { Toast } from './components/Toast';
import { Dashboard } from './pages/Dashboard';
import { Statistics } from './pages/Statistics';
import { Transactions } from './pages/Transactions';
import { Accounts } from './pages/Accounts';
import { Categories } from './pages/Categories';
import { Budgets } from './pages/Budgets';
import { Recurring } from './pages/Recurring';
import { Goals } from './pages/Goals';
import { Rules } from './pages/Rules';
import { Tools } from './pages/Tools';
import { UsersPage } from './pages/Users';

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  // `month` resets to the current month on each session — the previously-viewed
  // month is rarely what you want to land on tomorrow.
  const [month, setMonth] = useState<string>(() => currentMonthIso());
  const [reportCurrency, setReportCurrency] = usePersistedState('report_currency', 'EUR');
  const [tab, setTab] = usePersistedState<Tab>('active_tab', 'dashboard');
  const [openSections, setOpenSections] = usePersistedState<Record<string, boolean>>('nav_sections', {
    pilotage: true,
    structure: true,
    admin: true,
  });

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [recurring, setRecurring] = useState<RecurringTransaction[]>([]);
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Bumped on every successful reload. Children that fetch derived data not
  // covered by the main reload (e.g. Dashboard's wealth history) observe this
  // to re-fetch after snapshots/transactions are created.
  const [dataVersion, setDataVersion] = useState(0);

  // Version token: every reload bumps this; only the latest in-flight reload
  // is allowed to write into React state, so rapid month/currency/user changes
  // never resurrect stale data.
  const reloadVersion = useRef(0);

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
      const [dash, txs, accs, insts, cats, bds, recs, rls, gls, snaps] = await Promise.all([
        api.dashboard(userId, month, reportCurrency),
        api.transactions(userId, month),
        api.accounts(userId),
        api.institutions(userId),
        api.categories(userId),
        api.budgets(userId, month),
        api.recurring(userId),
        api.rules(userId),
        api.goals(userId),
        api.snapshots(userId),
      ]);
      if (version !== reloadVersion.current) return;
      setSummary(dash);
      setTransactions(txs);
      setAccounts(accs);
      setInstitutions(insts);
      setCategories(cats);
      setBudgets(bds);
      setRecurring(recs);
      setRules(rls);
      setGoals(gls);
      setSnapshots(snaps);
      setDataVersion((v) => v + 1);
    } finally {
      if (version === reloadVersion.current) setLoading(false);
    }
  };

  useEffect(() => {
    reloadUsers().catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    setError(null);
    reload().catch((e) => setError((e as Error).message));
  }, [userId, month, reportCurrency]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const institutionById = useMemo(() => new Map(institutions.map((i) => [i.id, i])), [institutions]);

  // The Toast component handles its own auto-dismiss timer; we just keep the
  // last error/notice in state and clear them when the toast tells us to.
  const run = async (fn: () => Promise<unknown>, message = 'Enregistré') => {
    try {
      setError(null);
      await fn();
      await reload();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const runUsers = async (fn: () => Promise<unknown>, message = 'Enregistré') => {
    try {
      setError(null);
      await fn();
      await reloadUsers();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const activeNav = navItems.find((item) => item.tab === tab);
  const setActiveTab = (nextTab: Tab) => {
    setTab(nextTab);
    setSidebarOpen(false);
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
        <header className="topbar">
          <div className="topbar-title">
            <button className="menu-toggle" type="button" aria-label="Ouvrir le menu" onClick={() => setSidebarOpen(true)}>
              <Menu size={22} />
            </button>
            <div>
              <p className="eyebrow">{activeNav?.label ?? 'Vue générale'}</p>
              <h1>{tab === 'dashboard' ? 'Pilotage financier' : activeNav?.label}</h1>
            </div>
            {loading && <span className="spinner" aria-label="Chargement" />}
          </div>
          <div className="toolbar">
            {userId && <SearchBox userId={userId} onNavigate={setActiveTab} />}
            <select value={userId ?? ''} onChange={(e) => setUserId(Number(e.target.value))} aria-label="Utilisateur">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select value={reportCurrency} onChange={(e) => setReportCurrency(e.target.value)} aria-label="Devise d'affichage">
              {REPORT_CURRENCIES.map((option) => <option key={option.value} value={option.value}>{option.value}</option>)}
            </select>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mois" />
          </div>
        </header>

        {tab === 'dashboard' && (
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
          />
        )}
        {tab === 'transactions' && userId && (
          <Transactions
            userId={userId}
            transactions={transactions}
            recurring={recurring}
            accounts={accounts}
            categories={categories}
            categoryById={categoryById}
            accountById={accountById}
            run={run}
          />
        )}
        {tab === 'statistics' && userId && (
          <Statistics userId={userId} reportCurrency={reportCurrency} />
        )}
        {tab === 'accounts' && userId && (
          <Accounts userId={userId} accounts={accounts} institutions={institutions} snapshots={snapshots} institutionById={institutionById} run={run} />
        )}
        {tab === 'categories' && userId && (
          <Categories userId={userId} categories={categories} run={run} />
        )}
        {tab === 'budgets' && userId && (
          <Budgets userId={userId} month={month} categories={categories} budgets={budgets} summary={summary} run={run} />
        )}
        {tab === 'recurring' && userId && (
          <Recurring userId={userId} recurring={recurring} accounts={accounts} categories={categories} categoryById={categoryById} accountById={accountById} run={run} />
        )}
        {tab === 'goals' && userId && (
          <Goals userId={userId} goals={goals} run={run} />
        )}
        {tab === 'rules' && userId && (
          <Rules userId={userId} rules={rules} categories={categories} categoryById={categoryById} run={run} />
        )}
        {tab === 'tools' && userId && (
          <Tools userId={userId} accounts={accounts} run={run} />
        )}
        {tab === 'users' && (
          <UsersPage users={users} currentUserId={userId} run={runUsers} />
        )}
      </main>

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
