import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildResources, catalogIssues, parseCatalog, parseCsv } from './catalog';

describe('parseCsv', () => {
  it('lit les champs entre guillemets (virgules, guillemets doublés, retours à la ligne)', () => {
    const rows = parseCsv('keys,fr,en\na.b,"Un, deux","Say ""hi"""\nc.d,"ligne 1\nligne 2",x\n');
    expect(rows.map((r) => r.cells)).toEqual([
      ['keys', 'fr', 'en'],
      ['a.b', 'Un, deux', 'Say "hi"'],
      ['c.d', 'ligne 1\nligne 2', 'x'],
    ]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3]);
  });
  it('tolère le BOM, les fins de ligne CRLF, les lignes vides et l’absence de saut final', () => {
    const rows = parseCsv('﻿keys,fr,en\r\n\r\na.b,Oui,Yes');
    expect(rows.map((r) => r.cells)).toEqual([['keys', 'fr', 'en'], ['a.b', 'Oui', 'Yes']]);
    expect(rows[1]!.line).toBe(3);
  });
  it('refuse un guillemet non fermé', () => {
    expect(() => parseCsv('keys,fr,en\na.b,"Oui,Yes\n')).toThrow(/non fermé/);
  });
});

describe('parseCatalog', () => {
  it('associe chaque colonne à sa langue', () => {
    const cat = parseCatalog('keys,fr,en\nbudgets.hero.remaining,Reste {{amount}},{{amount}} left\n', 'budgets.csv');
    expect(cat.langs).toEqual(['fr', 'en']);
    expect(cat.rows).toEqual([{ key: 'budgets.hero.remaining', values: { fr: 'Reste {{amount}}', en: '{{amount}} left' }, line: 2 }]);
  });
  it('refuse un en-tête invalide ou une ligne au mauvais nombre de colonnes', () => {
    expect(() => parseCatalog('key,fr,en\n', 'x.csv')).toThrow(/en-tête/);
    expect(() => parseCatalog('keys,fr,en\na.b,Un, deux,Two\n', 'x.csv')).toThrow(/x\.csv:2 : 4 colonnes/);
  });
});

describe('catalogIssues', () => {
  it('signale clé mal formée, doublon entre catalogues, case vide et colonne absente', () => {
    const a = parseCatalog('keys,fr,en\nui.ok,Oui,Yes\nPas une clé,X,Y\nui.vide,Non,\n', 'a.csv');
    const b = parseCatalog('keys,fr\nui.ok,Oui\n', 'b.csv');
    const messages = catalogIssues([a, b], ['fr', 'en']).map((i) => `${i.file}:${i.line} ${i.message}`);
    expect(messages).toEqual([
      'a.csv:3 clé « Pas une clé » mal formée (attendu : domaine.sous_partie.nom)',
      'a.csv:4 « ui.vide » : traduction en vide',
      'b.csv:1 colonne « en » absente',
      'b.csv:2 clé « ui.ok » déjà définie (a.csv:2)',
    ]);
  });
});

describe('buildResources', () => {
  it('fusionne catalogues et ancien dictionnaire, sans valeur vide (repli sur le français)', () => {
    const cat = parseCatalog('keys,fr,en\nui.save,Enregistrer,Save\nui.draft,Brouillon,\n', 'ui.csv');
    const res = buildResources([cat], { Patrimoine: { fr: 'Patrimoine', en: 'Net worth' } }, ['fr', 'en']);
    expect(res.fr!.translation).toEqual({ Patrimoine: 'Patrimoine', 'ui.save': 'Enregistrer', 'ui.draft': 'Brouillon' });
    expect(res.en!.translation).toEqual({ Patrimoine: 'Net worth', 'ui.save': 'Save' });
  });
});

describe('catalogues du dépôt', () => {
  it('sont bien formés : clés stables uniques, aucune case vide', () => {
    const dir = fileURLToPath(new URL('./catalogs/', import.meta.url));
    const catalogs = fs.readdirSync(dir).filter((f) => f.endsWith('.csv'))
      .map((f) => parseCatalog(fs.readFileSync(dir + f, 'utf8'), f));
    expect(catalogs.length).toBeGreaterThan(0);
    expect(catalogIssues(catalogs, ['fr', 'en'])).toEqual([]);
  });
});
