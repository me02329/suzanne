import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownCircle, ArrowLeft, ArrowUpCircle, Landmark, Loader2, Wallet } from 'lucide-react';
import {
  LIVRET_CEILINGS,
  accountTypeLabel,
  type Account,
  type AccountSnapshot,
  type Category,
  type DashboardSummary,
  type Transaction,
} from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { formatMonth, money as moneyFmt, moneyCompact as moneyCompactFmt } from '../lib/format';
import { useChartTheme } from '../lib/chartTheme';
import { usePersistedState } from '../lib/storage';
import { accountSignedAmount, touchesAccount } from '../lib/account';
import { DataTable } from '../components/DataTable';
import { EmptyChart } from '../components/EmptyChart';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';

const RANGES: Array<{ value: string; label: string }> = [
  { value: '6m', label: '6 mois' },
  { value: '12m', label: '12 mois' },
  { value: 'ytd', label: 'Depuis janvier' },
  { value: 'all', label: 'Tout' },
];

export function AccountDetail({ userId, accounts, summary, snapshots, categoryById, reportCurrency }: {
  userId: number;
  accounts: Account[];
  summary: DashboardSummary | null;
  snapshots: AccountSnapshot[];
  categoryById: Map<number, Category>;
  reportCurrency: string;
}) {
  const params = useParams();
  const accountId = Number(params.id);
  const account = accounts.find((a) => a.id === accountId);

  const [range, setRange] = usePersistedState('account_detail_range', '12m');
  const [history, setHistory] = useState<{ date: string; balance: number }[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const chartTheme = useChartTheme();

  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, displayCurrency);
  const moneyCompact = (value: number) => moneyCompactFmt(value, displayCurrency);
  const nativeMoney = (value: number) => moneyFmt(value, account?.currency ?? displayCurrency);

  // Balance-over-time series, extracted from the per-account wealth history.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    api.wealthHistory(userId, range, 'month', reportCurrency)
      .then((points) => {
        if (cancelled) return;
        setHistory(points.map((p) => ({ date: p.date, balance: p.by_account[account.id] ?? 0 })));
      })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [userId, account, range, reportCurrency]);

  // All-time transactions touching this account (one fetch, filtered client-side).
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setLoading(true);
    api.transactions(userId)
      .then((all) => { if (!cancelled) setTransactions(all.filter((t) => touchesAccount(t, account.id))); })
      .catch(() => { if (!cancelled) setTransactions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, account]);

  const { inflow, outflow, recent } = useMemo(() => {
    if (!account) return { inflow: 0, outflow: 0, recent: [] as Array<{ tx: Transaction; signed: number }> };
    let inflow = 0;
    let outflow = 0;
    const rows = transactions
      .map((tx) => ({ tx, signed: accountSignedAmount(tx, account.id) }))
      .filter((r) => r.signed !== 0);
    for (const r of rows) {
      if (r.signed > 0) inflow += r.signed; else outflow += -r.signed;
    }
    rows.sort((a, b) => b.tx.date.localeCompare(a.tx.date) || b.tx.id - a.tx.id);
    return { inflow, outflow, recent: rows.slice(0, 40) };
  }, [transactions, account]);

  if (!account) {
    return (
      <section className="stack">
        <Link className="ghost-button back-link" to="/accounts"><ArrowLeft size={16} /> Retour aux comptes</Link>
        <p className="empty">Compte introuvable.</p>
      </section>
    );
  }

  const balanceRow = summary?.account_balances.find((a) => a.account_id === account.id);
  const currentBalance = balanceRow?.signed_balance ?? account.initial_balance;
  const ceiling = LIVRET_CEILINGS[account.type];
  const showCeiling = ceiling != null && reportCurrency === 'EUR';
  const ceilingPct = ceiling ? Math.min(100, (currentBalance / ceiling) * 100) : 0;
  const accountSnapshots = snapshots.filter((s) => s.account_id === account.id);
  const chartData = history.map((p) => ({ ...p, label: formatMonth(p.date.slice(0, 7)) }));

  return (
    <section className="stack">
      <Link className="ghost-button back-link" to="/accounts"><ArrowLeft size={16} /> Retour aux comptes</Link>

      <Panel title={account.name} icon={<Landmark />}>
        <p className="panel-note">{accountTypeLabel(account.type)} · {account.currency} · ouvert le {new Date(account.initial_balance_date).toLocaleDateString('fr-FR')}</p>
        {showCeiling && (
          <div className="account-ceiling">
            <div className="account-ceiling-head">
              <span>Plafond {accountTypeLabel(account.type)}</span>
              <span>{money(currentBalance)} / {money(ceiling!)}</span>
            </div>
            <div className="bar"><span style={{ width: `${ceilingPct}%`, background: ceilingPct >= 100 ? 'var(--expense)' : 'var(--accent)' }} /></div>
            <span className="panel-note">{ceilingPct >= 100 ? 'Plafond atteint.' : `${money(ceiling! - currentBalance)} encore versables.`}</span>
          </div>
        )}
      </Panel>

      <section className="stats">
        <Stat icon={<Wallet />} label="Solde actuel" value={money(currentBalance)} signed={currentBalance} />
        <Stat icon={<ArrowUpCircle />} label="Total entrées" value={nativeMoney(inflow)} positive />
        <Stat icon={<ArrowDownCircle />} label="Total sorties" value={nativeMoney(outflow)} negative />
      </section>

      <section className="chart-full">
        <Panel
          title="Évolution du solde"
          icon={<Wallet />}
          action={(
            <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Plage de l'historique">
              {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          )}
        >
          <div className="chart-area">
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="accountFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartTheme.net} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={chartTheme.net} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis tickFormatter={(v) => moneyCompact(Number(v))} tickLine={false} axisLine={false} width={64} />
                  <Tooltip formatter={(v) => money(Number(v))} />
                  <Area type="monotone" dataKey="balance" name="Solde" stroke={chartTheme.net} strokeWidth={2} fill="url(#accountFill)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Pas encore d'historique de solde pour ce compte. Saisis des snapshots de fin de mois pour l'alimenter." />
            )}
          </div>
        </Panel>
      </section>

      <section className="chart-full">
        <Panel title="Mouvements récents" icon={<Landmark />}>
          <DataTable empty={loading ? null : recent.length === 0 ? 'Aucun mouvement sur ce compte.' : null}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Libellé</th>
                <th>Catégorie</th>
                <th className="amount-cell">Montant</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(({ tx, signed }) => {
                const category = tx.category_id != null ? categoryById.get(tx.category_id) : null;
                const label = tx.description || (tx.type === 'transfer' ? 'Transfert' : category?.name) || 'Mouvement';
                return (
                  <tr key={tx.id}>
                    <td data-label="Date">{new Date(tx.date).toLocaleDateString('fr-FR')}</td>
                    <td data-label="Libellé"><strong>{label}</strong></td>
                    <td data-label="Catégorie">{category?.name ?? <span className="muted">—</span>}</td>
                    <td className={`amount-cell ${signed >= 0 ? 'income' : 'expense'}`} data-label="Montant">
                      {signed >= 0 ? '+' : '-'}{nativeMoney(Math.abs(signed))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
          {loading && <p className="empty"><Loader2 className="spin-icon" size={16} /> Chargement des mouvements…</p>}
        </Panel>
      </section>

      {accountSnapshots.length > 0 && (
        <section className="chart-full">
          <Panel title="Snapshots de solde" icon={<Wallet />}>
            <DataTable empty={null}>
              <thead><tr><th>Date</th><th className="amount-cell">Solde relevé</th></tr></thead>
              <tbody>
                {accountSnapshots.slice(0, 24).map((s) => (
                  <tr key={s.id}>
                    <td data-label="Date">{new Date(s.date).toLocaleDateString('fr-FR')}</td>
                    <td className="amount-cell" data-label="Solde relevé">{nativeMoney(s.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </Panel>
        </section>
      )}
    </section>
  );
}
