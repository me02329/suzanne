import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, CheckCircle2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  accountTypeLabel,
  type Account,
  type AccountSnapshot,
  type Category,
  type DashboardSummary,
  type Transaction,
} from '@suzanne/shared';
import { api } from '../lib/api';
import { accountsApi, type AccountWithInvestment } from '../lib/api-accounts';
import { formatMonth, money as moneyFmt, moneyCompact as moneyCompactFmt, todayIso } from '../lib/format';
import { useChartTheme } from '../lib/chartTheme';
import { usePersistedState } from '../lib/storage';
import { accountSignedAmount, livretCeiling } from '../lib/account';
import { fitDomain } from '../lib/chartScale';
import { accountCash, accountPositions, envelopeFlows, formatDateFr, parseDecimal, positionsAtCost } from '../lib/pea';
import { EmptyChart } from '../components/EmptyChart';
import { Modal } from '../components/Modal';
import { PeaView, type PeaData } from '../components/pea/PeaView';
import { AccountFormModal } from '../components/accounts/AccountFormModal';
import type { Run } from '../lib/run';
import '../styles/pages/accounts.css';
import '../styles/pages/account-detail.css';

const RANGES: Array<{ value: string; label: string }> = [
  { value: '6m', label: '6 mois' },
  { value: '12m', label: '12 mois' },
  { value: 'ytd', label: 'Cette année' },
  { value: 'all', label: 'Tout' },
];

const ENVELOPE_TYPES: ReadonlyArray<Account['type']> = ['pea', 'securities'];

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
  const account = accounts.find((a) => a.id === accountId) as AccountWithInvestment | undefined;
  const isEnvelope = account != null && ENVELOPE_TYPES.includes(account.type);

  const [range, setRange] = usePersistedState('account_detail_range', '12m');
  const [history, setHistory] = useState<{ date: string; balance: number }[] | null>(null);
  const [activity, setActivity] = useState<{ cleared_balance: number; uncleared_count: number; recent: Transaction[] } | null>(null);
  const [activityLimit, setActivityLimit] = useState(15);
  const [envelope, setEnvelope] = useState<PeaData | null>(null);
  const [statementBalance, setStatementBalance] = useState('');
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const chartTheme = useChartTheme();

  const displayCurrency = summary?.currency ?? reportCurrency;
  const money = (v: number) => moneyFmt(v, displayCurrency);
  const nativeMoney = (v: number) => moneyFmt(v, account?.currency ?? displayCurrency);
  const asOf = todayIso();

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    setHistory(null);
    api.wealthHistory(userId, range, 'month', reportCurrency)
      .then((points) => { if (!cancelled) setHistory(points.map((p) => ({ date: p.date, balance: p.by_account[account.id] ?? 0 }))); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [userId, account, range, reportCurrency]);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    api.accountActivity(userId, account.id, activityLimit)
      .then((a) => { if (!cancelled) setActivity(a); })
      .catch(() => { if (!cancelled) setActivity({ cleared_balance: 0, uncleared_count: 0, recent: [] }); });
    return () => { cancelled = true; };
  }, [userId, account, activityLimit]);

  // Enveloppe (PEA / compte-titres) : opérations du compte + positions valorisées.
  // `summary` change après chaque mutation (reload global) → on recharge aussi.
  useEffect(() => {
    if (!account || !isEnvelope) { setEnvelope(null); return; }
    let cancelled = false;
    const valuation = api.holdingsValuation(userId, account.currency)
      .then((v) => {
        const positions = accountPositions(v, account.id);
        return { positions, degraded: positions.some((p) => p.price == null) ? 'partial' as const : 'none' as const };
      })
      .catch(async () => ({ positions: positionsAtCost(await api.holdings(userId), account.id), degraded: 'offline' as const }));
    Promise.all([accountsApi.transactions(userId, account.id), valuation])
      .then(([txs, val]) => {
        if (cancelled) return;
        setEnvelope({ ...val, cash: accountCash(account, txs, snapshots), flows: envelopeFlows(txs, account.id) });
      })
      .catch(() => { if (!cancelled) setEnvelope(null); });
    return () => { cancelled = true; };
  }, [userId, account, isEnvelope, snapshots, summary]);

  const recent = useMemo(
    () => (account && activity ? activity.recent.map((tx) => ({ tx, signed: accountSignedAmount(tx, account.id) })) : []),
    [activity, account],
  );

  if (!account) {
    return (
      <section className="pg-stack">
        <Link className="ad-back" to="/accounts"><ArrowLeft size={16} /> Comptes</Link>
        <p className="acc-muted">Compte introuvable.</p>
      </section>
    );
  }

  const balanceRow = summary?.account_balances.find((a) => a.account_id === account.id);
  const envelopeValue = envelope ? envelope.cash + envelope.positions.reduce((s, p) => s + p.market_value, 0) : null;
  const heroValue = isEnvelope && envelopeValue != null ? envelopeValue : (balanceRow?.signed_balance ?? account.initial_balance);
  const heroMoney = isEnvelope && envelopeValue != null ? nativeMoney : money;
  const ceiling = livretCeiling(account, reportCurrency);
  const accountSnapshots = snapshots.filter((s) => s.account_id === account.id).sort((a, b) => b.date.localeCompare(a.date));

  const accountStart = [account.initial_balance_date, ...accountSnapshots.map((s) => s.date)].map((d) => d.slice(0, 10)).reduce((m, d) => (d < m ? d : m));
  const chartData = (history ?? []).filter((p) => p.date.slice(0, 10) >= accountStart).map((p) => ({ ...p, label: formatMonth(p.date.slice(0, 7)) }));
  const domain = fitDomain(chartData.map((p) => p.balance).filter((v) => Number.isFinite(v)));

  const statement = parseDecimal(statementBalance);
  const gap = activity && statementBalance.trim() !== '' && Number.isFinite(statement) ? Math.round((statement - activity.cleared_balance) * 100) / 100 : null;

  const submitSnapshot = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const balance = parseDecimal(data.get('balance'));
    if (!Number.isFinite(balance)) return;
    void run(() => api.setSnapshot(userId, { account_id: account.id, date: String(data.get('date')), balance }), 'Relevé enregistré')
      .then((ok) => { if (ok) setSnapshotOpen(false); });
  };

  return (
    <section className="pg-stack ad">
      <Link className="ad-back" to="/accounts"><ArrowLeft size={16} /> Comptes</Link>

      <header className="acc-hero">
        <div className="acc-hero-main">
          <span className="acc-kicker">{accountTypeLabel(account.type)} · {account.currency}{account.archived ? ' · archivé' : ''}</span>
          <h2 className="ad-name">{account.name}</h2>
          <strong className={`acc-hero-value num${heroValue < 0 ? ' expense' : ''}`}>{heroMoney(heroValue)}</strong>
          {isEnvelope && envelope && (
            <span className="acc-hero-sub">
              <span>Titres <b className="num">{nativeMoney(heroValue - envelope.cash)}</b></span>
              <span>Espèces <b className="num">{nativeMoney(envelope.cash)}</b></span>
            </span>
          )}
          {!isEnvelope && activity && (
            <span className="acc-hero-sub">
              <span>Pointé <b className="num">{nativeMoney(activity.cleared_balance)}</b></span>
              <span>Ouvert le {formatDateFr(account.initial_balance_date)}</span>
            </span>
          )}
        </div>
        <div className="acc-hero-actions">
          <button type="button" className="secondary" onClick={() => setEditOpen(true)}><Pencil size={16} /> Modifier</button>
          <button type="button" className="secondary" onClick={() => setSnapshotOpen(true)}><Plus size={16} /> Saisir un relevé</button>
        </div>
      </header>

      {ceiling != null && (() => {
        const current = balanceRow?.signed_balance ?? account.initial_balance;
        const pct = Math.min(100, (current / ceiling) * 100);
        return (
          <div className="ad-ceiling">
            <div className="ad-ceiling-head"><span>Plafond {accountTypeLabel(account.type)}</span><span className="num">{money(current)} / {money(ceiling)}</span></div>
            <div className="pea-bar"><i style={{ width: `${pct}%` }} className={pct >= 100 ? 'full' : ''} /></div>
            <span className="acc-muted">{pct >= 100 ? 'Plafond atteint.' : `${money(ceiling - current)} encore versables.`}</span>
          </div>
        );
      })()}

      {isEnvelope && (envelope
        ? <PeaView account={account} data={envelope} asOf={asOf} />
        : <p className="acc-muted"><Loader2 className="spin-icon" size={14} /> Chargement des positions…</p>)}

      <section className="pg-section">
        <div className="pg-section-head">
          <h2>Évolution</h2>
          <div className="acc-seg" role="group" aria-label="Période">
            {RANGES.map((r) => (
              <button key={r.value} type="button" aria-pressed={range === r.value} onClick={() => setRange(r.value)}>{r.label}</button>
            ))}
          </div>
        </div>
        <div className="ad-chart">
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="adFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartTheme.net} stopOpacity={0.28} />
                    <stop offset="95%" stopColor={chartTheme.net} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={chartTheme.grid} vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} />
                <YAxis domain={domain} tickFormatter={(v) => moneyCompactFmt(Number(v), displayCurrency)} tickLine={false} axisLine={false} width={60} />
                <Tooltip formatter={(v) => [money(Number(v)), 'Solde']} />
                <Area type="monotone" dataKey="balance" name="Solde" stroke={chartTheme.net} strokeWidth={2} fill="url(#adFill)" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message={history == null ? 'Chargement de l’historique…' : 'Pas encore d’historique. Saisis des relevés pour l’alimenter.'} />
          )}
        </div>
      </section>

      <section className="pg-section">
        <div className="pg-section-head"><h2>Mouvements récents</h2></div>
        {activity == null ? (
          <p className="acc-muted"><Loader2 className="spin-icon" size={14} /> Chargement…</p>
        ) : recent.length === 0 ? (
          <p className="acc-muted">Aucun mouvement sur ce compte.</p>
        ) : (
          <>
            <ul className="ad-moves">
              {recent.map(({ tx, signed }) => {
                const category = tx.category_id != null ? categoryById.get(tx.category_id) : null;
                const label = tx.description || (tx.kind === 'transfer' ? 'Virement' : category?.name) || 'Mouvement';
                return (
                  <li key={tx.id}>
                    <div className="ad-move-main">
                      <span className="ad-move-label">{label}</span>
                      <span className="ad-move-meta">{formatDateFr(tx.date)}{category ? ` · ${category.name}` : tx.kind === 'trade' ? ' · ordre de bourse' : ''}</span>
                    </div>
                    <span className={`num ad-move-amount ${signed >= 0 ? 'income' : 'expense'}`}>{signed >= 0 ? '+' : '−'}{nativeMoney(Math.abs(signed))}</span>
                    <button
                      type="button"
                      className={`row-btn${tx.cleared ? ' on' : ''}`}
                      aria-pressed={tx.cleared}
                      aria-label={tx.cleared ? 'Dépointer' : 'Pointer'}
                      title={tx.cleared ? 'Pointée — cliquer pour dépointer' : 'Pointer (rapprochée du relevé)'}
                      onClick={() => void run(() => api.updateTransaction(userId, tx.id, { cleared: !tx.cleared }), tx.cleared ? 'Dépointée' : 'Pointée')}
                    ><CheckCircle2 size={18} /></button>
                  </li>
                );
              })}
            </ul>
            {recent.length >= activityLimit && activityLimit < 100 && (
              <button type="button" className="secondary pea-more" onClick={() => setActivityLimit((n) => Math.min(100, n * 2))}>Afficher plus</button>
            )}
          </>
        )}
      </section>

      {!isEnvelope && activity && (
        <details className="acc-fold">
          <summary>Rapprochement{activity.uncleared_count > 0 && <span className="acc-count">{activity.uncleared_count} non pointé{activity.uncleared_count > 1 ? 's' : ''}</span>}</summary>
          <div className="ad-fold-body">
            <p className="acc-muted">Solde pointé : <b className="num">{nativeMoney(activity.cleared_balance)}</b>. Saisis le solde de ton relevé : écart nul = compte rapproché.</p>
            <label className="ad-field">Solde du relevé ({account.currency})
              <input inputMode="decimal" autoComplete="off" value={statementBalance} onChange={(e) => setStatementBalance(e.target.value)} placeholder="1 234,56" />
            </label>
            {gap != null && (gap === 0
              ? <p className="ad-ok">Compte rapproché.</p>
              : <p className="ad-ko">Écart de <span className="num">{nativeMoney(Math.abs(gap))}</span> {gap > 0 ? 'manquant' : 'en trop'} dans les opérations pointées.</p>)}
          </div>
        </details>
      )}

      <details className="acc-fold">
        <summary>Relevés <span className="acc-count">{accountSnapshots.length}</span></summary>
        {accountSnapshots.length === 0 ? (
          <p className="acc-muted acc-pad" style={{ paddingTop: 12 }}>Aucun relevé pour ce compte.</p>
        ) : (
          <ul className="acc-list">
            {accountSnapshots.map((s) => (
              <li key={s.id} className="acc-row">
                <div className="acc-row-main"><span className="acc-row-name">{formatDateFr(s.date)}</span></div>
                <span className="acc-row-amount num">{nativeMoney(s.balance)}</span>
                <div className="acc-row-actions">
                  <button
                    type="button"
                    className="row-btn"
                    aria-label="Supprimer ce relevé"
                    title="Supprimer"
                    onClick={() => void run(
                      () => api.deleteSnapshot(userId, s.id),
                      'Relevé supprimé',
                      { undo: () => api.setSnapshot(userId, { account_id: s.account_id, date: s.date.slice(0, 10), balance: s.balance }) },
                    )}
                  ><Trash2 size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>

      {snapshotOpen && (
        <Modal title={`Relevé · ${account.name}`} onClose={() => setSnapshotOpen(false)}>
          <form className="form acc-form sheet-ok" onSubmit={submitSnapshot}>
            <label>Date<input name="date" type="date" defaultValue={todayIso()} required /></label>
            <label>Solde ({account.currency})<input name="balance" inputMode="decimal" autoComplete="off" required autoFocus placeholder="0,00" /></label>
            {isEnvelope && <p className="acc-muted full">Pour ce compte, saisis les espèces seules : les titres sont valorisés à part.</p>}
            <div className="acc-form-actions full">
              <button type="button" className="secondary" onClick={() => setSnapshotOpen(false)}>Annuler</button>
              <button className="primary">Enregistrer</button>
            </div>
          </form>
        </Modal>
      )}
      {editOpen && (
        <AccountFormModal userId={userId} account={account} accounts={accounts} run={run} onClose={() => setEditOpen(false)} />
      )}
    </section>
  );
}
