import React from 'react';
import { Download, AlertCircle, RefreshCw } from 'lucide-react';

interface UpdateDialogProps {
  available: boolean;
  version?: string;
  currentVersion?: string;
  downloading: boolean;
  error?: string;
  onUpdate: () => void;
  onDismiss: () => void;
}

export const UpdateDialog: React.FC<UpdateDialogProps> = ({
  available,
  version,
  currentVersion,
  downloading,
  error,
  onUpdate,
  onDismiss,
}) => {
  if (!available) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Download className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-white">Update Available</h3>
              <p className="text-blue-100 text-sm">A new version is ready to install</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6">
          {error ? (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-900">Update Failed</p>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3 px-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm text-gray-600">Current Version</p>
                  <p className="text-lg font-semibold text-gray-900">{currentVersion}</p>
                </div>
                <div className="text-gray-400">→</div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">New Version</p>
                  <p className="text-lg font-semibold text-blue-600">{version}</p>
                </div>
              </div>

              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-900">
                  This update includes the latest features, improvements, and security fixes.
                  The application will restart after the update is installed.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3">
          <button
            onClick={onDismiss}
            disabled={downloading}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {error ? 'Close' : 'Later'}
          </button>
          <button
            onClick={onUpdate}
            disabled={downloading}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {downloading ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Installing...
              </>
            ) : error ? (
              'Retry'
            ) : (
              <>
                <Download className="h-4 w-4" />
                Update Now
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
