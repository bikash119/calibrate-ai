/**
 * Tiny CSV parser. Handles:
 *   - quoted cells with embedded commas, newlines, and escaped quotes ("")
 *   - CRLF and LF line endings
 *   - empty cells
 *
 * Returns rows as Record<headerKey, cellValue>. The first non-empty row is
 * the header. Cells are strings; downstream callers cast to number/etc.
 *
 * Not a general-purpose CSV implementation — no support for alternate
 * delimiters, BOM stripping, or header-less mode. Adequate for the upload
 * paths in this app; if it ever bites, swap in papaparse.
 */

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
}

export class CsvParseError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(`${message} (line ${line})`);
    this.name = "CsvParseError";
    this.line = line;
  }
}

export function parseCsv(text: string): CsvParseResult {
  const cells = tokenize(text);
  if (cells.length === 0) {
    return { headers: [], rows: [] };
  }
  const [header, ...dataRows] = cells;
  const headers = header.map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => h.length === 0)) {
    throw new CsvParseError("CSV has no headers", 1);
  }
  // Reject duplicate headers — they would silently overwrite each other
  const seen = new Set<string>();
  for (const h of headers) {
    if (seen.has(h)) throw new CsvParseError(`Duplicate header: '${h}'`, 1);
    seen.add(h);
  }

  const rows: Record<string, string>[] = [];
  for (const row of dataRows) {
    if (row.length === 1 && row[0] === "") continue; // skip blank lines
    const obj: Record<string, string> = {};
    headers.forEach((h, j) => {
      obj[h] = (row[j] ?? "").trim();
    });
    rows.push(obj);
  }

  return { headers, rows };
}

// ------------------------------------------------------------------ //

function tokenize(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  let line = 1;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      // swallow; will be handled by \n on next iteration if present
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      line++;
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (inQuotes) {
    throw new CsvParseError("Unterminated quoted cell", line);
  }
  // Trailing cell / row
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
