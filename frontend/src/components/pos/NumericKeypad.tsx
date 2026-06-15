import { Delete } from 'lucide-react';
import { appendKey } from './numericKeypadLogic';

interface NumericKeypadProps {
  /** Current raw string value being edited (e.g. "12.50"). */
  value: string;
  /** Called with the next raw string value after a key press. */
  onChange: (next: string) => void;
  /** Optional aria-label for the whole pad. */
  ariaLabel?: string;
}

/**
 * Append-style decimal keypad for cash entry. Pure string transforms (in
 * numericKeypadLogic.appendKey) so it stays controlled by the parent; the
 * parent owns parsing/validation. Big (>=44px) touch targets for tablet/
 * terminal use.
 */
const KEYS: string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

const NumericKeypad = ({ value, onChange, ariaLabel }: NumericKeypadProps) => {
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={ariaLabel}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(appendKey(value, key))}
          aria-label={key === 'back' ? 'backspace' : key}
          className={`h-14 min-h-[44px] rounded-xl text-xl font-semibold flex items-center justify-center transition-all duration-150 active:scale-95 ${
            key === 'back'
              ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              : 'bg-white border border-slate-200 text-slate-900 hover:border-primary-300 hover:bg-primary-50/50 shadow-sm'
          }`}
        >
          {key === 'back' ? <Delete className="h-6 w-6" /> : key}
        </button>
      ))}
    </div>
  );
};

export default NumericKeypad;
