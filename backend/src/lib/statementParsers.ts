// Parseurs de relevés bancaires OFX et QIF, purs et testés. Ils extraient des
// lignes brutes { dateRaw, amountRaw, description } ; la conversion date/montant
// est ensuite faite par le même pipeline que l'import CSV (parseDate /
// parseSignedAmount) pour un comportement identique (dédup, catégorisation…).

export interface RawStatementRow {
  dateRaw: string;
  amountRaw: string;
  description: string;
}

// OFX (SGML/XML des banques) : on lit les blocs <STMTTRN>…</STMTTRN> et, dans
// chacun, la valeur d'un tag = ce qui suit <TAG> jusqu'au prochain < ou saut de
// ligne (les tags OFX ne sont pas toujours fermés). DTPOSTED = AAAAMMJJ[hhmmss].
export function parseOfx(content: string): RawStatementRow[] {
  const rows: RawStatementRow[] = [];
  const blocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  const tag = (block: string, name: string): string | null => {
    const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1]!.trim() : null;
  };
  for (const block of blocks) {
    const posted = tag(block, 'DTPOSTED');
    const amount = tag(block, 'TRNAMT');
    if (!posted || !amount) continue;
    const name = tag(block, 'NAME') ?? '';
    const memo = tag(block, 'MEMO') ?? '';
    rows.push({
      dateRaw: posted.slice(0, 8), // AAAAMMJJ
      amountRaw: amount,
      description: [name, memo].filter(Boolean).join(' — ').trim(),
    });
  }
  return rows;
}

// QIF : enregistrements séparés par une ligne `^`. Champs : D=date, T ou U=montant,
// P=bénéficiaire, M=mémo. La date QIF est ambiguë (jj/mm vs mm/jj) → on garde la
// valeur brute, le format est choisi à l'import comme pour le CSV.
export function parseQif(content: string): RawStatementRow[] {
  const rows: RawStatementRow[] = [];
  let cur: { date?: string; amount?: string; payee?: string; memo?: string } = {};
  const flush = () => {
    if (cur.date && cur.amount) {
      rows.push({
        dateRaw: cur.date,
        amountRaw: cur.amount,
        description: [cur.payee, cur.memo].filter(Boolean).join(' — ').trim(),
      });
    }
    cur = {};
  };
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('!')) continue; // en-tête !Type:…
    const code = line[0];
    const value = line.slice(1).trim();
    switch (code) {
      case '^': flush(); break;
      case 'D': cur.date = value; break;
      case 'T': case 'U': cur.amount = value; break;
      case 'P': cur.payee = value; break;
      case 'M': cur.memo = value; break;
      default: break;
    }
  }
  flush(); // dernier enregistrement sans `^` final
  return rows;
}
