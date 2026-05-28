import { X } from 'lucide-react';
import type { Tag } from '@suzanne-lite/shared';

export function TagPicker({ value, tags, onChange }: {
  value: number[];
  tags: Tag[];
  onChange: (ids: number[]) => void;
}) {
  const selected = new Set(value);
  const available = tags.filter((t) => !selected.has(t.id));

  const remove = (id: number) => onChange(value.filter((v) => v !== id));
  const add = (id: number) => {
    if (!Number.isFinite(id) || selected.has(id)) return;
    onChange([...value, id]);
  };

  return (
    <div className="tag-picker">
      <div className="tag-picker-chips">
        {value.map((id) => {
          const tag = tags.find((t) => t.id === id);
          if (!tag) return null;
          return (
            <span key={id} className="tag-chip" style={{ background: tag.color }}>
              {tag.name}
              <button type="button" onClick={() => remove(id)} aria-label={`Retirer ${tag.name}`}>
                <X size={12} />
              </button>
            </span>
          );
        })}
        {value.length === 0 && <span className="tag-picker-placeholder">Aucun tag</span>}
      </div>
      {available.length > 0 && (
        <select
          className="tag-picker-select"
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) add(id);
            e.target.value = '';
          }}
        >
          <option value="">+ Ajouter un tag…</option>
          {available.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
    </div>
  );
}
