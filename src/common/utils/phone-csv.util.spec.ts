import { csvCell, toCsv } from './csv.util';
import { normaliseIndianMobile, phoneSearchDigits } from './phone.util';

describe('normaliseIndianMobile (PRD §5.5)', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765-43210', '9876543210'],
    ['+919876543210', '9876543210'],
    ['919876543210', '9876543210'],
    ['098765 43210', '9876543210'],
    ['(987) 654-3210', '9876543210'],
  ])('%s → %s', (raw, expected) => {
    expect(normaliseIndianMobile(raw)).toBe(expected);
  });

  it.each(['12345', '5876543210', '98765432101', '+1 415 555 0100', 'abcdefghij', ''])(
    'refuses %s',
    (raw) => {
      expect(normaliseIndianMobile(raw)).toBeNull();
    },
  );

  it('finds a phone by a fragment typed with spaces', () => {
    expect(phoneSearchDigits('98765 43')).toBe('9876543');
    expect(phoneSearchDigits('sharma')).toBeNull();
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Sharma, Anil')).toBe('"Sharma, Anil"');
    expect(csvCell('said "yes"')).toBe('"said ""yes"""');
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('neutralises spreadsheet formulas typed into a note', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-5 discount')).toBe("'-5 discount");
  });

  it('leaves numbers alone, negative coordinates included', () => {
    expect(csvCell(-33.8688)).toBe('-33.8688');
    expect(csvCell(null)).toBe('');
  });

  it('starts with a UTF-8 BOM and uses CRLF', () => {
    const csv = toCsv(['a', 'b'], [[1, 'x']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('a,b\r\n1,x\r\n');
  });
});
