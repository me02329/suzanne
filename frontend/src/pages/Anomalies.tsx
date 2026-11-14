import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, CircleSlash, Copy, ExternalLink, Loader2, ScanLine, Tags, Trash2 } from 'lucide-react';
import type { Account, AnomalyReport, AnomalyTxRef, Category } from '@suzanne/shared';
import { api, http } from '../lib/api';
import { money } from '../lib/format';
import { pickableAccounts } from '../lib/account';
import type { Run } from '../lib/run';
import { DataTable } from '../components/DataTable';
import { IconButton } from '../components/IconButton';
import { Panel } from '../components/Panel';
import { CategoryName } from '../components/CategoryName';

const signedMoney = (t: AnomalyTxRef) => `${t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''}${money(Math.abs(t.amount))}`;
const dateFr = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR');

// « À vérifier » : chaque signalement se règle sur place (catégorie, compte,
// doublon validé ou supprimé) ; « Voir » ouvre l'opération dans le journal,
// sur son mois.
export function Anomalies({ userId, accounts, accountById, categories, categoryById, dataVersion, run }: {
  userId: number;
  accounts: Account[];
  accountById: Map<number, Account>;
  categories: Category[];
  categoryById: Map<number, Category>;
  dataVersion: number;
  run: Run;
}) {
  const [report, setReport] = useState<AnomalyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setLoading((current) => current && report === null);
    api.anomalies(userId)
      .then((r) => { if (!cancelled) setReport(r); })
      .catch(() => { if (!cancelled) setReport(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, dataVersion]);

  const byType = useMemo(() => ({
    expense: categories.filter((c) => c.type === 'expense'),
    income: categories.filter((c) => c.type === 'income'),
  }), [categories]);

  const accountName = (id: number | null) => (id != null ? accountById.get(id)?.name ?? `#${id}` : '—');
  // Le journal bascule de lui-même sur le mois de l'opération (?tx=).
  const openTx = (t: AnomalyTxRef) => navigate(`/transactions?tx=${t.id}`);

  const setCategory = (t: AnomalyTxRef, categoryId: number) => {
    const name = categoryById.get(categoryId)?.name ?? 'catégorie';
    void run(() => api.updateTransaction(userId, t.id, { category_id: categoryId }), `Catégorisée « ${name} »`);
  };
  const acceptAll = (rows: Array<AnomalyTxRef & { suggested_category_id?: number | null }>) => {
    const todo = rows.filter((r) => r.suggested_category_id != null);
    void run(async () => {
      // Regroupées par catégorie : une requête groupée par catégorie proposée.
      const groups = new Map<number, number[]>();
      for (const r of todo) groups.set(r.suggested_category_id!, [...(groups.get(r.suggested_category_id!) ?? []), r.id]);
      for (const [category_id, ids] of groups) await api.bulkUpdateTransactions(userId, { ids, category_id });
    }, `${todo.length} opération${todo.length > 1 ? 's' : ''} catégorisée${todo.length > 1 ? 's' : ''}`);
  };
  const setAccount = (t: AnomalyTxRef, accountId: number) => {
    void run(() => api.updateTransaction(userId, t.id, { account_id: accountId }), `Rattachée à ${accountName(accountId)}`);
  };
  const dismissPair = (a: AnomalyTxRef, b: AnomalyTxRef) => {
    void run(
      () => http(`/users/${userId}/anomalies/duplicates/dismiss`, { method: 'POST', body: JSON.stringify({ a_id: a.id, b_id: b.id }) }),
      'Validé : ce n’est pas un doublon',
    );
  };
  const restoreDismissed = () => {
    void run(() => http(`/users/${userId}/anomalies/duplicates/dismiss`, { method: 'DELETE' }), 'Doublons validés réaffichés');
  };
  const deleteTx = (t: AnomalyTxRef) => {
    void run(
      () => api.deleteTransaction(userId, t.id),
      'Doublon déplacé vers la corbeille',
      { undo: () => api.restoreTransaction(userId, t.id) },
    );
  };

  if (loading) return <p className="empty"><Loader2 className="spin-icon" size={16} /> Analyse en cours…</p>;
  if (!report) return <p className="empty">Analyse indisponible.</p>;

  const clean = report.no_account.length === 0 && report.no_category.length === 0 && report.duplicates.length === 0;
  const suggestedCount = report.no_category.filter((r) => r.suggested_category_id != null).length;

  return (
    <section className="stack">
      {clean && (
        <Panel title="Aucune anomalie" icon={<ScanLine />}>
          <p className="panel-note">Rien à signaler : pas de transaction orpheline, sans catégorie, ni de doublon probable.</p>
        </Panel>
      )}

      {report.no_account.length > 0 && (
        <Panel title={`Sans compte (${report.no_account.length})`} icon={<CircleSlash />}>
          <p className="panel-note">Ces revenus/dépenses ne sont rattachés à aucun compte — ils ne pèsent pas dans les soldes. Choisis le compte pour régler le signalement.</p>
          <DataTable scroll empty={null}>
            <thead><tr><th>Date</th><th>Libellé</th><th className="amount-cell">Montant</th><th>Compte</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {report.no_account.map((t) => (
                <tr key={t.id}>
                  <td data-label="Date">{dateFr(t.date)}</td>
                  <td data-label="Libellé">{t.description ?? <span className="muted">Sans libellé</span>}</td>
                  <td className={`amount-cell ${t.type === 'income' ? 'income' : 'expense'}`} data-label="Montant">{signedMoney(t)}</td>
                  <td data-label="Compte">
                    <select value="" onChange={(e) => { if (e.target.value) setAccount(t, Number(e.target.value)); }} aria-label="Rattacher au compte">
                      <option value="">Choisir…</option>
                      {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td className="actions-cell"><IconButton label="Voir dans le journal" tone="neutral" icon={<ExternalLink size={16} />} onClick={() => openTx(t)} /></td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      )}

      {report.no_category.length > 0 && (
        <Panel
          title={`Sans catégorie (${report.no_category.length})`}
          icon={<Tags />}
          action={suggestedCount > 0 ? (
            <button type="button" className="secondary" onClick={() => acceptAll(report.no_category)}>
              <Check size={16} /> Valider les {suggestedCount} propositions
            </button>
          ) : undefined}
        >
          <p className="panel-note">Choisis la catégorie directement ici. Quand une catégorie est proposée (règle ou même libellé déjà catégorisé), ✓ la valide.</p>
          <DataTable scroll empty={null}>
            <thead><tr><th>Date</th><th>Compte</th><th>Libellé</th><th className="amount-cell">Montant</th><th>Catégorie</th><th className="actions-cell">Actions</th></tr></thead>
            <tbody>
              {report.no_category.map((t) => {
                const suggestion = t.suggested_category_id != null ? categoryById.get(t.suggested_category_id) : undefined;
                const options = t.type === 'income' ? byType.income : byType.expense;
                const value = picked[t.id] ?? (suggestion ? String(suggestion.id) : '');
                return (
                  <tr key={t.id}>
                    <td data-label="Date">{dateFr(t.date)}</td>
                    <td data-label="Compte">{accountName(t.account_id)}</td>
                    <td data-label="Libellé">{t.description ?? <span className="muted">Sans libellé</span>}</td>
                    <td className={`amount-cell ${t.type === 'income' ? 'income' : 'expense'}`} data-label="Montant">{signedMoney(t)}</td>
                    <td data-label="Catégorie">
                      <div className="review-cat">
                        <select
                          value={value}
                          onChange={(e) => {
                            setPicked((cur) => ({ ...cur, [t.id]: e.target.value }));
                            // Choix explicite = appliqué tout de suite.
                            if (e.target.value) setCategory(t, Number(e.target.value));
                          }}
                          aria-label="Catégorie"
                        >
                          <option value="">Choisir…</option>
                          {options.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        {suggestion && picked[t.id] === undefined && <small className="muted">Proposée : <CategoryName category={suggestion} /></small>}
                      </div>
                    </td>
                    <td className="actions-cell">
                      {suggestion && picked[t.id] === undefined && (
                        <IconButton label={`Valider « ${suggestion.name} »`} tone="neutral" icon={<Check size={16} />} onClick={() => setCategory(t, suggestion.id)} />
                      )}
                      <IconButton label="Voir dans le journal" tone="neutral" icon={<ExternalLink size={16} />} onClick={() => openTx(t)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </Panel>
      )}

      {(report.duplicates.length > 0 || (report.dismissed_duplicates ?? 0) > 0) && (
        <Panel
          title={`Doublons probables (${report.duplicates.length})`}
          icon={<Copy />}
          action={(report.dismissed_duplicates ?? 0) > 0 ? (
            <button type="button" className="secondary" onClick={restoreDismissed}>Réafficher les {report.dismissed_duplicates} validés</button>
          ) : undefined}
        >
          <p className="panel-note">Même compte, même type, même montant, à {'≤'} 2 jours d'écart — souvent un import rejoué ou une double saisie. ✓ = « ce n’est pas un doublon » (la paire ne sera plus proposée) ; sinon supprime l’une des deux.</p>
          {report.duplicates.length === 0 ? <p className="panel-note">Aucun doublon en attente.</p> : (
            <DataTable scroll empty={null}>
              <thead><tr><th>Compte</th><th className="amount-cell">Montant</th><th>Transaction A</th><th>Transaction B</th><th>Écart</th><th className="actions-cell">Actions</th></tr></thead>
              <tbody>
                {report.duplicates.map((p, i) => (
                  <tr key={`${p.a.id}-${p.b.id}-${i}`}>
                    <td data-label="Compte">{accountName(p.a.account_id)}</td>
                    <td className={`amount-cell ${p.a.type === 'income' ? 'income' : 'expense'}`} data-label="Montant">{signedMoney(p.a)}</td>
                    <td data-label="A">
                      <button type="button" className="link-button" onClick={() => openTx(p.a)}>{dateFr(p.a.date)} · {p.a.description ?? '—'}</button>
                    </td>
                    <td data-label="B">
                      <button type="button" className="link-button" onClick={() => openTx(p.b)}>{dateFr(p.b.date)} · {p.b.description ?? '—'}</button>
                    </td>
                    <td data-label="Écart">{p.days_apart} j</td>
                    <td className="actions-cell">
                      <IconButton label="Pas un doublon : valider" tone="neutral" icon={<Check size={16} />} onClick={() => dismissPair(p.a, p.b)} />
                      <IconButton label="Supprimer B (corbeille)" tone="danger" icon={<Trash2 size={16} />} onClick={() => deleteTx(p.b)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Panel>
      )}
    </section>
  );
}
