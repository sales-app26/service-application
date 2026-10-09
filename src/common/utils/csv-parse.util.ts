/**
 * RFC 4180 CSV reader: quoted cells, doubled quotes, commas and line breaks inside
 * quotes, CRLF or LF, and a leading byte-order mark (what Excel writes).
 *
 * Cells are returned as text. Rows that are entirely empty are dropped, so a
 * trailing newline or a blank line in the middle never becomes a "lead".
 */
export const parseCsv = (input: string): string[][] => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  const endCell = (): void => {
    row.push(cell);
    cell = '';
  };
  const endRow = (): void => {
    endCell();
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') endCell();
    else if (char === '\n') endRow();
    else if (char === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRow();
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
};
