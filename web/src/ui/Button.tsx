import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type AnchorHTMLAttributes } from 'react';
import { Spinner } from './Spinner.tsx';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
  block?: boolean;
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', block = false, extra?: string) {
  return ['n-btn', `n-btn--${variant}`, `n-btn--${size}`, block ? 'n-btn--block' : '', extra ?? '']
    .filter(Boolean)
    .join(' ');
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, iconRight, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon ? <span className="n-btn__icon">{icon}</span> : null}
      {children != null && <span className="n-btn__label">{children}</span>}
      {iconRight && !loading ? <span className="n-btn__icon">{iconRight}</span> : null}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: 'ghost' | 'secondary';
  size?: 'sm' | 'md';
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={['n-icon-btn', `n-icon-btn--${variant}`, `n-icon-btn--${size}`, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
});

export interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

/** An anchor styled as a button (for navigation, external links). */
export function LinkButton({ variant = 'secondary', size = 'md', icon, iconRight, className, children, ...rest }: LinkButtonProps) {
  return (
    <a className={buttonClass(variant, size, false, className)} {...rest}>
      {icon ? <span className="n-btn__icon">{icon}</span> : null}
      <span className="n-btn__label">{children}</span>
      {iconRight ? <span className="n-btn__icon">{iconRight}</span> : null}
    </a>
  );
}
