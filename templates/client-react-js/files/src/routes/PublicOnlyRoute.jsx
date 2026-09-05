/**
 * The mirror of `ProtectedRoute`: keeps a signed-in user off the sign-in and sign-up pages.
 *
 * Without it, a reload on `/login` while already authenticated renders a form the user cannot
 * meaningfully submit, and submitting it would rotate a perfectly good session.
 */
import { Navigate } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';

export default function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (user !== null) return <Navigate to="/dashboard" replace />;

  return children;
}
