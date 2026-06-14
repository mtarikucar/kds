import { HexColorPicker } from 'react-colorful';

interface ColorPickerButtonProps {
  label: string;
  /** Current hex value for this color slot. */
  value: string;
  /** Whether this picker's popover is currently open. */
  isOpen: boolean;
  /** Toggle this picker open/closed. */
  onToggle: () => void;
  /** Close this picker (used by the backdrop click). */
  onClose: () => void;
  /** Emit a new hex value as the user drags the picker. */
  onChange: (color: string) => void;
}

/**
 * Single color slot (swatch + label + popover hex picker).
 *
 * Previously declared inline inside DesignEditor's render body, which gave it a
 * fresh component identity on every parent render — so React remounted it on
 * every keystroke/state change and the open picker lost focus. Hoisting it to
 * module level keeps its identity stable across renders while preserving the
 * exact same markup and behavior; all state still lives in the parent and is
 * threaded through props.
 */
const ColorPickerButton = ({
  label,
  value,
  isOpen,
  onToggle,
  onClose,
  onChange,
}: ColorPickerButtonProps) => (
  <div className="relative">
    <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
    <button
      type="button"
      onClick={onToggle}
      className="w-full h-10 rounded border-2 border-slate-300 flex items-center gap-2 px-3 hover:border-blue-500"
    >
      <div
        className="w-6 h-6 rounded border border-slate-300"
        style={{ backgroundColor: value }}
      />
      <span className="text-sm font-mono">{value}</span>
    </button>
    {isOpen && (
      <div className="absolute z-10 mt-2">
        <div
          className="fixed inset-0"
          onClick={onClose}
        />
        <div className="relative bg-white p-3 rounded-lg shadow-lg border border-slate-200">
          <HexColorPicker
            color={value}
            onChange={onChange}
          />
        </div>
      </div>
    )}
  </div>
);

export default ColorPickerButton;
