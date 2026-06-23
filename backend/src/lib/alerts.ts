// Évaluation des alertes, pure et testée (pas d'I/O). Les alertes sont calculées
// à la volée au chargement : on compare la configuration de l'utilisateur à
// l'état courant (soldes, transactions du mois, snapshots, objectifs) et on
// renvoie les déclenchements avec un message prêt à afficher.

export type AlertType = 'account_balance' | 'transaction_amount' | 'stale_snapshot' | 'goal_behind';
export type AlertOperator = 'lt' | 'gt';

export interface AlertConfig {
  id: number;
  type: AlertType;
  account_id: number | null;
  goal_id: number | null;
  operator: AlertOperator | null;
  threshold: number | null;
  active: boolean;
}

export interface AlertContext {
  accounts: Array<{ id: number; name: string }>;
  // Solde signé par compte, en devise de reporting.
  balanceByAccount: Map<number, number>;
  // Transactions du mois courant (montants positifs, signe porté par le type).
  monthTransactions: Array<{ amount: number; type: string; account_id: number | null; description: string }>;
  goals: Array<{ id: number; name: string; current_amount: number; target_amount: number; deadline: string | null }>;
  // Dernière date de snapshot par compte (absent = jamais).
  latestSnapshotByAccount: Map<number, Date>;
  today: Date;
  currency: string;
}

export interface TriggeredAlert {
  id: number;
  type: AlertType;
  severity: 'warning' | 'info';
  message: string;
}

function fmt(amount: number, currency: string): string {
  return `${Math.round(amount).toLocaleString('fr-FR')} ${currency}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function evaluateAlerts(alerts: AlertConfig[], ctx: AlertContext): TriggeredAlert[] {
  const accountName = new Map(ctx.accounts.map((a) => [a.id, a.name]));
  const triggered: TriggeredAlert[] = [];

  for (const alert of alerts) {
    if (!alert.active) continue;

    if (alert.type === 'account_balance') {
      if (alert.account_id == null || alert.operator == null || alert.threshold == null) continue;
      const balance = ctx.balanceByAccount.get(alert.account_id);
      if (balance == null) continue;
      const hit = alert.operator === 'lt' ? balance < alert.threshold : balance > alert.threshold;
      if (hit) {
        const name = accountName.get(alert.account_id) ?? `Compte #${alert.account_id}`;
        const word = alert.operator === 'lt' ? 'est descendu sous' : 'a dépassé';
        triggered.push({
          id: alert.id,
          type: alert.type,
          severity: 'warning',
          message: `Le solde de « ${name} » ${word} ${fmt(alert.threshold, ctx.currency)} (actuel : ${fmt(balance, ctx.currency)}).`,
        });
      }
      continue;
    }

    if (alert.type === 'transaction_amount') {
      if (alert.operator == null || alert.threshold == null) continue;
      const matches = ctx.monthTransactions.filter((t) => {
        if (t.type === 'transfer') return false;
        if (alert.account_id != null && t.account_id !== alert.account_id) return false;
        return alert.operator === 'gt' ? t.amount > alert.threshold! : t.amount < alert.threshold!;
      });
      if (matches.length > 0) {
        const scope = alert.account_id != null ? ` sur « ${accountName.get(alert.account_id) ?? `#${alert.account_id}`} »` : '';
        const word = alert.operator === 'gt' ? 'au-dessus de' : 'en dessous de';
        triggered.push({
          id: alert.id,
          type: alert.type,
          severity: 'info',
          message: `${matches.length} transaction${matches.length > 1 ? 's' : ''}${scope} ${word} ${fmt(alert.threshold, ctx.currency)} ce mois-ci.`,
        });
      }
      continue;
    }

    if (alert.type === 'stale_snapshot') {
      const days = alert.threshold ?? 30;
      const accountsToCheck = alert.account_id != null
        ? ctx.accounts.filter((a) => a.id === alert.account_id)
        : ctx.accounts;
      const stale = accountsToCheck.filter((a) => {
        const last = ctx.latestSnapshotByAccount.get(a.id);
        if (!last) return true;
        return (ctx.today.getTime() - last.getTime()) / DAY_MS > days;
      });
      if (stale.length > 0) {
        const names = stale.slice(0, 3).map((a) => a.name).join(', ');
        const extra = stale.length > 3 ? ` (+${stale.length - 3})` : '';
        triggered.push({
          id: alert.id,
          type: alert.type,
          severity: 'info',
          message: `Aucun relevé depuis plus de ${days} jours : ${names}${extra}.`,
        });
      }
      continue;
    }

    if (alert.type === 'goal_behind') {
      if (alert.goal_id == null) continue;
      const goal = ctx.goals.find((g) => g.id === alert.goal_id);
      if (!goal || !goal.deadline) continue;
      if (goal.current_amount >= goal.target_amount) continue;
      const deadline = new Date(goal.deadline);
      // En retard = échéance passée et objectif non atteint.
      if (deadline.getTime() < ctx.today.getTime()) {
        const pct = goal.target_amount > 0 ? Math.round((goal.current_amount / goal.target_amount) * 100) : 0;
        triggered.push({
          id: alert.id,
          type: alert.type,
          severity: 'warning',
          message: `Objectif « ${goal.name} » en retard : échéance dépassée, atteint à ${pct} %.`,
        });
      }
      continue;
    }
  }

  return triggered;
}
