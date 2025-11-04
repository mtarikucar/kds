import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Monitor, CheckCircle, AlertCircle, Clock, ExternalLink, Loader2 } from 'lucide-react';
import { useLatestRelease, getPlatformInfo, trackDownload } from '../../features/desktop-app/desktopAppApi';

const DesktopAppSettingsPage = () => {
  const { t } = useTranslation('settings');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('windows');

  const { data: latestRelease, isLoading, error } = useLatestRelease();
  const platforms = getPlatformInfo(latestRelease);

  const handleDownload = async (platform: typeof platforms[0]) => {
    if (!platform.downloadUrl) {
      alert('Download not available for this platform yet.');
      return;
    }

    // Track download analytics
    if (latestRelease) {
      await trackDownload(latestRelease.version, platform.id);
    }

    // Start download
    window.open(platform.downloadUrl, '_blank');
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
            <p className="text-gray-600">Loading desktop app information...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-6 w-6 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-900 mb-1">No Desktop Releases Available</h3>
              <p className="text-yellow-800 text-sm">
                Desktop app releases haven't been published yet. Please check back later or contact support.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Monitor className="h-8 w-8 text-blue-600" />
          <h1 className="text-3xl font-bold text-gray-900">{t('desktopApp')}</h1>
        </div>
        <p className="text-gray-600">{t('desktopAppDesc')}</p>
      </div>

      {/* Latest Version Banner */}
      {latestRelease && (
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-6 mb-8 text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="h-5 w-5" />
                <span className="text-sm font-medium opacity-90">Latest Version</span>
              </div>
              <h2 className="text-4xl font-bold mb-1">v{latestRelease.version}</h2>
              <p className="text-blue-100 text-sm">
                Released {new Date(latestRelease.pubDate).toLocaleDateString()}
              </p>
            </div>
            <Download className="h-16 w-16 opacity-20" />
          </div>
        </div>
      )}

      {/* Platform Selection */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{t('selectPlatform')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {platforms.map((platform) => (
            <button
              key={platform.id}
              onClick={() => setSelectedPlatform(platform.id)}
              className={`text-left p-6 rounded-xl border-2 transition-all hover:shadow-lg ${
                selectedPlatform === platform.id
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-4xl">{platform.icon}</span>
                  <div>
                    <h4 className="font-semibold text-gray-900">{platform.name}</h4>
                    <p className="text-sm text-gray-600">{platform.description}</p>
                  </div>
                </div>
                {selectedPlatform === platform.id && (
                  <CheckCircle className="h-6 w-6 text-blue-600" />
                )}
              </div>
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
                <span className="text-sm text-gray-500">{platform.fileSize}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(platform);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download
                </button>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Installation Instructions */}
      <div className="bg-gray-50 rounded-xl p-6 mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-blue-600" />
          {t('installInstructions')}
        </h3>
        <div className="space-y-4">
          {selectedPlatform === 'windows' && (
            <ol className="list-decimal list-inside space-y-2 text-gray-700">
              <li>Download the Windows installer (.msi or .exe)</li>
              <li>Run the installer and follow the setup wizard</li>
              <li>Launch HummyTummy KDS from the Start menu or desktop shortcut</li>
              <li>The app will automatically check for updates on startup</li>
            </ol>
          )}
          {selectedPlatform === 'linux' && (
            <ol className="list-decimal list-inside space-y-2 text-gray-700">
              <li>Download the Linux package (.AppImage)</li>
              <li>Make it executable with `chmod +x filename.AppImage` and run it</li>
              <li>Launch HummyTummy KDS from your applications menu</li>
              <li>The app will automatically check for updates on startup</li>
            </ol>
          )}
        </div>
      </div>

      {/* Features & Benefits */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <div className="h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
            <Monitor className="h-6 w-6 text-blue-600" />
          </div>
          <h4 className="font-semibold text-gray-900 mb-2">{t('offlineMode')}</h4>
          <p className="text-sm text-gray-600">{t('offlineModeDesc')}</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <div className="h-12 w-12 bg-green-100 rounded-lg flex items-center justify-center mb-4">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
          <h4 className="font-semibold text-gray-900 mb-2">{t('autoUpdates')}</h4>
          <p className="text-sm text-gray-600">{t('autoUpdatesDesc')}</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <div className="h-12 w-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
            <Clock className="h-6 w-6 text-purple-600" />
          </div>
          <h4 className="font-semibold text-gray-900 mb-2">{t('betterPerformance')}</h4>
          <p className="text-sm text-gray-600">{t('betterPerformanceDesc')}</p>
        </div>
      </div>

      {/* Release Notes */}
      {latestRelease && (
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <ExternalLink className="h-5 w-5 text-gray-600" />
            {t('releaseNotes')}
          </h3>
          <div className="prose prose-sm max-w-none text-gray-700">
            <p className="whitespace-pre-wrap">{latestRelease.releaseNotes}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default DesktopAppSettingsPage;
