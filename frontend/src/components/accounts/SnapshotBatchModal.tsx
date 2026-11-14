import { FormEvent, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { accountGroupLabel, accountGroupOf, type Account, type DashboardSummary } from '@suzanne/shared';
import { api } from '../../lib/api';
import { lastDayOfPreviousMonthIso, money } from '../../lib/format';
import { parseDecimal } from '../../lib/pea';
import { Modal } from '../Modal';
import type { Run } from '../../lib/run';
import { useTranslation } from 'react-i18next';

const ORDERED_GROUPS = ['cash', 'regulated_savings', 'investments', 'crypto', 'liabilities', 'other'];

// Saisie groupée des soldes réels à une date (relevés de fin de mois).
export function SnapshotBatchModal({ userId, accounts, summary, run, onClose }: {
  userId: number;
  accounts: Account[];
  summary: DashboardSummary | null;
  run: Run;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [date, setDate] = useState(() => lastDayOfPreviousMonthIso());
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [prefilling, setPrefilling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = accounts.filter((a) => !a.archived);
  const estimated = new Map((summary?.account_balances ?? []).map((r) => [r.account_id, r]));
  const reportCurrency = summary?.currency ?? 'EUR';
  const filled = Object.values(inputs).filter((v) => v.trim() !== '').length;

  const prefill = async () => {
    setPrefilling(true);
    try {
      const suggestions = await api.snapshotSuggestions(userId, date);
      setInputs((current) => {
        const next = { ...current };
        for (const s of suggestions) next[s.account_id] = String(s.suggested_balance).replace('.', ',');
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPrefilling(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entries = Object.entries(inputs).filter(([, raw]) => raw.trim() !== '');
    const balances = entries.map(([id, raw]) => ({ account_id: Number(id), balance: parseDecimal(raw) }));
    const invalid = balances.find((b) => !Number.isFinite(b.balance));
    if (invalid) { setError(`Montant invalide pour ${active.find((a) => a.id === invalid.account_id)?.name ?? 'un compte'}.`); return; }
    if (balances.length === 0) return;
    setError(null);
    void run(
      () => api.setSnapshotBatch(userId, { date, balances }),
      (result) => {
        const { created, updated } = result as { created: number; updated: number };
        const parts = [created > 0 ? `${created} créé${created > 1 ? 's' : ''}` : '', updated > 0 ? `${updated} mis à jour` : ''].filter(Boolean);
        return parts.length > 0 ? `Soldes enregistrés : ${parts.join(', ')}` : 'Aucun changement';
      },
    ).then((ok) => { if (ok) onClose(); });
  };

  return (
    <Modal title={t('comptes.snapshot_batch_modal.month_end_balances')} onClose={onClose} wide>
      <form className="acc-batch sheet-ok" onSubmit={submit}>
        <p className="acc-muted">{t('comptes.snapshot_batch_modal.enter_actual_balance_read_on')}</p>
        <div className="acc-batch-top">
          <label>{t('comptes.snapshot_batch_modal.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <button type="button" className="secondary" onClick={() => void prefill()} disabled={prefilling || active.length === 0}>
            <Wand2 size={16} /> {prefilling ? 'Calcul…' : 'Pré-remplir'}
          </button>
        </div>
        {active.length === 0 ? (
          <p className="empty">{t('comptes.snapshot_batch_modal.create_account_first')}</p>
        ) : (
          <div className="acc-batch-list">
            {ORDERED_GROUPS.flatMap((group) => {
              const list = active.filter((a) => accountGroupOf(a) === group).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
              if (list.length === 0) return [];
              return [
                <h3 key={`h-${group}`} className="acc-batch-group">{accountGroupLabel(group)}</h3>,
                ...list.map((a) => {
                  const est = estimated.get(a.id);
                  return (
                    <label key={a.id} className="acc-batch-row">
                      <span className="acc-batch-name">
                        <strong>{a.name}</strong>
                        <small>{t('comptes.snapshot_batch_modal.estimated')} {est ? money(est.signed_balance, reportCurrency) : '—'}</small>
                      </span>
                      <input
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder={a.currency}
                        value={inputs[a.id] ?? ''}
                        onChange={(e) => setInputs((cur) => ({ ...cur, [a.id]: e.target.value }))}
                        aria-label={`Solde réel de ${a.name} en ${a.currency}`}
                      />
                    </label>
                  );
                }),
              ];
            })}
          </div>
        )}
        {error && <p className="acc-error" role="alert">{error}</p>}
        <div className="acc-form-actions">
          <button type="button" className="secondary" onClick={onClose}>{t('comptes.snapshot_batch_modal.cancel')}</button>
          <button className="primary" disabled={filled === 0}>{t('comptes.snapshot_batch_modal.save')}{filled > 0 ? ` (${filled})` : ''}</button>
        </div>
      </form>
    </Modal>
  );
}
