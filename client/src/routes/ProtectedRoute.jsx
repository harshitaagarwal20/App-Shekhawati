/**
 * Route protection.
 *
 * This gates NAVIGATION only. It stops a user wandering into a screen they
 * cannot use and seeing a wall of 403s - it is not a security control. The
 * server rejects the underlying request regardless of what the router allows,
 * and it is the server's decision that matters.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from '../components/ui.jsx';

function FullPageLoading() {
  return (
    <div className="auth-page">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <Spinner label="Loading your session..." />
      </div>
    </div>
  );
}

/** Requires a signed-in user. */
export function RequireAuth() {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullPageLoading />;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;

  // Seeded and admin-reset accounts must set their own password before they can
  // reach anything else. The server enforces the same rule.
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return <Outlet />;
}

/** Requires any one of `permissions` (or any one of `roles`). */
export function RequirePermission({ permissions = [], roles = [], children }) {
  const { can, hasRole } = useAuth();
  const allowed =
    (permissions.length === 0 && roles.length === 0) ||
    can(permissions) ||
    (roles.length > 0 && hasRole(roles));

  if (!allowed) return <Navigate to="/forbidden" replace />;
  return children ?? <Outlet />;
}

/** Redirects an already-signed-in user away from the login screen. */
export function RedirectIfAuthenticated({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <FullPageLoading />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return children;
}
