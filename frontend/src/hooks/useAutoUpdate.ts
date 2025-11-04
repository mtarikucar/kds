import { useState, useEffect, useCallback } from 'react';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

interface UpdateState {
  available: boolean;
  version?: string;
  downloading: boolean;
  error?: string;
  currentVersion?: string;
}

export const useAutoUpdate = (checkOnMount = true) => {
  const [updateState, setUpdateState] = useState<UpdateState>({
    available: false,
    downloading: false,
  });
  const [update, setUpdate] = useState<Update | null>(null);

  const checkForUpdates = useCallback(async () => {
    try {
      console.log('🔍 Checking for updates...');
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
    if (!update) {
      console.error('❌ No update available to install');
      return;
    }

    try {
      setUpdateState((prev) => ({ ...prev, downloading: true, error: undefined }));

      console.log('⬇️ Downloading and installing update...');

      // Download and install the update
      await update.downloadAndInstall((event) => {
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

      // Relaunch the application to apply the update
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
    if (checkOnMount) {
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
