import { FormEvent, useEffect, useMemo, useState } from 'react';
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
import { ArrowDownCircle, ArrowLeft, ArrowUpCircle, CheckCircle2, Landmark, Loader2, Plus, Wallet } from 'lucide-react';
import {
  accountTypeLabel,
  type Account,
  type AccountSnapshot,
  type Category,
  type DashboardSummary,
  type Transaction,
} from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { formatMonth, money as moneyFmt, moneyCompact as moneyCompactFmt, todayIso } from '../lib/format';
import { useChartTheme } from '../lib/chartTheme';
import { usePersistedState } from '../lib/storage';
import { accountSignedAmount, livretCeiling } from '../lib/account';
import { fitDomain, symlogConstant, symlogInverse, toBase100, toSymlog, type ChartScaleMode } from '../lib/chartScale';
import { DataTable } from '../components/DataTable';
import { EmptyChart } from '../components/EmptyChart';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';
import { Stat } from '../components/Stat';

import type { Run } from '../lib/run';

const RANGES: Array<{ value: string; label: string }> = [
  { value: '6m', label: '6 mois' },
  { value: '12m', label: '12 mois' },
  { value: 'ytd', label: 'Depuis janvier' },
  { value: 'all', label: 'Tout' },
  { value: 'custom', label: 'Personnalisé' },
];

export function AccountDetail({ userId, accounts, summary, snapshots, categoryById, reportCurrency, run }: {
  userId: number;
  accounts: Account[];
  summary: DashboardSummary | null;
  snapshots: AccountSnapshot[];
  categoryById: Map<number, Category>;
  reportCurrency: string;
  run: Run;
}) {
  const params = useParams();
  const accountId = Number(params.id);
  const account = accounts.find((a) => a.id === accountId);

  const [range, setRange] = usePersistedState('account_detail_range', '12m');
  // Custom range bounds (persisted), used only when range === 'custom'. Empty
  // means open — from falls back to the earliest data, to to today.
  const [rangeFrom, setRangeFrom] = usePersistedState('account_detail_from', '');
  const [rangeTo, setRangeTo] = usePersistedState('account_detail_to', '');
  const [scaleMode, setScaleMode] = usePersistedState<ChartScaleMode>('account_detail_scale_mode', 'linear');
  const [history, setHistory] = useState<{ date: string; balance: number }[]>([]);
  const [activity, setActivity] = useState<{ inflow: number; outflow: number; cleared_balance: number; uncleared_count: number; recent: Transaction[] }>({ inflow: 0, outflow: 0, cleared_balance: 0, uncleared_count: 0, recent: [] });
  const [loading, setLoading] = useState(true);
  // Rapprochement : solde du relevé bancaire saisi par l'utilisateur (local,
  // non persisté — il change à chaque relevé).
  const [statementBalance, setStatementBalance] = useState('');
  const chartTheme = useChartTheme();

  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (value: number) => moneyFmt(value, displayCurrency);
  const moneyCompact = (value: number) => moneyCompactFmt(value, displayCurrency);
  const nativeMoney = (value: number) => moneyFmt(value, account?.currency ?? displayCurrency);

  // Balance-over-time series, extracted from the per-account wealth history.
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    const from = range === 'custom' ? rangeFrom : undefined;
    const to = range === 'custom' ? rangeTo : undefined;
    api.wealthHistory(userId, range, 'month', reportCurrency, from, to)
      .then((points) => {
        if (cancelled) return;
        setHistory(points.map((p) => ({ date: p.date, balance: p.by_account[account.id] ?? 0 })));
      })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [userId, account, range, reportCurrency, rangeFrom, rangeTo]);

  // Inflow/outflow totals + recent movements, computed server-side and scoped to
  // this account (no longer fetches every user transaction to filter on screen).
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setLoading(true);
    api.accountActivity(userId, account.id, 40)
      .then((a) => { if (!cancelled) setActivity(a); })
      .catch(() => { if (!cancelled) setActivity({ inflow: 0, outflow: 0, cleared_balance: 0, uncleared_count: 0, recent: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, account]);

  const { inflow, outflow, recent } = useMemo(() => {
    if (!account) return { inflow: 0, outflow: 0, recent: [] as Array<{ tx: Transaction; signed: number }> };
    return {
      inflow: activity.inflow,
      outflow: activity.outflow,
      recent: activity.recent.map((tx) => ({ tx, signed: accountSignedAmount(tx, account.id) })),
    };
  }, [activity, account]);

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
  const ceiling = livretCeiling(account, reportCurrency);
  const showCeiling = ceiling != null;
  const ceilingPct = ceiling ? Math.min(100, (currentBalance / ceiling) * 100) : 0;
  const accountSnapshots = snapshots.filter((s) => s.account_id === account.id);
  // This account's own earliest data point — its opening date, or an older
  // back-dated snapshot if one exists. The global wealth-history can reach
  // further back (other accounts), which would pad this chart with a long flat
  // run of 0 before the account had any value; clip that off so the chart
  // starts where the account actually does.
  const accountStart = [account.initial_balance_date, ...accountSnapshots.map((s) => s.date)]
    .map((d) => d.slice(0, 10))
    .reduce((min, d) => (d < min ? d : min));
  const chartData = history
    .filter((p) => p.date.slice(0, 10) >= accountStart)
    .map((p) => ({ ...p, label: formatMonth(p.date.slice(0, 7)) }));
  const balanceValues = chartData.map((p) => p.balance).filter((v) => Number.isFinite(v));
  const effectiveScaleMode = scaleMode;
  const balanceSymlogConstant = symlogConstant(balanceValues);
  const displayedChartData = effectiveScaleMode === 'base100'
    ? toBase100(chartData, ['balance'])
    : effectiveScaleMode === 'symlog'
      ? toSymlog(chartData, ['balance'], balanceSymlogConstant)
      : chartData;
  const balanceDomain = fitDomain(displayedChartData.map((p) => p.balance).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)));
  const yTick = (value: number) =>
    effectiveScaleMode === 'base100'
      ? `${Math.round(value)}`
      : effectiveScaleMode === 'symlog'
        ? moneyCompact(symlogInverse(Number(value), balanceSymlogConstant))
        : moneyCompact(Number(value));
  const tooltipValue = (value: unknown, name: unknown, item: { payload?: Record<string, unknown> }): [string, string] => {
    if (effectiveScaleMode === 'base100') {
      const raw = item.payload?.balance__raw;
      const rawText = typeof raw === 'number' && Number.isFinite(raw) ? ` · ${money(raw)}` : '';
      return [`${Number(value).toFixed(1)}${rawText}`, String(name)];
    }
    if (effectiveScaleMode === 'symlog') {
      const raw = item.payload?.balance__raw;
      return [typeof raw === 'number' && Number.isFinite(raw) ? money(raw) : money(symlogInverse(Number(value), balanceSymlogConstant)), String(name)];
    }
    return [money(Number(value)), String(name)];
  };

  // Add a balance snapshot for *this* account alone — no need to go through the
  // end-of-month batch form on the accounts page just to record one account.
  const submitSnapshot = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => api.setSnapshot(userId, {
      account_id: account.id,
      date: String(data.get('date')),
      balance: Number(data.get('balance')),
    }), 'Relevé enregistré');
    form.reset();
  };

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
        <Stat icon={<CheckCircle2 />} label="Solde pointé" value={nativeMoney(activity.cleared_balance)} signed={activity.cleared_balance} />
        <Stat icon={<ArrowUpCircle />} label="Total entrées" value={nativeMoney(inflow)} positive />
        <Stat icon={<ArrowDownCircle />} label="Total sorties" value={nativeMoney(outflow)} negative />
      </section>

      <section className="chart-full">
        <Panel title="Rapprochement bancaire" icon={<CheckCircle2 />}>
          <p className="panel-note">
            Le solde pointé cumule le solde initial et les seules transactions pointées (✓). Saisis le solde
            de ton relevé : quand l'écart est nul, le compte est rapproché.
            {activity.uncleared_count > 0 && ` Il reste ${activity.uncleared_count} transaction${activity.uncleared_count > 1 ? 's' : ''} non pointée${activity.uncleared_count > 1 ? 's' : ''} sur ce compte.`}
          </p>
          <form className="form form-inline" onSubmit={(e) => e.preventDefault()}>
            <label className="grow">Solde du relevé ({account.currency})
              <input
                type="number"
                step="0.01"
                value={statementBalance}
                onChange={(e) => setStatementBalance(e.target.value)}
                placeholder="Ex: 1234,56"
              />
            </label>
          </form>
          {statementBalance.trim() !== '' && Number.isFinite(Number(statementBalance)) && (() => {
            const gap = Math.round((Number(statementBalance) - activity.cleared_balance) * 100) / 100;
            return gap === 0 ? (
              <p className="panel-note" style={{ color: 'var(--income)' }}>
                ✓ Compte rapproché : le solde pointé correspond au relevé.
              </p>
            ) : (
              <p className="panel-note" style={{ color: 'var(--expense)' }}>
                Écart de {nativeMoney(Math.abs(gap))} {gap > 0 ? 'manquant dans les transactions pointées' : 'en trop dans les transactions pointées'} —
                pointe les mouvements ci-dessous (ou repère une transaction manquante/doublonnée).
              </p>
            );
          })()}
        </Panel>
      </section>

      <section className="chart-full">
        <Panel
          title="Évolution du solde"
          icon={<Wallet />}
          action={(
            <div className="range-controls">
              <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Plage de l'historique">
                {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              {range === 'custom' && (
                <>
                  <input type="date" value={rangeFrom} max={rangeTo || todayIso()} onChange={(e) => setRangeFrom(e.target.value)} aria-label="Début de la période" />
                  <span className="range-sep">→</span>
                  <input type="date" value={rangeTo} min={rangeFrom || undefined} max={todayIso()} onChange={(e) => setRangeTo(e.target.value)} aria-label="Fin de la période (vide = aujourd'hui)" />
                </>
              )}
              <select value={scaleMode} onChange={(e) => setScaleMode(e.target.value as ChartScaleMode)} aria-label="Échelle du graphique">
                <option value="linear">Linéaire</option>
                <option value="symlog">Pseudo-log</option>
                <option value="base100">Base 100</option>
              </select>
            </div>
          )}
        >
          {effectiveScaleMode === 'symlog' && (
            <p className="panel-note">Pseudo-log : zéro et les soldes négatifs restent affichables, tandis que les gros écarts sont compressés. Le tooltip conserve le montant réel.</p>
          )}
          {effectiveScaleMode === 'base100' && (
            <p className="panel-note">Base 100 : le solde démarre à 100 depuis sa première valeur non nulle. Le tooltip conserve le montant réel.</p>
          )}
          <div className="chart-area">
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displayedChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="accountFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartTheme.net} stopOpacity={0.35} />
                      <stop offset="95%" stopColor={chartTheme.net} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} />
                  <YAxis domain={balanceDomain} tickFormatter={(v) => yTick(Number(v))} tickLine={false} axisLine={false} width={64} />
                  <Tooltip formatter={tooltipValue} />
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
                <th className="actions-cell">Pointage</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(({ tx, signed }) => {
                const category = tx.category_id != null ? categoryById.get(tx.category_id) : null;
                const label = tx.description || (tx.type === 'transfer' ? 'Transfert' : category?.name) || 'Mouvement';
                return (
                  <tr key={tx.id}>
                    <td data-label="Date">{new Date(tx.date).toLocaleDateString('fr-FR')}</td>
                    <td data-label="Libellé"><strong title={label}>{label}</strong></td>
                    <td data-label="Catégorie">{category?.name ?? <span className="muted">—</span>}</td>
                    <td className={`amount-cell ${signed >= 0 ? 'income' : 'expense'}`} data-label="Montant">
                      {signed >= 0 ? '+' : '-'}{nativeMoney(Math.abs(signed))}
                    </td>
                    <td className="actions-cell" data-label="Pointage">
                      <IconButton
                        label={tx.cleared ? 'Pointée — cliquer pour dépointer' : 'Pointer (rapprochée du relevé)'}
                        tone={tx.cleared ? 'accent' : 'neutral'}
                        icon={<CheckCircle2 size={16} />}
                        onClick={() => void run(
                          () => api.updateTransaction(userId, tx.id, { cleared: !tx.cleared }),
                          tx.cleared ? 'Transaction dépointée' : 'Transaction pointée',
                        )}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
          {loading && <p className="empty"><Loader2 className="spin-icon" size={16} /> Chargement des mouvements…</p>}
        </Panel>
      </section>

      <section className="chart-full">
        <Panel title="Snapshots de solde" icon={<Wallet />}>
          <form className="form form-inline" onSubmit={submitSnapshot}>
            <label>Date<input name="date" type="date" defaultValue={todayIso()} required /></label>
            <label className="grow">Solde relevé ({account.currency})<input name="balance" type="number" step="0.01" required /></label>
            <button className="primary"><Plus size={16} /> Enregistrer le relevé</button>
          </form>
          <DataTable empty={accountSnapshots.length === 0 ? 'Aucun relevé pour ce compte. Saisis un solde ci-dessus pour démarrer l\'historique.' : null}>
            <thead><tr><th>Date</th><th className="amount-cell">Solde relevé</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {accountSnapshots.slice(0, 24).map((s) => (
                <tr key={s.id}>
                  <td data-label="Date">{new Date(s.date).toLocaleDateString('fr-FR')}</td>
                  <td className="amount-cell" data-label="Solde relevé">{nativeMoney(s.balance)}</td>
                  <td className="actions-cell"><IconButton label="Supprimer" onClick={() => void run(() => api.deleteSnapshot(userId, s.id), 'Relevé supprimé')} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      </section>
    </section>
  );
}
