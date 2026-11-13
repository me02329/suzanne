import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, DatabaseBackup, Download, FileJson, FileUp, Landmark, Loader2, RotateCcw, Table2, Upload, X } from 'lucide-react';
import type { Account, BackupImportSummary, ImportDateFormat, ImportMapping } from '@suzanne/shared';
import { api } from '../lib/api';
import { pickableAccounts } from '../lib/account';
import { numberOrNull } from '../lib/forms';
import { todayIso } from '../lib/format';
import { guessColumn, parseCsvPreview } from '../lib/csv';
import { saveBlob, summarizeBackupImport } from '../lib/download';
import { Modal } from '../components/Modal';
import { StatementImportModal } from '../components/StatementImportModal';
import { BackupsPanel } from '../components/BackupsPanel';
import { AuditLogPanel } from '../components/AuditLogPanel';

import type { Run } from '../lib/run';
import '../styles/pages/settings.css';

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
      date: current.date || guessColumn(preview.headers, ['dateOp', 'dateVal', 'date']),
      amount: current.amount || guessColumn(preview.headers, ['amount', 'montant']),
      description: current.description || guessColumn(preview.headers, ['label', 'suggestedLabel', 'description', 'comment']),
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
      <option value="">Ignorer</option>
      {preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
    </select></label>
  );

  const fullBackup = () => void runExport({ entities: ALL_EXPORT_KEYS, from: null, to: null, closeModal: false });

  return (
    <section className="st-page tools-page">
      <div className="st-tools-grid">
        <section className="panel st-actions" aria-labelledby="tools-import-title">
          <h2 id="tools-import-title" className="st-list-title">Importer</h2>
          <button className="st-action" type="button" onClick={() => setImportOpen(true)}>
            <span className="st-action-icon"><FileUp size={18} /></span>
            <span className="st-action-text"><strong>Fichier CSV de ta banque</strong><small>Colonnes détectées, aperçu avant validation</small></span>
            <ChevronRight size={16} className="st-action-chevron" aria-hidden="true" />
          </button>
          <button className="st-action" type="button" onClick={() => setStatementOpen(true)}>
            <span className="st-action-icon"><Landmark size={18} /></span>
            <span className="st-action-text"><strong>Relevé OFX / QIF</strong><small>Doublons ignorés, règles appliquées</small></span>
            <ChevronRight size={16} className="st-action-chevron" aria-hidden="true" />
          </button>
          <button className="st-action" type="button" onClick={() => setRestoreOpen(true)}>
            <span className="st-action-icon"><RotateCcw size={18} /></span>
            <span className="st-action-text"><strong>Restaurer un export JSON</strong><small>Rien n’est écrasé ni dupliqué</small></span>
            <ChevronRight size={16} className="st-action-chevron" aria-hidden="true" />
          </button>
        </section>

        <section className="panel st-actions" aria-labelledby="tools-export-title">
          <h2 id="tools-export-title" className="st-list-title">Exporter</h2>
          <button className="st-action" type="button" onClick={fullBackup} disabled={exporting}>
            <span className="st-action-icon"><DatabaseBackup size={18} /></span>
            <span className="st-action-text"><strong>Sauvegarde complète</strong><small>Tout, en JSON réimportable</small></span>
            {exporting ? <Loader2 size={16} className="spin-icon st-action-chevron" aria-hidden="true" /> : <Download size={16} className="st-action-chevron" aria-hidden="true" />}
          </button>
          <button className="st-action" type="button" onClick={() => setExportOpen(true)}>
            <span className="st-action-icon"><FileJson size={18} /></span>
            <span className="st-action-text"><strong>Export sur mesure</strong><small>Choisir les données et la période</small></span>
            <ChevronRight size={16} className="st-action-chevron" aria-hidden="true" />
          </button>
          <button className="st-action" type="button" onClick={() => void runCsvExport()} disabled={exporting}>
            <span className="st-action-icon"><Table2 size={18} /></span>
            <span className="st-action-text"><strong>Opérations en CSV</strong><small>Pour un tableur (séparateur ;)</small></span>
            <Download size={16} className="st-action-chevron" aria-hidden="true" />
          </button>
        </section>
      </div>

      {lastCsvImport && (
        <section className="panel st-import-result" aria-live="polite">
          <div className="st-import-head">
            <h2 className="st-list-title">Dernier import CSV</h2>
            <button type="button" className="icon-button neutral" aria-label="Masquer" onClick={() => setLastCsvImport(null)}><X size={16} /></button>
          </div>
          <p className="st-import-figures">
            <strong>{lastCsvImport.imported}</strong> importée{lastCsvImport.imported > 1 ? 's' : ''}
            <span> · {lastCsvImport.skipped} ignorée{lastCsvImport.skipped > 1 ? 's' : ''}, dont {lastCsvImport.duplicates_count} doublon{lastCsvImport.duplicates_count > 1 ? 's' : ''}</span>
          </p>
          {(lastCsvImport.before_reference ?? 0) > 0 && (
            <p className="panel-note">
              {lastCsvImport.before_reference} opération(s) antérieure(s) au solde de référence du compte ({lastCsvImport.reference_date}) :
              elles complètent l’historique sans modifier le solde actuel.
            </p>
          )}
          {lastCsvImport.duplicates.length > 0 && (
            <ul className="st-dupes">
              {lastCsvImport.duplicates.slice(0, 12).map((duplicate) => (
                <li key={`${duplicate.line}-${duplicate.reason}`}>
                  <strong>Ligne {duplicate.line}</strong>
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
        <Modal title="Importer un CSV" onClose={() => setImportOpen(false)} wide>
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
                <span>{fileName ? <><strong>{fileName}</strong> · touche pour changer</> : 'Dépose le fichier CSV ici, ou touche pour parcourir'}</span>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={onFileInput} />
            </div>
            <label>Compte<select name="account_id"><option value="">Aucun</option>{pickableAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></label>
            <label>Format de date<select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as ImportDateFormat)}>
              <option value="auto">Détection auto</option>
              <option value="yyyy-mm-dd">AAAA-MM-JJ</option>
              <option value="dd/mm/yyyy">JJ/MM/AAAA</option>
              <option value="mm/dd/yyyy">MM/JJ/AAAA</option>
              <option value="dd-mm-yyyy">JJ-MM-AAAA</option>
              <option value="yyyymmdd">AAAAMMJJ</option>
            </select></label>
            {mappings.length > 0 && (
              <label className="full">Profil de banque
                <select defaultValue="" onChange={(e) => { const m = mappings.find((x) => String(x.id) === e.target.value); if (m) applyMapping(m); }}>
                  <option value="">Choisir un profil…</option>
                  {mappings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
            )}
            <details className="full st-paste">
              <summary>Ou coller le contenu du CSV</summary>
              <textarea
                aria-label="Contenu CSV"
                value={csv}
                onChange={(e) => { setCsv(e.target.value); setFileName(null); }}
                placeholder={PLACEHOLDER_CSV}
                rows={6}
              />
            </details>
            {preview.headers.length > 0 && (
              <>
                <div className="form-section-title">Colonnes à importer</div>
                {columnSelect('date', 'Date', true)}
                {columnSelect('amount', 'Montant', true)}
                {columnSelect('description', 'Libellé')}
                {columnSelect('type', 'Type')}
                <div className="full st-mapping">
                  <button type="button" className="secondary" disabled={!mapping.date || !mapping.amount} onClick={saveMapping}>
                    <DatabaseBackup size={16} /> Enregistrer comme profil
                  </button>
                  {mappings.map((m) => (
                    <span key={m.id} className="st-chip">
                      {m.name}
                      <button type="button" aria-label={`Supprimer le profil ${m.name}`} title="Supprimer ce profil" onClick={() => removeMapping(m)}><X size={12} /></button>
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
              <button type="button" className="secondary" onClick={() => setImportOpen(false)}>Annuler</button>
              <button className="primary" disabled={!csv.trim() || !mapping.date || !mapping.amount}>Importer</button>
            </div>
          </form>
        </Modal>
      )}

      {exportOpen && (
        <Modal title="Export sur mesure" onClose={() => setExportOpen(false)}>
          <div className="form tools-modal-form">
            <div className="form-section-title">Données ({exportEntities.size}/{EXPORT_ENTITIES.length})</div>
            <div className="preset-row full">
              <button type="button" className="secondary" onClick={() => setExportPreset(ALL_EXPORT_KEYS)}>Tout</button>
              <button type="button" className="secondary" onClick={() => setExportPreset(FINANCE_EXPORT_KEYS)}>Finances</button>
              <button type="button" className="secondary" onClick={() => setExportPreset(STRUCTURE_EXPORT_KEYS)}>Structure</button>
              <button type="button" className="secondary" onClick={() => setExportPreset([])}>Aucune</button>
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
            <div className="form-section-title">Période (opérations et soldes)</div>
            <label>Du<input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} /></label>
            <label>Au<input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} /></label>
            <div className="preset-row full">
              <button type="button" className="secondary" onClick={setCurrentYearExportRange}>Année en cours</button>
              <button type="button" className="secondary" onClick={() => { setExportFrom(''); setExportTo(''); }}>Toutes les dates</button>
            </div>
            <div className="modal-actions full">
              <button type="button" className="secondary" onClick={() => setExportOpen(false)}>Annuler</button>
              <button className="primary" type="button" onClick={() => void runExport()} disabled={exporting || exportEntities.size === 0}>
                <Download size={16} /> {exporting ? 'Export…' : 'Télécharger'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {restoreOpen && (
        <Modal title="Restaurer une sauvegarde" onClose={() => setRestoreOpen(false)}>
          <div className="form tools-modal-form">
            <p className="panel-note full">
              Rien n’est écrasé : ce qui existe déjà (mêmes noms, ou même opération — compte, date, montant, libellé) est reconnu
              et pas dupliqué. Tout ou rien : en cas d’erreur, rien n’est écrit.
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
              <span>{restoreFileName ? <><strong>{restoreFileName}</strong> · touche pour changer</> : 'Dépose le fichier JSON ici, ou touche pour parcourir'}</span>
            </div>
            <input ref={restoreFileRef} type="file" accept="application/json,.json" hidden onChange={onRestoreFile} />
            <details className="full st-paste">
              <summary>Ou coller le JSON</summary>
              <textarea
                aria-label="Contenu JSON"
                value={restorePayload}
                onChange={(e) => { setRestorePayload(e.target.value); setRestoreFileName(null); }}
                placeholder='{"version":1,"accounts":[...],...}'
                rows={6}
              />
            </details>
            <div className="modal-actions full">
              <button type="button" className="secondary" onClick={() => setRestoreOpen(false)}>Annuler</button>
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
