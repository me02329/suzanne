import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Account, Transaction } from '@suzanne/shared';
import { money } from '../lib/format';

// Bulle ancrée au point cliqué dans un graphique : liste les transactions
// correspondant à la part/barre cliquée (déjà récupérées par l'appelant) et
// laisse l'utilisateur choisir celle vers laquelle naviguer. Évite d'atterrir
// sur la page Transactions au mauvais mois quand l'agrégat couvre une plage.
export function DrilldownPopover({ x, y, title, loading, transactions, accountById, onPick, onClose }: {
  x: number;
  y: number;
  title: string;
  loading: boolean;
  transactions: Transaction[];
  accountById: Map<number, Account>;
  onPick: (transaction: Transaction) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Ancrage au clic, ramené dans la fenêtre pour ne jamais déborder.
  const width = Math.min(360, window.innerWidth - 24);
  const left = Math.max(12, Math.min(x, window.innerWidth - width - 12));
  const top = Math.max(12, Math.min(y + 10, window.innerHeight - 420));

  return (
    <>
      <button type="button" className="drilldown-backdrop" aria-label="Fermer" onClick={onClose} />
      <div className="drilldown-popover" role="dialog" aria-label={title} style={{ left, top, width }}>
        <div className="drilldown-head">
          <strong title={title}>{title}</strong>
          <button type="button" className="ghost-button" aria-label="Fermer" onClick={onClose}><X size={15} /></button>
        </div>
        {loading && <p className="empty">Chargement…</p>}
        {!loading && transactions.length === 0 && <p className="empty">Aucune transaction trouvée sur cette plage.</p>}
        {!loading && transactions.length > 0 && (
          <>
            <p className="drilldown-hint">{transactions.length} transaction{transactions.length > 1 ? 's' : ''} — clique pour ouvrir au bon mois.</p>
            <div className="drilldown-list">
              {transactions.map((t) => {
                const currency = accountById.get(t.account_id ?? -1)?.currency ?? 'EUR';
                return (
                  <button type="button" className="drilldown-item" key={t.id} onClick={() => onPick(t)}>
                    <span className="drilldown-date">{new Date(t.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
                    <span className="drilldown-label" title={t.description ?? undefined}>{t.description || 'Sans description'}</span>
                    <strong className={t.type === 'income' ? 'income' : 'expense'}>
                      {t.type === 'income' ? '+' : '-'}{money(t.amount, currency)}
                    </strong>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
