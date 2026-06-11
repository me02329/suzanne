import { CalendarCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { currentMonthIso } from '../lib/format';

const MONTH_LABELS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function clampMonth(year: number, monthIndex: number): string {
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
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
    <div className="month-picker" role="group" aria-label="Mois affiché">
      <button type="button" className="month-picker-arrow" aria-label="Mois précédent" onClick={() => shift(-1)}>
        <ChevronLeft size={16} />
      </button>
      <select
        value={monthIndex}
        onChange={(e) => onChange(clampMonth(year, Number(e.target.value)))}
        aria-label="Mois"
      >
        {MONTH_LABELS.map((label, idx) => (
          <option key={label} value={idx}>{label}</option>
        ))}
      </select>
      <select
        value={year}
        onChange={(e) => onChange(clampMonth(Number(e.target.value), monthIndex))}
        aria-label="Année"
      >
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <button type="button" className="month-picker-arrow" aria-label="Mois suivant" onClick={() => shift(1)}>
        <ChevronRight size={16} />
      </button>
      {value !== currentMonthIso() && (
        <button
          type="button"
          className="month-picker-arrow"
          aria-label="Revenir au mois courant"
          title="Revenir au mois courant"
          onClick={() => onChange(currentMonthIso())}
        >
          <CalendarCheck size={16} />
        </button>
      )}
    </div>
  );
}
