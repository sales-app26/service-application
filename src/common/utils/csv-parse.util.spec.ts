import { toCsv } from './csv.util';
import { parseCsv } from './csv-parse.util';

describe('parseCsv', () => {
  it('reads plain rows, with LF or CRLF line ends and a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips the byte-order mark Excel writes', () => {
    expect(parseCsv('﻿name,phone\nAsha,9876543210')).toEqual([
      ['name', 'phone'],
      ['Asha', '9876543210'],
    ]);
  });

  it('handles quoted cells: commas, doubled quotes and line breaks inside', () => {
    expect(parseCsv('name,notes\n"Patil, Asha","said ""call back""\nafter 4"\n')).toEqual([
      ['name', 'notes'],
      ['Patil, Asha', 'said "call back"\nafter 4'],
    ]);
  });

  it('keeps empty cells and drops fully empty lines', () => {
    expect(parseCsv('a,b,c\n\n1,,3\n,,\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('reads a last row that has no line end', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads back what toCsv writes', () => {
    const rows = [
      ['Asha "A" Patil', 'x,y'],
      ['line\nbreak', ''],
    ];
    expect(parseCsv(toCsv(['name', 'note'], rows))).toEqual([['name', 'note'], ...rows]);
  });

  it('returns nothing for an empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});
