import { useEffect, useState } from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import type { Category, Transaction } from '@suzanne/shared';
import { api } from '../lib/api';
import { money, txLabel } from '../lib/format';
import { DataTable } from './DataTable';
import { IconButton } from './IconButton';
import { Modal } from './Modal';
import type { Run } from '../lib/run';

// Corbeille : transactions soft-deleted, restaurables ou purgeables. La liste
// est rechargée localement après chaque action (le reload global ne la couvre pas).
export function TrashModal({ userId, categoryById, run, onClose }: {
  userId: number;
  categoryById: Map<number, Category>;
  run: Run;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Transaction[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.trashedTransactions(userId)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [userId, version]);

  const restore = (t: Transaction) => {
    void run(() => api.restoreTransaction(userId, t.id), 'Transaction restaurée').then((ok) => { if (ok) setVersion((v) => v + 1); });
  };
  const purge = (t: Transaction) => {
    void run(() => api.purgeTransaction(userId, t.id), 'Transaction supprimée définitivement').then((ok) => { if (ok) setVersion((v) => v + 1); });
  };

  return (
    <Modal title="Corbeille" onClose={onClose} wide>
      <p className="panel-note">Les transactions supprimées sont conservées ici. Restaure-les ou supprime-les définitivement (irréversible).</p>
      {items == null ? (
        <p className="empty"><Loader2 className="spin-icon" size={16} /> Chargement…</p>
      ) : (
        <DataTable scroll empty={items.length === 0 ? 'La corbeille est vide.' : null}>
          <thead><tr><th>Date</th><th>Libellé</th><th className="amount-cell">Montant</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td data-label="Date">{new Date(t.date).toLocaleDateString('fr-FR')}</td>
                <td data-label="Libellé">{txLabel(t, categoryById)}</td>
                <td className={`amount-cell ${t.type === 'income' ? 'income' : t.type === 'expense' ? 'expense' : 'transfer'}`} data-label="Montant">
                  {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}{money(Math.abs(t.amount))}
                </td>
                <td className="actions-cell">
                  <IconButton label="Restaurer" tone="accent" icon={<RotateCcw size={16} />} onClick={() => restore(t)} />
                  <IconButton label="Supprimer définitivement" confirm="Supprimer définitivement ? Cette action est irréversible." icon={<Trash2 size={16} />} onClick={() => purge(t)} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <button type="button" className="secondary" onClick={onClose}>Fermer</button>
    </Modal>
  );
}
