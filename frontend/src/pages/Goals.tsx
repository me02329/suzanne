import { FormEvent } from 'react';
import type { SavingsGoal } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';

import type { Run } from '../lib/run';

export function Goals({ userId, goals, run }: { userId: number; goals: SavingsGoal[]; run: Run }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.createGoal(userId, {
      name: String(data.get('name')),
      target_amount: Number(data.get('target_amount')),
      current_amount: Number(data.get('current_amount') || 0),
      deadline: String(data.get('deadline') || '') || null,
      color: String(data.get('color')),
    }), 'Objectif ajouté');
    event.currentTarget.reset();
  };
  return (
    <section className="split">
      <Panel title="Nouvel objectif" sticky>
        <p className="panel-note">Compteur cumulatif vers une cible (épargne, voyage, achat…). Indépendant des comptes — c'est un compteur que tu mets à jour à la main.</p>
        <form className="form" onSubmit={submit}>
          <label>Nom<input name="name" required /></label>
          <label>Cible<input name="target_amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Actuel<input name="current_amount" type="number" min="0" step="0.01" defaultValue="0" /></label>
          <label>Échéance<input name="deadline" type="date" /></label>
          <label>Couleur<input name="color" type="color" defaultValue="#4f46e5" /></label>
          <button className="primary">Ajouter</button>
        </form>
      </Panel>
      <Panel title="Objectifs">
        <DataTable empty={goals.length === 0 ? 'Aucun objectif.' : null}>
          <thead><tr><th>Objectif</th><th className="amount-cell">Actuel</th><th className="amount-cell">Cible</th><th>Progression</th><th>Échéance</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {goals.map((g) => {
              const pct = Math.min(100, (g.current_amount / g.target_amount) * 100);
              return (
                <tr key={g.id}>
                  <td><span className="dot inline" style={{ background: g.color }} /><strong>{g.name}</strong></td>
                  <td className="amount-cell">{money(g.current_amount)}</td>
                  <td className="amount-cell">{money(g.target_amount)}</td>
                  <td><div className="bar"><span style={{ width: `${pct}%`, background: g.color }} /></div><span>{Math.round(pct)} %</span></td>
                  <td>{g.deadline ? new Date(g.deadline).toLocaleDateString('fr-FR') : '-'}</td>
                  <td className="actions-cell"><IconButton label="Supprimer" onClick={() => void run(() => api.deleteGoal(userId, g.id), 'Objectif supprimé')} /></td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      </Panel>
    </section>
  );
}
