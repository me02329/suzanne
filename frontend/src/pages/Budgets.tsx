import { FormEvent, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Repeat, RotateCcw, Target, X } from 'lucide-react';
import type { BudgetStatus, Category } from '@suzanne/shared';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';
import { Collapsible } from '../components/Collapsible';

import type { Run } from '../lib/run';

export function Budgets({ userId, month, categories, budgets, run }: {
  userId: number;
  month: string;
  categories: Category[];
  budgets: BudgetStatus[];
  run: Run;
}) {
  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const [addOpen, setAddOpen] = usePersistedState<boolean>('budgets_add_open', budgets.length === 0);
  // Édition inline de la limite : l'upsert du backend conserve les flags
  // (recurring/rollover) quand on les omet, donc on ne renvoie que le montant.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const saveLimit = (budget: BudgetStatus) => {
    const amount = Number(editValue);
    if (!Number.isFinite(amount) || amount <= 0) return;
    void run(() => api.setBudget(userId, {
      category_id: budget.category_id,
      month: budget.month,
      amount_limit: amount,
    }), 'Limite mise à jour').then((ok) => { if (ok) setEditingId(null); });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(() => api.setBudget(userId, {
      category_id: Number(data.get('category_id')),
      month,
      amount_limit: Number(data.get('amount_limit')),
      ...(data.get('recurring') === 'on' ? { recurring: true } : {}),
      ...(data.get('rollover') === 'on' ? { rollover: true } : {}),
    }), 'Budget enregistré').then((ok) => {
      if (ok) form.reset();
    });
  };
  const toggleRecurring = (budget: BudgetStatus) => {
    void run(() => api.setBudget(userId, {
      category_id: budget.category_id,
      month: budget.month,
      amount_limit: budget.amount_limit,
      recurring: !budget.recurring,
    }), budget.recurring ? 'Reconduction arrêtée' : 'Budget reconduit chaque mois');
  };
  const toggleRollover = (budget: BudgetStatus) => {
    void run(() => api.setBudget(userId, {
      category_id: budget.category_id,
      month: budget.month,
      amount_limit: budget.amount_limit,
      rollover: !budget.rollover,
    }), budget.rollover ? 'Report d\'enveloppe désactivé' : 'Report d\'enveloppe activé');
  };
  return (
    <section className="stack">
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> Nouveau budget · {month}</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={addOpen} className="collapsible-body">
            <p className="panel-note">
              Limite mensuelle de dépense par catégorie. Ne bloque rien — sert de garde-fou visuel.
              Le <strong>report d'enveloppe</strong> reporte le solde (non dépensé ou dépassement) sur le mois suivant.
            </p>
            <form className="form form-inline" onSubmit={submit}>
              <label className="grow">Catégorie<select name="category_id" required>{expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label>Limite<input name="amount_limit" type="number" min="0.01" step="0.01" required /></label>
              <label className="checkbox-row inline-checkbox"><input name="recurring" type="checkbox" /> Reconduire chaque mois</label>
              <label className="checkbox-row inline-checkbox"><input name="rollover" type="checkbox" /> Report d'enveloppe</label>
              <button className="primary"><Plus size={16} /> Enregistrer</button>
            </form>
          </Collapsible>
      </div>
      <Panel title="Suivi" icon={<Target />}>
        <DataTable empty={budgets.length === 0 ? 'Aucun budget pour ce mois.' : null}>
          <thead><tr><th>Catégorie</th><th className="amount-cell">Dépensé</th><th className="amount-cell">Limite</th><th>Progression</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {budgets.map((b) => {
              const category = categories.find((c) => c.id === b.category_id);
              const limit = b.effective_limit;
              const pct = limit > 0 ? Math.min(100, (b.spent / limit) * 100) : 0;
              return (
                <tr key={b.id}>
                  <td>
                    <strong title={category?.name ?? 'Catégorie'}>{category?.name ?? 'Catégorie'}</strong>
                    {b.recurring && <span className="badge-recurring">Reconduit</span>}
                    {b.rollover && <span className="badge-recurring" title="Report d'enveloppe activé"><RotateCcw size={11} /> Report</span>}
                  </td>
                  <td className="amount-cell expense">{money(b.spent)}</td>
                  <td className="amount-cell">
                    {editingId === b.id ? (
                      <input
                        className="inline-amount-input"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={editValue}
                        autoFocus
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveLimit(b); if (e.key === 'Escape') setEditingId(null); }}
                      />
                    ) : (
                      <>
                        {money(limit)}
                        {b.rollover && b.carried_over !== 0 && (
                          <span className="muted" style={{ display: 'block', fontSize: '0.78em' }}>
                            {money(b.amount_limit)} {b.carried_over >= 0 ? '+' : '−'} {money(Math.abs(b.carried_over))} report
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    <div className="bar"><span style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--expense)' : 'var(--accent)' }} /></div>
                    <span>{Math.round(pct)} %</span>
                  </td>
                  <td className="actions-cell">
                    {editingId === b.id ? (
                      <>
                        <IconButton label="Valider la limite" tone="accent" icon={<Check size={16} />} onClick={() => saveLimit(b)} />
                        <IconButton label="Annuler" tone="neutral" icon={<X size={16} />} onClick={() => setEditingId(null)} />
                      </>
                    ) : (
                      <>
                        <IconButton
                          label="Modifier la limite"
                          tone="neutral"
                          icon={<Pencil size={16} />}
                          onClick={() => { setEditingId(b.id); setEditValue(String(b.amount_limit)); }}
                        />
                        <IconButton
                          label={b.rollover ? 'Désactiver le report d\'enveloppe' : 'Activer le report d\'enveloppe'}
                          tone={b.rollover ? 'accent' : 'neutral'}
                          icon={<RotateCcw size={16} />}
                          onClick={() => toggleRollover(b)}
                        />
                        <IconButton
                          label={b.recurring ? 'Arrêter la reconduction mensuelle' : 'Reconduire chaque mois'}
                          tone={b.recurring ? 'accent' : 'neutral'}
                          icon={<Repeat size={16} />}
                          onClick={() => toggleRecurring(b)}
                        />
                        <IconButton
                          label="Supprimer"
                          confirm={b.recurring ? 'Supprimer ce budget ? La reconduction mensuelle sera arrêtée.' : 'Supprimer ce budget ?'}
                          onClick={() => void run(() => api.deleteBudget(userId, b.id), 'Budget supprimé')}
                        />
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </Panel>
    </section>
  );
}
