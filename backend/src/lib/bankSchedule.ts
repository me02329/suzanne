// Planification de la synchro bancaire automatique : fonctions pures (sans
// base ni réseau), testées dans bankSchedule.test.ts.
//
// La DSP2 limite l'accès sans l'utilisateur devant l'écran à 4 lectures par
// jour et par compte. On synchronise donc à heures fixes (par défaut 7 h et
// 19 h, heure de Paris) : au plus une tentative automatique par créneau, même
// après un redémarrage du serveur, un échec ou une synchro manuelle juste avant.

const HOUR = 3600_000;

export const DEFAULT_SYNC_HOURS = [7, 19];
export const DEFAULT_SYNC_TZ = 'Europe/Paris';
/** Au plus 3 créneaux : 4 lectures par jour au maximum, une marge pour le bouton « Synchroniser ». */
export const MAX_SYNC_SLOTS = 3;
/** Une tentative (automatique ou manuelle) dans les 2 h qui précèdent : le créneau attend. */
export const MIN_GAP_MS = 2 * HOUR;

export interface SyncSchedule {
  hours: number[];
  timeZone: string;
  /** Avertissements de configuration (valeur ignorée, remplacée par le défaut). */
  warnings: string[];
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Lit BANK_SYNC_HOURS (« 7,19 ») et BANK_SYNC_TZ (« Europe/Paris »). Toute
 * valeur invalide est remplacée par le défaut avec un avertissement : une
 * faute de frappe ne doit ni arrêter le serveur ni épuiser le quota.
 */
export function parseSyncSchedule(env: { BANK_SYNC_HOURS?: string; BANK_SYNC_TZ?: string } = process.env): SyncSchedule {
  const warnings: string[] = [];
  let hours = DEFAULT_SYNC_HOURS;
  const rawHours = env.BANK_SYNC_HOURS?.trim();
  if (rawHours) {
    const parts = rawHours.split(/[,;\s]+/).filter(Boolean);
    const parsed = parts.map((p) => (/^\d{1,2}$/.test(p) ? Number(p) : NaN));
    if (parsed.length === 0 || parsed.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) {
      warnings.push(`BANK_SYNC_HOURS invalide (« ${rawHours} ») : heures de 0 à 23 séparées par des virgules. Défaut utilisé : ${DEFAULT_SYNC_HOURS.join(',')}.`);
    } else {
      const unique = [...new Set(parsed)].sort((a, b) => a - b);
      if (unique.length > MAX_SYNC_SLOTS) {
        warnings.push(`BANK_SYNC_HOURS : ${unique.length} créneaux, la banque en refuserait une partie (4 lectures par jour au plus). Seuls les ${MAX_SYNC_SLOTS} premiers sont gardés.`);
      }
      hours = unique.slice(0, MAX_SYNC_SLOTS);
    }
  }
  let timeZone = DEFAULT_SYNC_TZ;
  const rawTz = env.BANK_SYNC_TZ?.trim();
  if (rawTz) {
    if (validTimeZone(rawTz)) timeZone = rawTz;
    else warnings.push(`BANK_SYNC_TZ invalide (« ${rawTz} ») : fuseau IANA attendu, par exemple Europe/Paris. Défaut utilisé : ${DEFAULT_SYNC_TZ}.`);
  }
  return { hours, timeZone, warnings };
}

/** Clé du réglage par profil (table settings) : heures choisies dans Réglages → Données. */
export const bankScheduleKey = (user_id: number) => `bank_sync.${user_id}`;

/**
 * Créneaux d'un profil : son réglage s'il est valide, sinon ceux du serveur.
 * `hours: []` = synchro automatique désactivée pour ce profil. Un réglage
 * illisible (modifié à la main en base) retombe sur le défaut du serveur.
 */
export function scheduleFromSetting(value: string | null | undefined, fallback: SyncSchedule): SyncSchedule & { custom: boolean } {
  if (!value) return { ...fallback, custom: false };
  try {
    const data = JSON.parse(value) as { hours?: unknown; time_zone?: unknown };
    const hours = data.hours;
    if (!Array.isArray(hours) || hours.length > MAX_SYNC_SLOTS || hours.some((h) => !Number.isInteger(h) || (h as number) < 0 || (h as number) > 23)) throw new Error('heures');
    const timeZone = typeof data.time_zone === 'string' && validTimeZone(data.time_zone) ? data.time_zone : fallback.timeZone;
    return { hours: [...new Set(hours as number[])].sort((a, b) => a - b), timeZone, warnings: [], custom: true };
  } catch {
    return { ...fallback, custom: false };
  }
}

export { validTimeZone };

/** Heure locale (0-23) d'un instant dans un fuseau. */
function localHour(instant: Date, timeZone: string): number {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(instant));
  return h === 24 ? 0 : h;
}

/** Minutes locales (0-59) : non nulles dans les fuseaux décalés d'une demi-heure. */
function localMinute(instant: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, minute: 'numeric' }).format(instant));
}

/**
 * Dernier créneau passé (ou en cours) à `now` : l'instant le plus récent où
 * l'heure locale est une des heures prévues, à la minute 0. On remonte heure
 * par heure (48 h au plus) ; les changements d'heure sont gérés par Intl : une
 * heure locale sautée au printemps n'a pas de créneau ce jour-là, une heure
 * répétée à l'automne n'en déclenche qu'un (le plus récent).
 */
export function latestSlot(now: Date, schedule: Pick<SyncSchedule, 'hours' | 'timeZone'>): Date | null {
  if (schedule.hours.length === 0) return null;
  // Début de l'heure locale en cours (gère les fuseaux à demi-heure).
  const start = new Date(now.getTime() - localMinute(now, schedule.timeZone) * 60_000);
  start.setUTCSeconds(0, 0);
  for (let i = 0; i <= 48; i += 1) {
    const candidate = new Date(start.getTime() - i * HOUR);
    if (schedule.hours.includes(localHour(candidate, schedule.timeZone))) return candidate;
  }
  return null;
}

/** Prochain créneau après `now` (pour l'afficher). */
export function nextSlot(now: Date, schedule: Pick<SyncSchedule, 'hours' | 'timeZone'>): Date | null {
  if (schedule.hours.length === 0) return null;
  const start = new Date(now.getTime() - localMinute(now, schedule.timeZone) * 60_000);
  start.setUTCSeconds(0, 0);
  for (let i = 1; i <= 49; i += 1) {
    const candidate = new Date(start.getTime() + i * HOUR);
    if (schedule.hours.includes(localHour(candidate, schedule.timeZone))) return candidate;
  }
  return null;
}

export interface ConnectionSyncState {
  status: string;
  valid_until: Date;
  last_attempt_at: Date | null;
}

/**
 * Une connexion est à synchroniser si :
 * - elle est active (ou en erreur : on retente au créneau suivant) et non expirée ;
 * - aucune tentative depuis le dernier créneau (une tentative ratée compte :
 *   pas de nouvel essai en boucle qui épuiserait le quota) ;
 * - aucune tentative dans les 2 dernières heures (synchro manuelle juste avant).
 */
export function isSyncDue(c: ConnectionSyncState, now: Date, schedule: Pick<SyncSchedule, 'hours' | 'timeZone'>): boolean {
  if (c.status !== 'active' && c.status !== 'error') return false;
  if (c.valid_until.getTime() <= now.getTime()) return false;
  const slot = latestSlot(now, schedule);
  if (!slot) return false;
  if (!c.last_attempt_at) return true;
  if (c.last_attempt_at.getTime() >= slot.getTime()) return false;
  return now.getTime() - c.last_attempt_at.getTime() >= MIN_GAP_MS;
}
