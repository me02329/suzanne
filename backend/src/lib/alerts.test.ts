import { describe, it, expect } from 'vitest';
import { evaluateAlerts, type AlertConfig, type AlertContext } from './alerts';

const baseCtx = (over: Partial<AlertContext> = {}): AlertContext => ({
  accounts: [{ id: 1, name: 'Courant' }, { id: 2, name: 'Livret' }],
  balanceByAccount: new Map([[1, 50], [2, 5000]]),
  monthTransactions: [],
  goals: [],
  latestSnapshotByAccount: new Map(),
  today: new Date('2026-06-23T00:00:00.000Z'),
  currency: 'EUR',
  ...over,
});

const alert = (over: Partial<AlertConfig>): AlertConfig => ({
  id: 1, type: 'account_balance', account_id: null, goal_id: null, operator: null, threshold: null, active: true, ...over,
});

describe('evaluateAlerts', () => {
  it('skips inactive alerts', () => {
    const a = alert({ type: 'account_balance', account_id: 1, operator: 'lt', threshold: 100, active: false });
    expect(evaluateAlerts([a], baseCtx())).toHaveLength(0);
  });

  it('triggers account_balance below threshold', () => {
    const a = alert({ type: 'account_balance', account_id: 1, operator: 'lt', threshold: 100 });
    const res = evaluateAlerts([a], baseCtx());
    expect(res).toHaveLength(1);
    expect(res[0]!.message).toContain('Courant');
    expect(res[0]!.severity).toBe('warning');
  });

  it('does not trigger account_balance when above threshold', () => {
    const a = alert({ type: 'account_balance', account_id: 2, operator: 'lt', threshold: 100 });
    expect(evaluateAlerts([a], baseCtx())).toHaveLength(0);
  });

  it('counts transactions above threshold, ignoring transfers', () => {
    const ctx = baseCtx({ monthTransactions: [
      { amount: 600, type: 'expense', account_id: 1, description: 'Loyer' },
      { amount: 700, type: 'expense', account_id: 1, description: 'Frigo' },
      { amount: 900, type: 'transfer', account_id: 1, description: 'Virement' },
      { amount: 100, type: 'expense', account_id: 1, description: 'Courses' },
    ] });
    const a = alert({ type: 'transaction_amount', operator: 'gt', threshold: 500 });
    const res = evaluateAlerts([a], ctx);
    expect(res).toHaveLength(1);
    expect(res[0]!.message).toContain('2 transactions');
  });

  it('triggers stale_snapshot when a snapshot is older than the threshold', () => {
    const ctx = baseCtx({ latestSnapshotByAccount: new Map([[1, new Date('2026-06-20')], [2, new Date('2026-01-01')]]) });
    const a = alert({ type: 'stale_snapshot', threshold: 30 });
    const res = evaluateAlerts([a], ctx);
    expect(res).toHaveLength(1);
    expect(res[0]!.message).toContain('Livret');
    expect(res[0]!.message).not.toContain('Courant');
  });

  it('treats a never-snapshotted account as stale', () => {
    const a = alert({ type: 'stale_snapshot', account_id: 1, threshold: 30 });
    expect(evaluateAlerts([a], baseCtx())).toHaveLength(1);
  });

  it('triggers goal_behind when deadline passed and target not reached', () => {
    const ctx = baseCtx({ goals: [{ id: 9, name: 'Voyage', current_amount: 300, target_amount: 1000, deadline: '2026-05-01' }] });
    const a = alert({ type: 'goal_behind', goal_id: 9 });
    const res = evaluateAlerts([a], ctx);
    expect(res).toHaveLength(1);
    expect(res[0]!.message).toContain('30 %');
  });

  it('does not trigger goal_behind when target reached', () => {
    const ctx = baseCtx({ goals: [{ id: 9, name: 'Voyage', current_amount: 1000, target_amount: 1000, deadline: '2026-05-01' }] });
    const a = alert({ type: 'goal_behind', goal_id: 9 });
    expect(evaluateAlerts([a], ctx)).toHaveLength(0);
  });
});
