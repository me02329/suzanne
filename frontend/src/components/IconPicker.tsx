import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { CATEGORY_ICON_GROUPS, categoryIcon, normalizeWords } from '../lib/categoryIcons';

// Choix d'une icône de catégorie. Les icônes sont rangées par groupe : un clic
// sur un groupe (Alimentation, Logement…) affiche ses icônes ; la recherche
// (mots-clés français) parcourt tout le catalogue. Les icônes prennent la
// couleur de la catégorie pour voir le rendu final. La valeur (nom Lucide)
// part dans un champ caché `name` pour les formulaires classiques. Un nom
// inconnu déjà enregistré reste sélectionné tant qu'on n'en choisit pas un autre.
export function IconPicker({ name, defaultValue, color, suggestion }: {
  name: string;
  defaultValue?: string | null;
  color?: string;
  /** Icône proposée d'après le nom de la catégorie (affichée si aucune n'est choisie). */
  suggestion?: string | null;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue?.trim() ?? '');
  const [query, setQuery] = useState('');
  const current = categoryIcon(value);
  const known = value === '' || current != null;
  const [groupId, setGroupId] = useState(
    () => CATEGORY_ICON_GROUPS.find((g) => g.icons.some((i) => i.Icon === current))?.id ?? CATEGORY_ICON_GROUPS[0]!.id,
  );

  const shown = useMemo(() => {
    const words = normalizeWords(query);
    const raw = query.trim().toLowerCase();
    if (words.length === 0 && raw === '') return CATEGORY_ICON_GROUPS.find((g) => g.id === groupId)?.icons ?? [];
    return CATEGORY_ICON_GROUPS.flatMap((g) => g.icons).filter((i) => {
      const haystack = `${i.key} ${i.keywords}`;
      return words.length > 0 ? words.every((w) => haystack.includes(w)) : haystack.includes(raw);
    });
  }, [query, groupId]);

  const SuggestedIcon = suggestion && value === '' ? categoryIcon(suggestion) : null;
  const tint = color ? { ['--icon-picker-color' as string]: color } : undefined;

  return (
    <div className="icon-picker" style={tint}>
      <input type="hidden" name={name} value={value} />
      <div className="icon-picker-top">
        <div className="icon-picker-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('ui.icon_picker.search')}
            aria-label={t('ui.icon_picker.search')}
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
          />
        </div>
        <button
          type="button"
          className={value === '' ? 'icon-picker-item selected' : 'icon-picker-item'}
          aria-pressed={value === ''}
          title={t('ui.icon_picker.none')}
          aria-label={t('ui.icon_picker.none')}
          onClick={() => setValue('')}
        >
          <span className="icon-picker-none" aria-hidden>∅</span>
        </button>
        {SuggestedIcon && (
          <button type="button" className="icon-picker-suggest" onClick={() => setValue(suggestion!)}>
            {t('ui.icon_picker.suggestion')} <SuggestedIcon size={18} strokeWidth={1.8} aria-hidden />
          </button>
        )}
      </div>

      {query.trim() === '' && (
        <div className="icon-picker-groups" role="tablist" aria-label={t('operations.icon')}>
          {CATEGORY_ICON_GROUPS.map((g) => {
            const First = g.icons[0]!.Icon;
            const hasSelected = current != null && g.icons.some((i) => i.Icon === current);
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={g.id === groupId}
                className={['icon-picker-group', g.id === groupId ? 'active' : '', hasSelected ? 'has-selected' : ''].filter(Boolean).join(' ')}
                onClick={() => setGroupId(g.id)}
              >
                <First size={14} strokeWidth={1.8} aria-hidden />
                {t(`ui.icon_picker.group_${g.id}`, { defaultValue: g.label })}
              </button>
            );
          })}
        </div>
      )}

      <div className="icon-picker-grid" role="radiogroup" aria-label={t('operations.icon')}>
        {shown.map(({ key, Icon, keywords }) => {
          const selected = Icon === current;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={key}
              title={keywords.split(' ').slice(0, 3).join(', ') || key}
              className={selected ? 'icon-picker-item selected' : 'icon-picker-item'}
              onClick={() => setValue(key)}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden />
            </button>
          );
        })}
        {shown.length === 0 && <p className="icon-picker-empty st-muted">{t('ui.icon_picker.no_match')}</p>}
      </div>
      {!known && <small className="st-muted">{t('ui.icon_picker.unknown', { name: value })}</small>}
    </div>
  );
}
