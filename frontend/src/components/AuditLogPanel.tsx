import { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import type { AuditLogEntry } from '@suzanne/shared';
import { api } from '../lib/api';
import { DataTable } from './DataTable';
import { Panel } from './Panel';

const ACTION_LABEL: Record<string, string> = { POST: 'Création', PATCH: 'Modification', PUT: 'Modification', DELETE: 'Suppression' };
const ENTITY_LABEL: Record<string, string> = {
  transactions: 'Transaction', accounts: 'Compte', categories: 'Catégorie', budgets: 'Budget',
  recurring: 'Récurrent', goals: 'Objectif', 'savings-goals': 'Objectif', bills: 'Facture',
  holdings: 'Position', alerts: 'Alerte', snapshots: 'Snapshot', rules: 'Règle', tags: 'Tag',
  attachments: 'Pièce jointe', backups: 'Sauvegarde', institutions: 'Institution',
};

// Journal d'audit : dernières mutations (qui/quoi/quand).
export function AuditLogPanel({ userId, dataVersion = 0 }: { userId: number; dataVersion?: number }) {
  const [items, setItems] = useState<AuditLogEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.auditLog(userId)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [userId, dataVersion]);

  return (
    <Panel title="Activité récente" icon={<History />}>
      <p className="panel-note">Journal des modifications (200 dernières).</p>
      {items == null ? (
        <p className="empty"><Loader2 className="spin-icon" size={16} /> Chargement…</p>
      ) : (
        <DataTable scroll empty={items.length === 0 ? 'Aucune activité enregistrée.' : null}>
          <thead><tr><th>Quand</th><th>Action</th><th>Élément</th></tr></thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td data-label="Quand">{new Date(e.created_at).toLocaleString('fr-FR')}</td>
                <td data-label="Action">{ACTION_LABEL[e.action] ?? e.action}</td>
                <td data-label="Élément">{ENTITY_LABEL[e.entity] ?? e.entity}{e.entity_id != null ? ` #${e.entity_id}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Panel>
  );
}
