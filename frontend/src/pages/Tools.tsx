import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, CheckSquare, DatabaseBackup, Download, FileJson, FileUp, RotateCcw, Table2, Upload, WalletCards } from 'lucide-react';
import type { Account } from '@suzanne-lite/shared';
import { api } from '../lib/api';
import { numberOrNull } from '../lib/forms';
import { guessColumn, parseCsvPreview } from '../lib/csv';
import { Modal } from '../components/Modal';
import { Panel } from '../components/Panel';

import type { Run } from '../lib/run';

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
] as const;

const PLACEHOLDER_CSV = `dateOp\tdateVal\tlabel\tamount\n2026-05-24\t2026-05-24\tCourses\t-12,50`;
const ALL_EXPORT_KEYS = EXPORT_ENTITIES.map((e) => e.key);
const FINANCE_EXPORT_KEYS = ['transactions', 'accounts', 'categories', 'budgets', 'recurring', 'goals', 'goal_contributions', 'bills', 'snapshots'];
const STRUCTURE_EXPORT_KEYS = ['accounts', 'institutions', 'categories', 'category_rules', 'tags'];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentYearRange() {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: todayIso() };
}

export function Tools({ userId, accounts, run }: { userId: number; accounts: Account[]; run: Run }) {
  const [csv, setCsv] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => parseCsvPreview(csv), [csv]);
  const [mapping, setMapping] = useState({ date: '', amount: '', description: '', type: '' });
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

  const runExport = async (options?: { entities?: string[]; from?: string | null; to?: string | null; closeModal?: boolean }) => {
    const entities = options?.entities ?? Array.from(exportEntities);
    if (entities.length === 0) return;
    setExporting(true);
    try {
      const blob = await api.exportSelection(userId, {
        entities,
        from: options?.from ?? (exportFrom || null),
        to: options?.to ?? (exportTo || null),
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `suzanne-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      if (options?.closeModal ?? true) setExportOpen(false);
    } catch (e) {
      window.alert(`Export échoué: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const runRestore = async () => {
    if (!restorePayload.trim()) return;
    setRestoring(true);
    try {
      const parsed = JSON.parse(restorePayload);
      await run(async () => api.importJson(userId, parsed), (result) => {
        const r = result as Awaited<ReturnType<typeof api.importJson>>;
        return `Import : ${r.accounts.created} comptes, ${r.categories.created} catégories, ${r.transactions.created} transactions, ${r.snapshots.created + r.snapshots.updated} snapshots`;
      });
      setRestoreOpen(false);
      setRestorePayload('');
    } catch (e) {
      window.alert(`Import échoué: ${(e as Error).message}`);
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
    setFileName(null);
    setDragActive(false);
  }, [importOpen]);

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
        date_format: String(data.get('date_format') || 'auto'),
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

  return (
    <section className="tools-page">
      <section className="tools-hero">
        <div>
          <span className="tools-kicker">Maintenance des données</span>
          <h2>Importer, exporter, restaurer</h2>
          <p>Actions rapides pour sauvegarder Suzanne, alimenter les transactions et reprendre un export JSON.</p>
        </div>
        <div className="tools-hero-actions">
          <button className="primary" type="button" onClick={() => void runExport({ entities: ALL_EXPORT_KEYS, from: null, to: null, closeModal: false })} disabled={exporting}>
            <DatabaseBackup size={16} /> Sauvegarde complète
          </button>
          <a className="secondary link-button" href={api.exportCsvUrl(userId)}>
            <Table2 size={16} /> CSV transactions
          </a>
        </div>
      </section>

      <section className="tools-action-grid">
        <button className="tool-card primary-card" type="button" onClick={() => setImportOpen(true)}>
          <span className="tool-card-icon"><FileUp size={20} /></span>
          <strong>Importer des transactions</strong>
          <span>CSV bancaire avec détection des colonnes et aperçu avant validation.</span>
        </button>
        <button className="tool-card" type="button" onClick={() => setExportOpen(true)}>
          <span className="tool-card-icon"><Download size={20} /></span>
          <strong>Exporter sur mesure</strong>
          <span>Choisir les entités et limiter la sauvegarde à une plage de dates.</span>
        </button>
        <button className="tool-card" type="button" onClick={() => setRestoreOpen(true)}>
          <span className="tool-card-icon"><RotateCcw size={20} /></span>
          <strong>Restaurer un JSON</strong>
          <span>Réimporter un export Suzanne en réutilisant les entités existantes.</span>
        </button>
      </section>

      <section className="tools-grid">
        <Panel title="Raccourcis d'export" icon={<DatabaseBackup />}>
          <div className="quick-export-list">
            <button type="button" onClick={() => void runExport({ entities: ALL_EXPORT_KEYS, from: null, to: null, closeModal: false })} disabled={exporting}>
              <DatabaseBackup size={16} />
              <span><strong>Backup complet</strong><small>Tout le modèle, sans filtre de date</small></span>
            </button>
            <button type="button" onClick={() => void runExport({ entities: FINANCE_EXPORT_KEYS, ...currentYearRange(), closeModal: false })} disabled={exporting}>
              <CalendarDays size={16} />
              <span><strong>Année en cours</strong><small>Transactions, budgets, récurrents, objectifs, snapshots</small></span>
            </button>
            <a href={api.exportCsvUrl(userId)}>
              <Table2 size={16} />
              <span><strong>CSV transactions</strong><small>Fichier plat pour tableur ou rapprochement</small></span>
            </a>
          </div>
        </Panel>

        <Panel title="Bonnes pratiques" icon={<WalletCards />}>
          <div className="tools-checklist">
            <div><CheckSquare size={16} /> Faire un backup complet avant un gros import.</div>
            <div><CheckSquare size={16} /> Restaurer un JSON sur un profil vide si tu veux éviter les transactions doublonnées.</div>
            <div><CheckSquare size={16} /> Pour un CSV bancaire, choisir le compte source avant d'importer.</div>
          </div>
        </Panel>
      </section>
      {lastCsvImport && (
        <Panel title="Dernier import CSV" icon={<FileUp />}>
          <div className="import-summary">
            <strong>{lastCsvImport.imported} transactions importées</strong>
            <span>{lastCsvImport.skipped} lignes ignorées, dont {lastCsvImport.duplicates_count} doublons.</span>
            {lastCsvImport.duplicates.length > 0 && (
              <div className="duplicate-list">
                {lastCsvImport.duplicates.slice(0, 12).map((duplicate) => (
                  <div key={`${duplicate.line}-${duplicate.reason}`}>
                    <strong>Ligne {duplicate.line}</strong>
                    <span>{duplicate.date} · {duplicate.amount} · {duplicate.description || 'Sans libellé'} · {duplicate.reason === 'existing' ? 'déjà présente' : 'doublon du fichier'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
      )}
      {importOpen && (
        <Modal title="Importer CSV" onClose={() => setImportOpen(false)} wide>
          <form className="form tools-modal-form" onSubmit={submit}>
            <div className="modal-intro full">
              <FileUp size={18} />
              <span>Importe un relevé bancaire. Les colonnes date et montant sont obligatoires ; les autres peuvent rester ignorées.</span>
            </div>
            <label>Compte<select name="account_id"><option value="">Aucun</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></label>
            <label>Format de date<select name="date_format" defaultValue="auto">
              <option value="auto">Détection auto</option>
              <option value="yyyy-mm-dd">YYYY-MM-DD</option>
              <option value="dd/mm/yyyy">DD/MM/YYYY</option>
              <option value="mm/dd/yyyy">MM/DD/YYYY</option>
              <option value="dd-mm-yyyy">DD-MM-YYYY</option>
              <option value="yyyymmdd">YYYYMMDD</option>
            </select></label>
            <div className="full">
              <div
                className={`csv-drop${dragActive ? ' active' : ''}`}
                onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                <Upload size={20} />
                <span>{fileName ? `${fileName} chargé. Cliquez pour changer.` : 'Glissez un fichier CSV ici, ou cliquez pour parcourir.'}</span>
              </div>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={onFileInput} />
            </div>
            <label className="full">CSV
              <textarea
                value={csv}
                onChange={(e) => { setCsv(e.target.value); setFileName(null); }}
                placeholder={PLACEHOLDER_CSV}
                required
              />
            </label>
            {preview.headers.length > 0 && (
              <>
                <div className="form-section-title">Colonnes à importer</div>
                {columnSelect('date', 'Date', true)}
                {columnSelect('amount', 'Montant', true)}
                {columnSelect('description', 'Libellé')}
                {columnSelect('type', 'Type')}
                <div className="table-wrap full">
                  <table className="tx-table">
                    <thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                    <tbody>{preview.rows.slice(0, 5).map((row, idx) => <tr key={idx}>{preview.headers.map((header) => <td key={header}>{row[header] ?? ''}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              </>
            )}
            <div className="modal-actions full">
              <button className="primary" disabled={!mapping.date || !mapping.amount}>Importer</button>
              <button type="button" className="secondary" onClick={() => setImportOpen(false)}>Annuler</button>
            </div>
          </form>
        </Modal>
      )}

      {exportOpen && (
        <Modal title="Exporter une sauvegarde" onClose={() => setExportOpen(false)}>
          <div className="form tools-modal-form">
            <div className="modal-intro full">
              <FileJson size={18} />
              <span>Le JSON est le format de sauvegarde réimportable. Le CSV transactions sert plutôt à consulter ou traiter dans un tableur.</span>
            </div>
            <div className="preset-row full">
              <button type="button" className="secondary" onClick={() => setExportPreset(ALL_EXPORT_KEYS)}>Tout cocher</button>
              <button type="button" className="secondary" onClick={() => setExportPreset(FINANCE_EXPORT_KEYS)}>Données financières</button>
              <button type="button" className="secondary" onClick={() => setExportPreset(STRUCTURE_EXPORT_KEYS)}>Structure seule</button>
              <button type="button" className="secondary" onClick={() => setExportPreset([])}>Vider</button>
            </div>
            <div className="form-section-title">Données à inclure</div>
            <div className="checkbox-grid">
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
            <div className="form-section-title">Plage de dates (transactions et snapshots)</div>
            <label>Du<input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} /></label>
            <label>Au<input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} /></label>
            <div className="preset-row full">
              <button type="button" className="secondary" onClick={setCurrentYearExportRange}>Année en cours</button>
              <button type="button" className="secondary" onClick={() => { setExportFrom(''); setExportTo(''); }}>Sans filtre</button>
            </div>
            <p className="panel-note">Laisser vide pour exporter sans filtre de date. Les budgets sont filtrés par mois équivalent.</p>
            <div className="modal-actions full">
              <button className="primary" type="button" onClick={() => void runExport()} disabled={exporting || exportEntities.size === 0}>
                <Download size={16} /> {exporting ? 'Export en cours…' : 'Télécharger'}
              </button>
              <button type="button" className="secondary" onClick={() => setExportOpen(false)}>Annuler</button>
            </div>
          </div>
        </Modal>
      )}

      {restoreOpen && (
        <Modal title="Restaurer une sauvegarde" onClose={() => setRestoreOpen(false)}>
          <div className="form tools-modal-form">
            <p className="panel-note">
              Importe un export JSON Suzanne. Les entités existantes (mêmes noms / mêmes clés) sont réutilisées, pas dupliquées.
              Les transactions sont créées même si elles ressemblent à des doublons — restaure sur un compte vide pour éviter les surprises.
            </p>
            <div
              className={`csv-drop${restoreDragActive ? ' active' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setRestoreDragActive(true); }}
              onDragLeave={() => setRestoreDragActive(false)}
              onDrop={(event) => void onRestoreDrop(event)}
              onClick={() => restoreFileRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <Upload size={20} />
              <span>{restoreFileName ? `${restoreFileName} chargé. Cliquez pour changer.` : 'Glisser un fichier JSON ou cliquer pour parcourir.'}</span>
            </div>
            <input ref={restoreFileRef} type="file" accept="application/json,.json" hidden onChange={onRestoreFile} />
            <label className="full">JSON
              <textarea
                value={restorePayload}
                onChange={(e) => setRestorePayload(e.target.value)}
                placeholder='{"version":1,"accounts":[...],...}'
                rows={8}
              />
            </label>
            <div className="modal-actions full">
              <button className="primary" type="button" onClick={runRestore} disabled={restoring || !restorePayload.trim()}>
                <Upload size={16} /> {restoring ? 'Import en cours…' : 'Restaurer'}
              </button>
              <button type="button" className="secondary" onClick={() => setRestoreOpen(false)}>Annuler</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
