import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CATEGORY_ICONS, categoryIcon } from '../lib/categoryIcons';

// Choix d'une icône de catégorie : une grille d'icônes cliquables au lieu
// d'un nom à deviner. La valeur (nom Lucide) part dans un champ caché `name`
// pour les formulaires classiques. Un nom inconnu déjà enregistré reste
// sélectionné tant qu'on n'en choisit pas un autre.
export function IconPicker({ name, defaultValue, color }: { name: string; defaultValue?: string | null; color?: string }) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue?.trim() ?? '');
  const known = value === '' || categoryIcon(value) != null;
  return (
    <div className="icon-picker">
      <input type="hidden" name={name} value={value} />
      <div className="icon-picker-grid" role="radiogroup" aria-label={t('operations.icon')}>
        <button
          type="button"
          role="radio"
          aria-checked={value === ''}
          className={value === '' ? 'icon-picker-item selected' : 'icon-picker-item'}
          title={t('ui.icon_picker.none')}
          onClick={() => setValue('')}
        >
          <span className="icon-picker-none" aria-hidden>∅</span>
        </button>
        {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => {
          const selected = value === key || categoryIcon(value) === Icon;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={key}
              title={key}
              className={selected ? 'icon-picker-item selected' : 'icon-picker-item'}
              style={selected && color ? { ['--icon-picker-color' as string]: color } : undefined}
              onClick={() => setValue(key)}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden />
            </button>
          );
        })}
      </div>
      {!known && <small className="st-muted">{t('ui.icon_picker.unknown', { name: value })}</small>}
    </div>
  );
}
