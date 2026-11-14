import { useEffect, useState } from 'react';
import { Clock, DatabaseBackup, Download, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { BackupImportSummary, BackupMeta } from '@suzanne/shared';
import { api } from '../lib/api';
import { saveBlob, summarizeBackupImport } from '../lib/download';
import { DataTable } from './DataTable';
import { IconButton } from './IconButton';
import { Panel } from './Panel';
import { RowMenu } from './ui/RowMenu';
import type { Run } from '../lib/run';
import { useTranslation } from 'react-i18next';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// Sauvegardes : snapshots JSON complets stockés en base, créés à la demande ou
// automatiquement chaque jour (rotation côté serveur).
export function BackupsPanel({ userId, run }: { userId: number; run: Run }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<BackupMeta[] | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.backups(userId)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [userId, version]);

  const create = () => {
    setBusy(true);
    void run(() => api.createBackup(userId), 'Sauvegarde créée')
      .then((ok) => { if (ok) setVersion((v) => v + 1); })
      .finally(() => setBusy(false));
  };
  const download = async (b: BackupMeta) => {
    try {
      saveBlob(await api.backupBlob(userId, b.id), `suzanne-backup-${b.created_at.slice(0, 10)}-${b.id}.json`);
    } catch (e) {
      window.alert(`Téléchargement impossible : ${(e as Error).message}`);
    }
  };
  const restore = (b: BackupMeta) => {
    void run(() => api.restoreBackup(userId, b.id), (result) => `Sauvegarde restaurée. ${summarizeBackupImport(result as BackupImportSummary)}`);
  };
  const remove = (b: BackupMeta) => {
    void run(() => api.deleteBackup(userId, b.id), 'Sauvegarde supprimée').then((ok) => { if (ok) setVersion((v) => v + 1); });
  };

  return (
    <Panel
      title={t('reglages.backups_panel.backups')}
      action={(
        <button type="button" className="secondary" disabled={busy} onClick={create}>
          {busy ? <Loader2 className="spin-icon" size={16} /> : <Plus size={16} />}  {t('reglages.backups_panel.create')}
        </button>
      )}
    >
      <p className="panel-note">{t('reglages.backups_panel.one_automatic_backup_per_day')}</p>
      {items == null ? (
        <p className="empty"><Loader2 className="spin-icon" size={16} />  {t('reglages.backups_panel.loading')}</p>
      ) : (
        <DataTable scroll empty={items.length === 0 ? 'Aucune sauvegarde.' : null}>
          <thead><tr><th>{t('reglages.backups_panel.backup')}</th><th>{t('reglages.backups_panel.date')}</th><th className="amount-cell">{t('reglages.backups_panel.size')}</th><th className="actions-cell"><span className="sr-only">{t('reglages.backups_panel.actions')}</span></th></tr></thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.id}>
                <td className="cell-primary">
                  <span className="st-name">
                    {b.auto ? <Clock size={14} aria-label={t('reglages.backups_panel.automatic')} /> : <DatabaseBackup size={14} aria-label={t('reglages.backups_panel.manual')} />}
                    <span title={b.label}>{b.label}</span>
                  </span>
                </td>
                <td className="st-muted" data-label={t('reglages.backups_panel.date')}>{new Date(b.created_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className="amount-cell st-muted" data-label={t('reglages.backups_panel.size')}>{humanSize(b.size)}</td>
                <td className="actions-cell">
                  <IconButton label={t('reglages.backups_panel.download')} tone="neutral" icon={<Download size={16} />} onClick={() => void download(b)} />
                  <RowMenu items={[
                    { label: 'Restaurer', icon: <RotateCcw />, confirm: 'Restaurer cette sauvegarde ? Rien n’est écrasé ni dupliqué : seules les données absentes sont recréées.', onSelect: () => restore(b) },
                    { label: 'Supprimer', icon: <Trash2 />, danger: true, confirm: 'Supprimer cette sauvegarde ?', onSelect: () => remove(b) },
                  ]} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Panel>
  );
}
