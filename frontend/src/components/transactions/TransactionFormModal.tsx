import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { Account, Category, CreateTransactionBody, Tag, Transaction, TransactionType } from '@suzanne/shared';
import { api } from '../../lib/api';
import { pickableAccounts } from '../../lib/account';
import { money, todayIso } from '../../lib/format';
import { Modal } from '../Modal';
import { TagPicker } from '../TagPicker';
import type { Run } from '../../lib/run';
import { CategorySelect } from '../CategorySelect';
import {
  amountInput,
  emptySplitDraft,
  parseAmount,
  prefilledSplitDrafts,
  roundAmount,
  splitDraftsFromTransaction,
  type SplitDraft,
} from './txUtils';

export type TxFormMode = 'create' | 'edit' | 'copy' | 'split';

// Valeurs reprises de la saisie rapide (« Plus d'options »).
export interface TxDraft {
  type: TransactionType;
  amount: string;
  description: string;
  category_id: string;
  account_id: string;
  date: string;
  tag_ids?: number[];
}

const idOrNull = (value: string): number | null => {
  const n = Number(value);
  return value && Number.isFinite(n) && n > 0 ? n : null;
};

// Formulaire unique d'une transaction : création, modification, copie et
// ventilation. Ne se ferme qu'une fois l'appel réussi.
export function TransactionFormModal({ mode, tx, draft, userId, accounts, categories, tags, run, onClose, onSaved, extraActions }: {
  mode: TxFormMode;
  tx?: Transaction | null;
  draft?: Partial<TxDraft> | null;
  userId: number;
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  run: Run;
  onClose: () => void;
  onSaved?: () => void;
  /** Menu « ⋯ » des autres actions (mode édition). */
  extraActions?: ReactNode;
}) {
  const { t } = useTranslation();
  const source = mode === 'create' ? null : tx ?? null;
  const [type, setType] = useState<TransactionType>(source?.type ?? draft?.type ?? 'expense');
  const [amount, setAmount] = useState(source ? amountInput(source.amount) : draft?.amount ?? '');
  const [date, setDate] = useState(mode === 'copy' ? todayIso() : source?.date.slice(0, 10) ?? draft?.date ?? todayIso());
  const [accountId, setAccountId] = useState(String(source?.account_id ?? draft?.account_id ?? ''));
  const [toAccountId, setToAccountId] = useState(String(source?.to_account_id ?? ''));
  const [categoryId, setCategoryId] = useState(String(source?.category_id ?? draft?.category_id ?? ''));
  const [description, setDescription] = useState(source?.description ?? draft?.description ?? '');
  const [tagIds, setTagIds] = useState<number[]>(() => (source ? (source.tags ?? []).map((tag) => tag.id) : draft?.tag_ids ?? []));
  const [cleared, setCleared] = useState(mode === 'edit' || mode === 'split' ? source?.cleared ?? false : false);
  const hasSplits = (source?.splits ?? []).length > 0;
  const [splitEnabled, setSplitEnabled] = useState(mode === 'split' || hasSplits);
  const [splits, setSplits] = useState<SplitDraft[]>(() => {
    if (source && hasSplits) return splitDraftsFromTransaction(source);
    if (mode === 'split' && source) return prefilledSplitDrafts(source.category_id, amountInput(source.amount));
    return [emptySplitDraft(), emptySplitDraft()];
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isTransfer = type === 'transfer';
  const typedCategories = useMemo(() => categories.filter((c) => c.type === type), [categories, type]);
  const amountValue = parseAmount(amount);
  const currency = accounts.find((a) => String(a.id) === accountId)?.currency ?? 'EUR';

  const changeType = (next: TransactionType) => {
    setType(next);
    const current = categories.find((c) => String(c.id) === categoryId);
    if (current && current.type !== next) setCategoryId('');
    if (next !== 'transfer') {
      setSplits((rows) => rows.map((row) => {
        const cat = categories.find((c) => String(c.id) === row.category_id);
        return cat && cat.type !== next ? { ...row, category_id: '' } : row;
      }));
    }
  };

  const toggleSplit = (on: boolean) => {
    setSplitEnabled(on);
    if (on && splits.every((row) => !row.category_id && !row.amount)) {
      setSplits(prefilledSplitDrafts(categoryId, amount));
    }
  };

  const validate = (): string | null => {
    if (!(amountValue > 0)) return t('operations.enter_positive_amount_e_g');
    if (!date) return t('operations.choose_date');
    if (isTransfer) {
      if (!idOrNull(accountId) || !idOrNull(toAccountId)) return t('operations.a_transfer_needs_source_and');
      if (accountId === toAccountId) return t('operations.the_two_accounts_transfer_must');
    }
    if (!isTransfer && splitEnabled) {
      if (splits.length === 0) return t('operations.add_at_least_one_split');
      for (const row of splits) {
        if (!row.category_id || !(parseAmount(row.amount) > 0)) {
          return t('operations.each_split_line_needs_category');
        }
      }
      const total = roundAmount(splits.reduce((sum, row) => sum + parseAmount(row.amount), 0));
      if (Math.abs(total - roundAmount(amountValue)) > 0.01) {
        return t('operations.the_split_total_must_equal', { total: money(total, currency), amount: money(amountValue, currency) });
      }
    }
    return null;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem || busy) return;
    const useSplits = !isTransfer && splitEnabled;
    const body: CreateTransactionBody = {
      type,
      amount: roundAmount(amountValue),
      date,
      description: description.trim(),
      account_id: idOrNull(accountId),
      to_account_id: isTransfer ? idOrNull(toAccountId) : null,
      category_id: isTransfer || useSplits ? null : idOrNull(categoryId),
      tag_ids: tagIds,
    };
    if (useSplits) {
      body.splits = splits.map((row) => ({ category_id: Number(row.category_id), amount: roundAmount(parseAmount(row.amount)), note: row.note.trim() || null }));
    } else if (mode === 'edit' || mode === 'split') {
      body.splits = [];
    }
    if (mode !== 'create') body.cleared = cleared;
    setBusy(true);
    const ok = mode === 'edit' || mode === 'split'
      ? await run(() => api.updateTransaction(userId, source!.id, body), mode === 'split' ? t('operations.split_saved') : t('operations.transaction_updated'))
      : await run(() => api.createTransaction(userId, body), mode === 'copy' ? t('operations.transaction_copied') : t('operations.transaction_added'));
    setBusy(false);
    if (ok) {
      onSaved?.();
      onClose();
    }
  };

  const title = mode === 'create' ? t('operations.new_transaction')
    : mode === 'copy' ? t('operations.copy_transaction')
    : mode === 'split' ? t('operations.split_transaction')
    : t('operations.edit_transaction');
  const submitLabel = mode === 'create' ? t('operations.add') : mode === 'copy' ? t('operations.create_copy') : t('operations.save');

  return (
    <Modal title={title} onClose={onClose}>
      <form className="jr-form" onSubmit={submit} noValidate>
        <div className="jr-seg full" role="radiogroup" aria-label={t('operations.transaction_type')}>
          {(['expense', 'income', 'transfer'] as const).map((value) => (
            <button key={value} type="button" role="radio" aria-checked={type === value} className={type === value ? 'on' : ''} onClick={() => changeType(value)}>
              {value === 'expense' ? t('operations.expense') : value === 'income' ? t('operations.income') : t('operations.transfer')}
            </button>
          ))}
        </div>
        <label>{t('operations.amount')}
          <input
            className="jr-amount-input"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            required
            autoFocus={mode === 'create' || mode === 'copy'}
          />
        </label>
        <label>{t('operations.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className="full">{t('operations.label')}
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('operations.e_g_walmart_salary_rent')} />
        </label>
        <label>{isTransfer ? t('operations.from_account') : t('operations.account')}
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{isTransfer ? t('operations.choose') : t('operations.none')}</option>
            {pickableAccounts(accounts, source?.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {isTransfer ? (
          <label>{t('operations.to_account')}
            <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              <option value="">{t('operations.choose')}</option>
              {pickableAccounts(accounts, source?.to_account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        ) : (
          <label>{t('commun.category')}
            <CategorySelect
              value={splitEnabled ? '' : categoryId}
              onChange={setCategoryId}
              disabled={splitEnabled}
              categories={typedCategories}
              noneLabel={splitEnabled ? t('operations.split_3') : t('operations.none_2')}
              ariaLabel={t('commun.category')}
            />
          </label>
        )}
        {!isTransfer && (
          <label className="jr-check full">
            <input type="checkbox" checked={splitEnabled} onChange={(e) => toggleSplit(e.target.checked)} />
            {t('operations.split_across_several_categories')}
          </label>
        )}
        {!isTransfer && splitEnabled && (
          <SplitEditor drafts={splits} categories={typedCategories} target={amountValue > 0 ? amountValue : 0} currency={currency} onChange={setSplits} />
        )}
        <div className="full jr-field">
          <span className="jr-field-label">{t('operations.tags')}</span>
          <TagPicker value={tagIds} tags={tags} onChange={setTagIds} />
        </div>
        {(mode === 'edit' || mode === 'split') && (
          <label className="jr-check full">
            <input type="checkbox" checked={cleared} onChange={(e) => setCleared(e.target.checked)} />
            {t('operations.cleared_matched_with_statement')}
          </label>
        )}
        {error && <p className="jr-error full" role="alert">{error}</p>}
        <div className="jr-form-actions full">
          {extraActions}
          <span className="jr-spacer" />
          <button type="button" className="secondary" onClick={onClose}>{t('commun.cancel')}</button>
          <button className="primary" disabled={busy}>{submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

// Éditeur de ventilation : la somme des lignes doit atteindre le montant (la
// « cible »). Le reste s'affiche en direct ; « solde » complète une ligne.
function SplitEditor({ drafts, categories, target, currency, onChange }: {
  drafts: SplitDraft[];
  categories: Category[];
  target: number;
  currency: string;
  onChange: (drafts: SplitDraft[]) => void;
}) {
  const { t } = useTranslation();
  const value = (raw: string) => { const n = parseAmount(raw); return Number.isFinite(n) ? n : 0; };
  const update = (key: string, patch: Partial<SplitDraft>) => onChange(drafts.map((row) => row.key === key ? { ...row, ...patch } : row));
  const remove = (key: string) => onChange(drafts.filter((row) => row.key !== key));
  const total = roundAmount(drafts.reduce((sum, row) => sum + value(row.amount), 0));
  const remaining = roundAmount(target - total);
  const balanced = target > 0 && Math.abs(remaining) <= 0.01;
  const fill = (key: string) => {
    const others = drafts.reduce((sum, row) => row.key === key ? sum : sum + value(row.amount), 0);
    const next = roundAmount(target - others);
    if (next > 0) update(key, { amount: amountInput(next) });
  };
  return (
    <div className="jr-split full">
      <div className="jr-split-head">
        <strong>{t('operations.split')}</strong>
        <span className={balanced ? 'ok' : target > 0 ? 'ko' : undefined}>
          {target > 0
            ? (balanced
              ? t('operations.amount_split', { amount: money(total, currency) })
              : `${money(total, currency)} / ${money(target, currency)} · ${t('operations.remaining_amount_2', { amount: money(remaining, currency) })}`)
            : t('operations.lines_total_amount', { amount: money(total, currency) })}
        </span>
      </div>
      {drafts.map((row) => (
        <div className="jr-split-row" key={row.key}>
          <CategorySelect
            value={row.category_id}
            onChange={(v) => update(row.key, { category_id: v })}
            categories={categories}
            noneLabel={t('commun.category')}
            ariaLabel={t('operations.split_category')}
          />
          <div className="jr-split-amount">
            <input inputMode="decimal" autoComplete="off" value={row.amount} onChange={(e) => update(row.key, { amount: e.target.value })} placeholder="0,00" aria-label={t('operations.split_amount')} />
            <button type="button" className="jr-link" onClick={() => fill(row.key)} disabled={target <= 0} title={t('operations.fill_with_remainder')}>{t('operations.fill')}</button>
          </div>
          <input value={row.note} onChange={(e) => update(row.key, { note: e.target.value })} placeholder={t('operations.note_e_g_household')} aria-label={t('operations.split_note')} />
          <button type="button" className="icon-ghost" onClick={() => remove(row.key)} aria-label={t('operations.remove_line')}><Trash2 size={16} /></button>
        </div>
      ))}
      <button type="button" className="secondary jr-split-add" onClick={() => onChange([...drafts, emptySplitDraft()])}>
        <Plus size={16} /> {t('operations.add_line')}
      </button>
    </div>
  );
}
