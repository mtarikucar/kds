import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useEffect } from 'react';
import i18n from '../../i18n/config';
import api from '../../lib/api';
import { initializeNotificationSocket, disconnectNotificationSocket } from '../../lib/socket';
import { useAuthStore } from '../../store/authStore';

export const useNotifications = () => {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const response = await api.get('/notifications');
      return response.data;
    },
    // Removed polling - using WebSocket instead
    // Keep as fallback in case WebSocket fails
    refetchInterval: false,
  });
};

/**
 * Hook to initialize WebSocket connection for real-time notifications
 * Call this hook in your main layout or App component
 */
export const useNotificationSocket = () => {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((state) => !!state.accessToken);

  useEffect(() => {
    // Only initialize socket if user is authenticated
    if (!isAuthenticated) {
      return;
    }

    // Initialize notification socket with callback
    const socket = initializeNotificationSocket((notification) => {
      console.log('Received notification:', notification);

      // Show toast notification
      if (notification.type === 'SUCCESS') {
        toast.success(notification.title, {
          description: notification.message,
        });
      } else if (notification.type === 'INFO') {
        toast.info(notification.title, {
          description: notification.message,
        });
      } else if (notification.type === 'WARNING') {
        toast.warning(notification.title, {
          description: notification.message,
        });
      } else if (notification.type === 'ERROR') {
        toast.error(notification.title, {
          description: notification.message,
        });
      } else {
        toast(notification.title, {
          description: notification.message,
        });
      }

      // Update React Query cache to add new notification
      queryClient.setQueryData(['notifications'], (oldData: any) => {
        if (!oldData) return [notification];
        return [notification, ...oldData];
      });
    });

    // Cleanup on unmount or when authentication changes
    return () => {
      disconnectNotificationSocket();
    };
  }, [queryClient, isAuthenticated]);
};

export const useMarkAsRead = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await api.post(`/notifications/${notificationId}/read`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
};

export const useMarkAllAsRead = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await api.post('/notifications/mark-all-read');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success(i18n.t('common:notifications.allMarkedAsRead'));
    },
  });
};
