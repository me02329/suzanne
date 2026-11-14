import { useRef, useState } from 'react';
import { FileUp, Loader2, Upload } from 'lucide-react';
import type { Account, ImportDateFormat, ImportResult } from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { Modal } from './Modal';
import type { Run } from '../lib/run';
import { useTranslation } from 'react-i18next';
import { localeTag } from '../i18n';

// Import d'un relevé bancaire OFX ou QIF. Le format OFX porte sa propre date
// (AAAAMMJJ) ; pour QIF, la date est ambiguë → on laisse choisir le format.
export function StatementImportModal({ userId, accounts, run, onClose }: {
  userId: number;
  accounts: Account[];
  run: Run;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<'ofx' | 'qif'>('ofx');
  const [accountId, setAccountId] = useState('');
  const [dateFormat, setDateFormat] = useState<ImportDateFormat>('auto');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setContent(await file.text());
    setFileName(file.name);
    setResult(null);
    if (file.name.toLowerCase().endsWith('.qif')) setFormat('qif');
    if (file.name.toLowerCase().endsWith('.ofx')) setFormat('ofx');
  };

  const submit = () => {
    setBusy(true);
    void run(async () => {
      const r = await api.importStatement(userId, {
        format,
        content,
        account_id: accountId ? Number(accountId) : null,
        date_format: format === 'qif' ? dateFormat : undefined,
      });
      setResult(r);
      return r;
    }, (r) => `Relevé : ${(r as ImportResult).imported} importées, ${(r as ImportResult).duplicates_count} doublons ignorés`).finally(() => setBusy(false));
  };

  return (
    <Modal title={t('operations.statement_import_modal.import_ofx_qif_statement')} onClose={onClose} wide>
      <div className="form tools-modal-form">
        <div
          className={`csv-drop full${dragActive ? ' active' : ''}${fileName ? ' loaded' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => { event.preventDefault(); setDragActive(false); void onFile(event.dataTransfer.files?.[0]); }}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileRef.current?.click(); } }}
          role="button"
          tabIndex={0}
        >
          <Upload size={20} />
          <span>
            {fileName
              ? <><strong>{fileName}</strong> · {content.length.toLocaleString(localeTag())}  {t('operations.statement_import_modal.characters_key_to_change')}</>
              : 'Dépose le fichier .ofx ou .qif ici, ou touche pour parcourir'}
          </span>
        </div>
        <input ref={fileRef} type="file" accept=".ofx,.qif,application/x-ofx,text/plain" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        <label>{t('operations.statement_import_modal.format')}
          <select value={format} onChange={(e) => setFormat(e.target.value as 'ofx' | 'qif')}>
            <option value="ofx">OFX</option>{/* i18n-ignore */}
            <option value="qif">QIF</option>{/* i18n-ignore */}
          </select>
        </label>
        <label>{t('operations.statement_import_modal.account')}
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">{t('operations.statement_import_modal.none')}</option>
            {pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
          </select>
        </label>
        {format === 'qif' && (
          <label>{t('operations.statement_import_modal.date_format_qif')}
            <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as ImportDateFormat)}>
              <option value="auto">{t('operations.statement_import_modal.auto')}</option>
              <option value="dd/mm/yyyy">{t('operations.statement_import_modal.dd_mm_yyyy')}</option>
              <option value="mm/dd/yyyy">{t('operations.statement_import_modal.mm_dd_yyyy')}</option>
              <option value="yyyy-mm-dd">{t('operations.statement_import_modal.yyyy_mm_dd')}</option>
            </select>
          </label>
        )}
        <p className="panel-note full">{t('operations.statement_import_modal.duplicates_already_present_or_repeated')}</p>
        {result && (
          <div className="notice full" role="status">
            <FileUp size={16} /> <strong>{result.imported}</strong>  {t('operations.statement_import_modal.imported')}{result.imported > 1 ? 's' : ''} · {result.skipped}  {t('operations.statement_import_modal.skipped')}{result.skipped > 1 ? 's' : ''}
            {result.duplicates_count > 0 && ` (dont ${result.duplicates_count} doublon${result.duplicates_count > 1 ? 's' : ''})`}
          </div>
        )}
        <div className="modal-actions full">
          <button type="button" className="secondary" onClick={onClose}>{result ? 'Fermer' : 'Annuler'}</button>
          <button type="button" className="primary" disabled={!content || busy} onClick={submit}>
            {busy ? <Loader2 className="spin-icon" size={16} /> : <Upload size={16} />}  {t('operations.statement_import_modal.import')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
