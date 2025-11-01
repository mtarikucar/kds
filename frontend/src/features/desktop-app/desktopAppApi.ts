import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';

export interface DesktopRelease {
  id: string;
  version: string;
  releaseTag: string;
  published: boolean;
  pubDate: string;
  windowsUrl?: string;
  windowsSignature?: string;
  macArmUrl?: string;
  macArmSignature?: string;
  macIntelUrl?: string;
  macIntelSignature?: string;
  linuxUrl?: string;
  linuxSignature?: string;
  releaseNotes: string;
  changelog?: string;
  downloadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformInfo {
  id: string;
  name: string;
  icon: string;
  description: string;
  fileSize: string;
  downloadUrl?: string;
}

// Get latest published release
export const useLatestRelease = () => {
  return useQuery({
    queryKey: ['desktop-app', 'latest'],
    queryFn: async (): Promise<DesktopRelease> => {
      const response = await api.get('/desktop/releases/latest');
      return response.data;
    },
    retry: 1,
  });
};

// Get all published releases
export const usePublishedReleases = () => {
  return useQuery({
    queryKey: ['desktop-app', 'published'],
    queryFn: async (): Promise<DesktopRelease[]> => {
      const response = await api.get('/desktop/releases/published');
      return response.data;
    },
  });
};

// Track download
export const trackDownload = async (version: string, platform: string) => {
  try {
    await api.post(`/desktop/releases/${version}/download/${platform}`);
  } catch (error) {
    console.error('Failed to track download:', error);
  }
};

// Get platform-specific download URL and info
export const getPlatformInfo = (release: DesktopRelease | undefined): PlatformInfo[] => {
  if (!release) {
    return [
      {
        id: 'windows',
        name: 'Windows',
        icon: '🪟',
        description: 'Windows 10/11 (64-bit)',
        fileSize: '-',
        downloadUrl: undefined,
      },
      {
        id: 'mac-arm',
        name: 'macOS (Apple Silicon)',
        icon: '🍎',
        description: 'macOS 11+ (M1/M2/M3)',
        fileSize: '-',
        downloadUrl: undefined,
      },
      {
        id: 'mac-intel',
        name: 'macOS (Intel)',
        icon: '🍎',
        description: 'macOS 10.15+',
        fileSize: '-',
        downloadUrl: undefined,
      },
      {
        id: 'linux',
        name: 'Linux',
        icon: '🐧',
        description: 'Ubuntu/Debian (64-bit)',
        fileSize: '-',
        downloadUrl: undefined,
      },
    ];
  }

  return [
    {
      id: 'windows',
      name: 'Windows',
      icon: '🪟',
      description: 'Windows 10/11 (64-bit)',
      fileSize: release.windowsUrl ? '85 MB' : '-',
      downloadUrl: release.windowsUrl,
    },
    {
      id: 'mac-arm',
      name: 'macOS (Apple Silicon)',
      icon: '🍎',
      description: 'macOS 11+ (M1/M2/M3)',
      fileSize: release.macArmUrl ? '78 MB' : '-',
      downloadUrl: release.macArmUrl,
    },
    {
      id: 'mac-intel',
      name: 'macOS (Intel)',
      icon: '🍎',
      description: 'macOS 10.15+',
      fileSize: release.macIntelUrl ? '82 MB' : '-',
      downloadUrl: release.macIntelUrl,
    },
    {
      id: 'linux',
      name: 'Linux',
      icon: '🐧',
      description: 'Ubuntu/Debian (64-bit)',
      fileSize: release.linuxUrl ? '90 MB' : '-',
      downloadUrl: release.linuxUrl,
    },
  ];
};
