import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  Banknote,
  CalendarClock,
  Copy,
  CreditCard,
  Euro,
  FolderTree,
  Landmark,
  LayoutDashboard,
  Menu,
  Pencil,
  Plus,
  Repeat,
  Search,
  Settings2,
  Tags,
  Target,
  Trash2,
  Upload,
  Users,
  Wallet,
  X,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  Account,
  AccountSnapshot,
  Budget,
  Category,
  CategoryRule,
  DashboardSummary,
  Institution,
  RecurringFrequency,
  RecurringTransaction,
  SavingsGoal,
  SearchResult,
  Transaction,
  TransactionType,
  User,
} from '@suzanne-lite/shared';
import { api } from './lib/api';

type Tab = 'dashboard' | 'transactions' | 'accounts' | 'categories' | 'budgets' | 'recurring' | 'goals' | 'rules' | 'tools' | 'users';

const currentMonth = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);
const chartGrid = '#e8edf5';
const incomeColor = '#15803d';
const expenseColor = '#dc2626';
const netColor = '#2563eb';

const navItems: Array<{ tab: Tab; label: string; icon: React.ReactNode }> = [
  { tab: 'dashboard', label: 'Vue générale', icon: <LayoutDashboard size={18} /> },
  { tab: 'transactions', label: 'Transactions', icon: <CreditCard size={18} /> },
  { tab: 'accounts', label: 'Comptes', icon: <Landmark size={18} /> },
  { tab: 'categories', label: 'Catégories', icon: <Tags size={18} /> },
  { tab: 'budgets', label: 'Budgets', icon: <BarChart3 size={18} /> },
  { tab: 'recurring', label: 'Récurrents', icon: <Repeat size={18} /> },
  { tab: 'goals', label: 'Objectifs', icon: <Target size={18} /> },
  { tab: 'rules', label: 'Règles', icon: <Settings2 size={18} /> },
  { tab: 'tools', label: 'Import/Export', icon: <Upload size={18} /> },
  { tab: 'users', label: 'Utilisateurs', icon: <Users size={18} /> },
];

const navSections: Array<{ id: string; label: string; items: typeof navItems }> = [
  { id: 'pilotage', label: 'Pilotage', items: navItems.filter((item) => ['dashboard', 'transactions', 'budgets', 'recurring'].includes(item.tab)) },
  { id: 'structure', label: 'Structure', items: navItems.filter((item) => ['accounts', 'categories', 'goals', 'rules'].includes(item.tab)) },
  { id: 'admin', label: 'Administration', items: navItems.filter((item) => ['tools', 'users'].includes(item.tab)) },
];

function money(value: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
}

function formatMonth(month: string) {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(date);
}

function txLabel(t: Transaction, categoryById: Map<number, Category>) {
  return t.description || (t.type === 'transfer' ? 'Transfert' : categoryById.get(t.category_id ?? -1)?.name) || 'Transaction';
}

function typeLabel(type: TransactionType) {
  if (type === 'income') return 'Revenu';
  if (type === 'transfer') return 'Transfert';
  return 'Dépense';
}

function recurringFrequencyLabel(frequency: RecurringFrequency, interval: number) {
  const unit = frequency === 'weekly' ? 'semaine' : frequency === 'yearly' ? 'an' : 'mois';
  return interval <= 1 ? `Chaque ${unit}` : `Tous les ${interval} ${unit}${unit === 'mois' ? '' : 's'}`;
}

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [tab, setTab] = useState<Tab>('dashboard');
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
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    pilotage: true,
    structure: true,
    admin: true,
  });

  const reloadUsers = async () => {
    const rows = await api.users();
    setUsers(rows);
    setUserId((current) => rows.some((u) => u.id === current) ? current : rows[0]?.id ?? null);
  };

  const reload = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [dash, txs, accs, insts, cats, bds, recs, rls, gls, snaps] = await Promise.all([
        api.dashboard(userId, month),
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reloadUsers().catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    setError(null);
    reload().catch((e) => setError((e as Error).message));
  }, [userId, month]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const institutionById = useMemo(() => new Map(institutions.map((i) => [i.id, i])), [institutions]);

  const run = async (fn: () => Promise<unknown>, message = 'Enregistré') => {
    try {
      setError(null);
      await fn();
      await reload();
      setNotice(message);
      window.setTimeout(() => setNotice(null), 2500);
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
      window.setTimeout(() => setNotice(null), 2500);
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
    setOpenSections((current) => ({ ...current, [id]: !current[id] }));
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
          {navSections.map((section) => (
            <div className="nav-section" key={section.id}>
              <button
                className="nav-section-toggle"
                type="button"
                onClick={() => toggleSection(section.id)}
                aria-expanded={openSections[section.id] ?? true}
              >
                <span>{section.label}</span>
                {(openSections[section.id] ?? true) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {(openSections[section.id] ?? true) && section.items.map((item) => (
                <TabButton key={item.tab} tab={item.tab} current={tab} setTab={setActiveTab} label={item.label} icon={item.icon} />
              ))}
            </div>
          ))}
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
            {userId && <SearchBox userId={userId} />}
            <select value={userId ?? ''} onChange={(e) => setUserId(Number(e.target.value))} aria-label="Utilisateur">
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Mois" />
          </div>
        </header>

        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}

      {tab === 'dashboard' && (
        <Dashboard
          summary={summary}
          transactions={transactions}
          budgets={budgets}
          recurring={recurring}
          accounts={accounts}
          categoryById={categoryById}
          accountById={accountById}
        />
      )}
      {tab === 'transactions' && userId && (
        <Transactions
          userId={userId}
          transactions={transactions}
          accounts={accounts}
          categories={categories}
          categoryById={categoryById}
          accountById={accountById}
          run={run}
        />
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
    </div>
  );
}

function TabButton({ tab, current, setTab, label, icon }: { tab: Tab; current: Tab; setTab: (tab: Tab) => void; label: string; icon: React.ReactNode }) {
  return <button className={current === tab ? 'active' : ''} onClick={() => setTab(tab)}>{icon}<span>{label}</span></button>;
}

function SearchBox({ userId }: { userId: number }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handle = window.setTimeout(() => {
      api.search(userId, query)
        .then((rows) => { setResults(rows); setOpen(true); })
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query, userId]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  return (
    <div className="search-box" ref={boxRef}>
      <Search size={16} />
      <input
        placeholder="Rechercher une opération"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
      />
      {open && results.length > 0 && (
        <div className="search-results">
          {results.map((r) => <div key={`${r.type}-${r.id}`}><strong>{r.title}</strong><span>{r.subtitle}</span></div>)}
        </div>
      )}
    </div>
  );
}

function Dashboard({ summary, transactions, budgets, recurring, accounts, categoryById, accountById }: {
  summary: DashboardSummary | null;
  transactions: Transaction[];
  budgets: Budget[];
  recurring: RecurringTransaction[];
  accounts: Account[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
}) {
  let cumulativeNet = 0;
  const monthRows = (summary?.monthly_cashflow ?? []).map((row) => {
    cumulativeNet += row.net;
    return {
      ...row,
      label: formatMonth(row.month),
      cumulativeNet,
    };
  });
  const yearRows = summary?.yearly_cashflow ?? [];
  const categoryRows = summary?.expenses_by_category ?? [];
  const savingRate = summary && summary.income > 0 ? Math.round((summary.net / summary.income) * 100) : 0;
  const subscriptionExpenses = recurring.filter((r) => r.active && r.type === 'expense').reduce((sum, r) => sum + r.amount, 0);
  const subscriptionIncomes = recurring.filter((r) => r.active && r.type === 'income').reduce((sum, r) => sum + r.amount, 0);
  const transactionCount = transactions.length;
  const averageExpense = transactionCount > 0
    ? transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0) / Math.max(1, transactions.filter((t) => t.type === 'expense').length)
    : 0;
  const budgetLimit = budgets.reduce((sum, b) => sum + b.amount_limit, 0);
  const budgetUsed = summary?.expenses ?? 0;
  const budgetPct = budgetLimit > 0 ? Math.min(100, (budgetUsed / budgetLimit) * 100) : 0;
  const accountRows = accounts.map((account) => {
    const outgoing = transactions.filter((t) => t.account_id === account.id).reduce((sum, t) => sum + (t.type === 'income' ? t.amount : -t.amount), 0);
    const incoming = transactions.filter((t) => t.type === 'transfer' && t.to_account_id === account.id).reduce((sum, t) => sum + t.amount, 0);
    return { name: account.name, value: outgoing + incoming };
  });
  const topExpenses = transactions
    .filter((t) => t.type === 'expense')
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return (
    <>
      <section className="stats">
        <Stat icon={<Wallet />} label="Solde estimé" value={money(summary?.balance ?? 0)} />
        <Stat icon={<ArrowUpCircle />} label="Revenus" value={money(summary?.income ?? 0)} positive />
        <Stat icon={<ArrowDownCircle />} label="Dépenses" value={money(summary?.expenses ?? 0)} negative />
        <Stat icon={<Euro />} label="Net mensuel" value={money(summary?.net ?? 0)} />
        <Stat icon={<Repeat />} label="Abonnements/mois" value={money(subscriptionExpenses)} negative />
        <Stat icon={<BarChart3 />} label="Taux d'épargne" value={`${savingRate}%`} />
        <Stat icon={<CreditCard />} label="Transactions" value={String(transactionCount)} />
        <Stat icon={<Banknote />} label="Dépense moyenne" value={money(averageExpense)} />
      </section>

      <section className="charts-grid">
        <Panel title="Cashflow mensuel">
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chartGrid} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `${value}€`} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Legend />
                <Bar dataKey="income" name="Revenus" fill={incomeColor} radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Dépenses" fill={expenseColor} radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="cumulativeNet" name="Cumul net" stroke={netColor} strokeWidth={3} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Répartition des dépenses">
          <div className="chart-split">
            <div className="donut-area">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categoryRows} dataKey="amount" nameKey="name" innerRadius="58%" outerRadius="86%" paddingAngle={2}>
                    {categoryRows.map((row) => <Cell key={row.category_id ?? row.name} fill={row.color} />)}
                  </Pie>
                  <Tooltip formatter={(value) => money(Number(value))} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="category-list compact">
              {categoryRows.map((row) => (
                <div className="category-row" key={row.category_id ?? 'none'}>
                  <span className="dot" style={{ background: row.color }} />
                  <span>{row.name}</span>
                  <strong>{money(row.amount)}</strong>
                </div>
              ))}
              {categoryRows.length === 0 && <p className="empty">Aucune dépense ce mois-ci.</p>}
            </div>
          </div>
        </Panel>
      </section>

      <section className="charts-grid">
        <Panel title="Cumul net 12 mois">
          <div className="chart-area small">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chartGrid} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `${value}€`} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Area type="monotone" dataKey="cumulativeNet" name="Cumul net" stroke={netColor} fill="#dbeafe" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Budget du mois">
          <div className="dashboard-metric">
            <div>
              <span>Dépenses suivies</span>
              <strong>{money(budgetUsed)}</strong>
            </div>
            <div>
              <span>Limites posées</span>
              <strong>{budgetLimit > 0 ? money(budgetLimit) : 'Aucun budget'}</strong>
            </div>
          </div>
          <div className="bar big"><span style={{ width: `${budgetPct}%`, background: budgetPct >= 100 ? '#dc2626' : '#2563eb' }} /></div>
          <p className="panel-note">{budgetLimit > 0 ? `${Math.round(budgetPct)} % consommé` : 'Ajoute des budgets pour suivre la consommation du mois.'}</p>
        </Panel>
      </section>

      <section className="grid">
        <Panel title="Tendance annuelle">
          <div className="chart-area small">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yearRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chartGrid} vertical={false} />
                <XAxis dataKey="year" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `${value}€`} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Legend />
                <Line type="monotone" dataKey="income" name="Revenus" stroke={incomeColor} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="expenses" name="Dépenses" stroke={expenseColor} strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="net" name="Net" stroke={netColor} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Abonnements actifs">
          <div className="dashboard-metric">
            <div>
              <span>Sorties mensuelles</span>
              <strong className="expense">{money(subscriptionExpenses)}</strong>
            </div>
            <div>
              <span>Entrées récurrentes</span>
              <strong className="income">{money(subscriptionIncomes)}</strong>
            </div>
          </div>
          <div className="category-list compact">
            {recurring.filter((r) => r.active).slice(0, 6).map((r) => (
              <div className="category-row" key={r.id}>
                <span className="dot" style={{ background: r.type === 'income' ? incomeColor : expenseColor }} />
                <span>{r.description}</span>
                <strong className={r.type === 'income' ? 'income' : 'expense'}>{r.type === 'income' ? '+' : '-'}{money(r.amount)}</strong>
              </div>
            ))}
            {recurring.filter((r) => r.active).length === 0 && <p className="empty">Aucun récurrent actif.</p>}
          </div>
        </Panel>
      </section>

      <section className="charts-grid">
        <Panel title="Mouvements par compte">
          <div className="chart-area small">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={accountRows} layout="vertical" margin={{ top: 8, right: 8, left: 16, bottom: 0 }}>
                <CartesianGrid stroke={chartGrid} horizontal={false} />
                <XAxis type="number" tickFormatter={(value) => `${value}€`} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={100} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Bar dataKey="value" name="Mouvement" fill={netColor} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel title="Plus grosses dépenses">
          <TransactionList transactions={topExpenses} categoryById={categoryById} accountById={accountById} />
        </Panel>
      </section>
    </>
  );
}

function Transactions({ userId, transactions, accounts, categories, categoryById, accountById, run }: {
  userId: number;
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  run: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [type, setType] = useState<TransactionType>('expense');
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | TransactionType>('all');
  const filteredCategories = categories.filter((c) => c.type === type || type === 'transfer');
  const filteredTransactions = transactions.filter((t) => {
    const haystack = [
      t.description,
      typeLabel(t.type),
      accountById.get(t.account_id ?? -1)?.name,
      accountById.get(t.to_account_id ?? -1)?.name,
      categoryById.get(t.category_id ?? -1)?.name,
      money(t.amount),
      String(t.amount),
      new Date(t.date).toLocaleDateString('fr-FR'),
    ].filter(Boolean).join(' ').toLowerCase();
    return (filterType === 'all' || t.type === filterType) && haystack.includes(query.trim().toLowerCase());
  });
  const txTotals = filteredTransactions.reduce((acc, t) => {
    if (t.type === 'income') acc.income += t.amount;
    if (t.type === 'expense') acc.expenses += t.amount;
    if (t.type === 'transfer') acc.transfers += t.amount;
    return acc;
  }, { income: 0, expenses: 0, transfers: 0 });

  const startEdit = (t: Transaction) => {
    setType(t.type);
    setEditing(t);
  };

  const copyTransaction = (t: Transaction) => {
    setType(t.type);
    setEditing({ ...t, id: -t.id, date: today, created_at: today });
  };

  const cancelEdit = () => {
    setEditing(null);
    setType('expense');
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = {
      account_id: numberOrNull(data.get('account_id')),
      to_account_id: type === 'transfer' ? numberOrNull(data.get('to_account_id')) : null,
      category_id: type === 'transfer' ? null : numberOrNull(data.get('category_id')),
      amount: Number(data.get('amount')),
      type,
      date: String(data.get('date')),
      description: String(data.get('description') || ''),
    };
    if (editing && editing.id > 0) {
      void run(() => api.updateTransaction(userId, editing.id, body), 'Transaction modifiée');
      cancelEdit();
    } else {
      void run(() => api.createTransaction(userId, body), editing ? 'Transaction copiée' : 'Transaction ajoutée');
      form.reset();
      setType('expense');
      setEditing(null);
    }
  };

  return (
    <section className="split">
      <Panel title={editing ? (editing.id > 0 ? 'Modifier la transaction' : 'Copier la transaction') : 'Ajouter une transaction'}>
        <form className="form" onSubmit={submit} key={editing?.id ?? 'new'}>
          <label>Type<select value={type} onChange={(e) => setType(e.target.value as TransactionType)}><option value="expense">Dépense</option><option value="income">Revenu</option><option value="transfer">Transfert</option></select></label>
          <label>Date<input name="date" type="date" defaultValue={editing ? editing.date.slice(0, 10) : today} required /></label>
          <label>Montant<input name="amount" type="number" min="0.01" step="0.01" defaultValue={editing?.amount ?? ''} required /></label>
          <label>{type === 'transfer' ? 'Depuis le compte' : 'Compte'}<select name="account_id" defaultValue={editing?.account_id ?? ''} required={type === 'transfer'}><option value="">Aucun</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          {type === 'transfer'
            ? <label>Vers le compte<select name="to_account_id" defaultValue={editing?.to_account_id ?? ''} required><option value="">Choisir...</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            : <label>Catégorie<select name="category_id" defaultValue={editing?.category_id ?? ''}><option value="">Aucune</option>{filteredCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          <label className="full">Description<input name="description" defaultValue={editing?.description ?? ''} placeholder="Ex: Carrefour, salaire, loyer..." /></label>
          <button className="primary"><Plus size={16} /> {editing ? (editing.id > 0 ? 'Enregistrer' : 'Créer la copie') : 'Ajouter'}</button>
          {editing && <button type="button" className="secondary" onClick={cancelEdit}>Annuler</button>}
        </form>
      </Panel>
      <Panel title="Historique du mois">
        <div className="table-tools">
          <div className="search-box inline">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher date, compte, catégorie..." />
          </div>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as 'all' | TransactionType)}>
            <option value="all">Tous les types</option>
            <option value="expense">Dépenses</option>
            <option value="income">Revenus</option>
            <option value="transfer">Transferts</option>
          </select>
        </div>
        <div className="tx-summary">
          <span><strong>{filteredTransactions.length}</strong> lignes</span>
          <span className="income">+ {money(txTotals.income)}</span>
          <span className="expense">- {money(txTotals.expenses)}</span>
          <span className="transfer">{money(txTotals.transfers)} transférés</span>
        </div>
        <TransactionsTable
          transactions={filteredTransactions}
          categoryById={categoryById}
          accountById={accountById}
          onEdit={startEdit}
          onCopy={copyTransaction}
          onDelete={(t) => void run(() => api.deleteTransaction(userId, t.id), 'Transaction supprimée')}
        />
      </Panel>
    </section>
  );
}

function Accounts({ userId, accounts, institutions, snapshots, institutionById, run }: { userId: number; accounts: Account[]; institutions: Institution[]; snapshots: AccountSnapshot[]; institutionById: Map<number, Institution>; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createAccount(userId, {
      institution_id: numberOrNull(data.get('institution_id')),
      name: String(data.get('name')),
      type: String(data.get('type')) as Account['type'],
      currency: String(data.get('currency') || 'EUR'),
      initial_balance: Number(data.get('initial_balance') || 0),
      initial_balance_date: String(data.get('initial_balance_date')),
    }));
    event.currentTarget.reset();
  };

  const submitInstitution = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createInstitution(userId, { name: String(data.get('name')) }), 'Institution ajoutée');
    event.currentTarget.reset();
  };

  const submitSnapshot = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.setSnapshot(userId, { account_id: Number(data.get('account_id')), date: String(data.get('date')), balance: Number(data.get('balance')) }), 'Snapshot enregistré');
    event.currentTarget.reset();
  };

  return (
    <section className="split">
      <div className="stack">
        <Panel title="Nouvelle institution">
          <form className="form" onSubmit={submitInstitution}>
            <label>Nom<input name="name" required placeholder="Banque, broker, caisse..." /></label>
            <button className="primary">Ajouter</button>
          </form>
        </Panel>
        <Panel title="Nouveau compte">
          <form className="form" onSubmit={submit}>
            <label>Institution<select name="institution_id"><option value="">Aucune</option>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
            <label>Nom<input name="name" required /></label>
            <label>Type<select name="type"><option value="checking">Courant</option><option value="savings">Épargne</option><option value="cash">Espèces</option><option value="other">Autre</option></select></label>
            <label>Devise<input name="currency" defaultValue="EUR" maxLength={3} required /></label>
            <label>Solde initial<input name="initial_balance" type="number" step="0.01" defaultValue="0" /></label>
            <label>Date initiale<input name="initial_balance_date" type="date" defaultValue={today} required /></label>
            <button className="primary"><Landmark size={16} /> Ajouter</button>
          </form>
        </Panel>
        <Panel title="Snapshot de solde">
          <form className="form" onSubmit={submitSnapshot}>
            <label>Compte<select name="account_id" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label>Date<input name="date" type="date" defaultValue={today} required /></label>
            <label>Solde<input name="balance" type="number" step="0.01" required /></label>
            <button className="primary">Enregistrer</button>
          </form>
        </Panel>
      </div>
      <div className="stack">
        <Panel title="Comptes">
          <DataTable empty={accounts.length === 0 ? 'Aucun compte.' : null}>
            <thead><tr><th>Compte</th><th>Institution</th><th>Type</th><th>Devise</th><th className="amount-cell">Solde initial</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.name}</strong><span>Depuis le {new Date(a.initial_balance_date).toLocaleDateString('fr-FR')}</span></td>
                  <td>{institutionById.get(a.institution_id ?? -1)?.name ?? 'Sans institution'}</td>
                  <td>{a.type}</td>
                  <td>{a.currency}</td>
                  <td className="amount-cell">{money(a.initial_balance)}</td>
                  <td className="actions-cell"><IconButton label="Supprimer" confirm={`Supprimer le compte « ${a.name} » et toutes ses transactions ?`} onClick={() => void run(() => api.deleteAccount(userId, a.id), 'Compte supprimé')} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
        <Panel title="Institutions">
          <DataTable empty={institutions.length === 0 ? 'Aucune institution.' : null}>
            <thead><tr><th>Nom</th><th>Créée le</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {institutions.map((i) => (
                <tr key={i.id}>
                  <td><strong>{i.name}</strong></td>
                  <td>{new Date(i.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="actions-cell"><IconButton label="Supprimer" confirm={`Supprimer l'institution « ${i.name} » ?`} onClick={() => void run(() => api.deleteInstitution(userId, i.id), 'Institution supprimée')} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
        <Panel title="Snapshots récents">
          <DataTable empty={snapshots.length === 0 ? 'Aucun snapshot.' : null}>
            <thead><tr><th>Date</th><th>Compte</th><th className="amount-cell">Solde</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {snapshots.slice(0, 8).map((s) => {
                const account = accounts.find((a) => a.id === s.account_id);
                return (
                  <tr key={s.id}>
                    <td>{new Date(s.date).toLocaleDateString('fr-FR')}</td>
                    <td>{account?.name ?? 'Compte'}</td>
                    <td className="amount-cell">{money(s.balance)}</td>
                    <td className="actions-cell"><IconButton label="Supprimer" onClick={() => void run(() => api.deleteSnapshot(userId, s.id), 'Snapshot supprimé')} /></td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Panel>
      </div>
    </section>
  );
}

function Categories({ userId, categories, run }: { userId: number; categories: Category[]; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createCategory(userId, { name: String(data.get('name')), type: String(data.get('type')) as Category['type'], color: String(data.get('color')), icon: String(data.get('icon') || '') }));
    event.currentTarget.reset();
  };
  return (
    <section className="split">
      <Panel title="Nouvelle catégorie">
        <form className="form" onSubmit={submit}><label>Nom<input name="name" required /></label><label>Type<select name="type"><option value="expense">Dépense</option><option value="income">Revenu</option></select></label><label>Couleur<input name="color" type="color" defaultValue="#6366f1" /></label><label>Icône<input name="icon" placeholder="shopping-cart" /></label><button className="primary"><FolderTree size={16} /> Ajouter</button></form>
      </Panel>
      <Panel title="Catégories">
        <DataTable empty={categories.length === 0 ? 'Aucune catégorie.' : null}>
          <thead><tr><th>Nom</th><th>Type</th><th>Icône</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>{categories.map((c) => <tr key={c.id}><td><span className="dot inline" style={{ background: c.color }} /><strong>{c.name}</strong></td><td><span className={`pill ${c.type}`}>{c.type === 'income' ? 'Revenu' : 'Dépense'}</span></td><td>{c.icon ?? '-'}</td><td className="actions-cell"><IconButton label="Supprimer" confirm={`Supprimer la catégorie « ${c.name} » ?`} onClick={() => void run(() => api.deleteCategory(userId, c.id), 'Catégorie supprimée')} /></td></tr>)}</tbody>
        </DataTable>
      </Panel>
    </section>
  );
}

function Budgets({ userId, month, categories, budgets, summary, run }: { userId: number; month: string; categories: Category[]; budgets: Budget[]; summary: DashboardSummary | null; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const spentByCategory = new Map((summary?.expenses_by_category ?? []).map((c) => [c.category_id, c.amount]));
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.setBudget(userId, { category_id: Number(data.get('category_id')), month, amount_limit: Number(data.get('amount_limit')) }), 'Budget enregistré');
    event.currentTarget.reset();
  };
  return (
    <section className="split">
      <Panel title={`Budget ${month}`}>
        <form className="form" onSubmit={submit}><label>Catégorie<select name="category_id" required>{expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Limite<input name="amount_limit" type="number" min="0.01" step="0.01" required /></label><button className="primary">Enregistrer</button></form>
      </Panel>
      <Panel title="Suivi">
        <DataTable empty={budgets.length === 0 ? 'Aucun budget pour ce mois.' : null}>
          <thead><tr><th>Catégorie</th><th className="amount-cell">Dépensé</th><th className="amount-cell">Limite</th><th>Progression</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {budgets.map((b) => {
              const category = categories.find((c) => c.id === b.category_id);
              const spent = spentByCategory.get(b.category_id) ?? 0;
              const pct = Math.min(100, (spent / b.amount_limit) * 100);
              return (
                <tr key={b.id}>
                  <td><strong>{category?.name ?? 'Catégorie'}</strong></td>
                  <td className="amount-cell expense">{money(spent)}</td>
                  <td className="amount-cell">{money(b.amount_limit)}</td>
                  <td><div className="bar"><span style={{ width: `${pct}%`, background: pct >= 100 ? '#dc2626' : '#4f46e5' }} /></div><span>{Math.round(pct)} %</span></td>
                  <td className="actions-cell"><IconButton label="Supprimer" onClick={() => void run(() => api.deleteBudget(userId, b.id), 'Budget supprimé')} /></td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </Panel>
    </section>
  );
}

function Recurring({ userId, recurring, accounts, categories, categoryById, accountById, run }: { userId: number; recurring: RecurringTransaction[]; accounts: Account[]; categories: Category[]; categoryById: Map<number, Category>; accountById: Map<number, Account>; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createRecurring(userId, {
      account_id: numberOrNull(data.get('account_id')),
      category_id: numberOrNull(data.get('category_id')),
      amount: Number(data.get('amount')),
      type: String(data.get('type')) as 'expense' | 'income',
      description: String(data.get('description')),
      frequency: String(data.get('frequency')) as RecurringFrequency,
      interval: Number(data.get('interval') || 1),
      day_of_month: Number(data.get('day_of_month') || 1),
      active: true,
    }));
    event.currentTarget.reset();
  };
  return (
    <section className="split">
      <Panel title="Nouvelle transaction récurrente">
        <form className="form" onSubmit={submit}><label>Description<input name="description" required /></label><label>Type<select name="type"><option value="expense">Dépense</option><option value="income">Revenu</option></select></label><label>Montant<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Fréquence<select name="frequency" defaultValue="monthly"><option value="weekly">Semaines</option><option value="monthly">Mois</option><option value="yearly">Années</option></select></label><label>Tous les<input name="interval" type="number" min="1" max="120" defaultValue="1" required /></label><label>Jour<input name="day_of_month" type="number" min="1" max="31" defaultValue="1" /></label><label>Compte<select name="account_id"><option value="">Aucun</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Catégorie<select name="category_id"><option value="">Aucune</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="primary"><CalendarClock size={16} /> Ajouter</button><button type="button" className="secondary" onClick={() => void run(() => api.generateRecurring(userId), 'Récurrents générés')}>Générer ce mois</button></form>
      </Panel>
      <Panel title="Récurrents">
        <DataTable empty={recurring.length === 0 ? 'Aucune transaction récurrente.' : null}>
          <thead><tr><th>Description</th><th>Type</th><th className="amount-cell">Montant</th><th>Fréquence</th><th>Jour</th><th>Compte</th><th>Catégorie</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>{recurring.map((r) => <tr key={r.id}><td><strong>{r.description}</strong><span>{r.active ? 'Actif' : 'Inactif'}</span></td><td><span className={`pill ${r.type}`}>{r.type === 'income' ? 'Revenu' : 'Dépense'}</span></td><td className={`amount-cell ${r.type === 'income' ? 'income' : 'expense'}`}>{r.type === 'income' ? '+' : '-'}{money(r.amount)}</td><td>{recurringFrequencyLabel(r.frequency, r.interval ?? 1)}</td><td>{r.day_of_month ?? 1}</td><td>{accountById.get(r.account_id ?? -1)?.name ?? 'Sans compte'}</td><td>{categoryById.get(r.category_id ?? -1)?.name ?? 'Sans catégorie'}</td><td className="actions-cell"><IconButton label="Supprimer" onClick={() => void run(() => api.deleteRecurring(userId, r.id), 'Récurrent supprimé')} /></td></tr>)}</tbody>
        </DataTable>
      </Panel>
    </section>
  );
}

function UsersPage({ users, currentUserId, run }: { users: User[]; currentUserId: number | null; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createUser({ name: String(data.get('name')) }), 'Utilisateur créé');
    event.currentTarget.reset();
  };

  return (
    <section className="split">
      <Panel title="Nouvel utilisateur">
        <form className="form" onSubmit={submit}>
          <label>Nom<input name="name" required placeholder="Ex: Démo, Suzanne..." /></label>
          <button className="primary"><Users size={16} /> Créer</button>
        </form>
      </Panel>
      <Panel title="Utilisateurs">
        {users.map((u) => (
          <Row
            key={u.id}
            title={`${u.name}${u.id === currentUserId ? ' · actif' : ''}`}
            detail={`Créé le ${new Date(u.created_at).toLocaleDateString('fr-FR')}`}
            onDelete={() => {
              if (window.confirm(`Supprimer ${u.name} et toutes ses données ?`)) {
                void run(() => api.deleteUser(u.id), 'Utilisateur supprimé');
              }
            }}
          />
        ))}
        {users.length === 0 && <p className="empty">Aucun utilisateur.</p>}
      </Panel>
    </section>
  );
}

function Goals({ userId, goals, run }: { userId: number; goals: SavingsGoal[]; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createGoal(userId, { name: String(data.get('name')), target_amount: Number(data.get('target_amount')), current_amount: Number(data.get('current_amount') || 0), deadline: String(data.get('deadline') || '') || null, color: String(data.get('color')) }), 'Objectif ajouté');
    event.currentTarget.reset();
  };
  return (
    <section className="split">
      <Panel title="Nouvel objectif">
        <form className="form" onSubmit={submit}><label>Nom<input name="name" required /></label><label>Cible<input name="target_amount" type="number" min="0.01" step="0.01" required /></label><label>Actuel<input name="current_amount" type="number" min="0" step="0.01" defaultValue="0" /></label><label>Échéance<input name="deadline" type="date" /></label><label>Couleur<input name="color" type="color" defaultValue="#4f46e5" /></label><button className="primary">Ajouter</button></form>
      </Panel>
      <Panel title="Objectifs">
        <DataTable empty={goals.length === 0 ? 'Aucun objectif.' : null}>
          <thead><tr><th>Objectif</th><th className="amount-cell">Actuel</th><th className="amount-cell">Cible</th><th>Progression</th><th>Échéance</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {goals.map((g) => {
              const pct = Math.min(100, (g.current_amount / g.target_amount) * 100);
              return (
                <tr key={g.id}>
                  <td><span className="dot inline" style={{ background: g.color }} /><strong>{g.name}</strong></td>
                  <td className="amount-cell">{money(g.current_amount)}</td>
                  <td className="amount-cell">{money(g.target_amount)}</td>
                  <td><div className="bar"><span style={{ width: `${pct}%`, background: g.color }} /></div><span>{Math.round(pct)} %</span></td>
                  <td>{g.deadline ? new Date(g.deadline).toLocaleDateString('fr-FR') : '-'}</td>
                  <td className="actions-cell"><IconButton label="Supprimer" onClick={() => void run(() => api.deleteGoal(userId, g.id), 'Objectif supprimé')} /></td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </Panel>
    </section>
  );
}

function Rules({ userId, rules, categories, categoryById, run }: { userId: number; rules: CategoryRule[]; categories: Category[]; categoryById: Map<number, Category>; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.setRule(userId, { pattern: String(data.get('pattern')), category_id: Number(data.get('category_id')) }), 'Règle enregistrée');
    event.currentTarget.reset();
  };
  return (
    <section className="split">
      <Panel title="Nouvelle règle">
        <form className="form" onSubmit={submit}><label>Mot-clé<input name="pattern" placeholder="CARREFOUR" required /></label><label>Catégorie<select name="category_id" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="primary">Enregistrer</button></form>
      </Panel>
      <Panel title="Règles">
        <DataTable empty={rules.length === 0 ? 'Aucune règle.' : null}>
          <thead><tr><th>Mot-clé</th><th>Catégorie</th><th>Créée le</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>{rules.map((r) => <tr key={r.id}><td><strong>{r.pattern}</strong></td><td>{categoryById.get(r.category_id)?.name ?? 'Catégorie'}</td><td>{new Date(r.created_at).toLocaleDateString('fr-FR')}</td><td className="actions-cell"><IconButton label="Supprimer" onClick={() => void run(() => api.deleteRule(userId, r.id), 'Règle supprimée')} /></td></tr>)}</tbody>
        </DataTable>
      </Panel>
    </section>
  );
}

function Tools({ userId, accounts, run }: { userId: number; accounts: Account[]; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const [csv, setCsv] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.importCsv(userId, { csv, account_id: numberOrNull(data.get('account_id')) }), 'CSV importé');
    setCsv('');
  };
  return <section className="split"><Panel title="Importer CSV"><form className="form" onSubmit={submit}><label>Compte<select name="account_id"><option value="">Aucun</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label className="full">CSV<textarea value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'date,type,amount,description\\n2026-05-24,expense,12.50,Courses'} required /></label><button className="primary">Importer</button></form></Panel><Panel title="Exporter"><div className="export-actions"><a className="secondary link-button" href={api.exportCsvUrl(userId)}>Télécharger transactions CSV</a><a className="secondary link-button" href={api.exportJsonUrl(userId)}>Télécharger sauvegarde JSON</a></div></Panel></section>;
}

function TransactionList({ transactions, categoryById, accountById }: {
  transactions: Transaction[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
}) {
  return (
    <div className="transactions">
      {transactions.map((t) => (
        <div className="tx" key={t.id}>
          <div>
            <strong>{txLabel(t, categoryById)}</strong>
            <span>{new Date(t.date).toLocaleDateString('fr-FR')} · {accountById.get(t.account_id ?? -1)?.name ?? 'Sans compte'} · {categoryById.get(t.category_id ?? -1)?.name ?? 'Sans catégorie'}</span>
          </div>
          {t.type === 'transfer'
            ? <strong className="transfer">{money(t.amount)}</strong>
            : <strong className={t.type === 'income' ? 'income' : 'expense'}>{t.type === 'income' ? '+' : '-'}{money(t.amount)}</strong>}
        </div>
      ))}
      {transactions.length === 0 && <p className="empty">Aucune transaction.</p>}
    </div>
  );
}

function DataTable({ children, empty }: { children: React.ReactNode; empty: string | null }) {
  if (empty) return <p className="empty">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="tx-table">{children}</table>
    </div>
  );
}

function TransactionsTable({ transactions, categoryById, accountById, onEdit, onCopy, onDelete }: {
  transactions: Transaction[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  onEdit: (transaction: Transaction) => void;
  onCopy: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}) {
  if (transactions.length === 0) return <p className="empty">Aucune transaction sur ce mois.</p>;
  return (
    <div className="table-wrap">
      <table className="tx-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Libellé</th>
            <th>Type</th>
            <th>Compte</th>
            <th>Catégorie</th>
            <th className="amount-cell">Montant</th>
            <th className="actions-cell">Actions</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const source = accountById.get(t.account_id ?? -1)?.name ?? 'Sans compte';
            const destination = accountById.get(t.to_account_id ?? -1)?.name ?? 'Sans compte';
            const category = categoryById.get(t.category_id ?? -1);
            return (
              <tr key={t.id}>
                <td className="nowrap">{new Date(t.date).toLocaleDateString('fr-FR')}</td>
                <td>
                  <strong>{txLabel(t, categoryById)}</strong>
                  {t.description && category?.name && <span>{category.name}</span>}
                </td>
                <td><span className={`pill ${t.type}`}>{typeLabel(t.type)}</span></td>
                <td>{t.type === 'transfer' ? `${source} -> ${destination}` : source}</td>
                <td>{t.type === 'transfer' ? 'Transfert' : category?.name ?? 'Sans catégorie'}</td>
                <td className={`amount-cell ${t.type === 'income' ? 'income' : t.type === 'expense' ? 'expense' : 'transfer'}`}>
                  {t.type === 'transfer' ? '' : t.type === 'income' ? '+' : '-'}{money(t.amount)}
                </td>
                <td className="actions-cell">
                  <IconButton label="Copier" tone="neutral" icon={<Copy size={16} />} onClick={() => onCopy(t)} />
                  <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => onEdit(t)} />
                  <IconButton label="Supprimer" confirm="Supprimer cette transaction ?" onClick={() => onDelete(t)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="panel"><h2>{title}</h2>{children}</div>;
}

function Stat({ icon, label, value, positive, negative }: { icon: React.ReactNode; label: string; value: string; positive?: boolean; negative?: boolean }) {
  return <div className="stat"><div className="stat-icon">{icon}</div><span>{label}</span><strong className={positive ? 'income' : negative ? 'expense' : ''}>{value}</strong></div>;
}

function Row({ title, detail, onDelete, confirm }: { title: string; detail: string; onDelete: () => void; confirm?: string }) {
  return <div className="row"><div><strong>{title}</strong><span>{detail}</span></div><IconButton label="Supprimer" confirm={confirm} onClick={onDelete} /></div>;
}

function IconButton({ label, onClick, icon, confirm, tone = 'danger' }: { label: string; onClick: () => void; icon?: React.ReactNode; confirm?: string; tone?: 'danger' | 'neutral' }) {
  const handle = () => { if (!confirm || window.confirm(confirm)) onClick(); };
  return <button className={tone === 'neutral' ? 'icon-button neutral' : 'icon-button'} aria-label={label} title={label} onClick={handle}>{icon ?? <Trash2 size={16} />}</button>;
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
