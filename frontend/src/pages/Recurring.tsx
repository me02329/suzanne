import { FormEvent, useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, ChevronRight, PauseCircle, Pencil, PlayCircle, Plus, SkipForward, Trash2 } from 'lucide-react';
import { nextRecurringOccurrence, type Account, type Category, type DashboardSummary, type RecurringFrequency, type RecurringTransaction } from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { numberOrNull } from '../lib/forms';
import { formatRelativeDate, money, recurringFrequencyLabel } from '../lib/format';
import { cadenceTotals, groupByCadence, type CadenceGroup } from '../lib/subscriptions';
import { usePersistedState } from '../lib/storage';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/ui/RowMenu';
import { amountInputValue, positiveAmount } from '../components/home/amount';
import type { Run } from '../lib/run';
import '../styles/pages/plan.css';
import { useTranslation } from 'react-i18next';

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
].map((label, i) => ({ value: i + 1, label }));

export function Recurring({ userId, recurring, accounts, categories, categoryById, accountById, summary, reportCurrency, run }: {
  userId: number;
  recurring: RecurringTransaction[];
  accounts: Account[];
  categories: Category[];
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  summary: DashboardSummary | null;
  reportCurrency: string;
  run: Run;
}) {
  const { t } = useTranslation();
  // null = fermé ; 'new' = création ; sinon édition.
  const [form, setForm] = useState<'new' | RecurringTransaction | null>(null);
  const [collapsed, setCollapsed] = usePersistedState<Record<string, boolean>>('recurring_groups_collapsed', {});
  const toggleGroup = (key: string) => setCollapsed({ ...collapsed, [key]: !collapsed[key] });
  const displayCurrency = summary?.currency ?? reportCurrency;

  const rateFor = useMemo(() => {
    const rates = summary?.exchange_rates ?? {};
    return (accountId: number | null) => {
      const currency = (accountId != null ? accountById.get(accountId)?.currency : null) ?? 'EUR';
      return rates[currency] ?? 1;
    };
  }, [summary, accountById]);

  // Par sens puis par cadence : un prélèvement annuel reste annuel (jamais ÷12).
  const expenseGroups = useMemo(() => groupByCadence(recurring.filter((r) => r.type === 'expense'), rateFor), [recurring, rateFor]);
  const incomeGroups = useMemo(() => groupByCadence(recurring.filter((r) => r.type === 'income'), rateFor), [recurring, rateFor]);
  const expenseTotals = useMemo(() => cadenceTotals(recurring.filter((r) => r.type === 'expense' && r.active), rateFor), [recurring, rateFor]);
  const incomeTotals = useMemo(() => cadenceTotals(recurring.filter((r) => r.type === 'income' && r.active), rateFor), [recurring, rateFor]);
  const activeCount = recurring.filter((r) => r.active).length;

  const renderGroups = (groups: CadenceGroup[], prefix: string) => groups.map((group) => {
    const key = `${prefix}:${group.cadence}`;
    const open = !collapsed[key];
    return (
      <div className="pg-group" key={group.cadence}>
        <button type="button" className="pg-group-head" onClick={() => toggleGroup(key)} aria-expanded={open}>
          <span className="pg-group-title">
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {group.label} <small>{group.rows.length}</small>
          </span>
          <strong>{money(group.total, displayCurrency)}<small>{group.unit}</small></strong>
        </button>
        {open && (
          <ul className="lrows">
            {group.rows.map(({ r, native }) => (
              <RecurringRow
                key={r.id}
                r={r}
                native={native}
                unit={group.unit}
                account={accountById.get(r.account_id ?? -1)}
                category={categoryById.get(r.category_id ?? -1)}
                onEdit={() => setForm(r)}
                onSkip={() => void run(() => api.skipRecurring(userId, r.id), 'Prochaine occurrence sautée')}
                onToggleActive={() => void run(() => api.updateRecurring(userId, r.id, { active: !r.active }), r.active ? 'Récurrent mis en pause' : 'Récurrent réactivé')}
                onDelete={() => void run(() => api.deleteRecurring(userId, r.id), 'Récurrent supprimé')}
              />
            ))}
          </ul>
        )}
      </div>
    );
  });

  return (
    <section className="pg recurring-page">
      <div className="pg-hero">
        <div>
          <span className="pg-kicker">{t('operations.recurring.recurring_charges')}</span>
          <strong className="pg-hero-value">
            {money(expenseTotals.monthly, displayCurrency)} <small>{t('operations.recurring.month')}</small>
          </strong>
          <p className="pg-hero-sub">
            {expenseTotals.periodic > 0 && <>+ <strong>{money(expenseTotals.periodic, displayCurrency)}</strong>  {t('operations.recurring.year_periodic')} </>}
            {expenseTotals.weekly > 0 && <>+ <strong>{money(expenseTotals.weekly, displayCurrency)}</strong>  {t('operations.recurring.wk')} </>}
            {incomeTotals.monthly > 0 && <>{t('operations.recurring.income')} <strong className="income">{money(incomeTotals.monthly, displayCurrency)}</strong>  {t('operations.recurring.month_2')} </>}
            {activeCount}  {t('operations.recurring.active')}{activeCount > 1 ? 's' : ''}
          </p>
        </div>
        <div className="pg-toolbar-actions">
          <button type="button" className="secondary" onClick={() => void run(() => api.generateRecurring(userId), 'Récurrents générés')}>
            <CalendarClock size={16} />  {t('operations.recurring.generate_this_month')}
          </button>
          <button type="button" className="primary accent" onClick={() => setForm('new')}>
            <Plus size={16} />  {t('operations.recurring.new_recurring_item')}
          </button>
        </div>
      </div>

      <div className="pg-card">
        <div className="pg-card-head"><h2>{t('operations.recurring.expenses')}</h2></div>
        {expenseGroups.length > 0 ? renderGroups(expenseGroups, 'exp') : (
          <p className="pg-empty"><strong>{t('operations.recurring.no_recurring_expenses')}</strong>{t('operations.recurring.add_rent_subscriptions_insurance_to')}</p>
        )}
      </div>

      {incomeGroups.length > 0 && (
        <div className="pg-card">
          <div className="pg-card-head"><h2>{t('operations.recurring.income_2')}</h2></div>
          {renderGroups(incomeGroups, 'inc')}
        </div>
      )}

      {form && (
        <RecurringFormModal
          userId={userId}
          editing={form === 'new' ? null : form}
          accounts={accounts}
          categories={categories}
          run={run}
          onClose={() => setForm(null)}
        />
      )}
    </section>
  );
}

function RecurringRow({ r, native, unit, account, category, onEdit, onSkip, onToggleActive, onDelete }: {
  r: RecurringTransaction;
  native: number;
  unit: string;
  account: Account | undefined;
  category: Category | undefined;
  onEdit: () => void;
  onSkip: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const occurrence = formatRelativeDate(r.active ? nextRecurringOccurrence(r) : null);
  const soon = occurrence.days != null && occurrence.days <= 7;
  const income = r.type === 'income';
  const meta = [account?.name, category?.name].filter(Boolean).join(' · ');
  return (
    <li className={r.active ? 'lrow' : 'lrow muted'}>
      <div className="lrow-main">
        <div className="lrow-title">
          <span title={r.description}>{r.description}</span>
          {!r.active && <span className="tag">{t('operations.recurring.paused')}</span>}
        </div>
        <span className="lrow-sub">
          {recurringFrequencyLabel(r.frequency, r.interval ?? 1)}
          {r.active && <> · <span className={soon ? 'soon' : undefined}>{occurrence.label}</span></>}
          {meta && <> · {meta}</>}
        </span>
      </div>
      <div className={`lrow-amount ${income ? 'income' : 'expense'}`}>
        {income ? '+' : '−'}{money(native, account?.currency ?? 'EUR')}<small>{unit}</small>
      </div>
      <div className="lrow-actions">
        <button type="button" className="icon-button neutral" aria-label={`Modifier ${r.description}`} title={t('operations.recurring.edit')} onClick={onEdit}>
          <Pencil size={17} />
        </button>
        <RowMenu
          items={[
            {
              label: 'Sauter la prochaine occurrence', icon: <SkipForward />, onSelect: onSkip, disabled: !r.active,
              confirm: `Sauter la prochaine occurrence de « ${r.description} » ? Aucune transaction ne sera créée pour cette échéance.`,
            },
            { label: r.active ? 'Mettre en pause' : 'Réactiver', icon: r.active ? <PauseCircle /> : <PlayCircle />, onSelect: onToggleActive },
            // Pas d'annulation possible (recréer perdrait la date de dernière
            // génération et pourrait dupliquer des transactions) : on confirme.
            { label: 'Supprimer', icon: <Trash2 />, danger: true, onSelect: onDelete, confirm: `Supprimer « ${r.description} » ? Les transactions déjà générées sont conservées.` },
          ]}
        />
      </div>
    </li>
  );
}

function RecurringFormModal({ userId, editing, accounts, categories, run, onClose }: {
  userId: number;
  editing: RecurringTransaction | null;
  accounts: Account[];
  categories: Category[];
  run: Run;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [freq, setFreq] = useState<RecurringFrequency>(editing?.frequency ?? 'monthly');
  const [type, setType] = useState<'expense' | 'income'>(editing?.type ?? 'expense');
  const [error, setError] = useState<string | null>(null);
  const currentMonth = new Date().getMonth() + 1;
  const categoryOptions = categories.filter((c) => c.type === type || c.id === editing?.category_id);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = positiveAmount(data.get('amount'));
    if (amount == null) { setError('Indique un montant supérieur à 0.'); return; }
    const body = {
      account_id: numberOrNull(data.get('account_id')),
      category_id: numberOrNull(data.get('category_id')),
      amount,
      type,
      description: String(data.get('description')).trim(),
      frequency: freq,
      interval: Number(data.get('interval') || 1),
      day_of_month: data.get('day_of_month') ? Number(data.get('day_of_month')) : (editing?.day_of_month ?? 1),
      month_of_year: freq === 'yearly' ? numberOrNull(data.get('month_of_year')) : null,
      end_date: String(data.get('end_date') || '') || null,
    };
    const op = editing
      ? run(() => api.updateRecurring(userId, editing.id, body), 'Récurrent modifié')
      : run(() => api.createRecurring(userId, { ...body, active: true }), 'Récurrent ajouté');
    void op.then((ok) => { if (ok) onClose(); });
  };

  return (
    <Modal title={editing ? `Modifier « ${editing.description} »` : 'Nouveau récurrent'} onClose={onClose}>
      <form className="pg-form" onSubmit={submit}>
        <label className="full">{t('operations.recurring.label')}<input name="description" defaultValue={editing?.description ?? ''} placeholder={t('operations.recurring.e_g_rent_netflix')} required autoFocus /></label>
        <label>{t('operations.recurring.type')}
          <select value={type} onChange={(e) => setType(e.target.value as 'expense' | 'income')}>
            <option value="expense">{t('operations.recurring.expense')}</option>
            <option value="income">{t('operations.recurring.income_3')}</option>
          </select>
        </label>
        <label>{t('operations.recurring.amount')}
          <input name="amount" inputMode="decimal" autoComplete="off" defaultValue={amountInputValue(editing?.amount)} required onInput={() => setError(null)} />
        </label>
        <label>{t('operations.recurring.repeat')}
          <select value={freq} onChange={(e) => setFreq(e.target.value as RecurringFrequency)}>
            <option value="weekly">{t('operations.recurring.every_week')}</option>
            <option value="monthly">{t('operations.recurring.every_month')}</option>
            <option value="yearly">{t('operations.recurring.every_year')}</option>
          </select>
        </label>
        <label>{t('operations.recurring.every_interval')}<input name="interval" type="number" inputMode="numeric" min="1" max="120" defaultValue={editing?.interval ?? 1} required /></label>
        {freq === 'yearly' && (
          <label>{t('operations.recurring.month_3')}
            <select name="month_of_year" defaultValue={editing?.month_of_year ?? currentMonth}>
              {MONTHS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
        )}
        {freq !== 'weekly' && (
          <label>{t('operations.recurring.day_month')}<input name="day_of_month" type="number" inputMode="numeric" min="1" max="31" defaultValue={editing?.day_of_month ?? 1} /></label>
        )}
        <label>{t('operations.recurring.account')}
          <select name="account_id" defaultValue={editing?.account_id ?? ''}>
            <option value="">{t('operations.recurring.none')}</option>
            {pickableAccounts(accounts, editing?.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>{t('operations.recurring.category')}
          <select name="category_id" defaultValue={editing?.category_id ?? ''}>
            <option value="">{t('operations.recurring.none_2')}</option>
            {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="full">{t('operations.recurring.end_optional')}
          <input name="end_date" type="date" defaultValue={editing?.end_date ? editing.end_date.slice(0, 10) : ''} />
          <span className="hint">{t('operations.recurring.no_occurrences_will_be_generated')}</span>
        </label>
        {error && <p className="hint full expense" role="alert">{error}</p>}
        <div className="pg-form-actions">
          <button type="button" className="secondary" onClick={onClose}>{t('operations.recurring.cancel')}</button>
          <button type="submit" className="primary">{editing ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Modal>
  );
}
