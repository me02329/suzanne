import { useEffect, useState } from 'react';
const PAGE = 12;
import { Loader2 } from 'lucide-react';
import type { AuditLogEntry } from '@suzanne/shared';
import { api } from '../lib/api';
import { DataTable } from './DataTable';
import { Panel } from './Panel';
import { useTranslation } from 'react-i18next';
import { localeTag } from '../i18n';

const ACTION_LABEL: Record<string, string> = { POST: 'Création', PATCH: 'Modification', PUT: 'Modification', DELETE: 'Suppression' };
const ENTITY_LABEL: Record<string, string> = {
  transactions: 'Transaction', accounts: 'Compte', categories: 'Catégorie', budgets: 'Budget',
  recurring: 'Récurrent', goals: 'Objectif', 'savings-goals': 'Objectif', bills: 'Facture',
  holdings: 'Position', alerts: 'Alerte', snapshots: 'Snapshot', rules: 'Règle', tags: 'Tag',
  attachments: 'Pièce jointe', backups: 'Sauvegarde', institutions: 'Institution',
};

// Journal d'audit : dernières mutations (qui/quoi/quand).
export function AuditLogPanel({ userId, dataVersion = 0 }: { userId: number; dataVersion?: number }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<AuditLogEntry[] | null>(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let cancelled = false;
    api.auditLog(userId)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [userId, dataVersion]);

  return (
    <Panel title={t('reglages.audit_log_panel.recent_activity')}>
      <p className="panel-note">{t('reglages.audit_log_panel.the_latest_changes_newest_first')}</p>
      {items == null ? (
        <p className="empty"><Loader2 className="spin-icon" size={16} />  {t('reglages.audit_log_panel.loading')}</p>
      ) : (
        <>
        <DataTable empty={items.length === 0 ? 'Aucune activité enregistrée.' : null}>
          <thead><tr><th>{t('reglages.audit_log_panel.item')}</th><th>{t('reglages.audit_log_panel.action')}</th><th>{t('reglages.audit_log_panel.when')}</th></tr></thead>
          <tbody>
            {items.slice(0, shown).map((e) => (
              <tr key={e.id}>
                <td className="cell-primary"><strong>{ENTITY_LABEL[e.entity] ?? e.entity}{e.entity_id != null ? ` #${e.entity_id}` : ''}</strong></td>
                <td data-label={t('reglages.audit_log_panel.action')}>{ACTION_LABEL[e.action] ?? e.action}</td>
                <td className="st-muted" data-label={t('reglages.audit_log_panel.when')}>{new Date(e.created_at).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' })}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        {items.length > shown && (
          <button type="button" className="secondary st-more" onClick={() => setShown((n) => n + 50)}>
            
            {t('reglages.audit_log_panel.show_more')}{items.length - shown})
          </button>
        )}
        </>
      )}
    </Panel>
  );
}
