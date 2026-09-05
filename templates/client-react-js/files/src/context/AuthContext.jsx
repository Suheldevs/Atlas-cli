/**
 * Session state for the whole application.
 *
 * The access token is not here. It lives in `lib/api.js`, in a module variable, and this provider
 * only ever holds the *user*. Keeping them apart means no component can read a token by reaching
 * into context, and the one place that attaches credentials to a request stays the one place that
 * knows the credential.
 *
 * Restoring a session on load is a consequence of that split. A reload wipes the in-memory token,
 * so `GET /auth/me` starts unauthenticated and answers 401 — at which point the response
 * interceptor spends the `httpOnly` refresh cookie, retries, and the call succeeds. There is no
 * separate "am I logged in?" bootstrap because the interceptor already implements it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { clearAccessToken, http, onSessionExpired, setAccessToken } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Any request that ends in an unrecoverable 401 drops the user here, so a session that expires
  // in a background tab redirects to the sign-in page instead of leaving a shell with no data.
  useEffect(
    () =>
      onSessionExpired(() => {
        setUser(null);
      }),
    [],
  );

  useEffect(() => {
    let active = true;

    async function restore() {
      try {
        const payload = await http.get('/auth/me');
        if (active) setUser(payload?.user ?? null);
      } catch {
        // No cookie, an expired one, or a rejected rotation. All of them mean "signed out", and
        // none of them is worth showing the user on a page they have not asked for yet.
        clearAccessToken();
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    void restore();

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const payload = await http.post('/auth/login', credentials);
    setAccessToken(payload.accessToken);
    setUser(payload.user);
    return payload.user;
  }, []);

  const signup = useCallback(async (details) => {
    const payload = await http.post('/auth/signup', details);
    setAccessToken(payload.accessToken);
    setUser(payload.user);
    return payload.user;
  }, []);

  /**
   * The local session is cleared whether or not the server call succeeds.
   *
   * If the network is down, the honest outcome is still to sign the user out of this tab; leaving
   * them apparently logged in with a token that no longer refreshes is worse than a cookie that
   * outlives the click and expires on its own.
   */
  const logout = useCallback(async () => {
    try {
      await http.post('/auth/logout');
    } catch {
      // Intentionally ignored — see above.
    } finally {
      clearAccessToken();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, signup, logout }),
    [user, loading, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Throws rather than returning `null`, so a provider left out of the tree fails at the call site. */
export function useAuth() {
  const context = useContext(AuthContext);

  if (context === null) {
    throw new Error('useAuth must be used inside an <AuthProvider>.');
  }

  return context;
}
