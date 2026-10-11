/**
 * Navoro mark + wordmark for the public site. Mirrors web/public/navoro-mark.svg:
 * a continuous N path that ends at a lime "point of arrival".
 */

interface MarkProps {
  size?: number;
  /** 'ink' tile for light surfaces, 'paper' tile for dark surfaces. */
  tone?: 'ink' | 'paper';
}

export function Mark({ size = 28, tone = 'ink' }: MarkProps) {
  const tile = tone === 'ink' ? '#111210' : '#FAF8F3';
  const stroke = tone === 'ink' ? '#FAF8F3' : '#111210';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill={tile} />
      <path d="M9 23V9.5L22.5 22.5V12" stroke={stroke} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="22.5" cy="8.6" r="2.4" fill="#D2F53C" />
    </svg>
  );
}

interface LogoProps extends MarkProps {
  className?: string;
}

/** Mark + lowercase `navoro` wordmark, exposed to assistive tech as "navoro". */
export function Logo({ size = 28, tone = 'ink', className }: LogoProps) {
  return (
    <span className={['s-logo', className].filter(Boolean).join(' ')}>
      <Mark size={size} tone={tone} />
      <span className="s-logo__word" style={{ fontSize: Math.round(size * 0.78) }}>
        navoro
      </span>
    </span>
  );
}
