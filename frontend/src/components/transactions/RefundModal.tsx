import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { refundedAmount, type Account, type Category, type Transaction } from '@suzanne/shared';
import { api, http } from '../../lib/api';
import { pickableAccounts } from '../../lib/account';
import { currentMonthIso, money, todayIso, txLabel } from '../../lib/format';
import { Modal } from '../Modal';
import { MonthPicker } from '../MonthPicker';
import type { Run } from '../../lib/run';
import { amountInput, formatTxDate, parseAmount, roundAmount } from './txUtils';

// Remboursements entre opérations. Un revenu peut rembourser plusieurs
// dépenses (allocations), et une dépense peut être remboursée par plusieurs
// revenus. La modale travaille toujours autour d'un « pivot » :
//   - 1 revenu  ↔ N dépenses (le revenu est ventilé sur les dépenses) ;
//   - N revenus ↔ 1 dépense  (chaque revenu alloue une part à la dépense).
// Elle s'ouvre depuis une ligne (menu) ou depuis une sélection multiple.

interface Props {
  /** Opérations de départ : une ligne, ou la sélection du journal. */
  seed: Transaction[];
  userId: number;
  accounts: Account[];
  accountById: Map<number, Account>;
  categoryById: Map<number, Category>;
  run: Run;
  onClose: () => void;
  /** Appelé après un enregistrement réussi (ex. vider la sélection). */
  onDone?: () => void;
}

export function RefundModal(props: Props) {
  const { t } = useTranslation();
  const incomes = props.seed.filter((tx) => tx.type === 'income');
  const expenses = props.seed.filter((tx) => tx.type === 'expense');
  const invalid = incomes.length + expenses.length !== props.seed.length || (incomes.length > 1 && expenses.length > 1);
  if (invalid || props.seed.length === 0) {
    return (
      <Modal title={t('Remboursement')} onClose={props.onClose}>
        <p className="jr-note">
          {t('Sélectionne des dépenses et/ou des revenus (pas de transferts), avec un seul revenu ou une seule dépense d’un côté : un revenu peut rembourser plusieurs dépenses, et une dépense peut être remboursée par plusieurs revenus.')}
        </p>
        <div className="jr-form-actions"><span className="jr-spacer" /><button type="button" className="secondary" onClick={props.onClose}>{t('Fermer')}</button></div>
      </Modal>
    );
  }
  if (incomes.length === 0) return <ExpenseRefund {...props} expenses={expenses} />;
  return <LinkEditor {...props} initialIncomes={incomes} initialExpenses={expenses} />;
}

// ---- Dépense(s) seules : créer un remboursement ou en lier un existant -----

function ExpenseRefund(props: Props & { expenses: Transaction[] }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'create' | 'existing'>('create');
  const n = props.expenses.length;
  const title = n > 1 ? t('Rembourser {{n}} dépenses', { n }) : t('Rembourser la dépense');
  return (
    <Modal title={title} onClose={props.onClose}>
      <div className="jr-form">
        <div className="jr-seg full" role="tablist" aria-label={t('Mode')}>
          <button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'on' : ''} onClick={() => setTab('create')}>{t('Nouveau remboursement')}</button>
          <button type="button" role="tab" aria-selected={tab === 'existing'} className={tab === 'existing' ? 'on' : ''} onClick={() => setTab('existing')}>{t('Revenu déjà saisi')}</button>
        </div>
      </div>
      {tab === 'create'
        ? <CreateRefund {...props} />
        : <LinkEditorBody {...props} initialIncomes={[]} initialExpenses={props.expenses} />}
    </Modal>
  );
}

function CreateRefund({ expenses, userId, accounts, accountById, categoryById, run, onClose, onDone }: Props & { expenses: Transaction[] }) {
  const { t } = useTranslation();
  const first = expenses[0]!;
  const currency = accountById.get(first.account_id ?? -1)?.currency ?? 'EUR';
  const ordered = useMemo(() => [...expenses].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id), [expenses]);
  const remainingOf = (tx: Transaction) => Math.max(0, roundAmount(tx.amount - refundedAmount(tx)));
  const remaining = roundAmount(ordered.reduce((s, tx) => s + remainingOf(tx), 0));
  const already = roundAmount(ordered.reduce((s, tx) => s + refundedAmount(tx), 0));
  const [amount, setAmount] = useState(amountInput(Math.max(0.01, remaining)));
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState(String(first.account_id ?? ''));
  const [description, setDescription] = useState(expenses.length === 1
    ? t('Remboursement : {{label}}', { label: txLabel(first, categoryById) })
    : t('Remboursement : {{n}} dépenses', { n: expenses.length }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = parseAmount(amount);
  const surplus = roundAmount(value - remaining);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!(value > 0)) { setError(t('Saisis un montant positif (ex. 12,50).')); return; }
    setError(null);
    // Le montant est réparti sur les dépenses, de la plus ancienne à la plus
    // récente ; un éventuel surplus reste un simple revenu.
    let left = roundAmount(Math.min(value, remaining));
    const allocations: Array<{ expense_transaction_id: number; amount: number }> = [];
    for (const tx of ordered) {
      const part = roundAmount(Math.min(left, remainingOf(tx)));
      if (part > 0) allocations.push({ expense_transaction_id: tx.id, amount: part });
      left = roundAmount(left - part);
    }
    setBusy(true);
    const ok = await run(() => api.createTransaction(userId, {
      type: 'income',
      refund_allocations: allocations,
      account_id: accountId ? Number(accountId) : null,
      category_id: null,
      amount: roundAmount(value),
      date,
      description: description.trim(),
    }), t('Remboursement enregistré'));
    setBusy(false);
    if (ok) { onDone?.(); onClose(); }
  };

  return (
    <form className="jr-form" onSubmit={submit} noValidate style={{ marginTop: 12 }}>
      <ul className="jr-alloc-list full">
        {ordered.map((tx) => (
          <li key={tx.id}>
            <span>{formatTxDate(tx.date)} · {txLabel(tx, categoryById)}</span>
            <span className="jr-num">{money(tx.amount, currency)}</span>
          </li>
        ))}
      </ul>
      {already > 0 && <p className="jr-note full">{t('Déjà remboursé : {{amount}}', { amount: money(already, currency) })}</p>}
      <label>{t('Montant')}<input inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
      <label>{t('Date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
      {surplus > 0 && (
        <p className="jr-note full">
          {t('{{remaining}} viendront annuler la dépense ; le surplus de {{surplus}} sera compté comme revenu.', { remaining: money(remaining, currency), surplus: money(surplus, currency) })}
        </p>
      )}
      <label className="full">{t('Compte crédité')}
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          <option value="">{t('Aucun')}</option>
          {pickableAccounts(accounts, first.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
      <label className="full">{t('Libellé')}<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      {error && <p className="jr-error full" role="alert">{error}</p>}
      <div className="jr-form-actions full">
        <span className="jr-spacer" />
        <button type="button" className="secondary" onClick={onClose}>{t('Annuler')}</button>
        <button className="primary" disabled={busy}>{t('Créer le remboursement')}</button>
      </div>
    </form>
  );
}

// ---- Éditeur de liens ------------------------------------------------------

type EditorProps = Props & { initialIncomes: Transaction[]; initialExpenses: Transaction[] };

function LinkEditor(props: EditorProps) {
  const { t } = useTranslation();
  const title = props.initialIncomes.length === 1 && props.initialExpenses.length === 0
    ? t('Lier à des dépenses')
    : t('Lier les remboursements');
  return (
    <Modal title={title} onClose={props.onClose}>
      <LinkEditorBody {...props} />
    </Modal>
  );
}

const num = (raw: string | undefined) => { const n = parseAmount(raw ?? ''); return Number.isFinite(n) ? n : 0; };

function LinkEditorBody({ initialIncomes, initialExpenses, userId, accountById, categoryById, run, onClose, onDone }: EditorProps) {
  const { t } = useTranslation();
  // Côté pivot (un seul élément) et côté « plusieurs ». Sans pivot fourni
  // (N revenus seuls ou N dépenses seules), on le choisit dans la recherche.
  const pivotSide: 'income' | 'expense' = initialIncomes.length === 1
    ? 'income'
    : initialExpenses.length === 1 ? 'expense' : initialIncomes.length > 1 ? 'expense' : 'income';
  const manySide: 'income' | 'expense' = pivotSide === 'income' ? 'expense' : 'income';
  const [pivot, setPivot] = useState<Transaction | null>(pivotSide === 'income' ? initialIncomes[0] ?? null : initialExpenses[0] ?? null);
  const initialMany = pivotSide === 'income' ? initialExpenses : initialIncomes;
  // Côté « plusieurs » : tous les éléments touchés (cochés ou décochés) ;
  // `amounts` ne contient que les cochés.
  const [items, setItems] = useState<Transaction[]>(initialMany);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // ---- Calculs ----
  // Allocations existantes d'un revenu, par dépense.
  const allocOf = (income: Transaction) => new Map((income.refund_allocations ?? []).map((a) => [a.expense_transaction_id, a.amount]));
  // Déjà remboursé sur une dépense par des revenus HORS de la modale.
  const refundedByOthers = (expense: Transaction, incomeIds: Set<number>) =>
    roundAmount(refundedAmount(expense) - (expense.refunded_by ?? []).filter((r) => incomeIds.has(r.id)).reduce((s, r) => s + r.amount, 0));
  const itemIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const modalIncomeIds = useMemo(
    () => new Set(pivotSide === 'income' ? (pivot ? [pivot.id] : []) : items.map((i) => i.id)),
    [pivotSide, pivot, items],
  );
  // Part d'un revenu engagée sur des dépenses qui ne sont pas dans la modale.
  const keptOf = (income: Transaction, touchedIds: Set<number> = itemIds) => {
    let kept = 0;
    for (const [expenseId, amount] of allocOf(income)) {
      const touched = pivotSide === 'income' ? touchedIds.has(expenseId) : expenseId === pivot?.id;
      if (!touched) kept += amount;
    }
    return roundAmount(kept);
  };
  const checkedTotal = roundAmount(Object.values(amounts).reduce((s, v) => s + num(v), 0));

  // Valeur proposée quand on coche un élément du côté « plusieurs ».
  // `scope` = éléments du côté « plusieurs » à considérer (par défaut l'état).
  const defaultFor = (item: Transaction, current: Record<number, string>, scope: Transaction[] = items): number => {
    if (!pivot) return 0.01;
    const scopeIds = new Set(scope.map((x) => x.id));
    const others = Object.entries(current).filter(([id]) => Number(id) !== item.id).reduce((s, [, v]) => s + num(v), 0);
    if (pivotSide === 'income') {
      const existing = allocOf(pivot).get(item.id);
      if (existing != null) return existing;
      const avail = pivot.amount - keptOf(pivot, new Set([...scopeIds, item.id])) - others;
      const room = item.amount - refundedByOthers(item, new Set([pivot.id]));
      return Math.max(0.01, roundAmount(Math.min(avail, room)));
    }
    const existing = allocOf(item).get(pivot.id);
    if (existing != null) return existing;
    const ids = new Set([...scopeIds, item.id]);
    const room = pivot.amount - refundedByOthers(pivot, ids) - others;
    const avail = item.amount - keptOf(item);
    return Math.max(0.01, roundAmount(Math.min(avail, room)));
  };

  // Au choix du pivot : on charge les liens existants (dépenses d'un revenu,
  // ou revenus qui remboursent une dépense) pour pouvoir les voir et les retirer.
  useEffect(() => {
    if (!pivot) return;
    const linkedIds = pivotSide === 'income'
      ? (pivot.refund_allocations ?? []).map((a) => a.expense_transaction_id)
      : (pivot.refunded_by ?? []).map((r) => r.id);
    const missing = linkedIds.filter((id) => !initialMany.some((x) => x.id === id));
    let cancelled = false;
    setLoading(missing.length > 0);
    Promise.all(missing.map((id) => http<Transaction>(`/users/${userId}/transactions/${id}`).catch(() => null)))
      .then((rows) => {
        if (cancelled) return;
        const loaded = rows.filter((r): r is Transaction => r !== null);
        const all = [...initialMany.filter((x) => x.id !== pivot.id), ...loaded];
        setItems(all);
        // Existants d'abord (montants actuels), puis les nouveaux (répartis).
        const next: Record<number, string> = {};
        const linked = all.filter((x) => linkedIds.includes(x.id));
        const fresh = all.filter((x) => !linkedIds.includes(x.id));
        for (const x of linked) {
          const value = pivotSide === 'income' ? allocOf(pivot).get(x.id) : allocOf(x).get(pivot.id);
          next[x.id] = amountInput(value ?? 0.01);
        }
        for (const x of fresh) next[x.id] = amountInput(defaultFor(x, next, all));
        setAmounts(next);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pivot?.id]);

  const toggle = (item: Transaction, on: boolean) => {
    if (on && !items.some((x) => x.id === item.id)) setItems((cur) => [...cur, item]);
    setAmounts((current) => {
      const next = { ...current };
      if (!on) { delete next[item.id]; return next; }
      next[item.id] = amountInput(defaultFor(item, current));
      return next;
    });
  };

  // ---- Validation ----
  const errors: string[] = [];
  const overItems = new Set<number>();
  if (pivot) {
    if (pivotSide === 'income') {
      if (keptOf(pivot) + checkedTotal - pivot.amount > 0.01) errors.push(t('Le total alloué dépasse le montant du remboursement.'));
      for (const x of items) {
        if (amounts[x.id] === undefined) continue;
        if (refundedByOthers(x, new Set([pivot.id])) + num(amounts[x.id]) - x.amount > 0.01) overItems.add(x.id);
      }
      if (overItems.size > 0) errors.push(t('Une allocation dépasse le reste remboursable de sa dépense.'));
    } else {
      if (refundedByOthers(pivot, modalIncomeIds) + checkedTotal - pivot.amount > 0.01) errors.push(t('Le cumul des remboursements dépasse le montant de la dépense.'));
      for (const x of items) {
        if (amounts[x.id] === undefined) continue;
        if (keptOf(x) + num(amounts[x.id]) - x.amount > 0.01) overItems.add(x.id);
      }
      if (overItems.size > 0) errors.push(t('Un revenu alloue plus que son montant.'));
    }
  }
  const changed = pivot != null && items.some((x) => {
    const before = pivotSide === 'income' ? allocOf(pivot).get(x.id) : allocOf(x).get(pivot.id);
    const after = amounts[x.id] === undefined ? undefined : roundAmount(num(amounts[x.id]));
    return (before ?? 0) !== (after ?? 0);
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pivot || errors.length > 0 || !changed) return;
    // Mises à jour à envoyer : une par revenu touché.
    const updates: Array<{ income: Transaction; allocations: Array<{ expense_transaction_id: number; amount: number }>; delta: number }> = [];
    if (pivotSide === 'income') {
      const kept = (pivot.refund_allocations ?? []).filter((a) => !itemIds.has(a.expense_transaction_id)).map((a) => ({ expense_transaction_id: a.expense_transaction_id, amount: a.amount }));
      const fresh = Object.entries(amounts).map(([id, v]) => ({ expense_transaction_id: Number(id), amount: roundAmount(num(v)) })).filter((a) => a.amount > 0);
      updates.push({ income: pivot, allocations: [...kept, ...fresh], delta: 0 });
    } else {
      for (const income of items) {
        const before = allocOf(income).get(pivot.id) ?? 0;
        const after = amounts[income.id] === undefined ? 0 : roundAmount(num(amounts[income.id]));
        if (before === after) continue;
        const kept = (income.refund_allocations ?? []).filter((a) => a.expense_transaction_id !== pivot.id).map((a) => ({ expense_transaction_id: a.expense_transaction_id, amount: a.amount }));
        updates.push({ income, allocations: after > 0 ? [...kept, { expense_transaction_id: pivot.id, amount: after }] : kept, delta: after - before });
      }
      // Les baisses d'abord : le serveur refuse un cumul temporairement dépassé.
      updates.sort((a, b) => a.delta - b.delta);
    }
    setBusy(true);
    const linkedCount = Object.keys(amounts).length;
    const ok = await run(async () => {
      for (const u of updates) await api.updateTransaction(userId, u.income.id, { refund_allocations: u.allocations });
    }, linkedCount > 0 ? t('Remboursements enregistrés') : t('Lien de remboursement retiré'));
    setBusy(false);
    if (ok) { onDone?.(); onClose(); }
  };

  const currencyOf = (tx: Transaction) => accountById.get(tx.account_id ?? -1)?.currency ?? 'EUR';
  const sign = (tx: Transaction) => (tx.type === 'income' ? '+' : '−');

  // Pas encore de pivot : on le choisit (un seul).
  if (!pivot) {
    const others = initialMany;
    return (
      <div className="jr-form" style={{ marginTop: 12 }}>
        <p className="jr-note full">
          {pivotSide === 'income'
            ? t('Choisis le revenu qui rembourse ces {{n}} dépenses.', { n: others.length })
            : t('Choisis la dépense remboursée par ces {{n}} revenus.', { n: others.length })}
        </p>
        <ul className="jr-alloc-list full">
          {others.map((tx) => <li key={tx.id}><span>{formatTxDate(tx.date)} · {txLabel(tx, categoryById)}</span><span className="jr-num">{sign(tx)}{money(tx.amount, currencyOf(tx))}</span></li>)}
        </ul>
        <TxPicker
          userId={userId}
          type={pivotSide}
          defaultMonth={others[0]?.date.slice(0, 7)}
          selectedIds={new Set()}
          excludeIds={new Set(others.map((o) => o.id))}
          accountById={accountById}
          categoryById={categoryById}
          single
          onToggle={(tx) => setPivot(tx)}
        />
        <div className="jr-form-actions full"><span className="jr-spacer" /><button type="button" className="secondary" onClick={onClose}>{t('Annuler')}</button></div>
      </div>
    );
  }

  const pivotCurrency = currencyOf(pivot);
  const pivotRefunded = pivotSide === 'expense' ? refundedByOthers(pivot, modalIncomeIds) : keptOf(pivot);
  const pivotLeft = Math.max(0, roundAmount(pivot.amount - pivotRefunded - checkedTotal));

  return (
    <form className="jr-form" onSubmit={submit} style={{ marginTop: 12 }}>
      <div className="jr-ref full">
        <span>{formatTxDate(pivot.date)} · {txLabel(pivot, categoryById)}</span>
        <strong className="jr-num">{sign(pivot)}{money(pivot.amount, pivotCurrency)}</strong>
      </div>
      <div className={`jr-alloc full${errors.length > 0 ? ' ko' : ''}`}>
        <span>{pivotSide === 'income' ? t('Alloué : {{amount}}', { amount: money(checkedTotal, pivotCurrency) }) : t('Remboursé : {{amount}}', { amount: money(roundAmount(checkedTotal + pivotRefunded), pivotCurrency) })}</span>
        <span>{t('Reste : {{amount}}', { amount: money(pivotLeft, pivotCurrency) })}</span>
      </div>

      {items.length > 0 && (
        <div className="jr-candidates full">
          {items.map((x) => {
            const checked = amounts[x.id] !== undefined;
            return (
              <label key={x.id} className="jr-candidate">
                <input type="checkbox" checked={checked} onChange={(e) => toggle(x, e.target.checked)} />
                <span>{formatTxDate(x.date)} · {txLabel(x, categoryById)}</span>
                <span className="jr-num">{sign(x)}{money(x.amount, currencyOf(x))}</span>
                {checked && (
                  <input
                    className={`jr-candidate-amount${overItems.has(x.id) ? ' ko' : ''}`}
                    inputMode="decimal"
                    value={amounts[x.id]}
                    onChange={(e) => setAmounts((cur) => ({ ...cur, [x.id]: e.target.value }))}
                    aria-label={t('Montant alloué à {{label}}', { label: txLabel(x, categoryById) })}
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
      {loading && <p className="jr-note full">{t('Chargement des liens existants…')}</p>}

      <TxPicker
        userId={userId}
        type={manySide}
        defaultMonth={undefined}
        selectedIds={new Set(Object.keys(amounts).map(Number))}
        excludeIds={new Set([pivot.id])}
        accountById={accountById}
        categoryById={categoryById}
        onToggle={(tx, on) => toggle(tx, on)}
        label={manySide === 'expense' ? t('Ajouter des dépenses') : t('Ajouter des revenus')}
      />

      {errors.map((e) => <p key={e} className="jr-error full">{e}</p>)}
      <div className="jr-form-actions full">
        <span className="jr-spacer" />
        <button type="button" className="secondary" onClick={onClose}>{t('Annuler')}</button>
        <button className="primary" disabled={busy || loading || errors.length > 0 || !changed}>{t('Enregistrer')}</button>
      </div>
    </form>
  );
}

// ---- Recherche d'opérations (toutes périodes, ou un mois) --------------------

function TxPicker({ userId, type, defaultMonth, selectedIds, excludeIds, accountById, categoryById, onToggle, single = false, label }: {
  userId: number;
  type: 'income' | 'expense';
  defaultMonth?: string;
  selectedIds: Set<number>;
  excludeIds: Set<number>;
  accountById: Map<number, Account>;
  categoryById: Map<number, Category>;
  onToggle: (tx: Transaction, on: boolean) => void;
  single?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<'all' | 'month'>('all');
  const [month, setMonth] = useState(defaultMonth ?? currentMonthIso());
  const [candidates, setCandidates] = useState<Transaction[]>([]);
  const [searching, setSearching] = useState(false);

  // Recherche débouncée côté serveur ; libellé ou montant (« 12,50 »).
  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
    const range = period === 'month' ? { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` } : {};
    const timer = setTimeout(() => {
      api.findTransactions(userId, { type, q: query.trim() || undefined, limit: 100, ...range })
        .then((rows) => { if (!cancelled) setCandidates(rows); })
        .catch(() => { if (!cancelled) setCandidates([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userId, type, query, period, month]);

  const visible = candidates.filter((tx) => !excludeIds.has(tx.id));

  return (
    <div className="full jr-picker">
      <span className="jr-field-label">{label ?? (type === 'expense' ? t('Chercher une dépense') : t('Chercher un revenu'))}</span>
      <div className="jr-picker-bar">
        <div className="jr-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Libellé ou montant…')}
            aria-label={t('Rechercher')}
          />
        </div>
        <select value={period} onChange={(e) => setPeriod(e.target.value as 'all' | 'month')} aria-label={t('Période')}>
          <option value="all">{t('Toutes les dates')}</option>
          <option value="month">{t('Un mois précis')}</option>
        </select>
        {period === 'month' && <MonthPicker value={month} onChange={setMonth} />}
      </div>
      <div className="jr-candidates">
        {searching && visible.length === 0 && <p className="empty">{t('Recherche…')}</p>}
        {!searching && visible.length === 0 && <p className="empty">{t('Aucune opération trouvée.')}</p>}
        {visible.map((tx) => {
          const c = accountById.get(tx.account_id ?? -1)?.currency ?? 'EUR';
          const refunded = tx.type === 'expense' ? refundedAmount(tx) : (tx.refund_allocations ?? []).reduce((s, a) => s + a.amount, 0);
          const checked = selectedIds.has(tx.id);
          return (
            <label key={tx.id} className="jr-candidate">
              <input type={single ? 'radio' : 'checkbox'} name={single ? 'jr-pick' : undefined} checked={checked} onChange={(e) => onToggle(tx, e.target.checked)} />
              <span>
                {formatTxDate(tx.date)} · {txLabel(tx, categoryById)}
                {refunded > 0 && <small> · {tx.type === 'expense' ? t('déjà remboursé {{amount}}', { amount: money(refunded, c) }) : t('déjà alloué {{amount}}', { amount: money(refunded, c) })}</small>}
              </span>
              <span className="jr-num">{tx.type === 'income' ? '+' : '−'}{money(tx.amount, c)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
