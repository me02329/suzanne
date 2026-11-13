import { FormEvent, useState } from 'react';
import { Pencil, Plus, Repeat, RotateCcw, Trash2 } from 'lucide-react';
import type { BudgetStatus, Category } from '@suzanne/shared';
import { api } from '../lib/api';
import { formatMonthLong, money } from '../lib/format';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/ui/RowMenu';
import { amountInputValue, positiveAmount } from '../components/home/amount';
import type { Run } from '../lib/run';
import '../styles/pages/plan.css';

// Budgets du mois. Structure volontairement découpée (résumé / ligne /
// formulaire) pour accueillir plus tard : budget global, projection de rythme,
// suggestions, enveloppes d'épargne.

/** Part consommée d'un budget (non plafonnée) ; null si limite nulle et rien dépensé. */
export function budgetUsage(b: Pick<BudgetStatus, 'spent' | 'effective_limit'>): number | null {
  if (b.effective_limit > 0) return b.spent / b.effective_limit;
  return b.spent > 0 ? Infinity : null;
}

function meterTone(ratio: number | null): string {
  if (ratio == null) return 'meter';
  if (ratio >= 1) return 'meter over';
  if (ratio >= 0.8) return 'meter warn';
  return 'meter';
}

const pctLabel = (ratio: number | null) => (ratio == null ? '—' : ratio === Infinity ? '∞' : `${Math.round(ratio * 100)} %`);

export function Budgets({ userId, month, categories, budgets, run }: {
  userId: number;
  month: string;
  categories: Category[];
  budgets: BudgetStatus[];
  run: Run;
}) {
  // null = fermé ; 'new' = création ; sinon édition du budget donné.
  const [form, setForm] = useState<'new' | BudgetStatus | null>(null);
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  const totalLimit = budgets.reduce((sum, b) => sum + Math.max(0, b.effective_limit), 0);
  const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
  const totalRatio = totalLimit > 0 ? totalSpent / totalLimit : null;
  const overCount = budgets.filter((b) => (budgetUsage(b) ?? 0) >= 1).length;
  const sorted = [...budgets].sort((a, b) => (budgetUsage(b) ?? -1) - (budgetUsage(a) ?? -1));

  const toggle = (budget: BudgetStatus, key: 'recurring' | 'rollover') => {
    const on = !budget[key];
    const message = key === 'recurring'
      ? (on ? 'Budget reconduit chaque mois' : 'Reconduction arrêtée')
      : (on ? 'Report d’enveloppe activé' : 'Report d’enveloppe désactivé');
    void run(() => api.setBudget(userId, {
      category_id: budget.category_id,
      month: budget.month,
      amount_limit: budget.amount_limit,
      [key]: on,
    }), message);
  };

  // Suppression annulable : l'upsert recrée le budget à l'identique.
  const remove = (budget: BudgetStatus) => {
    void run(() => api.deleteBudget(userId, budget.id), 'Budget supprimé', {
      undo: () => api.setBudget(userId, {
        category_id: budget.category_id,
        month: budget.month,
        amount_limit: budget.amount_limit,
        recurring: budget.recurring,
        rollover: budget.rollover,
      }),
    });
  };

  return (
    <section className="pg budgets-page">
      <div className="pg-hero">
        <div>
          <span className="pg-kicker">Budgets · {formatMonthLong(month)}</span>
          {budgets.length > 0 ? (
            <>
              <strong className="pg-hero-value">
                {money(totalSpent)} <small>/ {money(totalLimit)}</small>
              </strong>
              <p className="pg-hero-sub">
                {totalLimit - totalSpent >= 0
                  ? <>Reste <strong>{money(totalLimit - totalSpent)}</strong> sur {budgets.length} budget{budgets.length > 1 ? 's' : ''}</>
                  : <>Dépassement global de <strong className="expense">{money(totalSpent - totalLimit)}</strong></>}
                {overCount > 0 && <> · {overCount} dépassé{overCount > 1 ? 's' : ''}</>}
              </p>
            </>
          ) : (
            <p className="pg-hero-sub">Aucun budget ce mois-ci.</p>
          )}
        </div>
        <div className="pg-toolbar-actions">
          <button type="button" className="primary accent" onClick={() => setForm('new')}>
            <Plus size={16} /> Nouveau budget
          </button>
        </div>
        {budgets.length > 0 && (
          <div className="pg-hero-meter">
            <div className={`${meterTone(totalRatio)} big`}><span style={{ width: `${Math.max(0, Math.min(100, (totalRatio ?? 0) * 100))}%` }} /></div>
          </div>
        )}
      </div>

      <div className="pg-card">
        <div className="pg-card-head">
          <h2>Par catégorie</h2>
          {budgets.length > 0 && <span className="pg-card-meta">{pctLabel(totalRatio)}</span>}
        </div>
        {budgets.length === 0 ? (
          <p className="pg-empty">
            <strong>Pas encore de budget</strong>
            Fixe une limite mensuelle par catégorie : rien n’est bloqué, c’est un garde-fou.
          </p>
        ) : (
          <ul className="lrows">
            {sorted.map((b) => (
              <BudgetRow
                key={b.id}
                budget={b}
                category={categoryById.get(b.category_id)}
                onEdit={() => setForm(b)}
                onToggle={(key) => toggle(b, key)}
                onDelete={() => remove(b)}
              />
            ))}
          </ul>
        )}
      </div>

      {form && (
        <BudgetFormModal
          userId={userId}
          month={month}
          categories={categories}
          budgets={budgets}
          editing={form === 'new' ? null : form}
          run={run}
          onClose={() => setForm(null)}
        />
      )}
    </section>
  );
}

function BudgetRow({ budget: b, category, onEdit, onToggle, onDelete }: {
  budget: BudgetStatus;
  category: Category | undefined;
  onEdit: () => void;
  onToggle: (key: 'recurring' | 'rollover') => void;
  onDelete: () => void;
}) {
  const ratio = budgetUsage(b);
  const remaining = b.effective_limit - b.spent;
  const name = category?.name ?? 'Catégorie';
  return (
    <li className="lrow">
      <div className="lrow-main">
        <div className="lrow-title">
          <span title={name}>{name}</span>
          {b.recurring && <span className="tag" title="Reconduit chaque mois"><Repeat size={11} /> Mensuel</span>}
          {b.rollover && <span className="tag" title="Report d’enveloppe"><RotateCcw size={11} /> Report</span>}
        </div>
        <span className="lrow-sub">
          {remaining >= 0 ? `Reste ${money(remaining)}` : <span className="expense">Dépassé de {money(-remaining)}</span>}
          {b.rollover && b.carried_over !== 0 && ` · ${money(b.amount_limit)} ${b.carried_over >= 0 ? '+' : '−'} ${money(Math.abs(b.carried_over))} reporté`}
        </span>
      </div>
      <div className="lrow-amount">
        <span className={ratio != null && ratio >= 1 ? 'expense' : undefined}>{money(b.spent)}</span>
        <small>sur {money(b.effective_limit)} · {pctLabel(ratio)}</small>
      </div>
      <div className="lrow-actions">
        <button type="button" className="icon-button neutral" aria-label={`Modifier le budget ${name}`} title="Modifier" onClick={onEdit}>
          <Pencil size={17} />
        </button>
        <RowMenu
          items={[
            { label: b.recurring ? 'Arrêter la reconduction' : 'Reconduire chaque mois', icon: <Repeat />, onSelect: () => onToggle('recurring') },
            { label: b.rollover ? 'Désactiver le report' : 'Activer le report d’enveloppe', icon: <RotateCcw />, onSelect: () => onToggle('rollover') },
            { label: 'Supprimer', icon: <Trash2 />, danger: true, onSelect: onDelete },
          ]}
        />
      </div>
      <div className="lrow-extra">
        <div className={meterTone(ratio)}><span style={{ width: `${Math.max(0, Math.min(100, (ratio ?? 0) * 100))}%` }} /></div>
      </div>
    </li>
  );
}

function BudgetFormModal({ userId, month, categories, budgets, editing, run, onClose }: {
  userId: number;
  month: string;
  categories: Category[];
  budgets: BudgetStatus[];
  editing: BudgetStatus | null;
  run: Run;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const taken = new Set(budgets.map((b) => b.category_id));
  // En création, on ne propose que les catégories pas encore budgétées ce mois
  // (l'API ferait un upsert silencieux sur la limite existante).
  const options = categories.filter((c) => c.type === 'expense' && (editing ? c.id === editing.category_id : !taken.has(c.id)));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = positiveAmount(data.get('amount_limit'));
    if (amount == null) { setError('Indique une limite supérieure à 0.'); return; }
    const categoryId = editing ? editing.category_id : Number(data.get('category_id'));
    void run(() => api.setBudget(userId, {
      category_id: categoryId,
      month: editing?.month ?? month,
      amount_limit: amount,
      recurring: data.get('recurring') === 'on',
      rollover: data.get('rollover') === 'on',
    }), editing ? 'Budget mis à jour' : 'Budget enregistré').then((ok) => { if (ok) onClose(); });
  };

  return (
    <Modal title={editing ? 'Modifier le budget' : `Nouveau budget · ${formatMonthLong(month)}`} onClose={onClose}>
      {!editing && options.length === 0 ? (
        <p className="pg-note">Toutes tes catégories de dépense ont déjà un budget ce mois-ci.</p>
      ) : (
        <form className="pg-form" onSubmit={submit}>
          <label className="full">Catégorie
            <select name="category_id" defaultValue={editing?.category_id ?? options[0]?.id} disabled={Boolean(editing)} required>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="full">Limite mensuelle
            <input
              name="amount_limit"
              inputMode="decimal"
              autoComplete="off"
              placeholder="ex. 300"
              defaultValue={amountInputValue(editing?.amount_limit)}
              autoFocus
              required
              onInput={() => setError(null)}
            />
          </label>
          <label className="check full"><input name="recurring" type="checkbox" defaultChecked={editing?.recurring ?? true} /> Reconduire chaque mois</label>
          <label className="check full"><input name="rollover" type="checkbox" defaultChecked={editing?.rollover ?? false} /> Reporter le reste (ou le dépassement) sur le mois suivant</label>
          {error && <p className="hint full expense" role="alert">{error}</p>}
          <div className="pg-form-actions">
            <button type="button" className="secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="primary">{editing ? 'Enregistrer' : 'Créer le budget'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
