import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  /** Render function receives the id and aria attributes to put on the control. */
  children: (ids: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}

/** Label + control + hint + inline error, with correct aria wiring. */
export function Field({ label, hint, error, optional, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={['n-field', error ? 'n-field--error' : '', className].filter(Boolean).join(' ')}>
      <label className="n-field__label" htmlFor={id}>
        {label}
        {optional ? <span className="n-field__optional">Optional</span> : null}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint ? (
        <p className="n-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="n-field__error" id={errorId} role="alert">
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 4.5v4.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="11.25" r="0.9" fill="currentColor" />
          </svg>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={['n-input', className].filter(Boolean).join(' ')} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={['n-input', 'n-textarea', className].filter(Boolean).join(' ')} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <span className={['n-select', className].filter(Boolean).join(' ')}>
      <select ref={ref} className="n-input n-select__control" {...rest}>
        {children}
      </select>
      <svg className="n-select__chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none">
        <path d="M3 4.5 6 7.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}

export function Checkbox({ label, description, className, id, ...rest }: CheckboxProps) {
  const autoId = useId();
  const cid = id ?? autoId;
  const descId = description ? `${cid}-desc` : undefined;
  return (
    <div className={['n-check', rest.disabled ? 'n-check--disabled' : '', className].filter(Boolean).join(' ')}>
      <span className="n-check__box">
        <input type="checkbox" id={cid} aria-describedby={descId} {...rest} />
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="n-check__text">
        <label htmlFor={cid} className="n-check__label">
          {label}
        </label>
        {description ? (
          <span id={descId} className="n-check__desc">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const id = useId();
  return (
    <div className={['n-switch-row', disabled ? 'n-switch-row--disabled' : '', className].filter(Boolean).join(' ')}>
      <span className="n-switch-row__text">
        <span className="n-switch-row__label" id={`${id}-label`}>
          {label}
        </span>
        {description ? (
          <span className="n-switch-row__desc" id={`${id}-desc`}>
            {description}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        className="n-switch"
        onClick={() => onChange(!checked)}
      >
        <span className="n-switch__thumb" />
      </button>
    </div>
  );
}
