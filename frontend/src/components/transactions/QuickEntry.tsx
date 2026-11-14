import { forwardRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { Account, Category } from '@suzanne/shared';
import { api } from '../../lib/api';
import { pickableAccounts } from '../../lib/account';
import { todayIso } from '../../lib/format';
import type { Run } from '../../lib/run';
import type { TxDraft } from './TransactionFormModal';
import { parseAmount, roundAmount } from './txUtils';

type QuickType = 'expense' | 'income';

// Saisie rapide : LE point d'entrée pour ajouter une opération. « Plus
// d'options » ouvre le formulaire complet prérempli (transfert, ventilation,
// tags…).
export const QuickEntry = forwardRef<HTMLInputElement, {
  userId: number;
  accounts: Account[];
  categories: Category[];
  run: Run;
  onMore: (draft: TxDraft) => void;
}>(function QuickEntry({ userId, accounts, categories, run, onMore }, amountRef) {
  const { t } = useTranslation();
  const [type, setType] = useState<QuickType>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  // Sur mobile, les champs secondaires apparaissent au premier focus et restent
  // visibles : les replier au blur décalerait la page sous le doigt.
  const [engaged, setEngaged] = useState(false);

  const typed = categories.filter((c) => c.type === type);
  const expanded = engaged || amount !== '' || description !== '';

  const switchType = (next: QuickType) => {
    setType(next);
    if (categories.find((c) => String(c.id) === categoryId)?.type !== next) setCategoryId('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = parseAmount(amount);
    if (!(value > 0)) {
      setInvalid(true);
      (amountRef as React.RefObject<HTMLInputElement>)?.current?.focus();
      return;
    }
    setBusy(true);
    const ok = await run(() => api.createTransaction(userId, {
      type,
      amount: roundAmount(value),
      description: description.trim(),
      category_id: categoryId ? Number(categoryId) : null,
      account_id: accountId ? Number(accountId) : null,
      date: date || todayIso(),
    }), t('operations.transaction_added'));
    setBusy(false);
    if (!ok) return;
    // Saisies en chaîne : on garde compte et date, on revient sur le montant.
    setAmount('');
    setDescription('');
    setCategoryId('');
    setInvalid(false);
    (amountRef as React.RefObject<HTMLInputElement>)?.current?.focus();
  };

  return (
    <form
      className={`jr-quick${expanded ? ' expanded' : ''}`}
      onSubmit={submit}
      onFocus={() => setEngaged(true)}
      aria-label={t('operations.quick_entry')}
      noValidate
    >
      <div className="jr-seg jr-quick-type" role="radiogroup" aria-label={t('operations.transaction_type')}>
        <button type="button" role="radio" aria-checked={type === 'expense'} className={type === 'expense' ? 'on' : ''} onClick={() => switchType('expense')}>{t('operations.expense')}</button>
        <button type="button" role="radio" aria-checked={type === 'income'} className={type === 'income' ? 'on' : ''} onClick={() => switchType('income')}>{t('operations.income')}</button>
      </div>
      <input
        ref={amountRef}
        className="jr-quick-amount"
        inputMode="decimal"
        autoComplete="off"
        placeholder={t('operations.amount')}
        aria-label={t('operations.amount')}
        aria-invalid={invalid || undefined}
        value={amount}
        onChange={(e) => { setAmount(e.target.value); setInvalid(false); }}
      />
      <input className="jr-quick-label" placeholder={t('operations.label')} aria-label={t('operations.label')} value={description} onChange={(e) => setDescription(e.target.value)} />
      <select className="jr-quick-extra" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label={t('commun.category')}>
        <option value="">{t('commun.category')}</option>
        {typed.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select className="jr-quick-extra" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t('operations.account')}>
        <option value="">{t('operations.account')}</option>
        {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <input className="jr-quick-extra" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t('operations.date')} />
      <button className="primary accent jr-quick-add" disabled={busy}><Plus size={16} /> <span>{t('operations.add')}</span></button>
      <button
        type="button"
        className="jr-link jr-quick-more"
        onClick={() => onMore({ type, amount, description, category_id: categoryId, account_id: accountId, date })}
      >
        {t('operations.more_options')}
      </button>
      {invalid && <p className="jr-error jr-quick-error" role="alert">{t('operations.enter_positive_amount_e_g')}</p>}
    </form>
  );
});
