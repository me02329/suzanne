import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account } from '@suzanne/shared';
import { accountsApi } from '../../lib/api-accounts';
import { localeTag } from '../../i18n';

// Livret / épargne rémunérée : intérêts reçus par année et taux constaté
// (intérêts / solde moyen de l'année). Les revenus d'un livret sont ses
// intérêts : les virements entre comptes n'en sont pas.
export function InterestCard({ userId, account, history, fmt, version }: {
  userId: number;
  account: Account;
  /** Soldes mensuels du compte (courbe de la fiche). */
  history: Array<{ date: string; balance: number }> | null;
  fmt: (v: number) => string;
  /** Change après chaque modification (rechargement). */
  version?: unknown;
}) {
  const { t } = useTranslation();
  const [byYear, setByYear] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    accountsApi.transactions(userId, account.id)
      .then((txs) => {
        if (cancelled) return;
        const out = new Map<string, number>();
        for (const tx of txs) {
          if (tx.type !== 'income' || tx.account_id !== account.id) continue;
          const year = tx.date.slice(0, 4);
          out.set(year, (out.get(year) ?? 0) + tx.amount);
        }
        setByYear(out);
      })
      .catch(() => { if (!cancelled) setByYear(new Map()); });
    return () => { cancelled = true; };
  }, [userId, account.id, version]);

  const rows = useMemo(() => {
    if (!byYear) return [];
    return [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([year, interest]) => {
      const points = (history ?? []).filter((p) => p.date.startsWith(year) && p.balance > 0);
      const avg = points.length > 0 ? points.reduce((s, p) => s + p.balance, 0) / points.length : 0;
      return { year, interest, rate: avg > 0 ? interest / avg : null };
    });
  }, [byYear, history]);

  if (!byYear) return null;
  const pct = (r: number) => `${(r * 100).toLocaleString(localeTag(), { maximumFractionDigits: 2 })} %`;
  return (
    <section className="pg-section ad-interest">
      <div className="pg-section-head"><h2>{t('comptes.features.interest_title')}</h2></div>
      {rows.length === 0 ? (
        <p className="acc-muted">{t('comptes.features.interest_none')}</p>
      ) : (
        <table className="ad-table">
          <thead><tr><th>{t('comptes.features.year')}</th><th className="num">{t('comptes.features.interest')}</th><th className="num">{t('comptes.features.observed_rate')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year}>
                <td>{r.year}</td>
                <td className="num income">+{fmt(r.interest)}</td>
                <td className="num acc-muted">{r.rate != null ? pct(r.rate) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="acc-muted ad-note">{t('comptes.features.interest_note')}</p>
    </section>
  );
}
