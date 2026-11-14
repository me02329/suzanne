import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, DatabaseBackup, Download, FileJson, FileUp, Landmark, Loader2, RotateCcw, Table2, Upload, X } from 'lucide-react';
import type { Account, BackupImportSummary, ImportDateFormat, ImportMapping } from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { numberOrNull } from '../lib/forms';
import { todayIso } from '../lib/format';
import { guessColumn, isBoursoOperationsExport, parseCsvPreview } from '../lib/csv';
import { saveBlob, summarizeBackupImport } from '../lib/download';
import { Modal } from '../components/Modal';
import { StatementImportModal } from '../components/StatementImportModal';
import { BackupsPanel } from '../components/BackupsPanel';
import { AuditLogPanel } from '../components/AuditLogPanel';

import type { Run } from '../lib/run';
import '../styles/pages/settings.css';
import { useTranslation } from 'react-i18next';

const EXPORT_ENTITIES = [
  { key: 'transactions', label: 'Transactions' },
  { key: 'accounts', label: 'Comptes' },
  { key: 'institutions', label: 'Institutions' },
  { key: 'categories', label: 'Catégories' },
  { key: 'tags', label: 'Tags' },
  { key: 'category_rules', label: 'Règles d\'auto-catégorisation' },
  { key: 'budgets', label: 'Budgets' },
  { key: 'recurring', label: 'Récurrents' },
  { key: 'goals', label: 'Objectifs' },
  { key: 'goal_contributions', label: 'Versements d\'objectifs' },
  { key: 'bills', label: 'Factures attendues' },
  { key: 'snapshots', label: 'Snapshots de solde' },
  { key: 'holdings', label: 'Positions et ordres de bourse' },
  { key: 'alerts', label: 'Alertes' },
  { key: 'import_mappings', label: "Profils d'import CSV" },
  { key: 'attachments', label: 'Pièces jointes (justificatifs)' },
  { key: 'global_budgets', label: 'Budget du mois' },
  { key: 'sinking_funds', label: 'Provisions' },
] as const;

const PLACEHOLDER_CSV = `dateOp\tdateVal\tlabel\tamount\n2026-05-24\t2026-05-24\tCourses\t-12,50`;
const ALL_EXPORT_KEYS = EXPORT_ENTITIES.map((e) => e.key);
const FINANCE_EXPORT_KEYS = ['transactions', 'accounts', 'categories', 'budgets', 'recurring', 'goals', 'goal_contributions', 'bills', 'snapshots', 'holdings', 'global_budgets', 'sinking_funds'];
const STRUCTURE_EXPORT_KEYS = ['accounts', 'institutions', 'categories', 'category_rules', 'tags', 'import_mappings', 'alerts'];

function currentYearRange() {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: todayIso() };
}

export function Tools({ userId, accounts, run }: { userId: number; accounts: Account[]; run: Run }) {
  const { t } = useTranslation();
  const [csv, setCsv] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => parseCsvPreview(csv), [csv]);
  const [mapping, setMapping] = useState({ date: '', amount: '', description: '', type: '' });
  const [dateFormat, setDateFormat] = useState<ImportDateFormat>('auto');
  const [mappings, setMappings] = useState<ImportMapping[]>([]);
  const [lastCsvImport, setLastCsvImport] = useState<Awaited<ReturnType<typeof api.importCsv>> | null>(null);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportEntities, setExportEntities] = useState<Set<string>>(() => new Set(EXPORT_ENTITIES.map((e) => e.key)));
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exporting, setExporting] = useState(false);

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restorePayload, setRestorePayload] = useState<string>('');
  const [restoring, setRestoring] = useState(false);
  const [restoreFileName, setRestoreFileName] = useState<string | null>(null);
  const [restoreDragActive, setRestoreDragActive] = useState(false);
  const restoreFileRef = useRef<HTMLInputElement>(null);

  const setExportPreset = (keys: string[]) => {
    setExportEntities(new Set(keys));
  };

  const setCurrentYearExportRange = () => {
    const range = currentYearRange();
    setExportFrom(range.from);
    setExportTo(range.to);
  };

  const toggleEntity = (key: string) => {
    setExportEntities((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // `options.from/to` explicitement à null = « sans filtre » : ne pas retomber
  // sur la plage restée saisie dans la modale (un `??` le faisait, et une
  // « sauvegarde complète » pouvait être silencieusement filtrée).
  const runExport = async (options?: { entities?: string[]; from?: string | null; to?: string | null; closeModal?: boolean }) => {
    const entities = options?.entities ?? Array.from(exportEntities);
    if (entities.length === 0) return;
    const from = options && 'from' in options ? options.from ?? null : exportFrom || null;
    const to = options && 'to' in options ? options.to ?? null : exportTo || null;
    setExporting(true);
    try {
      const blob = await api.exportSelection(userId, { entities, from, to });
      const suffix = from || to ? `${from ?? 'debut'}_${to ?? 'fin'}` : todayIso();
      saveBlob(blob, `suzanne-export-${suffix}.json`);
      if (options?.closeModal ?? true) setExportOpen(false);
    } catch (e) {
      window.alert(`Export échoué : ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const runCsvExport = async () => {
    setExporting(true);
    try {
      saveBlob(await api.exportCsv(userId), `suzanne-transactions-${todayIso()}.csv`);
    } catch (e) {
      window.alert(`Export CSV échoué : ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const runRestore = async () => {
    if (!restorePayload.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(restorePayload);
    } catch {
      window.alert("Ce fichier n'est pas un JSON valide.");
      return;
    }
    setRestoring(true);
    try {
      const ok = await run(() => api.importJson(userId, parsed), (result) => summarizeBackupImport(result as BackupImportSummary));
      // La modale ne se ferme qu'en cas de succès : sur erreur, le fichier reste chargé.
      if (ok) {
        setRestoreOpen(false);
        setRestorePayload('');
        setRestoreFileName(null);
      }
    } finally {
      setRestoring(false);
    }
  };

  const onRestoreFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setRestorePayload(await file.text());
    setRestoreFileName(file.name);
  };

  useEffect(() => {
    if (preview.headers.length === 0) return;
    setMapping((current) => ({
      date: current.date || guessColumn(preview.headers, ['dateOp', 'Date Opération', 'dateVal', 'date']),
      amount: current.amount || guessColumn(preview.headers, ['amount', 'montant']) || (isBoursoOperationsExport(preview.headers) ? 'Solde' : ''),
      description: current.description || guessColumn(preview.headers, ['label', 'Libellé', 'suggestedLabel', 'description', 'comment']),
      type: current.type || guessColumn(preview.headers, ['type']),
    }));
  }, [preview.headers.join('|')]);

  // Reset state when the modal closes so reopening offers a fresh slate.
  useEffect(() => {
    if (importOpen) return;
    setCsv('');
    setMapping({ date: '', amount: '', description: '', type: '' });
    setDateFormat('auto');
    setFileName(null);
    setDragActive(false);
  }, [importOpen]);

  // Profils de mapping CSV sauvegardés (par banque), rechargés à l'ouverture.
  useEffect(() => {
    if (!importOpen) return;
    api.importMappings(userId).then(setMappings).catch(() => setMappings([]));
  }, [importOpen, userId]);

  const applyMapping = (m: ImportMapping) => {
    setMapping({ date: m.columns.date, amount: m.columns.amount, description: m.columns.description ?? '', type: m.columns.type ?? '' });
    setDateFormat(m.date_format);
  };
  const saveMapping = () => {
    const name = window.prompt('Nom du profil (ex. nom de la banque) :')?.trim();
    if (!name) return;
    void run(() => api.saveImportMapping(userId, {
      name,
      date_format: dateFormat,
      columns: { date: mapping.date, amount: mapping.amount, description: mapping.description || null, type: mapping.type || null },
    }), 'Profil enregistré').then((ok) => { if (ok) api.importMappings(userId).then(setMappings).catch(() => {}); });
  };
  const removeMapping = (m: ImportMapping) => {
    void run(() => api.deleteImportMapping(userId, m.id), 'Profil supprimé')
      .then((ok) => { if (ok) setMappings((cur) => cur.filter((x) => x.id !== m.id)); });
  };

  const readFile = async (file: File) => {
    const text = await file.text();
    setCsv(text);
    setFileName(file.name);
  };

  const onFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void readFile(file);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void readFile(file);
  };

  const onRestoreDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setRestoreDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    setRestorePayload(await file.text());
    setRestoreFileName(file.name);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(async () => {
      const result = await api.importCsv(userId, {
        csv,
        account_id: numberOrNull(data.get('account_id')),
        date_format: dateFormat,
        mapping: {
          date: mapping.date,
          amount: mapping.amount,
          description: mapping.description || null,
          type: mapping.type || null,
        },
      });
      setLastCsvImport(result);
      return result;
    }, (result) => {
      const r = result as Awaited<ReturnType<typeof api.importCsv>>;
      return `CSV : ${r.imported} importées, ${r.duplicates_count} doublons ignorés`;
    }).then((ok) => {
      if (ok) setImportOpen(false);
    });
  };

  const columnSelect = (key: keyof typeof mapping, label: string, required = false) => (
    <label>{label}<select value={mapping[key]} onChange={(e) => setMapping((current) => ({ ...current, [key]: e.target.value }))} required={required}>
      <option value="">{t('reglages.tools.skip')}</option>
      {preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
    </select></label>
  );

  const fullBackup = () => void runExport({ entities: ALL_EXPORT_KEYS, from: null, to: null, closeModal: false });

  return (
    <section className="st-page tools-page">
      <div className="st-tools-grid">
        <section className="panel st-actions" aria-labelledby="tools-import-title">
          <h2 id="tools-import-title" className="st-list-title">{t('reglages.tools.import')}</h2>
          <button className="st-action" type="button" onClick={() => setImportOpen(true)}>
            <span className="st-action-icon"><FileUp size={18} /></span>
            <span className="st-action-text"><strong>{t('reglages.tools.your_bank_s_csv_file')}</strong><small>{t('reglages.tools.detected_columns_preview_before_confirmi')}</small></span>
            <ChevronRight size={16} className="st-action-chevron" aria-hidden="true" />
          </button>
          <button className="st-action" type="button" onClick={() => setStatementOpen(true)}>
            <span className="st-action-icon"><Landmark size={18} /></span>
            <span className="st-action-text"><strong>{t('reglages.tools.ofx_qif_statement')}</strong><small>{t('reglages.tools.duplicates_skipped_rules_applied')}</small></span>
            <ChevronRight size={16} className="st-action-chevron" aria-hidden="true" />
          </button>
          <button className="st-action" type="button" onClick={() => setRestoreOpen(true)}>
            <span className="st-action-icon"><RotateCcw size={18} /></span>
            <span className="st-action-text"><strong>{t('reglages.tools.restore_json_export')}</strong><small>{t('reglages.tools.nothing_is_overwritten_or_duplicated')}</small></span>
            <ChevronRight size={16} className="st-action-chevron" aria-hidden="true" />
          </button>
        </section>

        <section className="panel st-actions" aria-labelledby="tools-export-title">
          <h2 id="tools-export-title" className="st-list-title">{t('reglages.tools.export')}</h2>
          <button className="st-action" type="button" onClick={fullBackup} disabled={exporting}>
            <span className="st-action-icon"><DatabaseBackup size={18} /></span>
            <span className="st-action-text"><strong>{t('reglages.tools.full_backup')}</strong><small>{t('reglages.tools.everything_as_re_importable_json')}</small></span>
            {exporting ? <Loader2 size={16} className="spin-icon st-action-chevron" aria-hidden="true" /> : <Download size={16} className="st-action-chevron" aria-hidden="true" />}
          </button>
          <button className="st-action" type="button" onClick={() => setExportOpen(true)}>
            <span className="st-action-icon"><FileJson size={18} /></span>
            <span className="st-action-text"><strong>{t('reglages.tools.custom_export')}</strong><small>{t('reglages.tools.choose_data_and_period')}</small></span>
            <ChevronRight size={16} className="st-action-chevron" aria-hidden="true" />
          </button>
          <button className="st-action" type="button" onClick={() => void runCsvExport()} disabled={exporting}>
            <span className="st-action-icon"><Table2 size={18} /></span>
            <span className="st-action-text"><strong>{t('reglages.tools.transactions_as_csv')}</strong><small>{t('reglages.tools.for_spreadsheet_separator')}</small></span>
            <Download size={16} className="st-action-chevron" aria-hidden="true" />
          </button>
        </section>
      </div>

      {lastCsvImport && (
        <section className="panel st-import-result" aria-live="polite">
          <div className="st-import-head">
            <h2 className="st-list-title">{t('reglages.tools.last_csv_import')}</h2>
            <button type="button" className="icon-button neutral" aria-label={t('reglages.tools.hide')} onClick={() => setLastCsvImport(null)}><X size={16} /></button>
          </div>
          <p className="st-import-figures">
            <strong>{lastCsvImport.imported}</strong>  {t('reglages.tools.imported')}{lastCsvImport.imported > 1 ? 's' : ''}
            <span> · {lastCsvImport.skipped}  {t('reglages.tools.skipped')}{lastCsvImport.skipped > 1 ? 's' : ''}{t('reglages.tools.incl')} {lastCsvImport.duplicates_count}  {t('reglages.tools.duplicate')}{lastCsvImport.duplicates_count > 1 ? 's' : ''}</span>
          </p>
          {(lastCsvImport.before_reference ?? 0) > 0 && (
            <p className="panel-note">
              {lastCsvImport.before_reference}  {t('reglages.tools.transaction_s_older_than_account')}{lastCsvImport.reference_date}{t('reglages.tools.they_complete_history_without_changing')}
            </p>
          )}
          {lastCsvImport.duplicates.length > 0 && (
            <ul className="st-dupes">
              {lastCsvImport.duplicates.slice(0, 12).map((duplicate) => (
                <li key={`${duplicate.line}-${duplicate.reason}`}>
                  <strong>{t('reglages.tools.line')} {duplicate.line}</strong>
                  <span>{duplicate.date} · <span className="amount-cell">{duplicate.amount}</span> · {duplicate.description || 'Sans libellé'} · {duplicate.reason === 'existing' ? 'déjà présente' : 'doublon du fichier'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="st-tools-grid st-tools-data">
        <BackupsPanel userId={userId} run={run} />
        <AuditLogPanel userId={userId} />
      </div>

      {statementOpen && (
        <StatementImportModal userId={userId} accounts={accounts} run={run} onClose={() => setStatementOpen(false)} />
      )}

      {importOpen && (
        <Modal title={t('reglages.tools.import_csv')} onClose={() => setImportOpen(false)} wide>
          <form className="form tools-modal-form" onSubmit={submit}>
            <div className="full">
              <div
                className={`csv-drop${dragActive ? ' active' : ''}${fileName ? ' loaded' : ''}`}
                onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInputRef.current?.click(); } }}
                role="button"
                tabIndex={0}
              >
                <Upload size={20} />
                <span>{fileName ? <><strong>{fileName}</strong>  {t('reglages.tools.key_to_change')}</> : 'Dépose le fichier CSV ici, ou touche pour parcourir'}</span>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={onFileInput} />
            </div>
            <label>{t('reglages.tools.account')}<select name="account_id"><option value="">{t('reglages.tools.none')}</option>{pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></label>
            <label>{t('reglages.tools.date_format')}<select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as ImportDateFormat)}>
              <option value="auto">{t('reglages.tools.auto_detect')}</option>
              <option value="yyyy-mm-dd">{t('reglages.tools.yyyy_mm_dd')}</option>
              <option value="dd/mm/yyyy">{t('reglages.tools.dd_mm_yyyy')}</option>
              <option value="mm/dd/yyyy">{t('reglages.tools.mm_dd_yyyy')}</option>
              <option value="dd-mm-yyyy">{t('reglages.tools.dd_mm_yyyy_2')}</option>
              <option value="yyyymmdd">{t('reglages.tools.yyyymmdd')}</option>
            </select></label>
            {mappings.length > 0 && (
              <label className="full">{t('reglages.tools.bank_profile')}
                <select defaultValue="" onChange={(e) => { const m = mappings.find((x) => String(x.id) === e.target.value); if (m) applyMapping(m); }}>
                  <option value="">{t('reglages.tools.choose_profile')}</option>
                  {mappings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
            )}
            <details className="full st-paste">
              <summary>{t('reglages.tools.or_paste_csv_content')}</summary>
              <textarea
                aria-label={t('reglages.tools.csv_content')}
                value={csv}
                onChange={(e) => { setCsv(e.target.value); setFileName(null); }}
                placeholder={PLACEHOLDER_CSV}
                rows={6}
              />
            </details>
            {preview.headers.length > 0 && (
              <>
                <div className="form-section-title">{t('reglages.tools.columns_to_import')}</div>
                {columnSelect('date', 'Date', true)}
                {columnSelect('amount', 'Montant', true)}
                {columnSelect('description', 'Libellé')}
                {columnSelect('type', 'Type')}
                <div className="full st-mapping">
                  <button type="button" className="secondary" disabled={!mapping.date || !mapping.amount} onClick={saveMapping}>
                    <DatabaseBackup size={16} />  {t('reglages.tools.save_as_profile')}
                  </button>
                  {mappings.map((m) => (
                    <span key={m.id} className="st-chip">
                      {m.name}
                      <button type="button" aria-label={`Supprimer le profil ${m.name}`} title={t('reglages.tools.delete_this_profile')} onClick={() => removeMapping(m)}><X size={12} /></button>
                    </span>
                  ))}
                </div>
                <div className="table-wrap table-nocards full st-preview-table">
                  <table className="tx-table">
                    <thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                    <tbody>{preview.rows.slice(0, 5).map((row, idx) => <tr key={idx}>{preview.headers.map((header) => <td key={header}>{row[header] ?? ''}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </>
            )}
            <div className="modal-actions full">
              <button type="button" className="secondary" onClick={() => setImportOpen(false)}>{t('reglages.tools.cancel')}</button>
              <button className="primary" disabled={!csv.trim() || !mapping.date || !mapping.amount}>{t('reglages.tools.import')}</button>
            </div>
          </form>
        </Modal>
      )}

      {exportOpen && (
        <Modal title={t('reglages.tools.custom_export')} onClose={() => setExportOpen(false)}>
          <div className="form tools-modal-form">
            <div className="form-section-title">{t('reglages.tools.data')}{exportEntities.size}/{EXPORT_ENTITIES.length})</div>
            <div className="preset-row full">
              <button type="button" className="secondary" onClick={() => setExportPreset(ALL_EXPORT_KEYS)}>{t('reglages.tools.all')}</button>
              <button type="button" className="secondary" onClick={() => setExportPreset(FINANCE_EXPORT_KEYS)}>{t('reglages.tools.finances')}</button>
              <button type="button" className="secondary" onClick={() => setExportPreset(STRUCTURE_EXPORT_KEYS)}>{t('reglages.tools.structure')}</button>
              <button type="button" className="secondary" onClick={() => setExportPreset([])}>{t('reglages.tools.none_2')}</button>
            </div>
            <div className="checkbox-grid full">
              {EXPORT_ENTITIES.map((entity) => (
                <label key={entity.key} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={exportEntities.has(entity.key)}
                    onChange={() => toggleEntity(entity.key)}
                  />
                  {entity.label}
                </label>
              ))}
            </div>
            <div className="form-section-title">{t('reglages.tools.period_transactions_and_balances')}</div>
            <label>{t('reglages.tools.from')}<input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} /></label>
            <label>{t('reglages.tools.to')}<input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} /></label>
            <div className="preset-row full">
              <button type="button" className="secondary" onClick={setCurrentYearExportRange}>{t('reglages.tools.current_year')}</button>
              <button type="button" className="secondary" onClick={() => { setExportFrom(''); setExportTo(''); }}>{t('reglages.tools.all_dates')}</button>
            </div>
            <div className="modal-actions full">
              <button type="button" className="secondary" onClick={() => setExportOpen(false)}>{t('reglages.tools.cancel')}</button>
              <button className="primary" type="button" onClick={() => void runExport()} disabled={exporting || exportEntities.size === 0}>
                <Download size={16} /> {exporting ? 'Export…' : 'Télécharger'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {restoreOpen && (
        <Modal title={t('reglages.tools.restore_backup')} onClose={() => setRestoreOpen(false)}>
          <div className="form tools-modal-form">
            <p className="panel-note full">
              
              {t('reglages.tools.nothing_is_overwritten_what_already')}
            </p>
            <div
              className={`csv-drop full${restoreDragActive ? ' active' : ''}${restoreFileName ? ' loaded' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setRestoreDragActive(true); }}
              onDragLeave={() => setRestoreDragActive(false)}
              onDrop={(event) => void onRestoreDrop(event)}
              onClick={() => restoreFileRef.current?.click()}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); restoreFileRef.current?.click(); } }}
              role="button"
              tabIndex={0}
            >
              <Upload size={20} />
              <span>{restoreFileName ? <><strong>{restoreFileName}</strong>  {t('reglages.tools.key_to_change')}</> : 'Dépose le fichier JSON ici, ou touche pour parcourir'}</span>
            </div>
            <input ref={restoreFileRef} type="file" accept="application/json,.json" hidden onChange={onRestoreFile} />
            <details className="full st-paste">
              <summary>{t('reglages.tools.or_paste_json')}</summary>
              <textarea
                aria-label={t('reglages.tools.json_content')}
                value={restorePayload}
                onChange={(e) => { setRestorePayload(e.target.value); setRestoreFileName(null); }}
                placeholder='{"version":1,"accounts":[...],...}' /* i18n-ignore */
                rows={6}
              />
            </details>
            <div className="modal-actions full">
              <button type="button" className="secondary" onClick={() => setRestoreOpen(false)}>{t('reglages.tools.cancel')}</button>
              <button className="primary" type="button" onClick={() => void runRestore()} disabled={restoring || !restorePayload.trim()}>
                <Upload size={16} /> {restoring ? 'Import…' : 'Restaurer'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
