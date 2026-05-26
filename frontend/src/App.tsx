import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  CalendarClock,
  CreditCard,
  Database,
  Euro,
  FolderTree,
  Landmark,
  LayoutDashboard,
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
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
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

function money(value: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
}

function formatMonth(month: string) {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(date);
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Database size={22} /></div>
          <div>
            <strong>Suzanne</strong>
            <span>Finance quotidienne</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Navigation principale">
          {navItems.map((item) => (
            <TabButton key={item.tab} tab={item.tab} current={tab} setTab={setTab} label={item.label} icon={item.icon} />
          ))}
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div className="topbar-title">
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
        <Dashboard summary={summary} transactions={transactions} categoryById={categoryById} />
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

function Dashboard({ summary, transactions, categoryById }: { summary: DashboardSummary | null; transactions: Transaction[]; categoryById: Map<number, Category> }) {
  const monthRows = (summary?.monthly_cashflow ?? []).map((row) => ({
    ...row,
    label: formatMonth(row.month),
  }));
  const yearRows = summary?.yearly_cashflow ?? [];
  const categoryRows = summary?.expenses_by_category ?? [];
  const savingRate = summary && summary.income > 0 ? Math.round((summary.net / summary.income) * 100) : 0;

  return (
    <>
      <section className="stats">
        <Stat icon={<Wallet />} label="Solde estimé" value={money(summary?.balance ?? 0)} />
        <Stat icon={<ArrowUpCircle />} label="Revenus" value={money(summary?.income ?? 0)} positive />
        <Stat icon={<ArrowDownCircle />} label="Dépenses" value={money(summary?.expenses ?? 0)} negative />
        <Stat icon={<Euro />} label="Net mensuel" value={money(summary?.net ?? 0)} />
        <Stat icon={<BarChart3 />} label="Taux d'épargne" value={`${savingRate}%`} />
      </section>

      <section className="charts-grid">
        <Panel title="Cashflow mensuel">
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={chartGrid} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `${value}€`} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(value) => money(Number(value))} />
                <Legend />
                <Bar dataKey="income" name="Revenus" fill={incomeColor} radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name="Dépenses" fill={expenseColor} radius={[4, 4, 0, 0]} />
              </BarChart>
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
        <Panel title="Dernières transactions">
          <TransactionList transactions={transactions.slice(0, 8)} categoryById={categoryById} />
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
  const filteredCategories = categories.filter((c) => c.type === type || type === 'transfer');

  const startEdit = (t: Transaction) => {
    setType(t.type);
    setEditing(t);
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
    if (editing) {
      void run(() => api.updateTransaction(userId, editing.id, body), 'Transaction modifiée');
      cancelEdit();
    } else {
      void run(() => api.createTransaction(userId, body));
      form.reset();
      setType('expense');
    }
  };

  return (
    <section className="split">
      <Panel title={editing ? 'Modifier la transaction' : 'Ajouter une transaction'}>
        <form className="form" onSubmit={submit} key={editing?.id ?? 'new'}>
          <label>Type<select value={type} onChange={(e) => setType(e.target.value as TransactionType)}><option value="expense">Dépense</option><option value="income">Revenu</option><option value="transfer">Transfert</option></select></label>
          <label>Date<input name="date" type="date" defaultValue={editing ? editing.date.slice(0, 10) : today} required /></label>
          <label>Montant<input name="amount" type="number" min="0.01" step="0.01" defaultValue={editing?.amount ?? ''} required /></label>
          <label>{type === 'transfer' ? 'Depuis le compte' : 'Compte'}<select name="account_id" defaultValue={editing?.account_id ?? ''} required={type === 'transfer'}><option value="">Aucun</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          {type === 'transfer'
            ? <label>Vers le compte<select name="to_account_id" defaultValue={editing?.to_account_id ?? ''} required><option value="">Choisir...</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            : <label>Catégorie<select name="category_id" defaultValue={editing?.category_id ?? ''}><option value="">Aucune</option>{filteredCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
          <label className="full">Description<input name="description" defaultValue={editing?.description ?? ''} placeholder="Ex: Carrefour, salaire, loyer..." /></label>
          <button className="primary"><Plus size={16} /> {editing ? 'Enregistrer' : 'Ajouter'}</button>
          {editing && <button type="button" className="secondary" onClick={cancelEdit}>Annuler</button>}
        </form>
      </Panel>
      <Panel title="Historique du mois">
        <div className="transactions">
          {transactions.map((t) => (
            <div className="tx" key={t.id}>
              <div>
                <strong>{t.description || (t.type === 'transfer' ? 'Transfert' : categoryById.get(t.category_id ?? -1)?.name) || 'Transaction'}</strong>
                <span>{new Date(t.date).toLocaleDateString('fr-FR')} · {t.type === 'transfer'
                  ? `${accountById.get(t.account_id ?? -1)?.name ?? 'Sans compte'} → ${accountById.get(t.to_account_id ?? -1)?.name ?? 'Sans compte'}`
                  : `${accountById.get(t.account_id ?? -1)?.name ?? 'Sans compte'} · ${categoryById.get(t.category_id ?? -1)?.name ?? 'Sans catégorie'}`}</span>
              </div>
              {t.type === 'transfer'
                ? <strong className="transfer">{money(t.amount)}</strong>
                : <strong className={t.type === 'income' ? 'income' : 'expense'}>{t.type === 'income' ? '+' : '-'}{money(t.amount)}</strong>}
              <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => startEdit(t)} />
              <IconButton label="Supprimer" confirm="Supprimer cette transaction ?" onClick={() => void run(() => api.deleteTransaction(userId, t.id), 'Transaction supprimée')} />
            </div>
          ))}
          {transactions.length === 0 && <p className="empty">Aucune transaction sur ce mois.</p>}
        </div>
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

  return <section className="split"><div className="stack"><Panel title="Nouvelle institution"><form className="form" onSubmit={submitInstitution}><label>Nom<input name="name" required placeholder="Banque, broker, caisse..." /></label><button className="primary">Ajouter</button></form></Panel><Panel title="Nouveau compte"><form className="form" onSubmit={submit}><label>Institution<select name="institution_id"><option value="">Aucune</option>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label><label>Nom<input name="name" required /></label><label>Type<select name="type"><option value="checking">Courant</option><option value="savings">Épargne</option><option value="cash">Espèces</option><option value="other">Autre</option></select></label><label>Devise<input name="currency" defaultValue="EUR" maxLength={3} required /></label><label>Solde initial<input name="initial_balance" type="number" step="0.01" defaultValue="0" /></label><label>Date initiale<input name="initial_balance_date" type="date" defaultValue={today} required /></label><button className="primary"><Landmark size={16} /> Ajouter</button></form></Panel><Panel title="Snapshot de solde"><form className="form" onSubmit={submitSnapshot}><label>Compte<select name="account_id" required>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Date<input name="date" type="date" defaultValue={today} required /></label><label>Solde<input name="balance" type="number" step="0.01" required /></label><button className="primary">Enregistrer</button></form></Panel></div><Panel title="Comptes">{accounts.map((a) => <Row key={a.id} title={a.name} detail={`${institutionById.get(a.institution_id ?? -1)?.name ?? 'Sans institution'} · ${a.type} · ${a.currency} · initial ${money(a.initial_balance)}`} confirm={`Supprimer le compte « ${a.name} » et toutes ses transactions ?`} onDelete={() => void run(() => api.deleteAccount(userId, a.id), 'Compte supprimé')} />)}{accounts.length === 0 && <p className="empty">Aucun compte.</p>}<h2 className="subheading">Institutions</h2>{institutions.map((i) => <Row key={i.id} title={i.name} detail="Institution bancaire" confirm={`Supprimer l'institution « ${i.name} » ?`} onDelete={() => void run(() => api.deleteInstitution(userId, i.id), 'Institution supprimée')} />)}<h2 className="subheading">Snapshots</h2>{snapshots.slice(0, 8).map((s) => <Row key={s.id} title={`${institutionById.get(accounts.find((a) => a.id === s.account_id)?.institution_id ?? -1)?.name ?? accounts.find((a) => a.id === s.account_id)?.name ?? 'Compte'} · ${money(s.balance)}`} detail={new Date(s.date).toLocaleDateString('fr-FR')} onDelete={() => void run(() => api.deleteSnapshot(userId, s.id), 'Snapshot supprimé')} />)}</Panel></section>;
}

function Categories({ userId, categories, run }: { userId: number; categories: Category[]; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createCategory(userId, { name: String(data.get('name')), type: String(data.get('type')) as Category['type'], color: String(data.get('color')), icon: String(data.get('icon') || '') }));
    event.currentTarget.reset();
  };
  return <section className="split"><Panel title="Nouvelle catégorie"><form className="form" onSubmit={submit}><label>Nom<input name="name" required /></label><label>Type<select name="type"><option value="expense">Dépense</option><option value="income">Revenu</option></select></label><label>Couleur<input name="color" type="color" defaultValue="#6366f1" /></label><label>Icône<input name="icon" placeholder="shopping-cart" /></label><button className="primary"><FolderTree size={16} /> Ajouter</button></form></Panel><Panel title="Catégories"><div className="category-list">{categories.map((c) => <div className="category-row" key={c.id}><span className="dot" style={{ background: c.color }} /><span>{c.name} · {c.type === 'income' ? 'revenu' : 'dépense'}</span><IconButton label="Supprimer" confirm={`Supprimer la catégorie « ${c.name} » ?`} onClick={() => void run(() => api.deleteCategory(userId, c.id), 'Catégorie supprimée')} /></div>)}</div></Panel></section>;
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
  return <section className="split"><Panel title={`Budget ${month}`}><form className="form" onSubmit={submit}><label>Catégorie<select name="category_id" required>{expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Limite<input name="amount_limit" type="number" min="0.01" step="0.01" required /></label><button className="primary">Enregistrer</button></form></Panel><Panel title="Suivi">{budgets.map((b) => { const category = categories.find((c) => c.id === b.category_id); const spent = spentByCategory.get(b.category_id) ?? 0; const pct = Math.min(100, (spent / b.amount_limit) * 100); return <div className="budget" key={b.id}><div><strong>{category?.name ?? 'Catégorie'}</strong><span>{money(spent)} / {money(b.amount_limit)}</span></div><div className="bar"><span style={{ width: `${pct}%`, background: pct >= 100 ? '#dc2626' : '#4f46e5' }} /></div><IconButton label="Supprimer" onClick={() => void run(() => api.deleteBudget(userId, b.id), 'Budget supprimé')} /></div>; })}{budgets.length === 0 && <p className="empty">Aucun budget pour ce mois.</p>}</Panel></section>;
}

function Recurring({ userId, recurring, accounts, categories, categoryById, accountById, run }: { userId: number; recurring: RecurringTransaction[]; accounts: Account[]; categories: Category[]; categoryById: Map<number, Category>; accountById: Map<number, Account>; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createRecurring(userId, { account_id: numberOrNull(data.get('account_id')), category_id: numberOrNull(data.get('category_id')), amount: Number(data.get('amount')), type: String(data.get('type')) as 'expense' | 'income', description: String(data.get('description')), frequency: 'monthly', day_of_month: Number(data.get('day_of_month') || 1), active: true }));
    event.currentTarget.reset();
  };
  return <section className="split"><Panel title="Nouvelle transaction récurrente"><form className="form" onSubmit={submit}><label>Description<input name="description" required /></label><label>Type<select name="type"><option value="expense">Dépense</option><option value="income">Revenu</option></select></label><label>Montant<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Jour du mois<input name="day_of_month" type="number" min="1" max="31" defaultValue="1" /></label><label>Compte<select name="account_id"><option value="">Aucun</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>Catégorie<select name="category_id"><option value="">Aucune</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="primary"><CalendarClock size={16} /> Ajouter</button><button type="button" className="secondary" onClick={() => void run(() => api.generateRecurring(userId), 'Récurrents générés')}>Générer ce mois</button></form></Panel><Panel title="Récurrents">{recurring.map((r) => <Row key={r.id} title={`${r.description} · ${money(r.amount)}`} detail={`${r.type === 'income' ? 'Revenu' : 'Dépense'} · jour ${r.day_of_month ?? 1} · ${accountById.get(r.account_id ?? -1)?.name ?? 'sans compte'} · ${categoryById.get(r.category_id ?? -1)?.name ?? 'sans catégorie'}`} onDelete={() => void run(() => api.deleteRecurring(userId, r.id), 'Récurrent supprimé')} />)}{recurring.length === 0 && <p className="empty">Aucune transaction récurrente.</p>}</Panel></section>;
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
  return <section className="split"><Panel title="Nouvel objectif"><form className="form" onSubmit={submit}><label>Nom<input name="name" required /></label><label>Cible<input name="target_amount" type="number" min="0.01" step="0.01" required /></label><label>Actuel<input name="current_amount" type="number" min="0" step="0.01" defaultValue="0" /></label><label>Échéance<input name="deadline" type="date" /></label><label>Couleur<input name="color" type="color" defaultValue="#4f46e5" /></label><button className="primary">Ajouter</button></form></Panel><Panel title="Objectifs">{goals.map((g) => { const pct = Math.min(100, (g.current_amount / g.target_amount) * 100); return <div className="budget" key={g.id}><div><strong>{g.name}</strong><span>{money(g.current_amount)} / {money(g.target_amount)}{g.deadline ? ` · ${new Date(g.deadline).toLocaleDateString('fr-FR')}` : ''}</span></div><div className="bar"><span style={{ width: `${pct}%`, background: g.color }} /></div><IconButton label="Supprimer" onClick={() => void run(() => api.deleteGoal(userId, g.id), 'Objectif supprimé')} /></div>; })}{goals.length === 0 && <p className="empty">Aucun objectif.</p>}</Panel></section>;
}

function Rules({ userId, rules, categories, categoryById, run }: { userId: number; rules: CategoryRule[]; categories: Category[]; categoryById: Map<number, Category>; run: (fn: () => Promise<unknown>, message?: string) => Promise<void> }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.setRule(userId, { pattern: String(data.get('pattern')), category_id: Number(data.get('category_id')) }), 'Règle enregistrée');
    event.currentTarget.reset();
  };
  return <section className="split"><Panel title="Nouvelle règle"><form className="form" onSubmit={submit}><label>Mot-clé<input name="pattern" placeholder="CARREFOUR" required /></label><label>Catégorie<select name="category_id" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button className="primary">Enregistrer</button></form></Panel><Panel title="Règles">{rules.map((r) => <Row key={r.id} title={r.pattern} detail={categoryById.get(r.category_id)?.name ?? 'Catégorie'} onDelete={() => void run(() => api.deleteRule(userId, r.id), 'Règle supprimée')} />)}{rules.length === 0 && <p className="empty">Aucune règle.</p>}</Panel></section>;
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

function TransactionList({ transactions, categoryById }: { transactions: Transaction[]; categoryById: Map<number, Category> }) {
  return <div className="transactions">{transactions.map((t) => <div className="tx" key={t.id}><div><strong>{t.description || categoryById.get(t.category_id ?? -1)?.name || 'Transaction'}</strong><span>{new Date(t.date).toLocaleDateString('fr-FR')} · {categoryById.get(t.category_id ?? -1)?.name ?? 'Sans catégorie'}</span></div><strong className={t.type === 'income' ? 'income' : 'expense'}>{t.type === 'income' ? '+' : '-'}{money(t.amount)}</strong></div>)}{transactions.length === 0 && <p className="empty">Aucune transaction.</p>}</div>;
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
