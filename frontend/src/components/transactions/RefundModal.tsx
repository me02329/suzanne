import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { refundedAmount, type Account, type Category, type Transaction } from '@suzanne/shared';
import { api } from '../../lib/api';
import { pickableAccounts } from '../../lib/account';
import { money, todayIso, txLabel } from '../../lib/format';
import { Modal } from '../Modal';
import type { Run } from '../../lib/run';
import { amountInput, formatTxDate, parseAmount, roundAmount } from './txUtils';

// Remboursements. Dépense → « Créer le remboursement » (un revenu lié).
// Revenu → « Lier à une dépense » (ventilé sur une ou plusieurs dépenses).
export function RefundModal(props: {
  tx: Transaction;
  userId: number;
  accounts: Account[];
  accountById: Map<number, Account>;
  categoryById: Map<number, Category>;
  run: Run;
  onClose: () => void;
}) {
  return props.tx.type === 'expense' ? <CreateRefund {...props} /> : <LinkRefund {...props} />;
}

type Props = Parameters<typeof RefundModal>[0];

function CreateRefund({ tx: expense, userId, accounts, accountById, categoryById, run, onClose }: Props) {
  const { t } = useTranslation();
  const currency = accountById.get(expense.account_id ?? -1)?.currency ?? 'EUR';
  const already = refundedAmount(expense);
  const remaining = Math.max(0, roundAmount(expense.amount - already));
  const [amount, setAmount] = useState(amountInput(Math.max(0.01, remaining)));
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState(String(expense.account_id ?? ''));
  const [description, setDescription] = useState(t('Remboursement : {{label}}', { label: txLabel(expense, categoryById) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = parseAmount(amount);
  const surplus = roundAmount(value - remaining);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!(value > 0)) { setError(t('Saisis un montant positif (ex. 12,50).')); return; }
    setError(null);
    // Un remboursement peut dépasser la dépense : on ne nette que le reste
    // remboursable, le surplus reste un simple revenu.
    const allocation = roundAmount(Math.min(value, remaining));
    setBusy(true);
    const ok = await run(() => api.createTransaction(userId, {
      type: 'income',
      refund_allocations: allocation > 0 ? [{ expense_transaction_id: expense.id, amount: allocation }] : [],
      account_id: accountId ? Number(accountId) : null,
      category_id: null,
      amount: roundAmount(value),
      date,
      description: description.trim(),
    }), t('Remboursement enregistré'));
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal title={t('Créer le remboursement')} onClose={onClose}>
      <form className="jr-form" onSubmit={submit} noValidate>
        <div className="jr-ref full">
          <span>{formatTxDate(expense.date)} · {txLabel(expense, categoryById)}</span>
          <strong className="jr-num">{money(expense.amount, currency)}</strong>
        </div>
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
            {pickableAccounts(accounts, expense.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
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
    </Modal>
  );
}

function LinkRefund({ tx: income, userId, accountById, categoryById, run, onClose }: Props) {
  const { t } = useTranslation();
  const currency = accountById.get(income.account_id ?? -1)?.currency ?? 'EUR';
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Transaction[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<number, string>>(() => {
    const allocations = income.refund_allocations ?? [];
    if (allocations.length > 0) return Object.fromEntries(allocations.map((a) => [a.expense_transaction_id, amountInput(a.amount)]));
    return income.refunds_transaction_id != null ? { [income.refunds_transaction_id]: amountInput(income.amount) } : {};
  });
  const existing = useMemo(
    () => new Map((income.refund_allocations ?? []).map((a) => [a.expense_transaction_id, a])),
    [income.refund_allocations],
  );
  const num = (raw: string | undefined) => { const n = parseAmount(raw ?? ''); return Number.isFinite(n) ? n : 0; };
  const selectedTotal = roundAmount(Object.values(selected).reduce((sum, v) => sum + num(v), 0));
  const selectedCount = Object.keys(selected).length;
  const overAllocated = selectedTotal - income.amount > 0.01;
  // Reste remboursable d'une dépense (l'allocation actuelle de ce revenu, qui
  // sera remplacée, est exclue).
  const remainingFor = (tx: Transaction) => roundAmount(tx.amount - (refundedAmount(tx) - (existing.get(tx.id)?.amount ?? 0)));
  const overExpense = new Set(candidates.filter((tx) => selected[tx.id] !== undefined && num(selected[tx.id]) - remainingFor(tx) > 0.01).map((tx) => tx.id));

  // Recherche débouncée côté serveur (toutes périodes) ; sans requête : les plus récentes.
  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api.findTransactions(userId, { type: 'expense', q: query.trim() || undefined, limit: 20 })
        .then((rows) => { if (!cancelled) setCandidates(rows); })
        .catch(() => { if (!cancelled) setCandidates([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userId, query]);

  const save = async (allocations: Array<{ expense_transaction_id: number; amount: number }>) => {
    setBusy(true);
    const ok = await run(
      () => api.updateTransaction(userId, income.id, { refund_allocations: allocations }),
      allocations.length > 0
        ? t(allocations.length > 1 ? 'Remboursement ventilé sur {{n}} dépenses' : 'Remboursement ventilé sur {{n}} dépense', { n: allocations.length })
        : t('Lien de remboursement retiré'),
    );
    setBusy(false);
    if (ok) onClose();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const allocations = Object.entries(selected)
      .map(([id, v]) => ({ expense_transaction_id: Number(id), amount: roundAmount(num(v)) }))
      .filter((a) => a.expense_transaction_id > 0 && a.amount > 0);
    if (allocations.length === 0 || overAllocated || overExpense.size > 0) return;
    void save(allocations);
  };

  const toggle = (tx: Transaction, on: boolean) => {
    setSelected((current) => {
      const next = { ...current };
      if (!on) { delete next[tx.id]; return next; }
      const others = Object.entries(next).filter(([id]) => Number(id) !== tx.id).reduce((s, [, v]) => s + num(v), 0);
      next[tx.id] = amountInput(Math.min(Math.max(0.01, income.amount - others), Math.max(0.01, tx.amount - refundedAmount(tx))));
      return next;
    });
  };

  const labelFor = (id: number) => {
    const c = candidates.find((tx) => tx.id === id);
    if (c) return `${formatTxDate(c.date)} · ${txLabel(c, categoryById)}`;
    const e = existing.get(id)?.expense_transaction;
    if (e) return `${formatTxDate(e.date)} · ${e.description ?? t('Dépense #{{id}}', { id: e.id })}`;
    return t('Dépense #{{id}}', { id });
  };

  return (
    <Modal title={t('Lier à une dépense')} onClose={onClose}>
      <form className="jr-form" onSubmit={submit}>
        <div className="jr-ref full">
          <span>{formatTxDate(income.date)} · {txLabel(income, categoryById)}</span>
          <strong className="jr-num">+{money(income.amount, currency)}</strong>
        </div>
        <div className={`jr-alloc full${overAllocated ? ' ko' : ''}`}>
          <span>{t('Alloué : {{amount}}', { amount: money(selectedTotal, currency) })}</span>
          <span>{t('Reste : {{amount}}', { amount: money(Math.max(0, roundAmount(income.amount - selectedTotal)), currency) })}</span>
        </div>
        {selectedCount > 0 && (
          <ul className="jr-alloc-list full">
            {Object.entries(selected).map(([id, v]) => (
              <li key={id}><span>{labelFor(Number(id))}</span><span className="jr-num">{money(num(v), currency)}</span></li>
            ))}
          </ul>
        )}
        <label className="full">{t('Chercher la dépense')}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Ex: Carrefour, restaurant...')} autoFocus />
        </label>
        <div className="jr-candidates full">
          {searching && candidates.length === 0 && <p className="empty">{t('Recherche…')}</p>}
          {!searching && candidates.length === 0 && <p className="empty">{t('Aucune dépense trouvée.')}</p>}
          {candidates.map((tx) => {
            const c = accountById.get(tx.account_id ?? -1)?.currency ?? 'EUR';
            const refunded = refundedAmount(tx);
            const checked = selected[tx.id] !== undefined;
            return (
              <label key={tx.id} className="jr-candidate">
                <input type="checkbox" checked={checked} onChange={(e) => toggle(tx, e.target.checked)} />
                <span>
                  {formatTxDate(tx.date)} · {txLabel(tx, categoryById)}
                  {refunded > 0 && <small> · {t('déjà remboursé {{amount}}', { amount: money(refunded, c) })}</small>}
                </span>
                <span className="jr-num">{money(tx.amount, c)}</span>
                {checked && (
                  <input
                    className={`jr-candidate-amount${overExpense.has(tx.id) ? ' ko' : ''}`}
                    inputMode="decimal"
                    value={selected[tx.id]}
                    onChange={(e) => setSelected((cur) => ({ ...cur, [tx.id]: e.target.value }))}
                    aria-label={t('Montant alloué à {{label}}', { label: txLabel(tx, categoryById) })}
                  />
                )}
              </label>
            );
          })}
        </div>
        {overAllocated && <p className="jr-error full">{t('Le total alloué dépasse le montant du remboursement.')}</p>}
        {overExpense.size > 0 && <p className="jr-error full">{t('Une allocation dépasse le reste remboursable de sa dépense.')}</p>}
        <div className="jr-form-actions full">
          {selectedCount > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => void save([])}>{t('Retirer les liens')}</button>}
          <span className="jr-spacer" />
          <button type="button" className="secondary" onClick={onClose}>{t('Annuler')}</button>
          <button className="primary" disabled={busy || selectedCount === 0 || overAllocated || overExpense.size > 0}>{t('Enregistrer')}</button>
        </div>
      </form>
    </Modal>
  );
}
