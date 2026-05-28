import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
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
  { key: 'category_rules', label: 'Règles d\'auto-catégorisation' },
  { key: 'budgets', label: 'Budgets' },
  { key: 'recurring', label: 'Récurrents' },
  { key: 'goals', label: 'Objectifs' },
  { key: 'snapshots', label: 'Snapshots de solde' },
] as const;

const PLACEHOLDER_CSV = `dateOp\tdateVal\tlabel\tamount\n2026-05-24\t2026-05-24\tCourses\t-12,50`;

export function Tools({ userId, accounts, run }: { userId: number; accounts: Account[]; run: Run }) {
  const [csv, setCsv] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => parseCsvPreview(csv), [csv]);
  const [mapping, setMapping] = useState({ date: '', amount: '', description: '', type: '' });

  const [exportOpen, setExportOpen] = useState(false);
  const [exportEntities, setExportEntities] = useState<Set<string>>(() => new Set(EXPORT_ENTITIES.map((e) => e.key)));
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exporting, setExporting] = useState(false);

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restorePayload, setRestorePayload] = useState<string>('');
  const [restoring, setRestoring] = useState(false);
  const restoreFileRef = useRef<HTMLInputElement>(null);

  const toggleEntity = (key: string) => {
    setExportEntities((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const blob = await api.exportSelection(userId, {
        entities: Array.from(exportEntities),
        from: exportFrom || null,
        to: exportTo || null,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `suzanne-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(() => api.importCsv(userId, {
      csv,
      account_id: numberOrNull(data.get('account_id')),
      date_format: String(data.get('date_format') || 'auto'),
      mapping: {
        date: mapping.date,
        amount: mapping.amount,
        description: mapping.description || null,
        type: mapping.type || null,
      },
    }), 'CSV importé');
    setImportOpen(false);
  };

  const columnSelect = (key: keyof typeof mapping, label: string, required = false) => (
    <label>{label}<select value={mapping[key]} onChange={(e) => setMapping((current) => ({ ...current, [key]: e.target.value }))} required={required}>
      <option value="">Ignorer</option>
      {preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
    </select></label>
  );

  return (
    <section className="split">
      <Panel title="Importer CSV">
        <p className="panel-note">Colle un CSV, glisse-dépose un fichier ou utilise le sélecteur dans la modale d'import.</p>
        <div className="export-actions">
          <button className="primary" type="button" onClick={() => setImportOpen(true)}>
            <Upload size={16} /> Importer CSV
          </button>
        </div>
      </Panel>
      <Panel title="Sauvegarde">
        <p className="panel-note">Exporte ou restaure tes données. Le JSON est réimportable : à chaque entité importée, les doublons sont détectés par nom/clé naturelle.</p>
        <div className="export-actions">
          <button className="primary" type="button" onClick={() => setExportOpen(true)}>
            <Download size={16} /> Exporter
          </button>
          <button className="secondary" type="button" onClick={() => setRestoreOpen(true)}>
            <Upload size={16} /> Restaurer
          </button>
          <a className="secondary link-button" href={api.exportCsvUrl(userId)}>CSV transactions</a>
        </div>
      </Panel>
      {importOpen && (
        <Modal title="Importer CSV" onClose={() => setImportOpen(false)} wide>
          <form className="form" onSubmit={submit}>
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
            <button className="primary" disabled={!mapping.date || !mapping.amount}>Importer</button>
            <button type="button" className="secondary" onClick={() => setImportOpen(false)}>Annuler</button>
          </form>
        </Modal>
      )}

      {exportOpen && (
        <Modal title="Exporter une sauvegarde" onClose={() => setExportOpen(false)}>
          <div className="form">
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
            <p className="panel-note">Laisser vide pour exporter sans filtre de date. Les budgets sont filtrés par mois équivalent.</p>
            <button className="primary" type="button" onClick={runExport} disabled={exporting || exportEntities.size === 0}>
              <Download size={16} /> {exporting ? 'Export en cours…' : 'Télécharger'}
            </button>
            <button type="button" className="secondary" onClick={() => setExportOpen(false)}>Annuler</button>
          </div>
        </Modal>
      )}

      {restoreOpen && (
        <Modal title="Restaurer une sauvegarde" onClose={() => setRestoreOpen(false)}>
          <div className="form">
            <p className="panel-note">
              Importe un export JSON Suzanne. Les entités existantes (mêmes noms / mêmes clés) sont réutilisées, pas dupliquées.
              Les transactions sont créées même si elles ressemblent à des doublons — restaure sur un compte vide pour éviter les surprises.
            </p>
            <div
              className="csv-drop"
              onClick={() => restoreFileRef.current?.click()}
              role="button"
              tabIndex={0}
            >
              <Upload size={20} />
              <span>Glisser un fichier JSON ou cliquer pour parcourir.</span>
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
            <button className="primary" type="button" onClick={runRestore} disabled={restoring || !restorePayload.trim()}>
              <Upload size={16} /> {restoring ? 'Import en cours…' : 'Restaurer'}
            </button>
            <button type="button" className="secondary" onClick={() => setRestoreOpen(false)}>Annuler</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
