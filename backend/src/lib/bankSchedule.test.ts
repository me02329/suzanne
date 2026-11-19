import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SYNC_HOURS, DEFAULT_SYNC_TZ, MAX_SYNC_SLOTS, MIN_GAP_MS,
  isSyncDue, latestSlot, nextSlot, parseSyncSchedule, scheduleFromSetting, type SyncSchedule,
} from './bankSchedule';

const paris: SyncSchedule = { hours: [7, 19], timeZone: 'Europe/Paris', warnings: [] };
const HOUR = 3600_000;
const at = (iso: string) => new Date(iso);
const active = (last: string | null, extra: Partial<{ status: string; valid_until: Date }> = {}) => ({
  status: 'active',
  valid_until: at('2027-06-01T00:00:00Z'),
  last_attempt_at: last ? at(last) : null,
  ...extra,
});

describe('parseSyncSchedule', () => {
  it('prend 7 h et 19 h, heure de Paris, par défaut', () => {
    expect(parseSyncSchedule({})).toEqual({ hours: DEFAULT_SYNC_HOURS, timeZone: DEFAULT_SYNC_TZ, warnings: [] });
  });

  it('lit, trie et dédoublonne les heures', () => {
    expect(parseSyncSchedule({ BANK_SYNC_HOURS: '19, 7;7 ', BANK_SYNC_TZ: 'UTC' })).toMatchObject({ hours: [7, 19], timeZone: 'UTC', warnings: [] });
  });

  it('ignore une valeur invalide avec un avertissement (jamais d\'arrêt du serveur)', () => {
    for (const bad of ['25', '7,abc', '-1', '7.5', ',,,']) {
      const s = parseSyncSchedule({ BANK_SYNC_HOURS: bad });
      if (bad === ',,,') continue; // vide une fois découpé : défaut sans avertissement utile
      expect(s.hours, bad).toEqual(DEFAULT_SYNC_HOURS);
      expect(s.warnings.length, bad).toBe(1);
    }
    const tz = parseSyncSchedule({ BANK_SYNC_TZ: 'Mars/Olympus' });
    expect(tz.timeZone).toBe(DEFAULT_SYNC_TZ);
    expect(tz.warnings[0]).toMatch(/BANK_SYNC_TZ/);
  });

  it('plafonne le nombre de créneaux (quota DSP2 de 4 lectures par jour)', () => {
    const s = parseSyncSchedule({ BANK_SYNC_HOURS: '1,5,9,13,17' });
    expect(s.hours).toHaveLength(MAX_SYNC_SLOTS);
    expect(s.warnings[0]).toMatch(/créneaux/);
  });
});

describe('scheduleFromSetting', () => {
  it('utilise les heures du profil quand elles sont valides', () => {
    expect(scheduleFromSetting('{"hours":[20,6],"time_zone":"Europe/Brussels"}', paris)).toEqual({ hours: [6, 20], timeZone: 'Europe/Brussels', warnings: [], custom: true });
  });

  it('accepte une liste vide (synchro automatique désactivée)', () => {
    expect(scheduleFromSetting('{"hours":[]}', paris)).toMatchObject({ hours: [], timeZone: 'Europe/Paris', custom: true });
  });

  it('retombe sur le défaut du serveur pour un réglage absent ou illisible', () => {
    for (const v of [null, undefined, '', 'pas du json', '{"hours":[25]}', '{"hours":[1,2,3,4]}', '{"hours":"7"}', '{"hours":[7.5]}']) {
      expect(scheduleFromSetting(v, paris), String(v)).toMatchObject({ hours: [7, 19], custom: false });
    }
  });

  it('garde les heures mais pas un fuseau inconnu', () => {
    expect(scheduleFromSetting('{"hours":[8],"time_zone":"Nulle/Part"}', paris)).toMatchObject({ hours: [8], timeZone: 'Europe/Paris' });
  });
});

describe('latestSlot / nextSlot', () => {
  it('trouve le dernier créneau passé, en heure de Paris (hiver, UTC+1)', () => {
    // 15 h à Paris le 19 novembre → dernier créneau 7 h Paris = 6 h UTC.
    expect(latestSlot(at('2026-11-19T14:00:00Z'), paris)?.toISOString()).toBe('2026-11-19T06:00:00.000Z');
    // 3 h du matin → 19 h la veille.
    expect(latestSlot(at('2026-11-19T02:00:00Z'), paris)?.toISOString()).toBe('2026-11-18T18:00:00.000Z');
    expect(nextSlot(at('2026-11-19T14:00:00Z'), paris)?.toISOString()).toBe('2026-11-19T18:00:00.000Z');
  });

  it('suit l\'heure d\'été (UTC+2)', () => {
    expect(latestSlot(at('2026-07-01T12:00:00Z'), paris)?.toISOString()).toBe('2026-07-01T05:00:00.000Z');
  });

  it('compte le créneau en cours dès sa première minute', () => {
    expect(latestSlot(at('2026-11-19T06:00:00Z'), paris)?.toISOString()).toBe('2026-11-19T06:00:00.000Z');
    expect(latestSlot(at('2026-11-19T05:59:59Z'), paris)?.toISOString()).toBe('2026-11-18T18:00:00.000Z');
  });

  it('gère les changements d\'heure (créneau à 2 h : sauté au printemps, une seule fois à l\'automne)', () => {
    const two = { hours: [2], timeZone: 'Europe/Paris' };
    // 29 mars 2026 : 2 h n'existe pas à Paris → dernier créneau = 28 mars 2 h (UTC+1).
    expect(latestSlot(at('2026-03-29T10:00:00Z'), two)?.toISOString()).toBe('2026-03-28T01:00:00.000Z');
    // 25 octobre 2026 : 2 h existe deux fois → la plus récente (UTC+1 = 1 h UTC).
    expect(latestSlot(at('2026-10-25T10:00:00Z'), two)?.toISOString()).toBe('2026-10-25T01:00:00.000Z');
  });

  it('gère les fuseaux décalés d\'une demi-heure', () => {
    const india = { hours: [7], timeZone: 'Asia/Kolkata' };
    // 7 h à Calcutta = 1 h 30 UTC.
    expect(latestSlot(at('2026-11-19T10:00:00Z'), india)?.toISOString()).toBe('2026-11-19T01:30:00.000Z');
  });

  it('renvoie null sans créneau', () => {
    expect(latestSlot(at('2026-11-19T10:00:00Z'), { hours: [], timeZone: 'UTC' })).toBeNull();
    expect(nextSlot(at('2026-11-19T10:00:00Z'), { hours: [], timeZone: 'UTC' })).toBeNull();
  });
});

describe('isSyncDue', () => {
  const now = at('2026-11-19T14:00:00Z'); // 15 h Paris ; créneau passé : 7 h (6 h UTC)

  it('synchronise une connexion jamais tentée', () => {
    expect(isSyncDue(active(null), now, paris)).toBe(true);
  });

  it('synchronise si la dernière tentative précède le créneau', () => {
    expect(isSyncDue(active('2026-11-18T18:05:00Z'), now, paris)).toBe(true);
  });

  it('une seule tentative par créneau, même ratée', () => {
    expect(isSyncDue(active('2026-11-19T06:00:30Z'), now, paris)).toBe(false);
    expect(isSyncDue(active('2026-11-19T06:00:30Z', { status: 'error' }), now, paris)).toBe(false);
  });

  it('retente une connexion en erreur au créneau suivant', () => {
    expect(isSyncDue(active('2026-11-18T18:00:30Z', { status: 'error' }), now, paris)).toBe(true);
  });

  it('attend 2 h après une synchro manuelle faite juste avant le créneau', () => {
    const manual = '2026-11-19T05:50:00Z';
    expect(isSyncDue(active(manual), at('2026-11-19T06:00:00Z'), paris)).toBe(false);
    expect(isSyncDue(active(manual), new Date(at(manual).getTime() + MIN_GAP_MS), paris)).toBe(true);
  });

  it('ignore les connexions expirées, révoquées ou désactivées', () => {
    expect(isSyncDue(active(null, { status: 'expired' }), now, paris)).toBe(false);
    expect(isSyncDue(active(null, { status: 'revoked' }), now, paris)).toBe(false);
    expect(isSyncDue(active(null, { valid_until: now }), now, paris)).toBe(false);
    expect(isSyncDue(active(null), now, { hours: [], timeZone: 'UTC' })).toBe(false);
  });

  it('jamais plus de tentatives automatiques par jour que de créneaux (simulation sur 3 jours)', () => {
    let state = active(null);
    const attempts: Date[] = [];
    // Vérification toutes les 15 minutes, comme le planificateur.
    for (let t = at('2026-11-19T00:00:00Z').getTime(); t < at('2026-11-22T00:00:00Z').getTime(); t += HOUR / 4) {
      const tick = new Date(t);
      if (isSyncDue(state, tick, paris)) {
        attempts.push(tick);
        state = { ...state, last_attempt_at: tick };
      }
    }
    // 00:00 UTC le 19 = 1 h Paris : rattrapage du créneau de 19 h la veille, puis 2 par jour.
    expect(attempts.map((d) => d.toISOString())).toEqual([
      '2026-11-19T00:00:00.000Z',
      '2026-11-19T06:00:00.000Z', '2026-11-19T18:00:00.000Z',
      '2026-11-20T06:00:00.000Z', '2026-11-20T18:00:00.000Z',
      '2026-11-21T06:00:00.000Z', '2026-11-21T18:00:00.000Z',
    ]);
  });
});
