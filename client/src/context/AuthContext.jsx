/**
 * Authentication state for the client.
 *
 * Holds the signed-in user and exposes `can()` for navigation and control
 * visibility. To be explicit about what that is: hiding a button is a
 * convenience, not a protection. Every one of these permission codes is
 * enforced again on the server, which re-reads the user's roles from the
 * database on every single request.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { auth as authApi } from '../services/erp.js';
import { setSessionLostHandler, tokenStore } from '../services/api.js';
import { forgetDataTransferCatalogues } from '../components/dataTransfer.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authenticated | anonymous
  const mounted = useRef(true);

  // StrictMode mounts, unmounts, then remounts in development. Without setting
  // this back to true on the way in, the remounted hook still believes it is
  // dead and drops its own results - the session check never finishing.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const signOutLocally = useCallback(() => {
    tokenStore.clear();
    /*
     * The export and import catalogues are "what MAY this user download or
     * import", cached in a module variable for the whole session. Left behind
     * at sign-out they would be the previous user's answer, and the next person
     * to sign in on a shared factory machine would see buttons for tables their
     * own role cannot read. The server would refuse each one - it re-reads
     * permissions on every request - but offering a button that is then refused
     * is its own kind of wrong.
     */
    forgetDataTransferCatalogues();
    if (mounted.current) {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  // The axios layer calls this when a refresh fails.
  useEffect(() => {
    setSessionLostHandler(signOutLocally);
  }, [signOutLocally]);

  // Restore the session on first load.
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!tokenStore.access) {
        if (!cancelled) setStatus('anonymous');
        return;
      }
      try {
        const me = await authApi.me();
        if (!cancelled) {
          setUser(me);
          setStatus('authenticated');
        }
      } catch {
        if (!cancelled) signOutLocally();
      }
    }
    restore();
    return () => { cancelled = true; };
  }, [signOutLocally]);

  const login = useCallback(async (credentials) => {
    const result = await authApi.login(credentials);
    tokenStore.set(result);
    setUser(result.user);
    setStatus('authenticated');
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The session may already be gone server-side; sign out locally regardless.
    }
    signOutLocally();
  }, [signOutLocally]);

  const refreshUser = useCallback(async () => {
    const me = await authApi.me();
    setUser(me);
    return me;
  }, []);

  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user]);
  const isAdmin = useMemo(() => (user?.roleCodes ?? []).includes('ADMIN'), [user]);

  /** True if the user holds ANY of the given permission codes. */
  const can = useCallback(
    (...codes) => {
      if (!user) return false;
      if (isAdmin) return true;
      return codes.flat().some((code) => permissions.has(code));
    },
    [user, isAdmin, permissions],
  );

  const hasRole = useCallback(
    (...codes) => {
      if (!user) return false;
      return codes.flat().some((code) => (user.roleCodes ?? []).includes(code));
    },
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated',
      isLoading: status === 'loading',
      mustChangePassword: Boolean(user?.mustChangePassword),
      isAdmin,
      can,
      hasRole,
      login,
      logout,
      refreshUser,
    }),
    [user, status, isAdmin, can, hasRole, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}

export default AuthContext;
