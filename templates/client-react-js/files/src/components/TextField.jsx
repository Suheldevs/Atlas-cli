/**
 * A labelled input that knows how to be invalid.
 *
 * The error is wired to the input through `aria-describedby` and `aria-invalid` rather than only
 * being printed underneath it, so the message is read out when focus lands on the field instead of
 * being a red line a screen reader never reaches.
 */
export default function TextField({
  id,
  label,
  error,
  hint,
  className = '',
  ...inputProps
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ');

  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input"
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        {...inputProps}
      />
      {hint && !error && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
