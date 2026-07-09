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
});
