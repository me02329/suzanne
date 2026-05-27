export interface CsvPreview {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export function parseCsvPreview(csv: string): CsvPreview {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const delimiter = detectCsvDelimiter(lines[0]!);
  const headers = splitCsvLine(lines[0]!, delimiter);
  const rows = lines.slice(1, 8).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    return headers.reduce<Record<string, string>>((row, header, idx) => {
      row[header] = cells[idx] ?? '';
      return row;
    }, {});
  });
  return { headers, rows };
}

export function detectCsvDelimiter(header: string): string {
  return ['\t', ';', ','].map((delimiter) => ({ delimiter, count: header.split(delimiter).length })).sort((a, b) => b.count - a.count)[0]?.delimiter ?? ',';
}

export function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else current += char;
    } else if (char === '"') inQuotes = true;
    else if (char === delimiter) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

export function guessColumn(headers: string[], candidates: string[]): string {
  const normalized = new Map(headers.map((header) => [header.trim().toLowerCase().replace(/[^a-z0-9]/g, ''), header]));
  for (const candidate of candidates) {
    const header = normalized.get(candidate.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (header) return header;
  }
  return '';
}
