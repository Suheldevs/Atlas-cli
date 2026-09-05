import { Link } from 'react-router-dom';

import BrandMark from '../components/BrandMark';

export default function NotFound() {
  return (
    <main className="auth">
      <div className="auth__glow" aria-hidden="true" />
      <section className="auth__card auth__card--centered">
        <BrandMark size={36} />
        <p className="notfound__code">404</p>
        <h1 className="auth__title">Page not found</h1>
        <p className="auth__subtitle">That page does not exist, or it moved.</p>
        <Link className="button button--primary" to="/">
          Back to safety
        </Link>
      </section>
    </main>
  );
}
