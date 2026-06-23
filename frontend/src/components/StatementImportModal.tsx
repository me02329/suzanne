import { useState } from 'react';
import { FileUp, Loader2, Upload } from 'lucide-react';
import type { Account, ImportDateFormat, ImportResult } from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { Modal } from './Modal';
import type { Run } from '../lib/run';

// Import d'un relevé bancaire OFX ou QIF. Le format OFX porte sa propre date
// (AAAAMMJJ) ; pour QIF, la date est ambiguë → on laisse choisir le format.
export function StatementImportModal({ userId, accounts, run, onClose }: {
  userId: number;
  accounts: Account[];
  run: Run;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<'ofx' | 'qif'>('ofx');
  const [accountId, setAccountId] = useState('');
  const [dateFormat, setDateFormat] = useState<ImportDateFormat>('auto');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setContent(await file.text());
    setFileName(file.name);
    if (file.name.toLowerCase().endsWith('.qif')) setFormat('qif');
    if (file.name.toLowerCase().endsWith('.ofx')) setFormat('ofx');
  };

  const submit = () => {
    void run(async () => {
      const r = await api.importStatement(userId, {
        format,
        content,
        account_id: accountId ? Number(accountId) : null,
        date_format: format === 'qif' ? dateFormat : undefined,
      });
      setResult(r);
      return r;
    }, (r) => `Relevé : ${(r as ImportResult).imported} importées, ${(r as ImportResult).duplicates_count} doublons ignorés`);
  };

  return (
    <Modal title="Importer un relevé (OFX / QIF)" onClose={onClose} wide>
      <p className="panel-note">
        Glisse un fichier <code>.ofx</code> ou <code>.qif</code> exporté depuis ta banque. Les doublons (déjà présents
        ou en double dans le fichier) sont détectés et ignorés, et les règles d'auto-catégorisation s'appliquent.
      </p>
      <div className="form tools-modal-form">
        <label>Fichier
          <input type="file" accept=".ofx,.qif,application/x-ofx,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {fileName && <p className="panel-note"><FileUp size={14} /> {fileName} · {content.length.toLocaleString('fr-FR')} caractères</p>}
        <label>Format
          <select value={format} onChange={(e) => setFormat(e.target.value as 'ofx' | 'qif')}>
            <option value="ofx">OFX</option>
            <option value="qif">QIF</option>
          </select>
        </label>
        <label>Compte
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Aucun</option>
            {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </label>
        {format === 'qif' && (
          <label>Format de date (QIF)
            <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as ImportDateFormat)}>
              <option value="auto">Auto</option>
              <option value="dd/mm/yyyy">JJ/MM/AAAA</option>
              <option value="mm/dd/yyyy">MM/JJ/AAAA</option>
              <option value="yyyy-mm-dd">AAAA-MM-JJ</option>
            </select>
          </label>
        )}
        {result && (
          <div className="panel-note">
            <strong>{result.imported}</strong> transactions importées · {result.skipped} ignorées
            {result.duplicates_count > 0 && ` (dont ${result.duplicates_count} doublons)`}.
          </div>
        )}
        <div className="form-inline">
          <button type="button" className="primary" disabled={!content} onClick={submit}>
            {content ? <Upload size={16} /> : <Loader2 size={16} />} Importer
          </button>
          <button type="button" className="secondary" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </Modal>
  );
}
