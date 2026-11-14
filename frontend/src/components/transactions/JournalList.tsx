import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { Account, Category, Transaction } from '@suzanne/shared';
import { txLabel } from '../../lib/format';
import type { SelectionState } from './useSelection';
import { formatDayHeader, formatTxDay, groupByDay, isReadOnly, txAmountLabel, txTone } from './txUtils';

// Journal mobile : liste compacte groupée par jour. Libellé + catégorie à
// gauche, montant signé à droite ; un tap ouvre l'édition (ou coche la ligne
// en mode sélection).
export function JournalList({ rows, grouped, emptyMessage, categoryById, accountById, highlightId, selection, selecting, onOpen }: {
  rows: Transaction[];
  grouped: boolean;
  emptyMessage: string;
  categoryById: Map<number, Category>;
  accountById: Map<number, Account>;
  highlightId: number | null;
  selection: SelectionState;
  selecting: boolean;
  onOpen: (t: Transaction) => void;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlightId === null) return;
    listRef.current?.querySelector(`[data-tx="${highlightId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightId]);

  if (rows.length === 0) return <p className="empty jr-empty">{emptyMessage}</p>;
  const thisYear = String(new Date().getFullYear());
  const groups = grouped ? groupByDay(rows) : [{ day: '', rows }];

  const item = (tx: Transaction) => {
    const readOnly = isReadOnly(tx);
    const selected = selection.ids.has(tx.id);
    const splitNames = (tx.splits ?? []).map((s) => categoryById.get(s.category_id ?? -1)?.name).filter(Boolean);
    const category = tx.type === 'transfer'
      ? `${accountById.get(tx.account_id ?? -1)?.name ?? '?'} → ${accountById.get(tx.to_account_id ?? -1)?.name ?? '?'}`
      : splitNames.length > 0 ? splitNames.join(' + ') : categoryById.get(tx.category_id ?? -1)?.name ?? null;
    const color = categoryById.get(tx.category_id ?? tx.splits?.[0]?.category_id ?? -1)?.color;
    return (
      <li key={tx.id}>
        <button
          type="button"
          data-tx={tx.id}
          className={['jr-item', selected ? 'selected' : '', tx.id === highlightId ? 'highlight' : '', readOnly ? 'readonly' : ''].filter(Boolean).join(' ')}
          onClick={() => (selecting ? selection.toggle(tx.id, !selected) : onOpen(tx))}
          disabled={readOnly}
          aria-pressed={selecting ? selected : undefined}
        >
          {selecting && <span className={`jr-tick${selected ? ' on' : ''}`} aria-hidden="true">{selected && <Check size={14} />}</span>}
          <span className="jr-item-main">
            <span className="jr-item-label">{txLabel(tx, categoryById)}</span>
            <span className="jr-item-meta">
              {!grouped && <span className="jr-item-day">{formatTxDay(tx.date)}</span>}
              {readOnly && <span className="jr-badge">{t('operations.stock_market')}</span>}
              {category && (
                <span className="jr-chip">
                  {color && <i style={{ background: color }} />}
                  {category}
                </span>
              )}
              {!category && !readOnly && <span>{t('operations.no_category')}</span>}
            </span>
          </span>
          <span className={`jr-num jr-amt ${txTone(tx)}`}>{txAmountLabel(tx, accountById)}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="jr-list" ref={listRef}>
      {groups.map((group) => (
        <section key={group.day || 'all'} className="jr-day">
          {grouped && <h3 className="jr-day-head">{formatDayHeader(group.day, !group.day.startsWith(thisYear))}</h3>}
          <ul>{group.rows.map(item)}</ul>
        </section>
      ))}
    </div>
  );
}
