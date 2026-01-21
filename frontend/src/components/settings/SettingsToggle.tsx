import { cn } from '../../lib/utils';
import { Switch } from '../ui/switch';
import { AlertTriangle } from 'lucide-react';

interface SettingsToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  warning?: string;
  className?: string;
}

export function SettingsToggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  warning,
  className,
}: SettingsToggleProps) {
  const handleClick = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 py-3 px-1',
        disabled && 'opacity-50',
        className
      )}
    >
      <div
        className={cn(
          'flex-1 min-w-0',
          !disabled && 'cursor-pointer'
        )}
        onClick={handleClick}
      >
        <p className="text-sm font-medium text-slate-900">{label}</p>
        {description && (
          <p className="text-sm text-slate-500 mt-0.5">{description}</p>
        )}
        {warning && (
          <p className="flex items-center gap-1.5 text-xs text-amber-600 mt-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {warning}
          </p>
        )}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        size="sm"
        className="flex-shrink-0 mt-0.5"
      />
    </div>
  );
}

interface SettingsSelectProps {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  className?: string;
}

export function SettingsSelect({
  label,
  description,
  value,
  onChange,
  options,
  disabled = false,
  className,
}: SettingsSelectProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 py-3 px-1',
        disabled && 'opacity-50',
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        {description && (
          <p className="text-sm text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex-shrink-0 min-w-[140px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 disabled:bg-slate-50 disabled:cursor-not-allowed"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface SettingsInputProps {
  label: string;
  description?: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'time' | 'number' | 'email';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}

export function SettingsInput({
  label,
  description,
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled = false,
  className,
  inputClassName,
}: SettingsInputProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 py-3 px-1',
        disabled && 'opacity-50',
        className
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        {description && (
          <p className="text-sm text-slate-500 mt-0.5">{description}</p>
        )}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          'flex-shrink-0 min-w-[140px] px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 disabled:bg-slate-50 disabled:cursor-not-allowed',
          inputClassName
        )}
      />
    </div>
  );
}

export default SettingsToggle;
