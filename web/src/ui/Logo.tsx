/**
 * Navoro brand mark + lowercase wordmark. Mirrors web/public/navoro-mark.svg.
 * Shared by the dashboard and the public site.
 */

export interface MarkProps {
  size?: number;
  /** 'ink' = ink tile (default, for light surfaces); 'paper' = paper tile for dark surfaces. */
  tone?: 'ink' | 'paper';
  title?: string;
  className?: string;
}

export function NavoroMark({ size = 28, tone = 'ink', title, className }: MarkProps) {
  const tile = tone === 'ink' ? '#111210' : '#FAF8F3';
  const stroke = tone === 'ink' ? '#FAF8F3' : '#111210';
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <rect width="32" height="32" rx="8" fill={tile} />
      <path
        d="M9 23V9.5L22.5 22.5V12"
        stroke={stroke}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="22.5" cy="8.6" r="2.4" fill="#D2F53C" />
    </svg>
  );
}

export interface LogoProps {
  size?: number;
  tone?: 'ink' | 'paper';
  /** Text color for the wordmark; inherits by default. */
  className?: string;
}

/** Mark + `navoro` wordmark, accessible as a single "navoro" label. */
export function Logo({ size = 28, tone = 'ink', className }: LogoProps) {
  return (
    <span className={['n-logo', className].filter(Boolean).join(' ')} role="img" aria-label="navoro">
      <NavoroMark size={size} tone={tone} />
      <span className="n-logo__word" aria-hidden="true" style={{ fontSize: Math.round(size * 0.72) }}>
        navoro
      </span>
    </span>
  );
}
