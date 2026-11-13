import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Lightbulb, PiggyBank, Pencil, Plus, Repeat, RotateCcw, Trash2, Wallet } from 'lucide-react';
import type { Category } from '@suzanne/shared';
import { api } from '../lib/api';
import { budgetsApi, PACE_LABEL, type BudgetHistoryPoint, type BudgetOverview, type BudgetSuggestions, type BudgetWithPace, type Pace, type SinkingFundStatus } from '../lib/api-budgets';
import { currentMonthIso, formatMonthLong, money } from '../lib/format';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/ui/RowMenu';
import { amountInputValue, positiveAmount } from '../components/home/amount';
import type { Run } from '../lib/run';
import '../styles/pages/plan.css';
import '../styles/pages/budgets.css';

// Budgets du mois : budget global (reste à vivre), enveloppes par catégorie
// avec leur rythme de dépense, suggestions de plafonds, provisions pour
// dépenses irrégulières et historique.

/** Part consommée d'un budget (non plafonnée) ; null si limite nulle et rien dépensé. */
export function budgetUsage(b: { spent: number; effective_limit: number }): number | null {
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
const shortMonth = (month: string) =>
  new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00.000Z`));
const width = (ratio: number | null) => `${Math.max(0, Math.min(100, (ratio ?? 0) * 100))}%`;

function PaceChip({ pace, currency }: { pace: Pace; currency: string }) {
  const tone = pace.status === 'ok' ? 'ok' : pace.status === 'warning' ? 'ink' : 'bad';
  const title = pace.status === 'projected_over' ? `Au rythme actuel : ${money(pace.projected, currency)} en fin de mois` : undefined;
  return <span className={`tag ${tone}`} title={title}>{PACE_LABEL[pace.status]}</span>;
}

export function Budgets({ userId, month, categories, run, reportCurrency = 'EUR', dataVersion = 0 }: {
  userId: number;
  month: string;
  categories: Category[];
  /** Conservé pour compatibilité (la page charge sa propre vue d'ensemble). */
  budgets?: unknown;
  run: Run;
  reportCurrency?: string;
  dataVersion?: number;
}) {
  const [overview, setOverview] = useState<BudgetOverview | null>(null);
  const [history, setHistory] = useState<BudgetHistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localVersion, setLocalVersion] = useState(0);
  const [dialog, setDialog] = useState<
    | { kind: 'budget'; editing: BudgetWithPace | null }
    | { kind: 'global' }
    | { kind: 'suggest' }
    | { kind: 'fund'; editing: SinkingFundStatus | null }
    | null
  >(null);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const isCurrent = month === currentMonthIso();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([budgetsApi.overview(userId, month, reportCurrency), budgetsApi.history(userId, month, reportCurrency, 6)])
      .then(([o, h]) => { if (!cancelled) { setOverview(o); setHistory(h); } })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [userId, month, reportCurrency, dataVersion, localVersion]);

  // Mutation locale : run() recharge l'app, et on rafraîchit la vue d'ensemble.
  const mutate = useCallback(async (fn: () => Promise<unknown>, message: string, options?: Parameters<Run>[2]) => {
    const ok = await run(fn, message, options);
    if (ok) setLocalVersion((v) => v + 1);
    return ok;
  }, [run]);

  const budgets = overview?.categories ?? [];
  const sorted = [...budgets].sort((a, b) => (budgetUsage(b) ?? -1) - (budgetUsage(a) ?? -1));
  const global = overview?.global ?? null;
  const cur = overview?.currency ?? reportCurrency;

  const toggle = (budget: BudgetWithPace, key: 'recurring' | 'rollover') => {
    const on = !budget[key];
    const message = key === 'recurring'
      ? (on ? 'Budget reconduit chaque mois' : 'Reconduction arrêtée')
      : (on ? 'Report d’enveloppe activé' : 'Report d’enveloppe désactivé');
    void mutate(() => api.setBudget(userId, { category_id: budget.category_id, month: budget.month, amount_limit: budget.amount_limit, [key]: on }), message);
  };

  // Suppression annulable : l'upsert recrée le budget à l'identique.
  const remove = (budget: BudgetWithPace) => {
    void mutate(() => api.deleteBudget(userId, budget.id), 'Budget supprimé', {
      undo: () => api.setBudget(userId, { category_id: budget.category_id, month: budget.month, amount_limit: budget.amount_limit, recurring: budget.recurring, rollover: budget.rollover }),
    });
  };

  const removeGlobal = () => {
    if (!global) return;
    void mutate(() => budgetsApi.deleteGlobal(userId, month), 'Budget du mois supprimé', {
      undo: () => budgetsApi.setGlobal(userId, { month, amount_limit: global.amount_limit, recurring: global.recurring }),
    });
  };

  const removeFund = (fund: SinkingFundStatus) => {
    void mutate(() => budgetsApi.deleteFund(userId, fund.id), 'Provision supprimée', {
      undo: () => budgetsApi.createFund(userId, { name: fund.name, category_id: fund.category_id, target_amount: fund.target_amount, period_months: fund.period_months, start_month: fund.start_month, color: fund.color }),
    });
  };

  const globalRatio = global ? budgetUsage({ spent: global.spent, effective_limit: global.amount_limit }) : null;
  const maxHistory = Math.max(1, ...history.map((h) => Math.max(h.total_spent, h.global_limit ?? 0)));

  return (
    <section className="pg budgets-page">
      {/* Reste à vivre */}
      <div className="pg-hero">
        <div>
          <span className="pg-kicker">Budget du mois · {formatMonthLong(month)}</span>
          {!overview ? (
            <p className="pg-hero-sub">{error ? `Chargement impossible : ${error}` : 'Chargement…'}</p>
          ) : global ? (
            <>
              <strong className="pg-hero-value">
                <span className={global.remaining < 0 ? 'expense' : undefined}>{money(global.remaining, cur)}</span>
                <small> {global.remaining >= 0 ? 'restants' : 'de dépassement'}</small>
              </strong>
              <p className="pg-hero-sub">
                <strong>{money(global.spent, cur)}</strong> dépensés sur <strong>{money(global.amount_limit, cur)}</strong>
                {isCurrent && global.pace.daily_allowance != null && global.remaining > 0 && (
                  <> · soit <strong>{money(global.pace.daily_allowance, cur)}</strong> par jour pendant {global.pace.days_left} jour{global.pace.days_left > 1 ? 's' : ''}</>
                )}
              </p>
              <div className="bg-hero-chips">
                <PaceChip pace={global.pace} currency={cur} />
                {isCurrent && global.pace.status === 'projected_over' && (
                  <span className="bg-hint">Au rythme actuel : {money(global.pace.projected, cur)} en fin de mois</span>
                )}
                {overview.unbudgeted_spent > 0 && budgets.length > 0 && (
                  <span className="bg-hint">dont {money(overview.unbudgeted_spent, cur)} hors enveloppes</span>
                )}
              </div>
            </>
          ) : (
            <>
              <strong className="pg-hero-value">{money(overview.total_spent, cur)} <small>dépensés</small></strong>
              <p className="pg-hero-sub">Fixe un budget pour le mois et suis ton « reste à vivre » jour après jour.</p>
            </>
          )}
        </div>
        <div className="pg-toolbar-actions">
          <button type="button" className="secondary" onClick={() => setDialog({ kind: 'global' })}>
            <Wallet size={16} /> {global ? 'Budget du mois' : 'Définir le budget du mois'}
          </button>
          <button type="button" className="primary accent" onClick={() => setDialog({ kind: 'budget', editing: null })}>
            <Plus size={16} /> Nouvelle enveloppe
          </button>
        </div>
        {global && (
          <div className="pg-hero-meter">
            <div className={`${meterTone(globalRatio)} big`}>
              <span style={{ width: width(globalRatio) }} />
              {isCurrent && <i className="bg-today" style={{ left: `${Math.round(global.pace.elapsed_ratio * 100)}%` }} title="Aujourd’hui" />}
            </div>
          </div>
        )}
      </div>

      {/* Enveloppes */}
      <div className="pg-card">
        <div className="pg-card-head">
          <h2>Enveloppes</h2>
          <button type="button" className="bg-link" onClick={() => setDialog({ kind: 'suggest' })}>
            <Lightbulb size={15} /> Suggérer des plafonds
          </button>
        </div>
        {budgets.length === 0 ? (
          <p className="pg-empty">
            <strong>Pas encore d’enveloppe</strong>
            Fixe une limite par catégorie — ou laisse Suzanne te proposer des plafonds d’après tes 6 derniers mois.
          </p>
        ) : (
          <ul className="lrows">
            {sorted.map((b) => (
              <BudgetRow
                key={b.id}
                budget={b}
                currency={cur}
                showPace={isCurrent}
                category={categoryById.get(b.category_id)}
                onEdit={() => setDialog({ kind: 'budget', editing: b })}
                onToggle={(key) => toggle(b, key)}
                onDelete={() => remove(b)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Provisions */}
      <div className="pg-card">
        <div className="pg-card-head">
          <h2>Provisions</h2>
          <button type="button" className="bg-link" onClick={() => setDialog({ kind: 'fund', editing: null })}>
            <Plus size={15} /> Nouvelle provision
          </button>
        </div>
        {(overview?.sinking_funds ?? []).length === 0 ? (
          <p className="pg-empty">
            <strong>Lisse tes grosses dépenses</strong>
            Vacances, assurance annuelle, cadeaux… Fixe un montant par an : Suzanne le découpe en mensualités et suit ce qui est disponible.
          </p>
        ) : (
          <div className="bg-funds">
            {overview!.sinking_funds.map((f) => (
              <FundCard
                key={f.id}
                fund={f}
                currency={cur}
                categoryName={f.category_id != null ? categoryById.get(f.category_id)?.name : undefined}
                onEdit={() => setDialog({ kind: 'fund', editing: f })}
                onDelete={() => removeFund(f)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Historique */}
      {history.some((h) => h.total_spent > 0) && (
        <div className="pg-card">
          <div className="pg-card-head">
            <h2>6 derniers mois</h2>
            <span className="pg-card-meta">dépensé / budget du mois</span>
          </div>
          <div className="bg-history" role="list">
            {history.map((h) => {
              const over = h.global_limit != null && h.total_spent > h.global_limit;
              return (
                <div key={h.month} className={h.month === month ? 'bg-hbar current' : 'bg-hbar'} role="listitem" title={`${formatMonthLong(h.month)} : ${money(h.total_spent, cur)}${h.global_limit != null ? ` / ${money(h.global_limit, cur)}` : ''}`}>
                  <div className="bg-hbar-track">
                    {h.global_limit != null && <i className="bg-hbar-limit" style={{ bottom: `${(h.global_limit / maxHistory) * 100}%` }} />}
                    <span className={over ? 'over' : undefined} style={{ height: `${(h.total_spent / maxHistory) * 100}%` }} />
                  </div>
                  <small>{shortMonth(h.month)}</small>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {global && (
        <p className="pg-note bg-footnote">
          Budget du mois : {money(global.amount_limit, cur)}{global.recurring ? ', reconduit chaque mois' : ''}.{' '}
          <button type="button" className="bg-link inline" onClick={removeGlobal}>Supprimer</button>
        </p>
      )}

      {dialog?.kind === 'budget' && (
        <BudgetFormModal
          userId={userId}
          month={month}
          categories={categories}
          budgets={budgets}
          editing={dialog.editing}
          mutate={mutate}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'global' && (
        <GlobalBudgetModal userId={userId} month={month} currency={cur} current={global} mutate={mutate} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'suggest' && (
        <SuggestionsModal userId={userId} month={month} currency={cur} existing={budgets} mutate={mutate} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'fund' && (
        <FundModal userId={userId} month={month} categories={categories} editing={dialog.editing} mutate={mutate} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}

type Mutate = (fn: () => Promise<unknown>, message: string, options?: Parameters<Run>[2]) => Promise<boolean>;

function BudgetRow({ budget: b, currency, showPace, category, onEdit, onToggle, onDelete }: {
  budget: BudgetWithPace;
  currency: string;
  showPace: boolean;
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
          {showPace && b.pace.status !== 'ok' && <PaceChip pace={b.pace} currency={currency} />}
          {b.rollover && <span className="tag" title="Report d’enveloppe"><RotateCcw size={11} /> Report</span>}
        </div>
        <span className="lrow-sub">
          {remaining >= 0 ? `Reste ${money(remaining, currency)}` : <span className="expense">Dépassé de {money(-remaining, currency)}</span>}
          {showPace && b.pace.daily_allowance != null && remaining > 0 && ` · ${money(b.pace.daily_allowance, currency)}/jour`}
          {showPace && b.pace.status === 'projected_over' && ` · fin de mois ≈ ${money(b.pace.projected, currency)}`}
          {b.rollover && b.carried_over !== 0 && ` · ${b.carried_over >= 0 ? '+' : '−'}${money(Math.abs(b.carried_over), currency)} reporté`}
        </span>
      </div>
      <div className="lrow-amount">
        <span className={ratio != null && ratio >= 1 ? 'expense' : undefined}>{money(b.spent, currency)}</span>
        <small>sur {money(b.effective_limit, currency)} · {pctLabel(ratio)}</small>
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
        <div className={meterTone(ratio)}>
          <span style={{ width: width(ratio) }} />
          {showPace && <i className="bg-today" style={{ left: `${Math.round(b.pace.elapsed_ratio * 100)}%` }} />}
        </div>
      </div>
    </li>
  );
}

function FundCard({ fund: f, currency, categoryName, onEdit, onDelete }: {
  fund: SinkingFundStatus;
  currency: string;
  categoryName?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const accruedRatio = f.target_amount > 0 ? f.accrued / f.target_amount : 0;
  return (
    <article className="bg-fund">
      <header>
        <span className="bg-fund-icon" style={{ background: f.color }}><PiggyBank size={16} /></span>
        <div className="bg-fund-title">
          <strong>{f.name}</strong>
          <small>{categoryName ?? 'Sans catégorie'} · {money(f.monthly_contribution, currency)}/mois</small>
        </div>
        <RowMenu items={[
          { label: 'Modifier', icon: <Pencil />, onSelect: onEdit },
          { label: 'Supprimer', icon: <Trash2 />, danger: true, onSelect: onDelete },
        ]} />
      </header>
      <strong className={f.available < 0 ? 'bg-fund-value expense' : 'bg-fund-value'}>{money(f.available, currency)}</strong>
      <small className="bg-fund-sub">disponibles · {money(f.accrued, currency)} mis de côté, {money(f.spent, currency)} dépensés</small>
      <div className="meter"><span style={{ width: width(accruedRatio) }} /></div>
      <small className="bg-fund-sub">Objectif {money(f.target_amount, currency)} · cycle {formatMonthLong(f.cycle_start)} → {formatMonthLong(f.cycle_end)}</small>
    </article>
  );
}

function BudgetFormModal({ userId, month, categories, budgets, editing, mutate, onClose }: {
  userId: number;
  month: string;
  categories: Category[];
  budgets: BudgetWithPace[];
  editing: BudgetWithPace | null;
  mutate: Mutate;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const taken = new Set(budgets.map((b) => b.category_id));
  // En création, seules les catégories pas encore budgétées ce mois.
  const options = categories.filter((c) => c.type === 'expense' && (editing ? c.id === editing.category_id : !taken.has(c.id)));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = positiveAmount(data.get('amount_limit'));
    if (amount == null) { setError('Indique une limite supérieure à 0.'); return; }
    const categoryId = editing ? editing.category_id : Number(data.get('category_id'));
    void mutate(() => api.setBudget(userId, {
      category_id: categoryId,
      month: editing?.month ?? month,
      amount_limit: amount,
      recurring: data.get('recurring') === 'on',
      rollover: data.get('rollover') === 'on',
    }), editing ? 'Enveloppe mise à jour' : 'Enveloppe créée').then((ok) => { if (ok) onClose(); });
  };

  return (
    <Modal title={editing ? 'Modifier l’enveloppe' : `Nouvelle enveloppe · ${formatMonthLong(month)}`} onClose={onClose}>
      {!editing && options.length === 0 ? (
        <p className="pg-note">Toutes tes catégories de dépense ont déjà une enveloppe ce mois-ci.</p>
      ) : (
        <form className="pg-form" onSubmit={submit}>
          <label className="full">Catégorie
            <select name="category_id" defaultValue={editing?.category_id ?? options[0]?.id} disabled={Boolean(editing)} required>
              {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="full">Limite mensuelle
            <input name="amount_limit" inputMode="decimal" autoComplete="off" placeholder="ex. 300"
              defaultValue={amountInputValue(editing?.amount_limit)} autoFocus required onInput={() => setError(null)} />
          </label>
          <label className="check full"><input name="recurring" type="checkbox" defaultChecked={editing?.recurring ?? true} /> Reconduire chaque mois</label>
          <label className="check full"><input name="rollover" type="checkbox" defaultChecked={editing?.rollover ?? false} /> Reporter le reste (ou le dépassement) sur le mois suivant</label>
          {error && <p className="hint full expense" role="alert">{error}</p>}
          <div className="pg-form-actions">
            <button type="button" className="secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="primary">{editing ? 'Enregistrer' : 'Créer l’enveloppe'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function GlobalBudgetModal({ userId, month, currency, current, mutate, onClose }: {
  userId: number;
  month: string;
  currency: string;
  current: BudgetOverview['global'];
  mutate: Mutate;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<number | null>(null);
  useEffect(() => {
    budgetsApi.suggestions(userId, month, currency).then((s) => setSuggested(s.global?.suggested ?? null)).catch(() => {});
  }, [userId, month, currency]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = positiveAmount(data.get('amount_limit'));
    if (amount == null) { setError('Indique un montant supérieur à 0.'); return; }
    void mutate(() => budgetsApi.setGlobal(userId, { month, amount_limit: amount, recurring: data.get('recurring') === 'on' }), 'Budget du mois enregistré')
      .then((ok) => { if (ok) onClose(); });
  };

  return (
    <Modal title={`Budget du mois · ${formatMonthLong(month)}`} onClose={onClose}>
      <form className="pg-form" onSubmit={submit}>
        <p className="pg-note full">Tout ce que tu prévois de dépenser ce mois-ci, toutes catégories confondues. Suzanne en déduit ton « reste à vivre » et ce que tu peux dépenser par jour.</p>
        <label className="full">Montant
          <input name="amount_limit" inputMode="decimal" autoComplete="off" autoFocus required
            defaultValue={amountInputValue(current?.amount_limit)} placeholder={suggested ? String(suggested) : 'ex. 1800'} onInput={() => setError(null)} />
        </label>
        {suggested != null && (
          <p className="hint full">Médiane de tes 6 derniers mois : <strong>{money(suggested, currency)}</strong></p>
        )}
        <label className="check full"><input name="recurring" type="checkbox" defaultChecked={current?.recurring ?? true} /> Reconduire chaque mois</label>
        {error && <p className="hint full expense" role="alert">{error}</p>}
        <div className="pg-form-actions">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="primary">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

function SuggestionsModal({ userId, month, currency, existing, mutate, onClose }: {
  userId: number;
  month: string;
  currency: string;
  existing: BudgetWithPace[];
  mutate: Mutate;
  onClose: () => void;
}) {
  const [data, setData] = useState<BudgetSuggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<number, string>>(new Map());
  const existingIds = new Set(existing.map((b) => b.category_id));

  useEffect(() => {
    budgetsApi.suggestions(userId, month, currency)
      .then((s) => {
        setData(s);
        // Pré-sélection : les catégories sans enveloppe ce mois-ci.
        setPicked(new Map(s.categories.filter((c) => !existingIds.has(c.category_id)).map((c) => [c.category_id, String(c.suggested)])));
      })
      .catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, month, currency]);

  const apply = () => {
    const entries = Array.from(picked.entries())
      .map(([category_id, raw]) => ({ category_id, amount: positiveAmount(raw) }))
      .filter((e): e is { category_id: number; amount: number } => e.amount != null);
    if (entries.length === 0) return;
    void mutate(async () => {
      for (const e of entries) await api.setBudget(userId, { category_id: e.category_id, month, amount_limit: e.amount, recurring: true });
    }, `${entries.length} enveloppe${entries.length > 1 ? 's' : ''} enregistrée${entries.length > 1 ? 's' : ''}`).then((ok) => { if (ok) onClose(); });
  };

  const max = Math.max(1, ...(data?.categories.flatMap((c) => c.history) ?? [1]));

  return (
    <Modal title="Plafonds suggérés" onClose={onClose} wide>
      <div className="pg-form">
        <p className="pg-note full">D’après la médiane de tes dépenses sur {data?.months.length ?? 6} mois complets (un mois exceptionnel ne fausse pas le calcul), arrondie à 5 €. Coche, ajuste, applique.</p>
        {error && <p className="hint full expense">{error}</p>}
        {!data ? <p className="pg-note full">Calcul…</p> : data.categories.length === 0 ? (
          <p className="pg-note full">Pas assez d’historique pour proposer des plafonds.</p>
        ) : (
          <ul className="bg-suggest full">
            {data.categories.map((c) => {
              const checked = picked.has(c.category_id);
              return (
                <li key={c.category_id} className={checked ? 'on' : undefined}>
                  <label className="bg-suggest-name">
                    <input type="checkbox" checked={checked} onChange={() => setPicked((cur) => {
                      const next = new Map(cur);
                      if (next.has(c.category_id)) next.delete(c.category_id); else next.set(c.category_id, String(c.suggested));
                      return next;
                    })} />
                    <span>{c.name}{existingIds.has(c.category_id) && <small> · déjà budgétée</small>}</span>
                  </label>
                  <span className="bg-spark" aria-hidden>
                    {c.history.map((v, i) => <i key={i} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />)}
                  </span>
                  <input
                    className="bg-suggest-amount"
                    inputMode="decimal"
                    aria-label={`Plafond ${c.name}`}
                    value={picked.get(c.category_id) ?? String(c.suggested)}
                    disabled={!checked}
                    onChange={(e) => setPicked((cur) => new Map(cur).set(c.category_id, e.target.value))}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <div className="pg-form-actions">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="primary" disabled={picked.size === 0} onClick={apply}>Appliquer {picked.size > 0 ? `(${picked.size})` : ''}</button>
        </div>
      </div>
    </Modal>
  );
}

function FundModal({ userId, month, categories, editing, mutate, onClose }: {
  userId: number;
  month: string;
  categories: Category[];
  editing: SinkingFundStatus | null;
  mutate: Mutate;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const target = positiveAmount(data.get('target_amount'));
    const name = String(data.get('name') ?? '').trim();
    if (!name) { setError('Donne un nom à la provision.'); return; }
    if (target == null) { setError('Indique un montant supérieur à 0.'); return; }
    const body = {
      name,
      category_id: data.get('category_id') ? Number(data.get('category_id')) : null,
      target_amount: target,
      period_months: Number(data.get('period_months') ?? 12),
      start_month: String(data.get('start_month') || month),
    };
    void mutate(
      () => (editing ? budgetsApi.updateFund(userId, editing.id, body) : budgetsApi.createFund(userId, body)),
      editing ? 'Provision mise à jour' : 'Provision créée',
    ).then((ok) => { if (ok) onClose(); });
  };
  return (
    <Modal title={editing ? 'Modifier la provision' : 'Nouvelle provision'} onClose={onClose}>
      <form className="pg-form" onSubmit={submit}>
        <label className="full">Nom
          <input name="name" defaultValue={editing?.name} placeholder="ex. Vacances d’été" autoFocus required onInput={() => setError(null)} />
        </label>
        <label>Montant à réunir
          <input name="target_amount" inputMode="decimal" autoComplete="off" defaultValue={amountInputValue(editing?.target_amount)} placeholder="ex. 1200" required onInput={() => setError(null)} />
        </label>
        <label>Tous les
          <select name="period_months" defaultValue={editing?.period_months ?? 12}>
            <option value={3}>3 mois</option>
            <option value={6}>6 mois</option>
            <option value={12}>12 mois</option>
            <option value={24}>24 mois</option>
          </select>
        </label>
        <label className="full">Catégorie des dépenses
          <select name="category_id" defaultValue={editing?.category_id ?? ''}>
            <option value="">Aucune (suivi de la cagnotte seulement)</option>
            {expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="full">Début du cycle
          <input name="start_month" type="month" defaultValue={editing?.start_month ?? month} />
        </label>
        <p className="hint full">Chaque mois, un douzième (selon la période) est mis de côté virtuellement ; les dépenses de la catégorie viennent en déduction. Aucun argent n’est déplacé.</p>
        {error && <p className="hint full expense" role="alert">{error}</p>}
        <div className="pg-form-actions">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="primary">{editing ? 'Enregistrer' : 'Créer la provision'}</button>
        </div>
      </form>
    </Modal>
  );
}
