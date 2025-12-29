import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '../../i18n/config';
import api from '../../lib/api';

// Types
export interface PublicStats {
  totalViews: number;
  uniqueVisitors: number;
  totalReviews: number;
  averageRating: number;
  totalTenants: number;
  countryDistribution: Record<string, number>;
  cityDistribution: Record<string, number>;
  viewsToday: number;
  viewsThisWeek: number;
  viewsThisMonth: number;
  lastUpdated: string;
}

export interface PublicReview {
  id: string;
  name: string;
  restaurant?: string;
  rating: number;
  comment: string;
  avatar?: string;
  isVerified: boolean;
  createdAt: string;
}

export interface TrackViewData {
  page: string;
  path: string;
  referrer?: string;
  sessionId?: string;
}

export interface SubmitReviewData {
  name: string;
  email: string;
  restaurant?: string;
  rating: number;
  comment: string;
}

// Query Keys
export const publicStatsKeys = {
  all: ['public-stats'] as const,
  stats: () => [...publicStatsKeys.all, 'stats'] as const,
  reviews: (limit?: number) => [...publicStatsKeys.all, 'reviews', limit] as const,
};

// Track page view (fire and forget)
export const useTrackPageView = () => {
  return useMutation({
    mutationFn: async (data: TrackViewData) => {
      const response = await api.post('/public-stats/track', data);
      return response.data;
    },
    // Silent - no toast notifications
  });
};

// Get public statistics
export const usePublicStats = () => {
  return useQuery({
    queryKey: publicStatsKeys.stats(),
    queryFn: async (): Promise<PublicStats> => {
      const response = await api.get('/public-stats/stats');
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
};

// Get approved reviews
export const usePublicReviews = (limit = 10) => {
  return useQuery({
    queryKey: publicStatsKeys.reviews(limit),
    queryFn: async (): Promise<PublicReview[]> => {
      const response = await api.get(`/public-stats/reviews?limit=${limit}`);
      return response.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
};

// Submit a review
export const useSubmitReview = () => {
  return useMutation({
    mutationFn: async (data: SubmitReviewData) => {
      const response = await api.post('/public-stats/reviews', data);
      return response.data;
    },
    onSuccess: () => {
      toast.success(i18n.t('common:landing.reviewSubmitted'));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || i18n.t('common:notifications.operationFailed'));
    },
  });
};
