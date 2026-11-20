import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ALLOCATION_PRESETS, rebalance, type AllocationTarget, type AssetBucket } from '@suzanne/shared';
import { api } from '../../lib/api';
import { parseDecimal } from '../../lib/pea';
import type { Run } from '../../lib/run';

// Diversification : allocation cible par classe d'actifs (profil type ou sur
// mesure), écart avec la situation, et répartition du prochain versement pour
// s'en rapprocher sans rien vendre.

// Clés écrites en toutes lettres (vérifiées par i18n:check).
const BUCKET_TEXT: Record<AssetBucket, string> = {
  cash: 'analyses.diversification.bucket_cash',
  bonds: 'analyses.diversification.bucket_bonds',
  equities: 'analyses.diversification.bucket_equities',
  real_estate: 'analyses.diversification.bucket_real_estate',
  alternative: 'analyses.diversification.bucket_alternative',
};
const WHERE_TEXT: Record<AssetBucket, string> = {
  cash: 'analyses.rebalance.where_cash',
  bonds: 'analyses.rebalance.where_bonds',
  equities: 'analyses.rebalance.where_equities',
  real_estate: 'analyses.rebalance.where_real_estate',
  alternative: 'analyses.rebalance.where_alternative',
};
const PRESET_TEXT = { prudent: 'analyses.rebalance.prudent', balanced: 'analyses.rebalance.balanced', dynamic: 'analyses.rebalance.dynamic' } as const;
const BUCKETS: AssetBucket[] = ['cash', 'bonds', 'equities', 'real_estate', 'alternative'];

export function RebalanceCard({ userId, buckets, money, run }: {
  userId: number;
  buckets: Array<{ bucket: AssetBucket; amount: number }>;
  money: (v: number) => string;
  run: Run;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<AllocationTarget | null | undefined>(undefined);
  const [draft, setDraft] = useState<Record<AssetBucket, string> | null>(null);
  const [deposit, setDeposit] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.allocationTarget(userId).then((v) => { if (!cancelled) setTarget(v); }).catch(() => { if (!cancelled) setTarget(null); });
    return () => { cancelled = true; };
  }, [userId]);

  const current = useMemo(() => Object.fromEntries(BUCKETS.map((b) => [b, buckets.find((x) => x.bucket === b)?.amount ?? 0])) as Record<AssetBucket, number>, [buckets]);
  const depositValue = Math.max(0, parseDecimal(deposit) || 0);
  const rows = useMemo(() => (target ? rebalance(current, target, depositValue) : []), [current, target, depositValue]);
  const pct = (v: number) => `${Math.round(v * 100)} %`;

  const startEdit = (from: AllocationTarget) => setDraft(Object.fromEntries(BUCKETS.map((b) => [b, String(from[b])])) as Record<AssetBucket, string>);
  const draftValues = draft ? (Object.fromEntries(BUCKETS.map((b) => [b, parseDecimal(draft[b]) || 0])) as AllocationTarget) : null;
  const draftSum = draftValues ? BUCKETS.reduce((s, b) => s + draftValues[b], 0) : 0;
  const save = async (value: AllocationTarget) => {
    if (await run(() => api.setAllocationTarget(userId, value), t('analyses.rebalance.saved'))) { setTarget(value); setDraft(null); }
  };

  if (target === undefined) return null;

  return (
    <section className="dv-card rb">
      <div className="rb-head">
        <h2>{t('analyses.rebalance.title')}</h2>
        {target && !draft && <button type="button" className="secondary" onClick={() => startEdit(target)}>{t('analyses.rebalance.edit')}</button>}
      </div>

      {(!target || draft) && (
        <div className="rb-setup">
          <p className="acc-muted">{t('analyses.rebalance.intro')}</p>
          <div className="rb-presets">
            {(Object.keys(ALLOCATION_PRESETS) as Array<keyof typeof ALLOCATION_PRESETS>).map((p) => {
              // Profil actif : la saisie en cours correspond exactement à ce profil.
              const active = draftValues != null && BUCKETS.every((b) => draftValues[b] === ALLOCATION_PRESETS[p][b]);
              return (
                <button key={p} type="button" className="secondary" aria-pressed={active} onClick={() => startEdit(ALLOCATION_PRESETS[p])}>
                  <strong>{t(PRESET_TEXT[p])}</strong>
                  <small title={BUCKETS.map((b) => `${t(BUCKET_TEXT[b])} ${ALLOCATION_PRESETS[p][b]} %`).join(' · ')}>
                    {BUCKETS.map((b) => ALLOCATION_PRESETS[p][b]).join(' / ')}
                  </small>
                </button>
              );
            })}
          </div>
          {draft && (
            <>
              <div className="rb-inputs">
                {BUCKETS.map((b) => (
                  <label key={b}>
                    <span>{t(BUCKET_TEXT[b])}</span>
                    <input inputMode="decimal" value={draft[b]} onChange={(e) => setDraft({ ...draft, [b]: e.target.value })} aria-label={t(BUCKET_TEXT[b])} />
                  </label>
                ))}
              </div>
              <div className="rb-actions">
                <span className={Math.abs(draftSum - 100) < 0.5 ? 'acc-muted' : 'expense'}>{t('analyses.rebalance.sum', { sum: Math.round(draftSum * 10) / 10 })}</span>
                {target && <button type="button" className="secondary" onClick={() => setDraft(null)}>{t('analyses.rebalance.cancel')}</button>}
                <button type="button" className="primary" disabled={Math.abs(draftSum - 100) >= 0.5} onClick={() => draftValues && void save(draftValues)}>{t('analyses.rebalance.save')}</button>
              </div>
            </>
          )}
        </div>
      )}

      {target && !draft && (
        <>
          <label className="rb-deposit">
            <span>{t('analyses.rebalance.next_deposit')}</span>
            <input inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="500" />
          </label>
          <table className="rb-table">
            <thead>
              <tr>
                <th>{t('analyses.rebalance.class')}</th>
                <th className="num">{t('analyses.rebalance.now')}</th>
                <th className="num">{t('analyses.rebalance.target')}</th>
                <th className="num">{t('analyses.rebalance.gap')}</th>
                {depositValue > 0 && <th className="num">{t('analyses.rebalance.put')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.bucket}>
                  <td><i className={`dv-seg ${r.bucket}`} /> {t(BUCKET_TEXT[r.bucket])}</td>
                  <td className="num">{pct(r.currentShare)}</td>
                  <td className="num acc-muted">{pct(r.targetShare)}</td>
                  <td className={`num ${Math.abs(r.gap) < 1 ? 'acc-muted' : r.gap > 0 ? 'income' : 'expense'}`}>{r.gap > 0 ? '+' : r.gap < 0 ? '−' : ''}{money(Math.abs(r.gap))}</td>
                  {depositValue > 0 && <td className="num">{r.deposit > 0 ? <><strong>{money(r.deposit)}</strong><small className="acc-muted"> {t(WHERE_TEXT[r.bucket])}</small></> : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="acc-muted dv-note">{t('analyses.rebalance.note')}</p>
        </>
      )}
    </section>
  );
}
