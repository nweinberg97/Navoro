/**
 * Navoro dashboard icon set. Hand-drawn on a 20px grid, 1.5px strokes,
 * round caps. Decorative by default (aria-hidden).
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...rest,
  };
}

/** Overview: a compass-like dial — "where things stand". */
export const IconOverview = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="10" cy="10" r="7.25" />
    <path d="M12.75 7.25 11 11l-3.75 1.75L9 9z" />
  </svg>
);

/** Applications: a window with a connection port. */
export const IconApplications = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.75" y="3.75" width="14.5" height="11.5" rx="2.25" />
    <path d="M2.75 7.25h14.5" />
    <circle cx="5.25" cy="5.5" r="0.35" fill="currentColor" />
    <path d="M7.5 17.25h5" />
  </svg>
);

/** Knowledge: stacked pages. */
export const IconKnowledge = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5.75 2.75h6.5l3 3v9.5a2 2 0 0 1-2 2h-7.5a2 2 0 0 1-2-2v-10.5a2 2 0 0 1 2-2z" />
    <path d="M12 2.75V6h3.25" />
    <path d="M7 10h6M7 13h4" />
  </svg>
);

/** Guidance: a path with steps — the navoro motion. */
export const IconGuidance = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 16V5.5l10 9.5V7" />
    <circle cx="14" cy="4.5" r="1.75" fill="currentColor" stroke="none" />
  </svg>
);

/** Privacy: a shield with a keyhole line. */
export const IconPrivacy = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 2.75 4 5v4.75c0 3.6 2.55 6.4 6 7.5 3.45-1.1 6-3.9 6-7.5V5z" />
    <path d="M10 8.25v3.5" />
  </svg>
);

/** Analytics: three bars and a baseline. */
export const IconAnalytics = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 16.75h14" />
    <path d="M5.75 13.5v-3M10 13.5v-7.5M14.25 13.5V9" />
  </svg>
);

/** Settings: sliders. */
export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 6h6.75M14 6h2.5M3.5 14h2.5M9.75 14h6.75" />
    <circle cx="12" cy="6" r="1.75" />
    <circle cx="8" cy="14" r="1.75" />
  </svg>
);

export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M16.25 10a6.25 6.25 0 1 1-1.83-4.42" />
    <path d="M16.5 3.5v3.25h-3.25" />
  </svg>
);

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 4.5v11M4.5 10h11" />
  </svg>
);

export const IconChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 8 4 4 4-4" />
  </svg>
);

export const IconChevronRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m8 6 4 4-4 4" />
  </svg>
);

export const IconArrowLeft = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M15.5 10h-11M9 5.5 4.5 10 9 14.5" />
  </svg>
);

export const IconArrowRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5" />
  </svg>
);

export const IconExternal = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M11.5 3.75h4.75V8.5M16 4 9.5 10.5" />
    <path d="M14.25 11.75v3a1.5 1.5 0 0 1-1.5 1.5h-7.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5h3" />
  </svg>
);

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </svg>
);

export const IconX = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </svg>
);

export const IconMenu = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 6.5h13M3.5 13.5h13" />
  </svg>
);

export const IconSignOut = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 3.75H5.25a1.5 1.5 0 0 0-1.5 1.5v9.5a1.5 1.5 0 0 0 1.5 1.5H8" />
    <path d="M12.5 6.5 16 10l-3.5 3.5M16 10H8" />
  </svg>
);

export const IconUpload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 13V3.75M6.25 7.5 10 3.75l3.75 3.75" />
    <path d="M3.75 13v1.75a1.5 1.5 0 0 0 1.5 1.5h9.5a1.5 1.5 0 0 0 1.5-1.5V13" />
  </svg>
);

export const IconLink = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8.5 11.5a3 3 0 0 0 4.24 0l2.5-2.5a3 3 0 0 0-4.24-4.24l-.75.75" />
    <path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2.5 2.5a3 3 0 0 0 4.24 4.24l.75-.75" />
  </svg>
);

export const IconPlay = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.75" y="4.25" width="14.5" height="11.5" rx="3" />
    <path d="M8.5 7.75v4.5l3.75-2.25z" fill="currentColor" />
  </svg>
);

export const IconPen = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12.5 4.5 15.5 7.5M4 16l.75-3.5L13.5 3.75a1.5 1.5 0 0 1 2.12 0l.63.63a1.5 1.5 0 0 1 0 2.12L7.5 15.25z" />
  </svg>
);

export const IconText = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5h12M4 10h12M4 15h7" />
  </svg>
);

export const IconSparkle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 3v3M10 14v3M3 10h3M14 10h3M5.5 5.5l1.75 1.75M12.75 12.75l1.75 1.75M5.5 14.5l1.75-1.75M12.75 7.25 14.5 5.5" />
  </svg>
);

export const IconTarget = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="10" cy="10" r="6.75" />
    <circle cx="10" cy="10" r="3" />
    <circle cx="10" cy="10" r="0.5" fill="currentColor" />
  </svg>
);

export const IconWarning = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M10 3.5 2.75 16h14.5z" />
    <path d="M10 8.5v3.25" />
    <circle cx="10" cy="13.85" r="0.4" fill="currentColor" />
  </svg>
);

export const IconEye = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 10s2.75-5.25 7.5-5.25S17.5 10 17.5 10s-2.75 5.25-7.5 5.25S2.5 10 2.5 10z" />
    <circle cx="10" cy="10" r="2.25" />
  </svg>
);

export const IconEyeOff = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.5 3.5l13 13" />
    <path d="M8.2 5a7.6 7.6 0 0 1 1.8-.25c4.75 0 7.5 5.25 7.5 5.25a13.6 13.6 0 0 1-2.2 2.9M12.6 14.7a7 7 0 0 1-2.6.55C5.25 15.25 2.5 10 2.5 10a13.4 13.4 0 0 1 3.1-3.6" />
  </svg>
);

export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3.75 5.75h12.5M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.5 5.75l.75 10a1.5 1.5 0 0 0 1.5 1.25h4.5a1.5 1.5 0 0 0 1.5-1.25l.75-10" />
  </svg>
);

export const IconCode = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m7 6-4 4 4 4M13 6l4 4-4 4" />
  </svg>
);
