import type { ComponentPropsWithoutRef } from 'react';

export interface TextFieldProps extends Omit<ComponentPropsWithoutRef<'input'>, 'id' | 'className'> {
  /** Required, not optional: it is what ties the label and the error message to the input. */
  readonly id: string;
  readonly label: string;
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  readonly className?: string;
}

/**
 * A labelled input that knows how to be invalid.
 *
 * The error is wired to the input through `aria-describedby` and `aria-invalid` rather than only
 * being printed underneath it, so the message is read out when focus lands on the field instead of
 * being a red line a screen reader never reaches.
 */
export default function TextField({ id, label, error, hint, className = '', ...inputProps }: TextFieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input"
        aria-invalid={error !== undefined}
        {...(describedBy === '' ? {} : { 'aria-describedby': describedBy })}
        {...inputProps}
      />
      {hint !== undefined && error === undefined && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
