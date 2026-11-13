import { useEffect, useState } from 'react';
import { Clock, DatabaseBackup, Download, Loader2, Plus, RotateCcw } from 'lucide-react';
import type { BackupImportSummary, BackupMeta } from '@suzanne/shared';
import { api } from '../lib/api';
import { saveBlob, summarizeBackupImport } from '../lib/download';
import { DataTable } from './DataTable';
import { IconButton } from './IconButton';
import { Panel } from './Panel';
import type { Run } from '../lib/run';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// Sauvegardes : snapshots JSON complets stockés en base, créés à la demande ou
// automatiquement chaque jour (rotation côté serveur).
export function BackupsPanel({ userId, run }: { userId: number; run: Run }) {
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
    <Panel title="Sauvegardes" icon={<DatabaseBackup />}>
      <p className="panel-note">Snapshots complets stockés dans la base. Une sauvegarde automatique est créée chaque jour (les 14 dernières sont conservées).</p>
      <div className="form-inline" style={{ marginBottom: 12 }}>
        <button type="button" className="primary" disabled={busy} onClick={create}>
          {busy ? <Loader2 className="spin-icon" size={16} /> : <Plus size={16} />} Créer une sauvegarde
        </button>
      </div>
      {items == null ? (
        <p className="empty"><Loader2 className="spin-icon" size={16} /> Chargement…</p>
      ) : (
        <DataTable scroll empty={items.length === 0 ? 'Aucune sauvegarde.' : null}>
          <thead><tr><th>Sauvegarde</th><th className="amount-cell">Taille</th><th>Date</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.id}>
                <td data-label="Sauvegarde">{b.auto ? <Clock size={13} /> : <DatabaseBackup size={13} />} {b.label}</td>
                <td className="amount-cell" data-label="Taille">{humanSize(b.size)}</td>
                <td data-label="Date">{new Date(b.created_at).toLocaleString('fr-FR')}</td>
                <td className="actions-cell">
                  <IconButton label="Télécharger" tone="neutral" icon={<Download size={16} />} onClick={() => void download(b)} />
                  <IconButton label="Restaurer" tone="accent" confirm="Restaurer cette sauvegarde ? Rien n'est écrasé ni dupliqué : seules les données absentes sont recréées." icon={<RotateCcw size={16} />} onClick={() => restore(b)} />
                  <IconButton label="Supprimer" confirm="Supprimer cette sauvegarde ?" onClick={() => remove(b)} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Panel>
  );
}
