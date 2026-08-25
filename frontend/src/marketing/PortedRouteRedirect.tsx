import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Sends a ported marketing path to the marketing site with a real navigation.
 *
 * nginx already 301s /ozellikler* and /cozumler* to landing, which covers a
 * crawler, a pasted URL and a bookmark. It does NOT cover a visitor already
 * inside the SPA: react-router intercepts `<Link to="/ozellikler/...">` on the
 * client, so the browser never issues an HTTP request and nginx never sees it.
 * Without this component a visitor who lands on the apex and clicks through the
 * marketing nav still reaches the old client-rendered pages — including the
 * module page whose copy was withdrawn because the feature behind it is off.
 *
 * `replace` rather than `assign` so the back button returns to where the
 * visitor actually came from instead of bouncing them forward again.
 */
const LANDING_ORIGIN = (
  import.meta.env.VITE_LANDING_URL || 'https://landing.hummytummy.com'
).replace(/\/+$/, '');

export default function PortedRouteRedirect() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    window.location.replace(`${LANDING_ORIGIN}/tr${pathname}${search}`);
  }, [pathname, search]);

  // Nothing renders: this is a navigation, and a flash of placeholder content
  // would be visible for the moment before the browser leaves.
  return null;
}
