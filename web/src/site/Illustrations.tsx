/**
 * Small bespoke line illustrations for the three pillars. Drawn on a 160x96
 * grid with the same stroke language as the mark: round caps, ink lines, one
 * lime point of arrival each.
 */
const INK = 'currentColor';
const LIME = '#D2F53C';
const FAINT = 'var(--s-line)';

const base = {
  viewBox: '0 0 160 96',
  fill: 'none',
  'aria-hidden': true,
  focusable: 'false',
  className: 's-illo',
} as const;

/** Guided onboarding: a route through three checkpoints to arrival. */
export function OnboardingIllo() {
  return (
    <svg {...base}>
      <rect x="8" y="10" width="144" height="76" rx="10" stroke={FAINT} strokeWidth="1.5" />
      <path d="M28 66 C 48 66, 46 34, 68 34 S 92 62, 112 58 S 128 34, 132 30" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeDasharray="0.1 7" />
      <circle cx="28" cy="66" r="5" fill={INK} />
      <circle cx="68" cy="34" r="5" fill={INK} />
      <circle cx="112" cy="58" r="5" fill="var(--s-bg-card)" stroke={INK} strokeWidth="2" />
      <circle cx="132" cy="30" r="7" fill={LIME} stroke={INK} strokeWidth="2" />
    </svg>
  );
}

/** Contextual troubleshooting: an inline error, ringed at the exact field. */
export function TroubleshootIllo() {
  return (
    <svg {...base}>
      <rect x="8" y="10" width="144" height="76" rx="10" stroke={FAINT} strokeWidth="1.5" />
      <rect x="22" y="24" width="54" height="6" rx="3" fill={FAINT} />
      <rect x="22" y="38" width="116" height="16" rx="5" stroke={INK} strokeWidth="2" />
      <path d="M30 46h40" stroke={FAINT} strokeWidth="4" strokeLinecap="round" />
      <rect x="16" y="32" width="128" height="28" rx="9" stroke={LIME} strokeWidth="3.5" />
      <circle cx="28" cy="72" r="4.5" fill={INK} />
      <path d="M28 69.8v2.4M28 74.2v.1" stroke="var(--s-bg-card)" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="38" y="69" width="62" height="6" rx="3" fill={INK} opacity="0.75" />
    </svg>
  );
}

/** On-demand visual assistance: a question, and a ring on the right button. */
export function AssistIllo() {
  return (
    <svg {...base}>
      <rect x="8" y="10" width="144" height="76" rx="10" stroke={FAINT} strokeWidth="1.5" />
      <rect x="22" y="58" width="34" height="14" rx="5" fill={FAINT} />
      <rect x="62" y="58" width="34" height="14" rx="5" fill={FAINT} />
      <rect x="102" y="58" width="36" height="14" rx="5" fill={INK} />
      <rect x="96" y="52" width="48" height="26" rx="9" stroke={LIME} strokeWidth="3.5" />
      <path d="M22 22h58a8 8 0 0 1 8 8v4a8 8 0 0 1-8 8H36l-8 6v-6h-6a0 0 0 0 1 0 0z" fill="var(--s-bg-card)" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M32 31h36" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity="0.8" />
    </svg>
  );
}
