import { describe, it, expect } from 'vitest';
import { parseOfx, parseQif } from './statementParsers';

describe('parseOfx', () => {
  const ofx = `
OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240115120000
<TRNAMT>-42.50
<NAME>CARREFOUR
<MEMO>Courses
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240131
<TRNAMT>1800.00
<NAME>SALAIRE
</STMTTRN>
</BANKTRANLIST></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it('extracts transactions with date, amount and description', () => {
    const rows = parseOfx(ofx);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ dateRaw: '20240115', amountRaw: '-42.50', description: 'CARREFOUR — Courses' });
    expect(rows[1]).toEqual({ dateRaw: '20240131', amountRaw: '1800.00', description: 'SALAIRE' });
  });

  it('returns nothing for content without transactions', () => {
    expect(parseOfx('<OFX></OFX>')).toHaveLength(0);
  });
});

describe('parseQif', () => {
  const qif = `!Type:Bank
D15/01/2024
T-42,50
PCARREFOUR
MCourses
^
D31/01/2024
T1800.00
PSALAIRE
^`;

  it('extracts records split on ^', () => {
    const rows = parseQif(qif);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ dateRaw: '15/01/2024', amountRaw: '-42,50', description: 'CARREFOUR — Courses' });
    expect(rows[1]).toEqual({ dateRaw: '31/01/2024', amountRaw: '1800.00', description: 'SALAIRE' });
  });

  it('flushes a trailing record without a final ^', () => {
    expect(parseQif('D01/02/2024\nT-5.00\nPCafé')).toHaveLength(1);
  });

  it('ignores the type header', () => {
    expect(parseQif('!Type:Bank\n')).toHaveLength(0);
  });
});
