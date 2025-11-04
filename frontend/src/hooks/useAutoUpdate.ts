import { useState, useEffect, useCallback } from 'react';

interface UpdateState {
  available: boolean;
  version?: string;
  downloading: boolean;
  error?: string;
  currentVersion?: string;
}

// Check if running in Tauri environment
const isTauri = () => {
  return typeof window !== 'undefined' && '__TAURI__' in window;
};

export const useAutoUpdate = (checkOnMount = true) => {
  const [updateState, setUpdateState] = useState<UpdateState>({
    available: false,
    downloading: false,
  });
  const [update, setUpdate] = useState<any>(null);

  const checkForUpdates = useCallback(async () => {
    // Only run in Tauri environment
    if (!isTauri()) {
      console.log('⚠️ Auto-update is only available in desktop app');
      return;
    }

    try {
      console.log('🔍 Checking for updates...');

      // Dynamically import Tauri plugins
      const { check } = await import('@tauri-apps/plugin-updater');
      const updateInfo = await check();

      if (updateInfo) {
        console.log('✅ Update available:', {
          version: updateInfo.version,
          currentVersion: updateInfo.currentVersion,
          date: updateInfo.date,
          body: updateInfo.body,
        });

        setUpdate(updateInfo);
        setUpdateState({
          available: true,
          version: updateInfo.version,
          currentVersion: updateInfo.currentVersion,
          downloading: false,
        });
      } else {
        console.log('✅ App is up to date');
        setUpdateState({
          available: false,
          downloading: false,
        });
      }
    } catch (error) {
      console.error('❌ Failed to check for updates:', error);
      setUpdateState((prev) => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to check for updates',
      }));
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    // Only run in Tauri environment
    if (!isTauri()) {
      console.error('⚠️ Auto-update is only available in desktop app');
      return;
    }

    if (!update) {
      console.error('❌ No update available to install');
      return;
    }

    try {
      setUpdateState((prev) => ({ ...prev, downloading: true, error: undefined }));

      console.log('⬇️ Downloading and installing update...');

      // Download and install the update
      await update.downloadAndInstall((event: any) => {
        switch (event.event) {
          case 'Started':
            console.log(`📦 Update download started - ${event.data.contentLength} bytes`);
            break;
          case 'Progress':
            console.log(`⏳ Downloaded ${event.data.chunkLength} bytes`);
            break;
          case 'Finished':
            console.log('✅ Download finished');
            break;
        }
      });

      console.log('🔄 Restarting application...');

      // Dynamically import relaunch function
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      console.error('❌ Failed to download and install update:', error);
      setUpdateState((prev) => ({
        ...prev,
        downloading: false,
        error: error instanceof Error ? error.message : 'Failed to install update',
      }));
    }
  }, [update]);

  // Check for updates on mount if enabled
  useEffect(() => {
    if (checkOnMount && isTauri()) {
      // Delay check by 3 seconds to avoid blocking app startup
      const timer = setTimeout(() => {
        checkForUpdates();
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [checkOnMount, checkForUpdates]);

  return {
    ...updateState,
    checkForUpdates,
    downloadAndInstall,
  };
};
