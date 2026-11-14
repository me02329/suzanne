import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { currentMonthIso } from '../lib/format';
import { useTranslation } from 'react-i18next';
import { localeTag } from '../i18n';

/** Noms des mois dans la langue de l'interface, avec majuscule (« Novembre », « November »). */
function monthLabels(): string[] {
  const fmt = new Intl.DateTimeFormat(localeTag(), { month: 'long', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, i) => {
    const name = fmt.format(new Date(Date.UTC(2000, i, 1)));
    return name.charAt(0).toUpperCase() + name.slice(1);
  });
}

function clampMonth(year: number, monthIndex: number): string {
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useTranslation();
  const [yearStr, monthStr] = value.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const currentYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = currentYear + 1; y >= currentYear - 10; y -= 1) years.push(y);
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => b - a);

  const shift = (delta: number) => onChange(clampMonth(year, monthIndex + delta));

  return (
    <div className="month-picker" role="group" aria-label={t('ui.month_picker.displayed_month')}>
      <button type="button" className="month-picker-arrow" aria-label={t('ui.month_picker.previous_month')} onClick={() => shift(-1)}>
        <ChevronLeft size={16} />
      </button>
      <select
        value={monthIndex}
        onChange={(e) => onChange(clampMonth(year, Number(e.target.value)))}
        aria-label={t('ui.month_picker.month')}
      >
        {monthLabels().map((label, idx) => (
          <option key={label} value={idx}>{label}</option>
        ))}
      </select>
      <select
        value={year}
        onChange={(e) => onChange(clampMonth(Number(e.target.value), monthIndex))}
        aria-label={t('ui.month_picker.year')}
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <button type="button" className="month-picker-arrow" aria-label={t('ui.month_picker.next_month')} onClick={() => shift(1)}>
        <ChevronRight size={16} />
      </button>
      {value !== currentMonthIso() && (
        <button
          type="button"
          className="month-picker-arrow"
          aria-label={t('ui.month_picker.back_to_current_month')}
          title={t('ui.month_picker.back_to_current_month')}
          onClick={() => onChange(currentMonthIso())}
        >
          <CalendarCheck size={16} />
        </button>
      )}
    </div>
  );
}
