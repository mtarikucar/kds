import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTrackPageView } from '../features/landing/publicStatsApi';

export const usePageTracking = () => {
  const location = useLocation();
  const { mutate: trackView } = useTrackPageView();

  useEffect(() => {
    // Get or create session ID
    let sessionId = sessionStorage.getItem('kds_session_id');
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem('kds_session_id', sessionId);
    }

    // Determine page name from path
    const pageName = location.pathname === '/' ? 'landing' : location.pathname.slice(1).replace(/\//g, '-');

    trackView({
      page: pageName,
      path: location.pathname + location.search,
      referrer: document.referrer || undefined,
      sessionId,
    });
  }, [location.pathname, trackView]);
};
