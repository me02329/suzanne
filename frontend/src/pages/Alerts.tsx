import { FormEvent, useState } from 'react';
import { AlertTriangle, Bell, ChevronDown, ChevronUp, Info, Plus, Power } from 'lucide-react';
import type { Account, Alert, AlertType, CreateAlertBody, SavingsGoal, TriggeredAlert } from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { money } from '../lib/format';
import { numberOrNull } from '../lib/forms';
import { usePersistedState } from '../lib/storage';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';
import { Collapsible } from '../components/Collapsible';
import type { Run } from '../lib/run';

const TYPE_LABEL: Record<AlertType, string> = {
  account_balance: 'Solde de compte',
  transaction_amount: 'Montant de transaction',
  stale_snapshot: 'Relevé manquant',
  goal_behind: 'Objectif en retard',
};

function describeAlert(alert: Alert, accountById: Map<number, Account>, goals: SavingsGoal[]): string {
  const account = alert.account_id != null ? accountById.get(alert.account_id)?.name : null;
  const op = alert.operator === 'lt' ? 'sous' : 'au-dessus de';
  switch (alert.type) {
    case 'account_balance':
      return `${account ?? 'Compte'} ${op} ${money(alert.threshold ?? 0)}`;
    case 'transaction_amount':
      return `Transaction ${op} ${money(alert.threshold ?? 0)}${account ? ` sur ${account}` : ''}`;
    case 'stale_snapshot':
      return `${account ?? 'Tout compte'} sans relevé depuis ${alert.threshold ?? 30} j`;
    case 'goal_behind': {
      const goal = goals.find((g) => g.id === alert.goal_id)?.name;
      return `Objectif « ${goal ?? '?'} » en retard sur son échéance`;
    }
  }
}

export function Alerts({ userId, alerts, triggered, accounts, goals, accountById, run }: {
  userId: number;
  alerts: Alert[];
  triggered: TriggeredAlert[];
  accounts: Account[];
  goals: SavingsGoal[];
  accountById: Map<number, Account>;
  run: Run;
}) {
  const [type, setType] = useState<AlertType>('account_balance');
  const [addOpen, setAddOpen] = usePersistedState<boolean>('alerts_add_open', alerts.length === 0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const body: CreateAlertBody = { type };
    if (type === 'account_balance') {
      body.account_id = numberOrNull(data.get('account_id'));
      body.operator = data.get('operator') as 'lt' | 'gt';
      body.threshold = Number(data.get('threshold'));
    } else if (type === 'transaction_amount') {
      body.account_id = numberOrNull(data.get('account_id'));
      body.operator = data.get('operator') as 'lt' | 'gt';
      body.threshold = Number(data.get('threshold'));
    } else if (type === 'stale_snapshot') {
      body.account_id = numberOrNull(data.get('account_id'));
      body.threshold = Number(data.get('threshold'));
    } else if (type === 'goal_behind') {
      body.goal_id = numberOrNull(data.get('goal_id'));
    }
    void run(() => api.createAlert(userId, body), 'Alerte créée').then((ok) => { if (ok) form.reset(); });
  };

  return (
    <section className="stack">
      {triggered.length > 0 && (
        <Panel title={`Alertes actives (${triggered.length})`} icon={<Bell />}>
          <div className="stack-sm">
            {triggered.map((t, i) => (
              <div key={`${t.id}-${i}`} className={`alert-line ${t.severity}`}>
                {t.severity === 'warning' ? <AlertTriangle size={16} /> : <Info size={16} />}
                <span>{t.message}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className={`collapsible-panel ${addOpen ? 'open' : ''}`}>
        <button type="button" className="collapsible-header" onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>
          <span className="collapsible-title"><Plus size={16} /> Nouvelle alerte</span>
          {addOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <Collapsible open={addOpen} className="collapsible-body">
          <p className="panel-note">Les alertes sont évaluées à la volée au chargement et affichées ci-dessus quand elles se déclenchent.</p>
          <form className="form form-inline" onSubmit={submit}>
            <label>Type
              <select value={type} onChange={(e) => setType(e.target.value as AlertType)}>
                {(Object.keys(TYPE_LABEL) as AlertType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </label>

            {(type === 'account_balance' || type === 'transaction_amount') && (
              <>
                <label>Compte
                  <select name="account_id" defaultValue="">
                    <option value="">{type === 'transaction_amount' ? 'Tous les comptes' : 'Choisir…'}</option>
                    {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                <label>Condition
                  <select name="operator" defaultValue={type === 'account_balance' ? 'lt' : 'gt'}>
                    <option value="lt">en dessous de</option>
                    <option value="gt">au-dessus de</option>
                  </select>
                </label>
                <label>Seuil<input name="threshold" type="number" step="0.01" required /></label>
              </>
            )}

            {type === 'stale_snapshot' && (
              <>
                <label>Compte
                  <select name="account_id" defaultValue="">
                    <option value="">Tous les comptes</option>
                    {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </label>
                <label>Jours sans relevé<input name="threshold" type="number" min="1" step="1" defaultValue="30" required /></label>
              </>
            )}

            {type === 'goal_behind' && (
              <label className="grow">Objectif
                <select name="goal_id" required defaultValue="">
                  <option value="" disabled>Choisir…</option>
                  {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}

            <button className="primary"><Plus size={16} /> Ajouter</button>
          </form>
        </Collapsible>
      </div>

      <Panel title="Alertes configurées" icon={<Bell />}>
        <DataTable empty={alerts.length === 0 ? 'Aucune alerte configurée.' : null}>
          <thead><tr><th>Type</th><th>Condition</th><th>État</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className={a.active ? '' : 'muted-row'}>
                <td data-label="Type">{TYPE_LABEL[a.type]}</td>
                <td data-label="Condition">{describeAlert(a, accountById, goals)}</td>
                <td data-label="État">{a.active ? <span className="income">Active</span> : <span className="muted">Inactive</span>}</td>
                <td className="actions-cell">
                  <IconButton
                    label={a.active ? 'Désactiver' : 'Activer'}
                    tone="neutral"
                    icon={<Power size={16} />}
                    onClick={() => void run(() => api.updateAlert(userId, a.id, { active: !a.active }), a.active ? 'Alerte désactivée' : 'Alerte activée')}
                  />
                  <IconButton label="Supprimer" confirm="Supprimer cette alerte ?" onClick={() => void run(() => api.deleteAlert(userId, a.id), 'Alerte supprimée')} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Panel>
    </section>
  );
}
