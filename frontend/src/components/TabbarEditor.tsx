import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, GripVertical, MoreHorizontal, Plus, RotateCcw, X } from 'lucide-react';
import { navSections } from '../lib/nav';
import { addButtonIndex, setTabbar, TABBAR_DEFAULT, TABBAR_MAX, TABBAR_MIN, useTabbar } from '../lib/tabbar';

// Réglages › Préférences : composer la barre du bas (téléphone). Aperçu en
// direct, pages glissées du doigt (poignée) ou déplacées avec ↑↓, ajoutées ou
// retirées. Chaque changement s'applique tout de suite à la vraie barre.
export function TabbarEditor() {
  const { t } = useTranslation();
  const ids = useTabbar();
  const listRef = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ id: string; offset: number } | null>(null);
  const dragState = useRef<{ startY: number; rowHeight: number; order: string[] } | null>(null);

  const sectionOf = (id: string) => navSections.find((s) => s.id === id)!;
  const outside = navSections.filter((s) => !ids.includes(s.id));
  const full = ids.length >= TABBAR_MAX;
  const minimal = ids.length <= TABBAR_MIN;
  const isDefault = ids.join() === TABBAR_DEFAULT.join();

  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setTabbar(next);
  };

  // Glisser-déposer au doigt (ou à la souris) depuis la poignée.
  const onGripDown = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    const row = (event.currentTarget.closest('li') as HTMLElement | null);
    if (!row) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = { startY: event.clientY, rowHeight: row.getBoundingClientRect().height, order: [...ids] };
    setDrag({ id, offset: 0 });
  };
  const onGripMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = dragState.current;
    if (!state || !drag) return;
    let offset = event.clientY - state.startY;
    const index = state.order.indexOf(drag.id);
    // Passé la moitié de la ligne voisine : on échange, et on recale le point de départ.
    if (offset > state.rowHeight / 2 && index < state.order.length - 1) {
      state.order.splice(index, 1); state.order.splice(index + 1, 0, drag.id);
      state.startY += state.rowHeight; offset -= state.rowHeight;
      setTabbar([...state.order]);
    } else if (offset < -state.rowHeight / 2 && index > 0) {
      state.order.splice(index, 1); state.order.splice(index - 1, 0, drag.id);
      state.startY -= state.rowHeight; offset += state.rowHeight;
      setTabbar([...state.order]);
    }
    setDrag({ id: drag.id, offset });
  };
  const onGripUp = () => { dragState.current = null; setDrag(null); };

  const addIndex = addButtonIndex(ids.length);
  return (
    <div className="tb-editor no-swipe">
      {/* Aperçu de la barre, tel qu'il apparaîtra en bas de l'écran. */}
      <div className="tb-preview" aria-label={t('reglages.tabbar.preview')} style={{ ['--tb-cols' as string]: ids.length + 2 }}>
        {ids.flatMap((id, index) => {
          const s = sectionOf(id);
          const cell = <span key={id} className="tb-preview-item">{s.icon}<small>{t(s.short)}</small></span>;
          return index === addIndex ? [<span key="add" className="tb-preview-add" aria-hidden><Plus size={18} /></span>, cell] : [cell];
        })}
        {addIndex >= ids.length && <span className="tb-preview-add" aria-hidden><Plus size={18} /></span>}
        <span className="tb-preview-item">{<MoreHorizontal size={18} />}<small>{t('ui.app.more')}</small></span>
      </div>

      <div className="tb-group-head">
        <strong>{t('reglages.tabbar.in_bar')}</strong>
        <span>{ids.length} / {TABBAR_MAX}</span>
      </div>
      <ol className="tb-list" ref={listRef}>
        {ids.map((id, index) => {
          const s = sectionOf(id);
          const dragging = drag?.id === id;
          return (
            <li key={id} className={dragging ? 'tb-row dragging' : 'tb-row'} style={dragging ? { transform: `translateY(${drag!.offset}px)` } : undefined}>
              <button
                type="button"
                className="tb-grip"
                aria-label={t('reglages.tabbar.drag', { name: t(s.label) })}
                onPointerDown={(e) => onGripDown(e, id)}
                onPointerMove={onGripMove}
                onPointerUp={onGripUp}
                onPointerCancel={onGripUp}
              >
                <GripVertical size={18} />
              </button>
              <span className="tb-name">{s.icon}{t(s.label)}</span>
              <button type="button" className="icon-ghost" disabled={index === 0} aria-label={t('reglages.tabbar.up', { name: t(s.label) })} onClick={() => move(index, index - 1)}><ArrowUp size={16} /></button>
              <button type="button" className="icon-ghost" disabled={index === ids.length - 1} aria-label={t('reglages.tabbar.down', { name: t(s.label) })} onClick={() => move(index, index + 1)}><ArrowDown size={16} /></button>
              <button
                type="button"
                className="icon-ghost"
                disabled={minimal}
                title={minimal ? t('reglages.tabbar.min', { n: TABBAR_MIN }) : undefined}
                aria-label={t('reglages.tabbar.remove', { name: t(s.label) })}
                onClick={() => setTabbar(ids.filter((x) => x !== id))}
              >
                <X size={16} />
              </button>
            </li>
          );
        })}
      </ol>

      <div className="tb-group-head">
        <strong>{t('reglages.tabbar.in_more')}</strong>
        {full && <span>{t('reglages.tabbar.full', { n: TABBAR_MAX })}</span>}
      </div>
      <ul className="tb-list">
        {outside.map((s) => (
          <li key={s.id} className="tb-row tb-row-more">
            <span className="tb-name">{s.icon}{t(s.label)}</span>
            <button type="button" className="secondary tb-add" disabled={full} onClick={() => setTabbar([...ids, s.id])}>
              <Plus size={15} /> {t('reglages.tabbar.add')}
            </button>
          </li>
        ))}
      </ul>

      {!isDefault && (
        <button type="button" className="link-button tb-reset" onClick={() => setTabbar(null)}>
          <RotateCcw size={14} /> {t('reglages.tabbar.reset')}
        </button>
      )}
    </div>
  );
}
