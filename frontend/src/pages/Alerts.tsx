import { FormEvent, useState } from 'react';
import { AlertTriangle, Bell, Info, Plus, Power, Trash2 } from 'lucide-react';
import type { Account, Alert, AlertType, CreateAlertBody, SavingsGoal, TriggeredAlert } from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { money } from '../lib/format';
import { numberOrNull } from '../lib/forms';
import { Modal } from '../components/Modal';
import { RowMenu } from '../components/ui/RowMenu';
import { parseAmount } from '../components/home/amount';
import type { Run } from '../lib/run';
import '../styles/pages/plan.css';
import '../styles/pages/home.css';

const TYPE_LABEL: Record<AlertType, string> = {
  account_balance: 'Solde de compte',
  transaction_amount: 'Montant de transaction',
  stale_snapshot: 'Relevé manquant',
  goal_behind: 'Objectif en retard',
};

function describeAlert(alert: Alert, accountById: Map<number, Account>, goals: SavingsGoal[]): string {
  const account = alert.account_id != null ? accountById.get(alert.account_id) : null;
  const op = alert.operator === 'lt' ? 'sous' : 'au-dessus de';
  // Le seuil est exprimé dans la devise du compte surveillé.
  const threshold = money(alert.threshold ?? 0, account?.currency ?? 'EUR');
  switch (alert.type) {
    case 'account_balance':
      return `${account?.name ?? 'Compte'} ${op} ${threshold}`;
    case 'transaction_amount':
      return `Transaction ${op} ${threshold}${account ? ` sur ${account.name}` : ''}`;
    case 'stale_snapshot':
      return `${account?.name ?? 'Tout compte'} sans relevé depuis ${alert.threshold ?? 30} j`;
    case 'goal_behind': {
      const goal = goals.find((g) => g.id === alert.goal_id)?.name;
      return `Objectif « ${goal ?? '?'} » en retard sur son échéance`;
    }
  }
}

const ALERT_SHORT: Record<AlertType, string> = {
  account_balance: 'Solde',
  transaction_amount: 'Montant',
  stale_snapshot: 'Relevé',
  goal_behind: 'Objectif',
};

export function Alerts({ userId, alerts, triggered, accounts, goals, accountById, run }: {
  userId: number;
  alerts: Alert[];
  triggered: TriggeredAlert[];
  accounts: Account[];
  goals: SavingsGoal[];
  accountById: Map<number, Account>;
  run: Run;
}) {
  const [creating, setCreating] = useState(false);
  const activeCount = alerts.filter((a) => a.active).length;

  const remove = (a: Alert) => {
    void run(() => api.deleteAlert(userId, a.id), 'Alerte supprimée', {
      undo: () => api.createAlert(userId, {
        type: a.type,
        account_id: a.account_id,
        goal_id: a.goal_id,
        operator: a.operator,
        threshold: a.threshold,
        active: a.active,
      }),
    });
  };

  return (
    <section className="pg home-sub">
      <div className="pg-toolbar">
        <p className="pg-note">
          {triggered.length > 0
            ? <><strong className="home-count">{triggered.length}</strong> alerte{triggered.length > 1 ? 's' : ''} déclenchée{triggered.length > 1 ? 's' : ''} · {activeCount} active{activeCount > 1 ? 's' : ''} sur {alerts.length}</>
            : alerts.length > 0 ? `Rien à signaler · ${activeCount} alerte${activeCount > 1 ? 's' : ''} active${activeCount > 1 ? 's' : ''}` : 'Aucune alerte configurée.'}
        </p>
        <div className="pg-toolbar-actions">
          <button type="button" className="primary accent" onClick={() => setCreating(true)}>
            <Plus size={16} /> Nouvelle alerte
          </button>
        </div>
      </div>

      {triggered.length > 0 && (
        <div className="pg-card">
          <div className="pg-card-head"><h2>Déclenchées</h2></div>
          <ul className="home-alerts">
            {triggered.map((t, i) => (
              <li key={`${t.id}-${i}`} className={`home-alert ${t.severity}`}>
                {t.severity === 'warning' ? <AlertTriangle size={17} /> : <Info size={17} />}
                <span>{t.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pg-card">
        <div className="pg-card-head"><h2>Mes alertes</h2></div>
        {alerts.length === 0 ? (
          <p className="pg-empty">
            <strong>Aucune alerte</strong>
            Sois prévenu quand un solde passe sous un seuil, qu’une grosse dépense arrive ou qu’un relevé manque.
          </p>
        ) : (
          <ul className="lrows">
            {alerts.map((a) => (
              <li key={a.id} className={a.active ? 'lrow two' : 'lrow two muted'}>
                <div className="lrow-main">
                  <div className="lrow-title">
                    <span>{describeAlert(a, accountById, goals)}</span>
                  </div>
                  <span className="lrow-sub">{TYPE_LABEL[a.type]}{a.active ? '' : ' · en pause'}</span>
                </div>
                <div className="lrow-actions">
                  <button
                    type="button"
                    className="icon-button neutral"
                    aria-pressed={a.active}
                    aria-label={a.active ? `Mettre en pause : ${ALERT_SHORT[a.type]}` : `Réactiver : ${ALERT_SHORT[a.type]}`}
                    title={a.active ? 'Mettre en pause' : 'Réactiver'}
                    onClick={() => void run(() => api.updateAlert(userId, a.id, { active: !a.active }), a.active ? 'Alerte en pause' : 'Alerte réactivée')}
                  >
                    {a.active ? <Bell size={17} /> : <Power size={17} />}
                  </button>
                  <RowMenu items={[{ label: 'Supprimer', icon: <Trash2 />, danger: true, onSelect: () => remove(a) }]} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating && (
        <AlertFormModal userId={userId} accounts={accounts} goals={goals} run={run} onClose={() => setCreating(false)} />
      )}
    </section>
  );
}

function AlertFormModal({ userId, accounts, goals, run, onClose }: {
  userId: number;
  accounts: Account[];
  goals: SavingsGoal[];
  run: Run;
  onClose: () => void;
}) {
  const [type, setType] = useState<AlertType>('account_balance');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const account = accounts.find((a) => String(a.id) === accountId);
  const isLiability = account?.type === 'credit' || account?.type === 'loan';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body: CreateAlertBody = { type };
    if (type === 'account_balance' || type === 'transaction_amount') {
      const threshold = parseAmount(data.get('threshold'));
      if (!Number.isFinite(threshold)) { setError('Indique un seuil valide.'); return; }
      body.account_id = numberOrNull(accountId);
      body.operator = data.get('operator') as 'lt' | 'gt';
      body.threshold = threshold;
    } else if (type === 'stale_snapshot') {
      body.account_id = numberOrNull(accountId);
      body.threshold = Number(data.get('threshold'));
    } else {
      body.goal_id = numberOrNull(data.get('goal_id'));
    }
    void run(() => api.createAlert(userId, body), 'Alerte créée').then((ok) => { if (ok) onClose(); });
  };

  return (
    <Modal title="Nouvelle alerte" onClose={onClose}>
      <form className="pg-form" onSubmit={submit} onInput={() => setError(null)}>
        <label className="full">Type
          <select value={type} onChange={(e) => setType(e.target.value as AlertType)}>
            {(Object.keys(TYPE_LABEL) as AlertType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>

        {type !== 'goal_behind' && (
          <label className="full">Compte
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required={type === 'account_balance'}>
              <option value="" disabled={type === 'account_balance'}>{type === 'account_balance' ? 'Choisir…' : 'Tous les comptes'}</option>
              {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
            </select>
          </label>
        )}

        {(type === 'account_balance' || type === 'transaction_amount') && (
          <>
            <label>Condition
              <select name="operator" defaultValue={type === 'account_balance' ? 'lt' : 'gt'} key={type}>
                <option value="lt">en dessous de</option>
                <option value="gt">au-dessus de</option>
              </select>
            </label>
            <label>Seuil{account ? ` (${account.currency})` : ''}
              <input name="threshold" inputMode="decimal" autoComplete="off" required />
            </label>
            {type === 'account_balance' && (
              <p className="hint full">
                Le seuil est comparé dans la devise du compte{account ? ` (${account.currency})` : ''}, sans conversion.
                {' '}Pour une carte de crédit ou un prêt, on compare le montant dû (valeur absolue du solde)
                {isLiability ? ' : « au-dessus de 1 000 » = plus de 1 000 dus.' : '.'}
              </p>
            )}
            {type === 'transaction_amount' && (
              <p className="hint full">Le montant de chaque transaction est comparé dans la devise de son compte.</p>
            )}
          </>
        )}

        {type === 'stale_snapshot' && (
          <label className="full">Jours sans relevé
            <input name="threshold" type="number" inputMode="numeric" min="1" step="1" defaultValue="30" required />
          </label>
        )}

        {type === 'goal_behind' && (
          <label className="full">Objectif
            <select name="goal_id" required defaultValue="">
              <option value="" disabled>Choisir…</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
        )}

        {error && <p className="hint full expense" role="alert">{error}</p>}
        <div className="pg-form-actions">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit" className="primary">Créer l’alerte</button>
        </div>
      </form>
    </Modal>
  );
}
