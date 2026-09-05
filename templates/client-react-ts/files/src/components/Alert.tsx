export interface AlertProps {
  readonly title: string;
  /** Extra server-side messages that belong to the form as a whole rather than to one input. */
  readonly messages?: readonly string[];
}

/**
 * A server-side failure, announced to assistive technology as well as shown.
 *
 * `role="alert"` matters here: a form that fails silently for a screen-reader user is a form that
 * appears to do nothing at all when submitted.
 */
export default function Alert({ title, messages = [] }: AlertProps) {
  return (
    <div className="alert" role="alert">
      <svg className="alert__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
        <circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 5.75v5m0 3.25v.25"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
      <div className="alert__body">
        <p className="alert__title">{title}</p>
        {messages.length > 0 && (
          <ul className="alert__list">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
