/**
 * Live product demonstration: a miniature "Lumen" analytics app with Navoro
 * embedded. A user asks how to create a report; Navoro answers, then a ring
 * walks them to "Reports" and on to "New report".
 *
 * - Autoplays (looping) only while in view; pause/replay controls.
 * - prefers-reduced-motion: no autoplay. Starts on the final state and offers
 *   Back / Next controls to step through each moment instead.
 * - Ring, step card and pointer positions are measured from the real DOM so
 *   the overlay stays exact at every viewport width.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Mark } from './Brand.tsx';

const QUESTION = 'How do I create a report?';

/** Phase index → how long it holds during autoplay (ms). */
const PHASES = [
  { hold: 1700, caption: 'A Lumen user opens Navoro and asks a question.' },
  { hold: 1100, caption: 'Navoro reads the approved context for this screen.' },
  { hold: 1500, caption: 'It answers in one line, with the source it came from.' },
  { hold: 1700, caption: 'Found it. Navoro points at Reports in the sidebar.' },
  { hold: 1000, caption: 'The user clicks. Navoro never clicks for them.' },
  { hold: 3600, caption: 'Next step: the ring moves to New report.' },
] as const;
const LAST = PHASES.length - 1;

type Rect = { x: number; y: number; w: number; h: number };

function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

function relRect(el: Element | null, root: Element | null): Rect | null {
  if (!el || !root) return null;
  const a = el.getBoundingClientRect();
  const b = root.getBoundingClientRect();
  return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
}

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'reports', label: 'Reports' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'settings', label: 'Settings' },
] as const;

function NavIcon({ id }: { id: (typeof NAV)[number]['id'] }) {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true } as const;
  switch (id) {
    case 'dashboard':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
      );
    case 'reports':
      return (
        <svg {...common}>
          <path d="M4 2h6l3 3v9H4z" strokeLinejoin="round" />
          <path d="M6.5 9v3M9 7v5M11 10v2" strokeLinecap="round" />
        </svg>
      );
    case 'integrations':
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="2.5" />
          <circle cx="11" cy="11" r="2.5" />
          <path d="M7 7l2 2" strokeLinecap="round" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.2" />
          <path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" strokeLinecap="round" />
        </svg>
      );
  }
}

const BARS = [38, 52, 44, 61, 57, 72, 66, 80, 74, 88, 83, 94];
const SEGMENTS = [
  ['Enterprise', 46],
  ['Mid-market', 31],
  ['Self-serve', 23],
] as const;
const REPORTS = [
  ['Weekly revenue', 'Dana K.', 'Today'],
  ['Churn by cohort', 'Sam R.', 'Yesterday'],
  ['Pipeline health', 'Ari L.', 'Mon'],
  ['Support volume', 'Dana K.', 'Oct 2'],
] as const;

export function Demo() {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<number>(reduced ? LAST : 0);
  const [typed, setTyped] = useState<number>(reduced ? QUESTION.length : 0);
  const [userPaused, setUserPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [geo, setGeo] = useState<{ reports: Rect | null; newReport: Rect | null; stage: { w: number; h: number } }>({
    reports: null,
    newReport: null,
    stage: { w: 0, h: 0 },
  });

  const stageRef = useRef<HTMLDivElement>(null);
  const reportsRef = useRef<HTMLSpanElement>(null);
  const newReportRef = useRef<HTMLSpanElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const playing = !reduced && !userPaused && inView;

  // Reduced motion: jump to the final, fully-explained state.
  useEffect(() => {
    if (reduced) {
      setPhase(LAST);
      setTyped(QUESTION.length);
    }
  }, [reduced]);

  // Only animate while on screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Typing the question (phase 0).
  useEffect(() => {
    if (!playing || phase !== 0 || typed >= QUESTION.length) return;
    const t = window.setTimeout(() => setTyped((n) => n + 1), typed === 0 ? 420 : 34);
    return () => window.clearTimeout(t);
  }, [playing, phase, typed]);

  // Phase timeline.
  useEffect(() => {
    if (!playing) return;
    if (phase === 0 && typed < QUESTION.length) return;
    const t = window.setTimeout(() => {
      if (phase === LAST) {
        setTyped(0);
        setPhase(0);
      } else {
        setPhase(phase + 1);
      }
    }, PHASES[phase]!.hold);
    return () => window.clearTimeout(t);
  }, [playing, phase, typed]);

  // Measure targets after every render that can move them.
  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    setGeo({
      reports: relRect(reportsRef.current, stage),
      newReport: relRect(newReportRef.current, stage),
      stage: { w: stage.clientWidth, h: stage.clientHeight },
    });
  }, []);

  useLayoutEffect(measure, [measure, phase]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [measure]);

  const onReportsPage = phase >= 5;
  const target = phase >= 5 ? geo.newReport : phase >= 3 ? geo.reports : null;
  const step = phase >= 5 ? { n: 2, text: 'Click New report' } : { n: 1, text: 'Open Reports' };

  // Ring geometry (padding around the target).
  const pad = 5;
  const ringStyle: CSSProperties = target
    ? {
        transform: `translate(${target.x - pad}px, ${target.y - pad}px)`,
        width: target.w + pad * 2,
        height: target.h + pad * 2,
      }
    : {};

  // Step card: below the target, kept inside the stage.
  const cardW = Math.min(232, Math.max(0, geo.stage.w - 24));
  let cardStyle: CSSProperties = {};
  if (target) {
    const preferRight = phase < 5; // sidebar target: card to its right when there is room
    let left: number;
    let top: number;
    if (preferRight && target.x + target.w + 16 + cardW < geo.stage.w - 12 && geo.stage.w > 640) {
      left = target.x + target.w + 18;
      top = target.y - 4;
    } else {
      left = Math.min(Math.max(12, target.x + target.w - cardW), geo.stage.w - cardW - 12);
      top = target.y + target.h + 14;
    }
    cardStyle = { transform: `translate(${left}px, ${top}px)`, width: cardW };
  }

  // Simulated pointer: the user's own cursor, not Navoro's.
  let pointerStyle: CSSProperties = { opacity: 0 };
  if (geo.reports && (phase === 4)) {
    pointerStyle = { opacity: 1, transform: `translate(${geo.reports.x + geo.reports.w * 0.42}px, ${geo.reports.y + geo.reports.h * 0.55}px)` };
  } else if (geo.newReport && phase >= 5) {
    pointerStyle = { opacity: 1, transform: `translate(${geo.newReport.x - 30}px, ${geo.newReport.y + geo.newReport.h * 0.2}px)` };
  } else if (geo.reports && phase === 3) {
    pointerStyle = { opacity: 0, transform: `translate(${geo.reports.x + geo.reports.w + 60}px, ${geo.reports.y + 60}px)` };
  }

  const question = QUESTION.slice(0, typed);

  const replay = () => {
    setUserPaused(false);
    setTyped(reduced ? QUESTION.length : 0);
    setPhase(reduced ? 1 : 0);
  };

  const goto = (p: number) => {
    const next = Math.max(1, Math.min(LAST, p));
    setTyped(QUESTION.length);
    setPhase(next);
  };

  return (
    <div className="s-demo" ref={rootRef}>
      <figure className="s-demo__figure">
        <div className="s-win" aria-hidden="true">
          <div className="s-win__bar">
            <span className="s-win__url">app.lumen.example/{onReportsPage ? 'reports' : 'dashboard'}</span>
          </div>
          <div className="s-win__stage" ref={stageRef}>
            <div className="s-lumen">
              <div className="s-lumen__side">
                <div className="s-lumen__brand">
                  <span className="s-lumen__logo" />
                  Lumen
                </div>
                <ul className="s-lumen__nav">
                  {NAV.map((n) => (
                    <li key={n.id}>
                      <span
                        ref={n.id === 'reports' ? reportsRef : undefined}
                        className={[
                          's-lumen__link',
                          (onReportsPage ? n.id === 'reports' : n.id === 'dashboard') ? 'is-active' : '',
                          phase === 4 && n.id === 'reports' ? 'is-pressed' : '',
                        ].join(' ')}
                      >
                        <NavIcon id={n.id} />
                        <span>{n.label}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="s-lumen__main">
                {onReportsPage ? (
                  <div className="s-lumen__page" key="reports">
                    <div className="s-lumen__head">
                      <div>
                        <div className="s-lumen__title">Reports</div>
                        <div className="s-lumen__sub">4 saved reports</div>
                      </div>
                      <span className="s-lumen__btn" ref={newReportRef}>
                        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                        </svg>
                        New report
                      </span>
                    </div>
                    <div className="s-lumen__table">
                      <div className="s-lumen__tr s-lumen__th">
                        <span>Name</span>
                        <span>Owner</span>
                        <span>Updated</span>
                      </div>
                      {REPORTS.map(([name, owner, when]) => (
                        <div className="s-lumen__tr" key={name}>
                          <span>{name}</span>
                          <span>{owner}</span>
                          <span>{when}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="s-lumen__page" key="dashboard">
                    <div className="s-lumen__head">
                      <div>
                        <div className="s-lumen__title">Dashboard</div>
                        <div className="s-lumen__sub">Last 12 weeks</div>
                      </div>
                      <span className="s-lumen__btn s-lumen__btn--quiet">Share</span>
                    </div>
                    <div className="s-lumen__kpis">
                      <div className="s-lumen__kpi">
                        <span>Active accounts</span>
                        <b>2,481</b>
                      </div>
                      <div className="s-lumen__kpi">
                        <span>Net revenue</span>
                        <b>$184k</b>
                      </div>
                      <div className="s-lumen__kpi s-lumen__kpi--hide-sm">
                        <span>Open tickets</span>
                        <b>37</b>
                      </div>
                    </div>
                    <div className="s-lumen__chart">
                      {BARS.map((h, i) => (
                        <span key={i} style={{ height: `${h}%` }} />
                      ))}
                    </div>
                    <div className="s-lumen__list">
                      <div className="s-lumen__lh">Top segments</div>
                      {SEGMENTS.map(([name, pct]) => (
                        <div className="s-lumen__li" key={name}>
                          <span>{name}</span>
                          <span className="s-lumen__meter">
                            <span style={{ width: `${pct}%` }} />
                          </span>
                          <span>{pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="s-nv">
                <div className="s-nv__head">
                  <Mark size={18} />
                  <span>Help</span>
                </div>
                <div className="s-nv__body">
                  {phase === 0 && <p className="s-nv__empty">Ask anything about Lumen. I’ll show you where it is.</p>}
                  {phase >= 1 && <div className="s-nv__q">{QUESTION}</div>}
                  {phase === 1 && (
                    <div className="s-nv__thinking">
                      <i />
                      <i />
                      <i />
                    </div>
                  )}
                  {phase >= 2 && (
                    <div className="s-nv__a">
                      <p>
                        Open <b>Reports</b> in the sidebar, then choose <b>New report</b>. I’ll point to each step.
                      </p>
                      <p className="s-nv__src">Source: Creating reports, Lumen Help</p>
                    </div>
                  )}
                  {phase >= 3 && (
                    <div className="s-nv__progress">
                      <span>Step {step.n} of 7</span>
                      <span className="s-nv__track">
                        <span style={{ width: `${(step.n / 7) * 100}%` }} />
                      </span>
                    </div>
                  )}
                </div>
                <div className={['s-nv__input', phase === 0 ? 'is-typing' : ''].join(' ')}>
                  <span className="s-nv__field">
                    {phase === 0 ? (
                      question ? (
                        <>
                          {question}
                          <span className="s-nv__caret" />
                        </>
                      ) : (
                        <span className="s-nv__ph">Ask about this page</span>
                      )
                    ) : (
                      <span className="s-nv__ph">Ask a follow-up</span>
                    )}
                  </span>
                  <span className="s-nv__send">
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </div>
              </div>
            </div>

            {/* Overlay: ring, step card, user's pointer */}
            <div className={['s-ring', target ? 'is-on' : ''].join(' ')} style={ringStyle} />
            <div className={['s-step', target ? 'is-on' : ''].join(' ')} style={cardStyle}>
              <span className="s-step__meta">
                <span className="s-step__found" key={step.n}>Found it.</span>
                <span className="s-step__count">Step {step.n} of 7</span>
              </span>
              <span className="s-step__text">{step.text}</span>
            </div>
            <svg className={['s-pointer', phase === 4 ? 'is-click' : ''].join(' ')} style={pointerStyle} width="20" height="22" viewBox="0 0 20 22">
              <path d="M2 2l15 8.2-6.6 1.6L7.3 18z" fill="#111210" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <figcaption className="s-demo__caption">
          <span className="s-demo__live" aria-live={reduced || userPaused ? 'polite' : 'off'}>
            {PHASES[phase]!.caption}
          </span>
        </figcaption>
      </figure>

      <div className="s-demo__controls" role="group" aria-label="Demo controls">
        {reduced ? (
          <>
            <button type="button" className="s-ctl" onClick={() => goto(phase - 1)} aria-disabled={phase <= 1}>
              Back
            </button>
            <span className="s-ctl__count" aria-hidden="true">
              {phase} / {LAST}
            </span>
            <button type="button" className="s-ctl" onClick={() => goto(phase + 1)} aria-disabled={phase >= LAST}>
              Next
            </button>
          </>
        ) : (
          <>
            <button type="button" className="s-ctl" onClick={() => setUserPaused((p) => !p)}>
              {userPaused ? (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3.2 2v8M8.8 2v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
              {userPaused ? 'Play' : 'Pause'}
            </button>
            <button type="button" className="s-ctl" onClick={replay}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2.2 6a3.8 3.8 0 1 0 1.2-2.8M2 1.6v2.6h2.6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Replay
            </button>
          </>
        )}
      </div>
    </div>
  );
}
