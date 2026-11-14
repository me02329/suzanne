import { localeTag } from '../i18n';

// Axe X temporel des graphiques : le mois (ou le jour) en clair, et l'année
// sur une 2e ligne dès que la série couvre plusieurs années — sinon « nov. »
// ne dit pas de quelle année il s'agit. Les valeurs sont des dates ISO
// (`YYYY-MM` ou `YYYY-MM-DD`) ; le tooltip affiche la date complète.

const parse = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
};

export function spansYears(values: string[]): boolean {
  if (values.length === 0) return false;
  const first = values[0]!.slice(0, 4);
  return values.some((v) => v.slice(0, 4) !== first);
}

export function shortTimeLabel(iso: string, granularity: 'month' | 'day' = iso.length > 7 ? 'day' : 'month'): string {
  const opts: Intl.DateTimeFormatOptions = granularity === 'day' ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { month: 'short', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(localeTag(), opts).format(parse(iso));
}

export function longTimeLabel(iso: string, granularity: 'month' | 'day' = iso.length > 7 ? 'day' : 'month'): string {
  const opts: Intl.DateTimeFormatOptions = granularity === 'day'
    ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
    : { month: 'long', year: 'numeric', timeZone: 'UTC' };
  const text = new Intl.DateTimeFormat(localeTag(), opts).format(parse(iso));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

interface TickProps {
  x?: number;
  y?: number;
  payload?: { value?: unknown };
  fill?: string;
}

// Graduation sur deux lignes (recharts `tick={<TimeTick … />}`).
export function TimeTick({ x = 0, y = 0, payload, multiYear, granularity, fill, fontSize = 11.5, fontFamily }: TickProps & {
  multiYear: boolean;
  granularity?: 'month' | 'day';
  fontSize?: number;
  fontFamily?: string;
}) {
  const value = String(payload?.value ?? '');
  if (!/^\d{4}-\d{2}/.test(value)) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={12} textAnchor="middle" fill={fill ?? 'currentColor'} fontSize={fontSize} fontFamily={fontFamily}>{shortTimeLabel(value, granularity)}</text>
      {multiYear && (
        <text dy={25} textAnchor="middle" fill={fill ?? 'currentColor'} fontSize={fontSize - 1.5} fontFamily={fontFamily} opacity={0.65}>{value.slice(0, 4)}</text>
      )}
    </g>
  );
}

/** Props d'un <XAxis> temporel : `values` = toutes les valeurs de la série. */
export function timeAxisProps(values: string[], tick: { fill: string; fontSize: number; fontFamily: string } | undefined, granularity?: 'month' | 'day') {
  const multiYear = spansYears(values);
  return {
    tick: <TimeTick multiYear={multiYear} granularity={granularity} fill={tick?.fill} fontSize={tick?.fontSize} fontFamily={tick?.fontFamily} />,
    height: multiYear ? 38 : 26,
    tickLine: false,
    axisLine: false,
  } as const;
}

/** labelFormatter de Tooltip pour un axe temporel. */
export const timeTooltipLabel = (granularity?: 'month' | 'day') => (label: unknown) => {
  const value = String(label ?? '');
  return /^\d{4}-\d{2}/.test(value) ? longTimeLabel(value, granularity) : value;
};
