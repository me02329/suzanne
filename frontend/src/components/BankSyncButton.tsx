import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { api, type BankConnection } from '../lib/api';
import type { Run } from '../lib/run';

// Bouton « synchroniser la banque » du bandeau (section Opérations) : évite de
// passer par Réglages › Banque. Synchronise toutes les connexions utilisables
// (consentement valide, au moins un compte relié). Invisible si la synchro
// bancaire n'est pas configurée ou qu'aucune connexion n'est utilisable.
export function BankSyncButton({ userId, run }: { userId: number; run: Run }) {
  const { t } = useTranslation();
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const status = await api.bank(userId);
      setConnections(status.configured ? status.connections : []);
    } catch {
      setConnections([]); // pas de bouton plutôt qu'une erreur dans le bandeau
    }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);

  const usable = connections.filter((c) => !c.expired && c.status !== 'expired' && c.status !== 'revoked' && c.links.some((l) => l.account_id != null));
  if (usable.length === 0) return null;

  const lastSync = usable.map((c) => c.last_sync_at).filter((d): d is string => d != null).sort().pop();
  const title = lastSync
    ? `${t('reglages.bank.sync_now')} — ${t('reglages.bank.last_sync', { date: new Date(lastSync).toLocaleString() })}`
    : t('reglages.bank.sync_now');

  const sync = async () => {
    setSyncing(true);
    await run(async () => {
      let imported = 0;
      let adopted = 0;
      for (const c of usable) {
        const { results } = await api.syncBankConnection(userId, c.id);
        imported += results.reduce((s, r) => s + r.imported, 0);
        adopted += results.reduce((s, r) => s + r.adopted, 0);
      }
      return { imported, adopted };
    }, (result) => t('reglages.bank.synced', result as { imported: number; adopted: number }));
    setSyncing(false);
    void load();
  };

  return (
    <button
      type="button"
      className="icon-ghost topbar-bank-sync"
      onClick={() => void sync()}
      disabled={syncing}
      aria-label={t('reglages.bank.sync_now')}
      title={title}
    >
      <RefreshCw size={18} className={syncing ? 'spin-icon' : undefined} />
    </button>
  );
}
