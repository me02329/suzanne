import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeftRight, Coins, HandCoins, History, Link2, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Account, GoalContribution, SavingsGoal } from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { money, todayIso } from '../lib/format';
import { numberOrNull } from '../lib/forms';
import { formatDateFr, parseDecimal } from '../lib/pea';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/accounts/RowMenu';
import type { Run } from '../lib/run';
import '../styles/pages/accounts.css';
import '../styles/pages/goals.css';
import { useTranslation } from 'react-i18next';

export function Goals({ userId, goals, accounts, accountById, run }: {
  userId: number;
  goals: SavingsGoal[];
  accounts: Account[];
  accountById: Map<number, Account>;
  run: Run;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<SavingsGoal | 'new' | null>(null);
  const [moving, setMoving] = useState<{ goal: SavingsGoal; kind: 'in' | 'out' } | null>(null);
  const [historyGoal, setHistoryGoal] = useState<number | null>(null);

  const saved = goals.reduce((s, g) => s + g.current_amount, 0);
  const target = goals.reduce((s, g) => s + g.target_amount, 0);
  const pctAll = target > 0 ? Math.min(100, (saved / target) * 100) : 0;

  const remove = (g: SavingsGoal) => void run(() => api.deleteGoal(userId, g.id), `Objectif « ${g.name} » supprimé`, {
    undo: () => api.createGoal(userId, { name: g.name, target_amount: g.target_amount, current_amount: g.current_amount, deadline: g.deadline?.slice(0, 10) ?? null, color: g.color, account_id: g.account_id }),
  });

  return (
    <section className="pg-stack">
      <header className="acc-hero">
        <div className="acc-hero-main">
          <span className="acc-kicker">{t('patrimoine.goals.saved_for_your_goals')}</span>
          <strong className="acc-hero-value num">{money(saved)}</strong>
          {goals.length > 0 && (
            <span className="acc-hero-sub">
              <span>{t('patrimoine.goals.of')} <b className="num">{money(target)}</b></span>
              <span>{Math.round(pctAll)}  {t('patrimoine.goals.reached')}</span>
              <span>{goals.length}  {t('patrimoine.goals.goal')}{goals.length > 1 ? 's' : ''}</span>
            </span>
          )}
        </div>
        <div className="acc-hero-actions">
          <button type="button" className="primary accent" onClick={() => setForm('new')}><Plus size={16} />  {t('patrimoine.goals.add_goal')}</button>
        </div>
      </header>

      {goals.length === 0 ? (
        <div className="acc-empty">
          <p>{t('patrimoine.goals.no_goals')}</p>
          <p className="acc-muted">{t('patrimoine.goals.a_trip_down_payment_emergency')}</p>
        </div>
      ) : (
        <div className="cards">
          {goals.map((g) => {
            const pct = g.target_amount > 0 ? Math.min(100, (g.current_amount / g.target_amount) * 100) : 0;
            const account = g.account_id != null ? accountById.get(g.account_id) : null;
            return (
              <article className="goal-card" key={g.id}>
                <header className="goal-head">
                  <span className="goal-dot" style={{ background: g.color }} />
                  <h2 title={g.name}>{g.name}</h2>
                  <RowMenu label={`Plus d'actions pour ${g.name}`} items={[
                    { label: 'Retirer', icon: <HandCoins size={16} />, disabled: g.current_amount <= 0, onClick: () => setMoving({ goal: g, kind: 'out' }) },
                    { label: 'Historique', icon: <History size={16} />, onClick: () => setHistoryGoal(g.id) },
                    { label: 'Modifier', icon: <Pencil size={16} />, onClick: () => setForm(g) },
                    { label: 'Supprimer', icon: <Trash2 size={16} />, danger: true, onClick: () => remove(g) },
                  ]} />
                </header>
                <p className="goal-amount"><span className="num">{money(g.current_amount)}</span> <small className="num">/ {money(g.target_amount)}</small></p>
                <div className="goal-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                  <i style={{ width: `${pct}%`, background: g.color }} />
                </div>
                <div className="goal-meta">
                  <span>{Math.round(pct)} %</span>
                  <span>{account ? <><Link2 size={12} /> {account.name}</> : 'Compteur manuel'}</span>
                  <span>{g.deadline ? `Échéance ${formatDateFr(g.deadline)}` : 'Sans échéance'}</span>
                </div>
                <button type="button" className="secondary goal-cta" onClick={() => setMoving({ goal: g, kind: 'in' })}><Coins size={16} />  {t('patrimoine.goals.deposit')}</button>
              </article>
            );
          })}
        </div>
      )}

      {form && <GoalFormModal userId={userId} goal={form === 'new' ? null : form} accounts={accounts} run={run} onClose={() => setForm(null)} />}
      {moving && <MoveModal userId={userId} goal={moving.goal} kind={moving.kind} accounts={accounts} run={run} onClose={() => setMoving(null)} />}
      {historyGoal != null && goals.some((g) => g.id === historyGoal) && (
        <GoalHistoryModal userId={userId} goal={goals.find((g) => g.id === historyGoal)!} run={run} onClose={() => setHistoryGoal(null)} />
      )}
    </section>
  );
}

function GoalFormModal({ userId, goal, accounts, run, onClose }: { userId: number; goal: SavingsGoal | null; accounts: Account[]; run: Run; onClose: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const target_amount = parseDecimal(data.get('target_amount'));
    const current_amount = parseDecimal(data.get('current_amount') || '0');
    if (!(target_amount > 0)) { setError('Cible invalide.'); return; }
    if (!(current_amount >= 0)) { setError('Montant actuel invalide.'); return; }
    const body = {
      name: String(data.get('name')).trim(),
      target_amount,
      current_amount,
      deadline: String(data.get('deadline') || '') || null,
      color: String(data.get('color')),
      account_id: numberOrNull(data.get('account_id')),
    };
    void run(() => (goal ? api.updateGoal(userId, goal.id, body) : api.createGoal(userId, body)), goal ? 'Objectif modifié' : 'Objectif ajouté')
      .then((ok) => { if (ok) onClose(); });
  };
  return (
    <Modal title={goal ? `Modifier « ${goal.name} »` : 'Ajouter un objectif'} onClose={onClose}>
      <form className="form acc-form sheet-ok" onSubmit={submit}>
        <label className="full">{t('patrimoine.goals.name')}<input name="name" defaultValue={goal?.name ?? ''} required autoFocus={!goal} /></label>
        <label>{t('patrimoine.goals.target')}<input name="target_amount" inputMode="decimal" autoComplete="off" defaultValue={goal ? String(goal.target_amount).replace('.', ',') : ''} required /></label>
        <label>{t('patrimoine.goals.already_saved')}<input name="current_amount" inputMode="decimal" autoComplete="off" defaultValue={goal ? String(goal.current_amount).replace('.', ',') : '0'} /></label>
        <label className="full">{t('patrimoine.goals.goal_account')}
          <select name="account_id" defaultValue={goal?.account_id ?? ''}>
            <option value="">{t('patrimoine.goals.none_manual_counter')}</option>
            {pickableAccounts(accounts, goal?.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>{t('patrimoine.goals.deadline')}<input name="deadline" type="date" defaultValue={goal?.deadline?.slice(0, 10) ?? ''} /></label>
        <label>{t('patrimoine.goals.colour')}<input name="color" type="color" defaultValue={goal?.color ?? '#4a6a00'} /></label>
        {error && <p className="acc-error full" role="alert">{error}</p>}
        <div className="acc-form-actions full">
          <button type="button" className="secondary" onClick={onClose}>{t('patrimoine.goals.cancel')}</button>
          <button className="primary">{goal ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>
    </Modal>
  );
}

function MoveModal({ userId, goal, kind, accounts, run, onClose }: { userId: number; goal: SavingsGoal; kind: 'in' | 'out'; accounts: Account[]; run: Run; onClose: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const others = pickableAccounts(accounts).filter((a) => a.id !== goal.account_id);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const amount = parseDecimal(data.get('amount'));
    if (!(amount > 0)) { setError('Montant invalide.'); return; }
    if (kind === 'out' && amount > goal.current_amount) { setError(`Au plus ${money(goal.current_amount)}.`); return; }
    const date = String(data.get('date'));
    const description = String(data.get('description') || '') || null;
    const other = numberOrNull(data.get('other_account_id'));
    void run(
      () => (kind === 'in'
        ? api.contributeGoal(userId, goal.id, { amount, date, source_account_id: other, description })
        : api.withdrawGoal(userId, goal.id, { amount, date, destination_account_id: other, description })),
      kind === 'in' ? 'Versement enregistré' : 'Retrait enregistré',
    ).then((ok) => { if (ok) onClose(); });
  };
  return (
    <Modal title={`${kind === 'in' ? 'Verser sur' : 'Retirer de'} « ${goal.name} »`} onClose={onClose}>
      <form className="form acc-form sheet-ok" onSubmit={submit}>
        <label>{t('patrimoine.goals.amount')}<input name="amount" inputMode="decimal" autoComplete="off" required autoFocus placeholder="0,00" /></label>
        <label>{t('patrimoine.goals.date')}<input name="date" type="date" defaultValue={todayIso()} required /></label>
        {goal.account_id != null && (
          <label className="full">{kind === 'in' ? 'Depuis le compte' : 'Vers le compte'}
            <select name="other_account_id">
              <option value="">{t('patrimoine.goals.none_counter_only')}</option>
              {others.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
        <label className="full">{t('patrimoine.goals.label')}<input name="description" placeholder={kind === 'in' ? 'Versement mensuel' : 'Achat prévu'} /></label>
        <p className="acc-muted full">
          {goal.account_id != null
            ? `Avec un compte choisi, un virement est créé ${kind === 'in' ? 'vers' : 'depuis'} le compte de l'objectif.`
            : 'Objectif sans compte : seul le compteur bouge.'}
          {kind === 'out' && ` Épargné : ${money(goal.current_amount)}.`}
        </p>
        {error && <p className="acc-error full" role="alert">{error}</p>}
        <div className="acc-form-actions full">
          <button type="button" className="secondary" onClick={onClose}>{t('patrimoine.goals.cancel')}</button>
          <button className="primary">{kind === 'in' ? 'Verser' : 'Retirer'}</button>
        </div>
      </form>
    </Modal>
  );
}

function GoalHistoryModal({ userId, goal, run, onClose }: { userId: number; goal: SavingsGoal; run: Run; onClose: () => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<GoalContribution[] | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api.goalContributions(userId, goal.id).then((r) => { if (!cancelled) setRows(r); }).catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [userId, goal.id, version]);
  const total = (rows ?? []).reduce((s, c) => s + c.amount, 0);
  return (
    <Modal title={`Historique · ${goal.name}`} onClose={onClose}>
      <div className="sheet-ok">
        {rows == null ? <p className="acc-muted"><Loader2 className="spin-icon" size={14} />  {t('patrimoine.goals.loading')}</p>
          : rows.length === 0 ? <p className="acc-muted">{t('patrimoine.goals.no_deposits_recorded')}</p>
            : (
              <>
                <p className="acc-muted">{rows.length}  {t('patrimoine.goals.movement')}{rows.length > 1 ? 's' : ''}  {t('patrimoine.goals.total')} <b className="num">{money(Math.round(total * 100) / 100)}</b>{t('patrimoine.goals.cancelling_deposit_lowers_progress_linke')}</p>
                <ul className="goal-history">
                  {rows.map((c) => (
                    <li key={c.id}>
                      <div className="goal-history-main">
                        <span>{c.description ?? (c.amount < 0 ? 'Retrait' : 'Versement')}{c.transaction_id != null && <ArrowLeftRight size={12} className="goal-tx" aria-label={t('patrimoine.goals.linked_transfer')} />}</span>
                        <small>{formatDateFr(c.date)}</small>
                      </div>
                      <span className={`num ${c.amount < 0 ? 'expense' : 'income'}`}>{c.amount < 0 ? '−' : '+'}{money(Math.abs(c.amount))}</span>
                      <button
                        type="button"
                        className="row-btn"
                        aria-label={c.amount < 0 ? 'Annuler ce retrait' : 'Annuler ce versement'}
                        title={t('patrimoine.goals.cancel')}
                        onClick={() => void run(() => api.deleteGoalContribution(userId, goal.id, c.id), 'Mouvement annulé').then((ok) => { if (ok) setVersion((v) => v + 1); })}
                      ><Trash2 size={16} /></button>
                    </li>
                  ))}
                </ul>
              </>
            )}
        <div className="acc-form-actions"><button type="button" className="secondary" onClick={onClose}>{t('patrimoine.goals.close')}</button></div>
      </div>
    </Modal>
  );
}
