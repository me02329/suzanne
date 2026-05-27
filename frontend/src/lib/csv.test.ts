import { describe, expect, it } from 'vitest';
import { detectCsvDelimiter, guessColumn, parseCsvPreview, splitCsvLine } from './csv';

describe('CSV helpers', () => {
  it('detects common delimiters', () => {
    expect(detectCsvDelimiter('date;amount;description')).toBe(';');
    expect(detectCsvDelimiter('date,amount,description')).toBe(',');
    expect(detectCsvDelimiter('date\tamount\tdescription')).toBe('\t');
  });

  it('splits quoted CSV lines with escaped quotes', () => {
    expect(splitCsvLine('"2026-05-28";"12,50";"Achat ""test"""', ';')).toEqual([
      '2026-05-28',
      '12,50',
      'Achat "test"',
    ]);
  });

  it('previews headers and up to seven rows', () => {
    const csv = [
      'Date;Montant;Libelle',
      '2026-05-01;10;A',
      '2026-05-02;20;B',
      '2026-05-03;30;C',
      '2026-05-04;40;D',
      '2026-05-05;50;E',
      '2026-05-06;60;F',
      '2026-05-07;70;G',
      '2026-05-08;80;H',
    ].join('\n');

    const preview = parseCsvPreview(csv);

    expect(preview.headers).toEqual(['Date', 'Montant', 'Libelle']);
    expect(preview.rows).toHaveLength(7);
    expect(preview.rows[0]).toEqual({ Date: '2026-05-01', Montant: '10', Libelle: 'A' });
  });

  it('guesses columns with punctuation and case ignored', () => {
    expect(guessColumn(['Date operation', 'Montant EUR'], ['date_operation', 'date'])).toBe('Date operation');
    expect(guessColumn(['Date operation', 'Montant EUR'], ['amount', 'montanteur'])).toBe('Montant EUR');
    expect(guessColumn(['Foo'], ['bar'])).toBe('');
  });
});
