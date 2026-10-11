/**
 * Authenticated app shell: sidebar (collapses into a top bar + menu < 900px),
 * application switcher, user/org footer, and the main content landmark.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Logo, Spinner } from '../ui/index.ts';
import { Link, paths, useRouter, type Route } from './router.tsx';
import { useMe, useSession, useWorkspace } from './session.tsx';
import { useMediaQuery } from './hooks.ts';
import {
  IconAnalytics,
  IconApplications,
  IconCheck,
  IconChevronDown,
  IconGuidance,
  IconKnowledge,
  IconMenu,
  IconOverview,
  IconPlus,
  IconPrivacy,
  IconSettings,
  IconSignOut,
  IconX,
} from './icons.tsx';

type Section = 'overview' | 'applications' | 'knowledge' | 'guidance' | 'privacy' | 'analytics' | 'settings';

const NAV: Array<{ key: Section; label: string; href: string; icon: (p: { size?: number }) => ReactNode }> = [
  { key: 'overview', label: 'Overview', href: paths.overview(), icon: IconOverview },
  { key: 'applications', label: 'Applications', href: paths.applications(), icon: IconApplications },
  { key: 'knowledge', label: 'Knowledge', href: paths.knowledge(), icon: IconKnowledge },
  { key: 'guidance', label: 'Guidance', href: paths.guidance(), icon: IconGuidance },
  { key: 'privacy', label: 'Privacy & Security', href: paths.privacy(), icon: IconPrivacy },
  { key: 'analytics', label: 'Analytics', href: paths.analytics(), icon: IconAnalytics },
  { key: 'settings', label: 'Settings', href: paths.settings(), icon: IconSettings },
];

function sectionOf(route: Route): Section | null {
  switch (route.name) {
    case 'overview':
      return 'overview';
    case 'applications':
    case 'application':
      return 'applications';
    case 'knowledge':
    case 'source':
      return 'knowledge';
    case 'guidance':
    case 'workflow':
      return 'guidance';
    case 'privacy':
      return 'privacy';
    case 'analytics':
      return 'analytics';
    case 'settings':
      return 'settings';
    default:
      return null;
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '·';
}

/* ───────────── Application switcher ───────────── */

function AppSwitcher({ onNavigate }: { onNavigate: () => void }) {
  const { applications, selected, select, loading, error } = useWorkspace();
  const { navigate } = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    // Focus the selected option when the list opens.
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"], [role="menuitem"]')?.focus());
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="switcher switcher--loading" aria-busy="true">
        <Spinner size={14} /> <span>Loading applications…</span>
      </div>
    );
  }
  if (error) {
    return <div className="switcher switcher--empty">Applications unavailable</div>;
  }
  if (applications.length === 0) {
    return (
      <Link
        className="switcher switcher--empty"
        href={`${paths.applications()}?register=1`}
        onClick={onNavigate}
      >
        <span className="switcher__plus" aria-hidden="true">
          <IconPlus size={14} />
        </span>
        <span>
          <span className="switcher__label">No application yet</span>
          <span className="switcher__name">Register your first app</span>
        </span>
      </Link>
    );
  }

  return (
    <div className="switcher-wrap" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        className="switcher"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="switcher__avatar" aria-hidden="true">
          {initials(selected?.name ?? '?')}
        </span>
        <span className="switcher__text">
          <span className="switcher__label">Application</span>
          <span className="switcher__name">{selected?.name ?? 'Select application'}</span>
        </span>
        <IconChevronDown size={16} className="switcher__chevron" />
      </button>
      {open ? (
        <div className="switcher__menu" role="menu" id={listId} aria-label="Switch application" onKeyDown={onMenuKey}>
          {applications.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitemradio"
              aria-checked={a.id === selected?.id}
              className="switcher__item"
              onClick={() => {
                select(a.id);
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              <span className="switcher__avatar switcher__avatar--sm" aria-hidden="true">
                {initials(a.name)}
              </span>
              <span className="switcher__item-name">{a.name}</span>
              {a.id === selected?.id ? <IconCheck size={14} /> : null}
            </button>
          ))}
          <div className="switcher__sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="switcher__item"
            onClick={() => {
              setOpen(false);
              onNavigate();
              navigate(`${paths.applications()}?register=1`);
            }}
          >
            <span className="switcher__avatar switcher__avatar--sm switcher__avatar--ghost" aria-hidden="true">
              <IconPlus size={12} />
            </span>
            <span className="switcher__item-name">Register application</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── Sidebar ───────────── */

function SidebarContent({ onNavigate }: { onNavigate: () => void }) {
  const { route } = useRouter();
  const me = useMe();
  const { signOut } = useSession();
  const current = sectionOf(route);
  const [signingOut, setSigningOut] = useState(false);
  return (
    <>
      <div className="sidebar__top">
        <AppSwitcher onNavigate={onNavigate} />
      </div>
      <nav className="sidebar__nav" aria-label="Primary">
        <ul>
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = current === item.key;
            return (
              <li key={item.key}>
                <Link href={item.href} className={['nav-item', active ? 'nav-item--active' : ''].join(' ')} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="sidebar__footer">
        <div className="sidebar__user">
          <span className="sidebar__user-avatar" aria-hidden="true">
            {initials(me.user.name)}
          </span>
          <span className="sidebar__user-text">
            <span className="sidebar__user-name">{me.user.name}</span>
            <span className="sidebar__user-org">
              {me.organization.name} · {me.role[0]!.toUpperCase() + me.role.slice(1)}
            </span>
          </span>
          <button
            type="button"
            className="sidebar__signout"
            aria-label="Sign out"
            title="Sign out"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await signOut().catch(() => undefined);
              window.location.assign('/login');
            }}
          >
            {signingOut ? <Spinner size={14} /> : <IconSignOut size={16} />}
          </button>
        </div>
      </div>
    </>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const compact = useMediaQuery('(max-width: 899px)');
  const [menuOpen, setMenuOpen] = useState(false);
  const { location } = useRouter();
  const mainRef = useRef<HTMLElement>(null);

  // Close the mobile menu on navigation; move focus to the new page's title.
  useEffect(() => {
    setMenuOpen(false);
    const raf = requestAnimationFrame(() => {
      const h1 = mainRef.current?.querySelector<HTMLElement>('[data-page-title]');
      if (h1 && document.activeElement && document.activeElement !== document.body && !mainRef.current?.contains(document.activeElement)) {
        h1.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [location.pathname]);

  useEffect(() => {
    if (!compact) setMenuOpen(false);
  }, [compact]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="shell">
      <a className="n-skip-link" href="#main">
        Skip to content
      </a>
      {compact ? (
        <header className="topbar">
          <Link href={paths.overview()} className="topbar__brand" aria-label="navoro — Overview">
            <Logo size={24} tone="paper" />
          </Link>
          <button
            type="button"
            className="topbar__menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <IconX size={20} /> : <IconMenu size={20} />}
            <span>{menuOpen ? 'Close' : 'Menu'}</span>
          </button>
        </header>
      ) : null}

      {compact ? (
        menuOpen ? (
          <div className="sidebar sidebar--mobile" id="mobile-nav">
            <SidebarContent onNavigate={() => setMenuOpen(false)} />
          </div>
        ) : null
      ) : (
        <aside className="sidebar" aria-label="Sidebar">
          <div className="sidebar__brand">
            <Link href={paths.overview()} aria-label="navoro — Overview" className="sidebar__brand-link">
              <Logo size={26} tone="paper" />
            </Link>
          </div>
          <SidebarContent onNavigate={() => undefined} />
        </aside>
      )}

      <main className="main" id="main" ref={mainRef} tabIndex={-1}>
        <div className="main__inner">{children}</div>
      </main>
    </div>
  );
}
