import { useState } from 'react';

import BrandMark from '../components/BrandMark';
import { useAuth } from '../context/AuthContext';

/** Up to two initials, from however many words a name happens to have. */
function initialsOf(name) {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return '?';

  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';

  return `${first}${last}`.toUpperCase();
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  // `ProtectedRoute` renders nothing until the session is known, so `user` cannot be null here.
  if (user === null) return null;

  async function handleLogout() {
    setSigningOut(true);
    // No navigate() call: clearing the user makes ProtectedRoute redirect on the next render, so
    // there is one place that decides where a signed-out visitor goes.
    await logout();
  }

  return (
    <div className="app">
      <header className="app__bar">
        <div className="app__bar-inner">
          <div className="app__brand">
            <BrandMark size={28} />
            <span>__PROJECT_NAME__</span>
          </div>
          <div className="app__account">
            <span className="avatar" aria-hidden="true">
              {initialsOf(user.name)}
            </span>
            <span className="app__account-name">{user.name}</span>
            <button
              className="button button--ghost"
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <p className="hero__eyebrow">Dashboard</p>
          <h1 className="hero__title">Hello, {user.name.split(' ')[0]}</h1>
          <p className="hero__subtitle">
            You are signed in. Everything below came from <code>GET /api/auth/me</code>.
          </p>
        </section>

        <div className="grid">
          <section className="card">
            <h2 className="card__title">Your account</h2>
            <dl className="details">
              <div className="details__row">
                <dt>Name</dt>
                <dd>{user.name}</dd>
              </div>
              <div className="details__row">
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div className="details__row">
                <dt>Role</dt>
                <dd>
                  <span className={`badge badge--${user.role}`}>{user.role}</span>
                </dd>
              </div>
              <div className="details__row">
                <dt>User ID</dt>
                <dd>
                  <code className="mono">{user.id}</code>
                </dd>
              </div>
            </dl>
          </section>

          <section className="card">
            <h2 className="card__title">How this session works</h2>
            <ul className="notes">
              <li>
                The access token is held in a module variable in <code>src/lib/api.js</code> — never
                in <code>localStorage</code>, where any script on the page could read it.
              </li>
              <li>
                The refresh token rides an <code>httpOnly</code> cookie the browser sends on its own
                and JavaScript cannot see.
              </li>
              <li>
                When a request comes back <code>401</code>, the response interceptor spends the
                cookie on <code>/api/auth/refresh</code> once and replays the original request.
              </li>
              <li>
                Reloading this page throws the access token away; the session survives because that
                same refresh runs before <code>/api/auth/me</code> is retried.
              </li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
