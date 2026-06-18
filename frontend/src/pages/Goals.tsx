import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronUp, Coins, HandCoins, History, Link2, Loader2, Pencil, PiggyBank, Plus } from 'lucide-react';
import type { Account, GoalContribution, SavingsGoal } from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { money, todayIso } from '../lib/format';
import { numberOrNull } from '../lib/forms';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { LimitPicker, useListLimit } from '../components/LimitPicker';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';
import { Collapsible } from '../components/Collapsible';

import type { Run } from '../lib/run';

export function Goals({ userId, goals, accounts, accountById, run }: {
  userId: number;
  goals: SavingsGoal[];
  accounts: Account[];
  accountById: Map<number, Account>;
  run: Run;
}) {
  const [contributing, setContributing] = useState<SavingsGoal | null>(null);
  const [withdrawing, setWithdrawing] = useState<SavingsGoal | null>(null);
  const [editing, setEditing] = useState<SavingsGoal | null>(null);
  const [historyGoal, setHistoryGoal] = useState<SavingsGoal | null>(null);
  const [addOpen, setAddOpen] = usePersistedState<boolean>('goals_add_open', goals.length === 0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createGoal(userId, {
      name: String(data.get('name')),
      target_amount: Number(data.get('target_amount')),
      current_amount: Number(data.get('current_amount') || 0),
      deadline: String(data.get('deadline') || '') || null,
      color: String(data.get('color')),
      account_id: numberOrNull(data.get('account_id')),
    }), 'Objectif ajouté');
    event.currentTarget.reset();
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    void run(() => api.updateGoal(userId, editing.id, {
      name: String(data.get('name')),
      target_amount: Number(data.get('target_amount')),
      current_amount: Number(data.get('current_amount') || 0),
      deadline: String(data.get('deadline') || '') || null,
      color: String(data.get('color')),
      account_id: numberOrNull(data.get('account_id')),
    }), 'Objectif modifié');
    setEditing(null);
  };

  const submitContribution = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!contributing) return;
    const data = new FormData(event.currentTarget);
    void run(() => api.contributeGoal(userId, contributing.id, {
      amount: Number(data.get('amount')),
      date: String(data.get('date')),
      source_account_id: numberOrNull(data.get('source_account_id')),
      description: String(data.get('description') || '') || null,
    }), 'Versement enregistré');
    setContributing(null);
  };

  const submitWithdrawal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!withdrawing) return;
    const data = new FormData(event.currentTarget);
    void run(() => api.withdrawGoal(userId, withdrawing.id, {
      amount: Number(data.get('amount')),
      date: String(data.get('date')),
      destination_account_id: numberOrNull(data.get('destination_account_id')),
      description: String(data.get('description') || '') || null,
    }), 'Retrait enregistré');
    setWithdrawing(null);
  };

  return (
    <section className="stack">
      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> Nouvel objectif</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={addOpen} className="collapsible-body">
            <p className="panel-note">
              Lié à un compte : la progression peut être alimentée par un versement (transfert depuis un autre compte).
              Sans compte : reste un compteur manuel.
            </p>
            <form className="form form-inline" onSubmit={submit}>
              <label className="grow">Nom<input name="name" required /></label>
              <label>Cible<input name="target_amount" type="number" min="0.01" step="0.01" required /></label>
              <label>Actuel<input name="current_amount" type="number" min="0" step="0.01" defaultValue="0" /></label>
              <label>Compte de l'objectif
                <select name="account_id">
                  <option value="">Aucun (compteur manuel)</option>
                  {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>Échéance<input name="deadline" type="date" /></label>
              <label>Couleur<input name="color" type="color" defaultValue="#4f46e5" /></label>
              <button className="primary"><Plus size={16} /> Ajouter</button>
            </form>
          </Collapsible>
      </div>
      <Panel title="Objectifs" icon={<PiggyBank />}>
        <DataTable empty={goals.length === 0 ? 'Aucun objectif.' : null}>
          <thead><tr><th>Objectif</th><th>Compte</th><th className="amount-cell">Actuel</th><th className="amount-cell">Cible</th><th>Progression</th><th>Échéance</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {goals.map((g) => {
              const pct = Math.min(100, (g.current_amount / g.target_amount) * 100);
              const account = g.account_id != null ? accountById.get(g.account_id) : null;
              return (
                <tr key={g.id}>
                  <td><span className="dot inline" style={{ background: g.color }} /><strong title={g.name}>{g.name}</strong></td>
                  <td>{account ? <span className="goal-account"><Link2 size={12} /> {account.name}</span> : <span className="muted">Manuel</span>}</td>
                  <td className="amount-cell">{money(g.current_amount)}</td>
                  <td className="amount-cell">{money(g.target_amount)}</td>
                  <td><div className="bar"><span style={{ width: `${pct}%`, background: g.color }} /></div><span>{Math.round(pct)} %</span></td>
                  <td>{g.deadline ? new Date(g.deadline).toLocaleDateString('fr-FR') : '-'}</td>
                  <td className="actions-cell">
                    <IconButton label="Verser" tone="accent" icon={<Coins size={16} />} onClick={() => setContributing(g)} />
                    <IconButton label="Retirer" tone="neutral" icon={<HandCoins size={16} />} onClick={() => setWithdrawing(g)} disabled={g.current_amount <= 0} />
                    <IconButton label="Historique des versements" tone="neutral" icon={<History size={16} />} onClick={() => setHistoryGoal(g)} />
                    <IconButton label="Modifier" tone="neutral" icon={<Pencil size={16} />} onClick={() => setEditing(g)} />
                    <IconButton label="Supprimer" confirm="Supprimer cet objectif ?" onClick={() => void run(() => api.deleteGoal(userId, g.id), 'Objectif supprimé')} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </Panel>

      {editing && (
        <Modal title={`Modifier "${editing.name}"`} onClose={() => setEditing(null)}>
          <form className="form" onSubmit={submitEdit}>
            <label>Nom<input name="name" defaultValue={editing.name} required /></label>
            <label>Cible<input name="target_amount" type="number" min="0.01" step="0.01" defaultValue={editing.target_amount} required /></label>
            <label>Actuel<input name="current_amount" type="number" min="0" step="0.01" defaultValue={editing.current_amount} /></label>
            <label>Compte de l'objectif
              <select name="account_id" defaultValue={editing.account_id ?? ''}>
                <option value="">Aucun (compteur manuel)</option>
                {pickableAccounts(accounts, editing.account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label>Échéance<input name="deadline" type="date" defaultValue={editing.deadline ? editing.deadline.slice(0, 10) : ''} /></label>
            <label>Couleur<input name="color" type="color" defaultValue={editing.color} /></label>
            <button className="primary">Enregistrer</button>
            <button type="button" className="secondary" onClick={() => setEditing(null)}>Annuler</button>
          </form>
        </Modal>
      )}

      {historyGoal && (
        <GoalHistoryModal
          userId={userId}
          goal={goals.find((g) => g.id === historyGoal.id) ?? historyGoal}
          run={run}
          onClose={() => setHistoryGoal(null)}
        />
      )}

      {contributing && (
        <Modal title={`Verser sur "${contributing.name}"`} onClose={() => setContributing(null)}>
          <form className="form" onSubmit={submitContribution}>
            <p className="panel-note">
              {contributing.account_id
                ? 'Choisis un compte source : un transfert est créé du compte source vers le compte de l\'objectif.'
                : 'Cet objectif n\'a pas de compte lié — la contribution incrémente uniquement le compteur.'}
            </p>
            <label>Montant<input name="amount" type="number" min="0.01" step="0.01" required /></label>
            <label>Date<input name="date" type="date" defaultValue={todayIso()} required /></label>
            {contributing.account_id != null && (
              <label>Depuis le compte
                <select name="source_account_id">
                  <option value="">Aucun (juste compteur)</option>
                  {pickableAccounts(accounts).filter((a) => a.id !== contributing.account_id).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="full">Libellé (optionnel)<input name="description" placeholder="Ex: Versement mensuel" /></label>
            <button className="primary"><Coins size={16} /> Enregistrer le versement</button>
            <button type="button" className="secondary" onClick={() => setContributing(null)}>Annuler</button>
          </form>
        </Modal>
      )}

      {withdrawing && (
        <Modal title={`Retirer de "${withdrawing.name}"`} onClose={() => setWithdrawing(null)}>
          <form className="form" onSubmit={submitWithdrawal}>
            <p className="panel-note">
              {withdrawing.account_id
                ? 'Choisis un compte destination : un transfert est créé du compte de l\'objectif vers ce compte. La progression est décrémentée.'
                : 'Cet objectif n\'a pas de compte lié — le retrait décrémente uniquement le compteur.'}
              {' '}Épargné : {money(withdrawing.current_amount)}.
            </p>
            <label>Montant<input name="amount" type="number" min="0.01" step="0.01" max={withdrawing.current_amount} required /></label>
            <label>Date<input name="date" type="date" defaultValue={todayIso()} required /></label>
            {withdrawing.account_id != null && (
              <label>Vers le compte
                <select name="destination_account_id">
                  <option value="">Aucun (juste compteur)</option>
                  {pickableAccounts(accounts).filter((a) => a.id !== withdrawing.account_id).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="full">Libellé (optionnel)<input name="description" placeholder="Ex: Achat prévu" /></label>
            <button className="primary"><HandCoins size={16} /> Enregistrer le retrait</button>
            <button type="button" className="secondary" onClick={() => setWithdrawing(null)}>Annuler</button>
          </form>
        </Modal>
      )}
    </section>
  );
}

// Timeline des versements d'un objectif. La liste est rechargée localement
// après une annulation (le reload global de `run` ne couvre pas cette donnée,
// chargée à la demande).
function GoalHistoryModal({ userId, goal, run, onClose }: {
  userId: number;
  goal: SavingsGoal;
  run: Run;
  onClose: () => void;
}) {
  const [contributions, setContributions] = useState<GoalContribution[] | null>(null);
  const [version, setVersion] = useState(0);
  const historyLimit = useListLimit(10);

  useEffect(() => {
    let cancelled = false;
    api.goalContributions(userId, goal.id)
      .then((rows) => { if (!cancelled) setContributions(rows); })
      .catch(() => { if (!cancelled) setContributions([]); });
    return () => { cancelled = true; };
  }, [userId, goal.id, version]);

  const removeContribution = (contribution: GoalContribution) => {
    void run(
      () => api.deleteGoalContribution(userId, goal.id, contribution.id),
      'Versement annulé',
    ).then((ok) => { if (ok) setVersion((v) => v + 1); });
  };

  const total = (contributions ?? []).reduce((sum, c) => sum + c.amount, 0);

  return (
    <Modal title={`Versements sur "${goal.name}"`} onClose={onClose}>
      {contributions == null ? (
        <p className="empty"><Loader2 className="spin-icon" size={16} /> Chargement…</p>
      ) : (
        <>
          <p className="panel-note">
            {contributions.length > 0
              ? `${contributions.length} versement${contributions.length > 1 ? 's' : ''} · ${money(Math.round(total * 100) / 100)} au total. Annuler un versement retire la ligne et décrémente la progression (le transfert lié, lui, reste dans les transactions).`
              : 'Aucun versement enregistré — les versements faits via « Verser » apparaîtront ici.'}
          </p>
          <LimitPicker limit={historyLimit.limit} onChange={historyLimit.setLimit} total={contributions.length} />
          <DataTable scroll empty={contributions.length === 0 ? 'Aucun versement.' : null}>
            <thead><tr><th>Date</th><th>Libellé</th><th className="amount-cell">Montant</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {historyLimit.clamp(contributions).map((c) => {
                const isWithdrawal = c.amount < 0;
                return (
                <tr key={c.id}>
                  <td data-label="Date">{new Date(c.date).toLocaleDateString('fr-FR')}</td>
                  <td data-label="Libellé">
                    {c.description ?? <span className="muted">{isWithdrawal ? 'Retrait' : '—'}</span>}
                    {c.transaction_id != null && (
                      <span className="badge-recurring" title="Un transfert a été créé pour ce mouvement"><ArrowLeftRight size={11} /> transfert</span>
                    )}
                  </td>
                  <td className={`amount-cell ${isWithdrawal ? 'expense' : 'income'}`} data-label="Montant">
                    {isWithdrawal ? '-' : '+'}{money(Math.abs(c.amount))}
                  </td>
                  <td className="actions-cell">
                    <IconButton label={isWithdrawal ? 'Annuler ce retrait' : 'Annuler ce versement'} confirm={isWithdrawal ? 'Annuler ce retrait ? La progression sera recréditée.' : 'Annuler ce versement ? La progression de l\'objectif sera décrémentée.'} onClick={() => removeContribution(c)} />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </DataTable>
        </>
      )}
      <button type="button" className="secondary" onClick={onClose}>Fermer</button>
    </Modal>
  );
}
