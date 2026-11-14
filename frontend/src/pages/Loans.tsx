import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, HandCoins, Plus } from 'lucide-react';
import type { Account, Category, Institution } from '@suzanne/shared';
import { api, type LoanSummary } from '../lib/api';
import { localIsoDate, money, moneyCompact } from '../lib/format';
import { parseAmount } from '../components/home/amount';
import { useChartTheme } from '../lib/chartTheme';
import { Modal } from '../components/Modal';
import { CategorySelect } from '../components/CategorySelect';
import { formatTxDate } from '../components/transactions/txUtils';
import type { Run } from '../lib/run';
import '../styles/pages/loans.css';

// Prêts entre proches, prêts bancaires, argent prêté : un compte par prêt
// (type « Emprunt » ou « Prêt accordé »), jamais des revenus ni des dépenses.
// La page résume chaque prêt (prêté, remboursé, reste, historique) et propose
// deux actions guidées qui créent les bons comptes et virements.
type Mode = 'borrowed' | 'paid_for_me' | 'lent';

// Opérations du prêt sur toutes les périodes (un prêt ancien ou soldé n'a
// souvent rien sur le mois affiché).
function loanTransactionsLink(loan: LoanSummary): string {
  return `/transactions?account=${loan.account_id}&period=all`;
}

// Clés écrites en toutes lettres (vérifiées par i18n:check).
const MODE_TEXT: Record<Mode, { title: string; hint: string; explain: string }> = {
  borrowed: { title: 'patrimoine.loans.mode_borrowed', hint: 'patrimoine.loans.mode_borrowed_hint', explain: 'patrimoine.loans.explain_borrowed' },
  paid_for_me: { title: 'patrimoine.loans.mode_paid_for_me', hint: 'patrimoine.loans.mode_paid_for_me_hint', explain: 'patrimoine.loans.explain_paid_for_me' },
  lent: { title: 'patrimoine.loans.mode_lent', hint: 'patrimoine.loans.mode_lent_hint', explain: 'patrimoine.loans.explain_lent' },
};

export function Loans({ userId, accounts, institutions, categories, dataVersion, run }: {
  userId: number;
  accounts: Account[];
  institutions: Institution[];
  categories: Category[];
  dataVersion: number;
  run: Run;
}) {
  const { t } = useTranslation();
  const [loans, setLoans] = useState<LoanSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [repaying, setRepaying] = useState<LoanSummary | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api.loans(userId).then((rows) => { if (!cancelled) setLoans(rows); }).catch(() => { if (!cancelled) setLoans([]); });
    return () => { cancelled = true; };
  }, [userId, dataVersion]);

  const active = (loans ?? []).filter((l) => l.status === 'active');
  const settled = (loans ?? []).filter((l) => l.status === 'settled');
  const iOwe = active.filter((l) => l.direction === 'borrowed').reduce((s, l) => s + Math.max(0, l.outstanding), 0);
  const owedToMe = active.filter((l) => l.direction === 'lent').reduce((s, l) => s + Math.max(0, l.outstanding), 0);
  const institutionById = useMemo(() => new Map(institutions.map((i) => [i.id, i])), [institutions]);
  const toggle = (id: number) => setOpen((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  return (
    <section className="pg-page loans-page">
      <div className="loans-toolbar">
        <div className="loans-totals">
          <div><span>{t('patrimoine.loans.i_owe')}</span><strong className="num expense">{money(iOwe)}</strong></div>
          <div><span>{t('patrimoine.loans.owed_to_me')}</span><strong className="num income">{money(owedToMe)}</strong></div>
        </div>
        <button type="button" className="primary accent" onClick={() => setCreating(true)}><Plus size={16} /> {t('patrimoine.loans.new_loan')}</button>
      </div>

      <details className="pg-card loans-help">
        <summary>{t('patrimoine.loans.help_title')}</summary>
        <ul>
          <li>{t('patrimoine.loans.help_account')}</li>
          <li>{t('patrimoine.loans.help_not_income')}</li>
          <li>{t('patrimoine.loans.help_paid_for_me')}</li>
          <li>{t('patrimoine.loans.help_bank')}</li>
        </ul>
      </details>

      {loans === null ? (
        <p className="pg-empty">{t('patrimoine.loans.loading')}</p>
      ) : active.length === 0 ? (
        <div className="pg-card loans-empty">
          <HandCoins size={28} aria-hidden />
          <p>{t('patrimoine.loans.no_active')}</p>
        </div>
      ) : (
        <div className="loans-grid">
          {active.map((loan) => (
            <LoanCard key={loan.account_id} loan={loan} institution={institutionById.get(loan.institution_id ?? -1)} open={open.has(loan.account_id)} onToggle={() => toggle(loan.account_id)} onRepay={() => setRepaying(loan)} />
          ))}
        </div>
      )}

      {settled.length > 0 && (
        <details className="pg-card loans-settled">
          <summary>{t('patrimoine.loans.settled_n', { n: settled.length })}</summary>
          <ul>
            {settled.map((loan) => (
              <li key={loan.account_id}>
                <span className="loans-settled-name">{loan.name}</span>
                <span className="loans-dir">{loan.direction === 'borrowed' ? t('patrimoine.loans.borrowed') : t('patrimoine.loans.lent')}</span>
                <span className="num">{money(loan.principal, loan.currency)}</span>
                <span className="muted">{loan.start_date ? formatTxDate(loan.start_date) : '—'} → {loan.settled_date ? formatTxDate(loan.settled_date) : '—'}</span>
                <Link to={loanTransactionsLink(loan)}>{t('patrimoine.loans.transactions')}</Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      {creating && (
        <NewLoanModal userId={userId} accounts={accounts} institutions={institutions} categories={categories} loans={active} run={run} onClose={() => setCreating(false)} />
      )}
      {repaying && (
        <RepayModal userId={userId} loan={repaying} accounts={accounts} run={run} onClose={() => setRepaying(null)} />
      )}
    </section>
  );
}

function LoanCard({ loan, institution, open, onToggle, onRepay }: {
  loan: LoanSummary;
  institution: Institution | undefined;
  open: boolean;
  onToggle: () => void;
  onRepay: () => void;
}) {
  const { t } = useTranslation();
  const theme = useChartTheme();
  const pct = loan.principal > 0 ? Math.min(100, Math.round((loan.repaid / loan.principal) * 100)) : 0;
  return (
    <article className="pg-card loan-card">
      <header>
        <div>
          <h3>{loan.name}</h3>
          <p className="muted">
            <span className={`loans-dir ${loan.direction}`}>{loan.direction === 'borrowed' ? t('patrimoine.loans.i_owe_short') : t('patrimoine.loans.owed_to_me_short')}</span>
            {institution && <> · {institution.name}</>}
          </p>
        </div>
        <div className="loan-remaining">
          <strong className="num">{money(Math.max(0, loan.outstanding), loan.currency)}</strong>
          <span className="muted">{t('patrimoine.loans.of_principal', { amount: money(loan.principal, loan.currency) })}</span>
        </div>
      </header>
      <div className="loan-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('patrimoine.loans.repaid_pct', { pct })}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="loan-meta muted">
        {t('patrimoine.loans.repaid_pct', { pct })}
        {loan.start_date && <> · {t('patrimoine.loans.since', { date: formatTxDate(loan.start_date) })}</>}
        {loan.last_repayment_date && <> · {t('patrimoine.loans.last_repayment', { date: formatTxDate(loan.last_repayment_date) })}</>}
      </p>
      <div className="loan-actions">
        <button type="button" className="primary" onClick={onRepay}>{t('patrimoine.loans.record_repayment')}</button>
        <button type="button" className="secondary" aria-expanded={open} onClick={onToggle}>
          {t('patrimoine.loans.history')} <ChevronDown size={14} className={open ? 'loan-chevron open' : 'loan-chevron'} aria-hidden />
        </button>
        <Link className="loan-link" to={loanTransactionsLink(loan)}>{t('patrimoine.loans.transactions')}</Link>
      </div>
      {open && (
        <div className="loan-history">
          {loan.series.length > 1 && (
            <div className="loan-chart">
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={loan.series} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
                  <XAxis dataKey="date" tickFormatter={(d: string) => formatTxDate(d)} tick={{ fontSize: 11, fill: theme.axis }} minTickGap={24} />
                  <YAxis width={56} tick={{ fontSize: 11, fill: theme.axis }} tickFormatter={(v: number) => moneyCompact(v, loan.currency)} />
                  <Tooltip formatter={(v) => [money(Number(v), loan.currency), t('patrimoine.loans.remaining')]} labelFormatter={(d) => formatTxDate(String(d))} contentStyle={theme.tooltip.contentStyle} />
                  <Area type="stepAfter" dataKey="outstanding" stroke={theme.series[3]} fill={theme.series[3]} fillOpacity={0.15} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul className="loan-movements">
            {loan.movements.map((m) => {
              const debtUp = (loan.direction === 'borrowed' ? -m.amount : m.amount) > 0;
              return (
                <li key={`${m.transaction_id}-${m.amount}`}>
                  <span className="muted">{formatTxDate(m.date)}</span>
                  <Link to={`/transactions?tx=${m.transaction_id}`} className="loan-mv-label">{m.description ?? t('patrimoine.loans.no_label')}</Link>
                  <span className={`num ${debtUp ? 'loan-up' : 'loan-down'}`}>{debtUp ? '+' : '−'}{money(Math.abs(m.amount), loan.currency)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}

// Comptes « à moi » où l'argent du prêt arrive ou d'où partent les remboursements.
const ownAccounts = (accounts: Account[]) => accounts.filter((a) => !a.archived && a.type !== 'loan' && a.type !== 'receivable');

function NewLoanModal({ userId, accounts, institutions, categories, loans, run, onClose }: {
  userId: number;
  accounts: Account[];
  institutions: Institution[];
  categories: Category[];
  loans: LoanSummary[];
  run: Run;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mine = ownAccounts(accounts);
  const [mode, setMode] = useState<Mode>('borrowed');
  const [existing, setExisting] = useState('');
  const [who, setWho] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(localIsoDate());
  const [accountId, setAccountId] = useState(String(mine.find((a) => a.type === 'checking')?.id ?? mine[0]?.id ?? ''));
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const direction = mode === 'lent' ? 'lent' : 'borrowed';
  const compatible = loans.filter((l) => l.direction === direction);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = parseAmount(amount);
    if (!(value > 0)) { setError(t('patrimoine.loans.error_amount')); return; }
    if (!existing && !who.trim()) { setError(t('patrimoine.loans.error_who')); return; }
    if (mode !== 'paid_for_me' && !accountId) { setError(t('patrimoine.loans.error_account')); return; }
    const ok = await run(async () => {
      const loanId = existing
        ? Number(existing)
        : (await api.createAccount(userId, {
          name: mode === 'lent' ? t('patrimoine.loans.name_lent', { who: who.trim() }) : t('patrimoine.loans.name_borrowed', { who: who.trim() }),
          type: mode === 'lent' ? 'receivable' : 'loan',
          currency: 'EUR',
          initial_balance: 0,
          initial_balance_date: date,
          institution_id: institutionId ? Number(institutionId) : null,
        })).id;
      const label = description.trim() || null;
      if (mode === 'paid_for_me') {
        // L'achat est une vraie dépense, payée depuis le compte de prêt : la dette se crée sans virement.
        await api.createTransaction(userId, { type: 'expense', amount: value, date, account_id: loanId, category_id: categoryId ? Number(categoryId) : null, description: label });
      } else if (mode === 'borrowed') {
        await api.createTransaction(userId, { type: 'transfer', amount: value, date, account_id: loanId, to_account_id: Number(accountId), description: label ?? t('patrimoine.loans.label_received') });
      } else {
        await api.createTransaction(userId, { type: 'transfer', amount: value, date, account_id: Number(accountId), to_account_id: loanId, description: label ?? t('patrimoine.loans.label_lent') });
      }
    }, t('patrimoine.loans.saved'));
    if (ok) onClose();
  };

  return (
    <Modal title={t('patrimoine.loans.new_loan')} onClose={onClose}>
      <form className="form st-form loans-form" onSubmit={submit}>
        <fieldset className="full loans-modes">
          <legend>{t('patrimoine.loans.what_happened')}</legend>
          {(['borrowed', 'paid_for_me', 'lent'] as Mode[]).map((m) => (
            <label key={m} className={mode === m ? 'loans-mode active' : 'loans-mode'}>
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => { setMode(m); setExisting(''); }} />
              <strong>{t(MODE_TEXT[m].title)}</strong>
              <span>{t(MODE_TEXT[m].hint)}</span>
            </label>
          ))}
        </fieldset>

        {compatible.length > 0 && (
          <label className="full">{t('patrimoine.loans.which_loan')}
            <select value={existing} onChange={(e) => setExisting(e.target.value)}>
              <option value="">{t('patrimoine.loans.new_loan_option')}</option>
              {compatible.map((l) => <option key={l.account_id} value={l.account_id}>{l.name} ({money(l.outstanding, l.currency)})</option>)}
            </select>
          </label>
        )}
        {!existing && (
          <>
            <label>{mode === 'lent' ? t('patrimoine.loans.to_whom') : t('patrimoine.loans.from_whom')}
              <input value={who} onChange={(e) => setWho(e.target.value)} placeholder={t('patrimoine.loans.who_placeholder')} autoComplete="off" />
            </label>
            <label>{t('patrimoine.loans.institution')}
              <select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
                <option value="">{t('patrimoine.loans.no_institution')}</option>
                {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </label>
          </>
        )}
        <label>{t('patrimoine.loans.amount')}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoComplete="off" required /></label>
        <label>{t('patrimoine.loans.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        {mode === 'paid_for_me' ? (
          <div>
            <span className="st-field-label">{t('patrimoine.loans.purchase_category')}</span>
            <CategorySelect value={categoryId} onChange={setCategoryId} categories={categories.filter((c) => c.type === 'expense')} noneLabel={t('patrimoine.loans.no_category')} ariaLabel={t('patrimoine.loans.purchase_category')} />
          </div>
        ) : (
          <label>{mode === 'lent' ? t('patrimoine.loans.from_my_account') : t('patrimoine.loans.to_my_account')}
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {mine.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <label className="full">{t('patrimoine.loans.label')}
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={mode === 'paid_for_me' ? t('patrimoine.loans.label_purchase_placeholder') : t('patrimoine.loans.label_placeholder')} autoComplete="off" />
        </label>
        <p className="full muted loans-explain">{t(MODE_TEXT[mode].explain)}</p>
        {error && <p className="full form-error" role="alert">{error}</p>}
        <div className="modal-actions full">
          <button type="button" className="secondary" onClick={onClose}>{t('commun.cancel')}</button>
          <button className="primary">{t('patrimoine.loans.save')}</button>
        </div>
      </form>
    </Modal>
  );
}

function RepayModal({ userId, loan, accounts, run, onClose }: {
  userId: number;
  loan: LoanSummary;
  accounts: Account[];
  run: Run;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mine = ownAccounts(accounts);
  const remaining = Math.max(0, loan.outstanding);
  const [amount, setAmount] = useState(String(remaining).replace('.', ','));
  const [date, setDate] = useState(localIsoDate());
  const [accountId, setAccountId] = useState(String(mine.find((a) => a.type === 'checking')?.id ?? mine[0]?.id ?? ''));
  const [close, setClose] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const value = parseAmount(amount);
  const settles = value > 0 && value >= remaining - 0.005;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!(value > 0)) { setError(t('patrimoine.loans.error_amount')); return; }
    if (!accountId) { setError(t('patrimoine.loans.error_account')); return; }
    const ok = await run(async () => {
      // Emprunt : de mon compte vers le prêt ; prêt accordé : du prêt vers mon compte.
      const [from, to] = loan.direction === 'borrowed' ? [Number(accountId), loan.account_id] : [loan.account_id, Number(accountId)];
      await api.createTransaction(userId, { type: 'transfer', amount: value, date, account_id: from, to_account_id: to, description: t('patrimoine.loans.label_repayment', { name: loan.name }) });
      if (settles && close) await api.updateAccount(userId, loan.account_id, { archived: true });
    }, t('patrimoine.loans.repayment_saved'));
    if (ok) onClose();
  };

  return (
    <Modal title={t('patrimoine.loans.repay_title', { name: loan.name })} onClose={onClose}>
      <form className="form st-form loans-form" onSubmit={submit}>
        <p className="full muted">{t('patrimoine.loans.remaining_is', { amount: money(remaining, loan.currency) })}</p>
        <label>{t('patrimoine.loans.amount')}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoComplete="off" required /></label>
        <label>{t('patrimoine.loans.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className="full">{loan.direction === 'borrowed' ? t('patrimoine.loans.from_my_account') : t('patrimoine.loans.to_my_account')}
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {mine.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {settles && (
          <label className="full loans-check">
            <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} />
            {t('patrimoine.loans.close_when_settled')}
          </label>
        )}
        {error && <p className="full form-error" role="alert">{error}</p>}
        <div className="modal-actions full">
          <button type="button" className="secondary" onClick={onClose}>{t('commun.cancel')}</button>
          <button className="primary">{t('patrimoine.loans.save')}</button>
        </div>
      </form>
    </Modal>
  );
}
