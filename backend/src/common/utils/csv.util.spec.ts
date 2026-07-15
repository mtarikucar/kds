import { toCsv } from './csv.util';

describe('toCsv', () => {
  it('joins headers and rows with commas + newlines', () => {
    const csv = toCsv(['date', 'sales'], [
      ['2026-06-01', 1200],
      ['2026-06-02', 900],
    ]);
    expect(csv).toBe('date,sales\n2026-06-01,1200\n2026-06-02,900');
  });

  it('quotes and escapes values containing comma, quote or newline (RFC 4180)', () => {
    const csv = toCsv(['name', 'note'], [
      ['Ali, Veli', 'said "hi"'],
      ['line\nbreak', 'ok'],
    ]);
    expect(csv).toBe(
      'name,note\n"Ali, Veli","said ""hi"""\n"line\nbreak",ok',
    );
  });

  it('renders null/undefined as empty cells', () => {
    expect(toCsv(['a', 'b'], [[null, undefined]])).toBe('a,b\n,');
  });

  describe('formula-injection defence', () => {
    it("prefixes a string cell starting with a formula char (= + - @) with a quote", () => {
      const csv = toCsv(
        ['name'],
        [['=HYPERLINK("http://evil","x")'], ['+1+1'], ['-cmd'], ['@SUM(A1)']],
      );
      // Each dangerous string is prefixed with ' → then RFC-quoted because it
      // now contains a comma/quote (the HYPERLINK one) or stays bare.
      const lines = csv.split('\n');
      expect(lines[1]).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
      expect(lines[2]).toBe(`'+1+1`);
      expect(lines[3]).toBe(`'-cmd`);
      expect(lines[4]).toBe(`'@SUM(A1)`);
    });

    it('leaves a NEGATIVE NUMBER untouched (must not become text)', () => {
      // Regression guard: an over/short of -50 is a number, not an injection.
      const csv = toCsv(['overShort'], [[-50]]);
      expect(csv).toBe('overShort\n-50');
    });

    it('does not prefix a benign string that merely contains a formula char later', () => {
      expect(toCsv(['x'], [['a=b']])).toBe('x\na=b');
    });

    it('quotes a cell containing a lone carriage return', () => {
      expect(toCsv(['x'], [['a\rb']])).toBe('x\n"a\rb"');
    });
  });
});
