import { useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Euro, Wallet } from 'lucide-react';
import type { Category, DashboardSummary, Transaction, User } from '@suzanne-lite/shared';
import { api } from './lib/api';

const currentMonth = new Date().toISOString().slice(0, 7);

function money(value: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
}

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  const [month, setMonth] = useState(currentMonth);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.users().then((rows) => {
      setUsers(rows);
      setUserId(rows[0]?.id ?? null);
    }).catch((e) => setError((e as Error).message));
  }, []);

  useEffect(() => {
    if (!userId) return;
    Promise.all([api.dashboard(userId, month), api.transactions(userId, month), api.categories(userId)])
      .then(([dash, txs, cats]) => { setSummary(dash); setTransactions(txs); setCategories(cats); })
      .catch((e) => setError((e as Error).message));
  }, [userId, month]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Suzanne Lite</p>
          <h1>Suivi quotidien</h1>
        </div>
        <div className="toolbar">
          <select value={userId ?? ''} onChange={(e) => setUserId(Number(e.target.value))}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="stats">
        <Stat icon={<Wallet />} label="Solde" value={money(summary?.balance ?? 0)} />
        <Stat icon={<ArrowUpCircle />} label="Revenus" value={money(summary?.income ?? 0)} positive />
        <Stat icon={<ArrowDownCircle />} label="Dépenses" value={money(summary?.expenses ?? 0)} negative />
        <Stat icon={<Euro />} label="Net mensuel" value={money(summary?.net ?? 0)} />
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Dépenses par catégorie</h2>
          <div className="category-list">
            {(summary?.expenses_by_category ?? []).map((row) => (
              <div className="category-row" key={row.category_id ?? 'none'}>
                <span className="dot" style={{ background: row.color }} />
                <span>{row.name}</span>
                <strong>{money(row.amount)}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h2>Transactions</h2>
          <div className="transactions">
            {transactions.map((t) => {
              const category = t.category_id ? categoryById.get(t.category_id) : null;
              return (
                <div className="tx" key={t.id}>
                  <div>
                    <strong>{t.description || category?.name || 'Transaction'}</strong>
                    <span>{new Date(t.date).toLocaleDateString('fr-FR')} · {category?.name ?? 'Sans catégorie'}</span>
                  </div>
                  <strong className={t.type === 'income' ? 'income' : 'expense'}>
                    {t.type === 'income' ? '+' : '-'}{money(t.amount)}
                  </strong>
                </div>
              );
            })}
            {transactions.length === 0 && <p className="empty">Aucune transaction sur ce mois.</p>}
          </div>
        </div>
      </section>
    </main>
  );
}

function Stat({ icon, label, value, positive, negative }: { icon: React.ReactNode; label: string; value: string; positive?: boolean; negative?: boolean }) {
  return <div className="stat"><div className="stat-icon">{icon}</div><span>{label}</span><strong className={positive ? 'income' : negative ? 'expense' : ''}>{value}</strong></div>;
}
