import PublicReservationContainer from '../../features/reservations/public/PublicReservationContainer';

/**
 * Thin route wrapper. The wizard's implementation lives in
 * `features/reservations/public/` so the heavy lifting can be
 * tested in isolation without the route boilerplate. See that
 * directory's README (or PublicReservationContainer.tsx header) for
 * the architecture.
 */
const PublicReservationPage: React.FC = () => <PublicReservationContainer />;

export default PublicReservationPage;
