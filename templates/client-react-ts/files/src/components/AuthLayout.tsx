import type { ReactNode } from 'react';

import BrandMark from './BrandMark';

export interface AuthLayoutProps {
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

/** The centred card both the sign-in and sign-up pages are built on. */
export default function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <main className="auth">
      <div className="auth__glow" aria-hidden="true" />
      <section className="auth__card">
        <header className="auth__header">
          <BrandMark size={36} />
          <h1 className="auth__title">{title}</h1>
          <p className="auth__subtitle">{subtitle}</p>
        </header>
        {children}
        {footer !== undefined && <footer className="auth__footer">{footer}</footer>}
      </section>
    </main>
  );
}
