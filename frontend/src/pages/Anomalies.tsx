import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleSlash, Copy, Loader2, ScanLine, Tags } from 'lucide-react';
import type { Account, AnomalyReport, AnomalyTxRef } from '@suzanne/shared';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';

const signedMoney = (t: AnomalyTxRef) => `${t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}${money(Math.abs(t.amount))}`;

export function Anomalies({ userId, accountById, dataVersion }: {
  userId: number;
  accountById: Map<number, Account>;
  dataVersion: number;
}) {
  const [report, setReport] = useState<AnomalyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.anomalies(userId)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch(() => { if (!cancelled) setReport(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [userId, dataVersion]);

  const accountName = (id: number | null) => (id != null ? accountById.get(id)?.name ?? `#${id}` : '—');
  const openTx = (t: AnomalyTxRef) => navigate(`/transactions?q=${encodeURIComponent(t.description ?? '')}`);

  if (loading) return <p className="empty"><Loader2 className="spin-icon" size={16} /> Analyse en cours…</p>;
  if (!report) return <p className="empty">Analyse indisponible.</p>;

  const clean = report.no_account.length === 0 && report.no_category.length === 0 && report.duplicates.length === 0;

  return (
    <section className="stack">
      {clean && (
        <Panel title="Aucune anomalie" icon={<ScanLine />}>
          <p className="panel-note">Rien à signaler : pas de transaction orpheline, sans catégorie, ni de doublon probable.</p>
        </Panel>
      )}

      {report.no_account.length > 0 && (
        <Panel title={`Sans compte (${report.no_account.length})`} icon={<CircleSlash />}>
          <p className="panel-note">Ces revenus/dépenses ne sont rattachés à aucun compte — ils ne pèsent pas dans les soldes.</p>
          <DataTable scroll empty={null}>
            <thead><tr><th>Date</th><th>Libellé</th><th className="amount-cell">Montant</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {report.no_account.map((t) => (
                <tr key={t.id}>
                  <td data-label="Date">{new Date(t.date).toLocaleDateString('fr-FR')}</td>
                  <td data-label="Libellé">{t.description ?? <span className="muted">Sans libellé</span>}</td>
                  <td className={`amount-cell ${t.type === 'income' ? 'income' : 'expense'}`} data-label="Montant">{signedMoney(t)}</td>
                  <td className="actions-cell"><IconButton label="Voir" tone="neutral" icon={<Tags size={16} />} onClick={() => openTx(t)} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      )}

      {report.no_category.length > 0 && (
        <Panel title={`Sans catégorie (${report.no_category.length})`} icon={<Tags />}>
          <p className="panel-note">Catégoriser ces transactions améliore les statistiques et budgets.</p>
          <DataTable scroll empty={null}>
            <thead><tr><th>Date</th><th>Compte</th><th>Libellé</th><th className="amount-cell">Montant</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {report.no_category.map((t) => (
                <tr key={t.id}>
                  <td data-label="Date">{new Date(t.date).toLocaleDateString('fr-FR')}</td>
                  <td data-label="Compte">{accountName(t.account_id)}</td>
                  <td data-label="Libellé">{t.description ?? <span className="muted">Sans libellé</span>}</td>
                  <td className={`amount-cell ${t.type === 'income' ? 'income' : 'expense'}`} data-label="Montant">{signedMoney(t)}</td>
                  <td className="actions-cell"><IconButton label="Voir" tone="neutral" icon={<Tags size={16} />} onClick={() => openTx(t)} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      )}

      {report.duplicates.length > 0 && (
        <Panel title={`Doublons probables (${report.duplicates.length})`} icon={<Copy />}>
          <p className="panel-note">Même compte, même type, même montant, à {'≤'} 2 jours d'écart — souvent un import rejoué ou une double saisie. À vérifier avant suppression.</p>
          <DataTable scroll empty={null}>
            <thead><tr><th>Compte</th><th className="amount-cell">Montant</th><th>Transaction A</th><th>Transaction B</th><th>Écart</th><th className="actions-cell"></th></tr></thead>
            <tbody>
              {report.duplicates.map((p, i) => (
                <tr key={`${p.a.id}-${p.b.id}-${i}`}>
                  <td data-label="Compte">{accountName(p.a.account_id)}</td>
                  <td className={`amount-cell ${p.a.type === 'income' ? 'income' : 'expense'}`} data-label="Montant">{signedMoney(p.a)}</td>
                  <td data-label="A">{new Date(p.a.date).toLocaleDateString('fr-FR')} · {p.a.description ?? <span className="muted">—</span>}</td>
                  <td data-label="B">{new Date(p.b.date).toLocaleDateString('fr-FR')} · {p.b.description ?? <span className="muted">—</span>}</td>
                  <td data-label="Écart">{p.days_apart} j</td>
                  <td className="actions-cell"><IconButton label="Voir" tone="neutral" icon={<Tags size={16} />} onClick={() => openTx(p.a)} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      )}
    </section>
  );
}
