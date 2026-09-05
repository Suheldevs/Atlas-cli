import type { ReactNode } from 'react';

export interface SubmitButtonProps {
  readonly pending: boolean;
  readonly children: ReactNode;
  readonly pendingLabel?: string;
}

/**
 * The submit control, disabled for exactly as long as a request is in flight.
 *
 * The label is swapped rather than hidden behind a spinner alone: "Signing in…" tells a user what
 * is happening, and keeps the button's accessible name meaningful while it is unavailable.
 */
export default function SubmitButton({ pending, children, pendingLabel = 'Working…' }: SubmitButtonProps) {
  return (
    <button className="button button--primary" type="submit" disabled={pending}>
      {pending && <span className="spinner" aria-hidden="true" />}
      <span>{pending ? pendingLabel : children}</span>
    </button>
  );
}
