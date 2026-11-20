import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import type { Account, Category, Transaction } from '@suzanne/shared';
import { money, txLabel } from '../../lib/format';
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
  // Jours repliés (un tap sur l'en-tête du jour) : on ne garde ouverts que ceux
  // qu'on veut voir.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggleDay = (day: string) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(day)) next.delete(day); else next.add(day);
    return next;
  });
  useEffect(() => {
    if (highlightId === null) return;
    // Opération ciblée dans un jour replié : on déplie ce jour d'abord.
    const day = rows.find((tx) => tx.id === highlightId)?.date.slice(0, 10);
    if (day) setCollapsed((prev) => { if (!prev.has(day)) return prev; const next = new Set(prev); next.delete(day); return next; });
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-tx="${highlightId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }, [highlightId]); // eslint-disable-line react-hooks/exhaustive-deps

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
              {tx.type !== 'transfer' && accountById.get(tx.account_id ?? -1)?.professional && <span className="jr-badge jr-badge-pro">{t('operations.pro_badge')}</span>}
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
      {groups.map((group) => {
        const isCollapsed = grouped && collapsed.has(group.day);
        return (
          <section key={group.day || 'all'} className={isCollapsed ? 'jr-day collapsed' : 'jr-day'}>
            {grouped && (() => {
              // Solde du jour : revenus − dépenses (transferts et comptes pro exclus,
              // comme le résumé du journal).
              const net = group.rows.reduce((sum, tx) => {
                if (accountById.get(tx.account_id ?? -1)?.professional) return sum;
                return tx.type === 'income' ? sum + tx.amount : tx.type === 'expense' ? sum - tx.amount : sum;
              }, 0);
              const hasFlows = group.rows.some((tx) => tx.type !== 'transfer');
              return (
                <h3 className="jr-day-head">
                  <button type="button" className="jr-day-toggle" aria-expanded={!isCollapsed} onClick={() => toggleDay(group.day)}>
                    <ChevronDown size={16} className="jr-day-chevron" aria-hidden />
                    <span className="jr-day-label">{formatDayHeader(group.day, !group.day.startsWith(thisYear))}</span>
                    {isCollapsed && <span className="jr-day-count">{t('operations.day_count', { count: group.rows.length })}</span>}
                    {hasFlows && (
                      <span className={`jr-num jr-day-total ${net >= 0 ? 'income' : 'expense'}`} title={t('operations.day_balance')}>
                        {net >= 0 ? '+' : '−'}{money(Math.abs(net))}
                      </span>
                    )}
                  </button>
                </h3>
              );
            })()}
            {!isCollapsed && <ul>{group.rows.map(item)}</ul>}
          </section>
        );
      })}
    </div>
  );
}
