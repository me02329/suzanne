import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Loader2, Paperclip, Upload } from 'lucide-react';
import type { Attachment } from '@suzanne/shared';
import { api } from '../lib/api';
import { DataTable } from './DataTable';
import { IconButton } from './IconButton';
import { Modal } from './Modal';
import type { Run } from '../lib/run';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

// Lit un fichier en base64 (sans le préfixe data:) pour l'upload JSON.
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Lecture impossible'));
    reader.readAsDataURL(file);
  });
}

export function AttachmentsModal({ userId, transactionId, label, run, onClose }: {
  userId: number;
  transactionId: number;
  label: string;
  run: Run;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [version, setVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    api.attachments(userId, transactionId)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [userId, transactionId, version]);

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const data_base64 = await readBase64(file);
      const ok = await run(
        () => api.uploadAttachment(userId, transactionId, { filename: file.name, mime_type: file.type || 'application/octet-stream', data_base64 }),
        'Pièce jointe ajoutée',
      );
      if (ok) setVersion((v) => v + 1);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const open = async (a: Attachment) => {
    try {
      const url = await api.attachmentBlobUrl(userId, a.id);
      window.open(url, '_blank', 'noopener');
      // Révocation différée : laisse le temps au nouvel onglet de charger.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch { /* l'erreur réseau est déjà visible côté onglet */ }
  };

  const remove = (a: Attachment) => {
    void run(() => api.deleteAttachment(userId, a.id), 'Pièce jointe supprimée').then((ok) => { if (ok) setVersion((v) => v + 1); });
  };

  return (
    <Modal title={`Pièces jointes · ${label}`} onClose={onClose} wide>
      <p className="panel-note">Reçus et justificatifs (images ou PDF, 8 Mo max), stockés dans la base.</p>
      <div className="form-inline" style={{ marginBottom: 12 }}>
        <input ref={fileInput} type="file" accept="image/*,application/pdf" hidden onChange={onPick} />
        <button type="button" className="primary" disabled={uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? <Loader2 className="spin-icon" size={16} /> : <Upload size={16} />} Ajouter un fichier
        </button>
      </div>
      {items == null ? (
        <p className="empty"><Loader2 className="spin-icon" size={16} /> Chargement…</p>
      ) : (
        <DataTable scroll empty={items.length === 0 ? 'Aucune pièce jointe.' : null}>
          <thead><tr><th>Fichier</th><th className="amount-cell">Taille</th><th>Ajouté le</th><th className="actions-cell">Actions</th></tr></thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td data-label="Fichier">
                  {a.mime_type.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />} {a.filename}
                </td>
                <td className="amount-cell" data-label="Taille">{humanSize(a.size)}</td>
                <td data-label="Ajouté le">{new Date(a.created_at).toLocaleDateString('fr-FR')}</td>
                <td className="actions-cell">
                  <IconButton label="Ouvrir / télécharger" tone="neutral" icon={<Download size={16} />} onClick={() => void open(a)} />
                  <IconButton label="Supprimer" confirm="Supprimer cette pièce jointe ?" onClick={() => remove(a)} />
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <button type="button" className="secondary" onClick={onClose}><Paperclip size={16} /> Fermer</button>
    </Modal>
  );
}
