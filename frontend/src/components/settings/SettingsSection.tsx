import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { SaveStatusIndicator } from '../ui/SaveStatusIndicator';
import Button from '../ui/Button';
import type { AutoSaveStatus } from '../../hooks/useAutoSave';

interface SettingsSectionProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  saveStatus?: AutoSaveStatus;
  onRetry?: () => void;
  requireManualSave?: boolean;
  onSave?: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
  saveLabel?: string;
  className?: string;
}

export function SettingsSection({
  title,
  description,
  icon,
  children,
  saveStatus,
  onRetry,
  requireManualSave = false,
  onSave,
  isSaving = false,
  hasChanges = false,
  saveLabel = 'Save',
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn('bg-white rounded-xl border border-slate-200', className)}>
      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-start gap-3">
          {icon && (
            <div className="flex-shrink-0 p-2 bg-slate-100 rounded-lg text-slate-600">
              {icon}
            </div>
          )}
          <div>
            <h3 className="text-base font-semibold text-slate-900">{title}</h3>
            {description && (
              <p className="text-sm text-slate-500 mt-0.5">{description}</p>
            )}
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex-shrink-0">
          {saveStatus && !requireManualSave && (
            <SaveStatusIndicator status={saveStatus} onRetry={onRetry} />
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-4">{children}</div>

      {/* Manual save footer */}
      {requireManualSave && onSave && (
        <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-t border-slate-100 rounded-b-xl">
          <div className="flex items-center gap-2">
            {saveStatus && (
              <SaveStatusIndicator status={saveStatus} onRetry={onRetry} />
            )}
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            isLoading={isSaving}
            disabled={!hasChanges || isSaving}
          >
            {saveLabel}
          </Button>
        </div>
      )}
    </section>
  );
}

interface SettingsDividerProps {
  className?: string;
}

export function SettingsDivider({ className }: SettingsDividerProps) {
  return <hr className={cn('border-slate-100 my-4', className)} />;
}

interface SettingsGroupProps {
  title?: string;
  children: ReactNode;
  className?: string;
}

export function SettingsGroup({ title, children, className }: SettingsGroupProps) {
  return (
    <div className={className}>
      {title && (
        <h4 className="text-sm font-medium text-slate-700 mb-3">{title}</h4>
      )}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export default SettingsSection;
