/**
 * Gate for routes that require a signed-in user.
 *
 * Nothing is rendered while the session is being restored. That is not laziness: rendering the
 * children first would flash private chrome to a signed-out visitor, and redirecting first would
 * bounce a signed-in user to the sign-in page on every reload, because the in-memory token is
 * always absent for the first few milliseconds after load.
 */
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;

  // `state` carries where they were headed, so signing in returns them there instead of to a
  // generic landing page.
  if (user === null) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return children;
}
