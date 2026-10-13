import { Logo } from './Brand.tsx';
import { DOWNLOAD_URL, IS_STATIC, LOCAL_DEMO_URL, REPO_URL } from './config.ts';
import { Demo } from './Demo.tsx';
import { AssistIllo, OnboardingIllo, TroubleshootIllo } from './Illustrations.tsx';
import { DownloadIcon, RunLocally } from './RunLocally.tsx';

/**
 * Link targets for the two build modes (see config.ts). On the static landing page
 * there is no server behind the site, so everything leads to the download section.
 */
const DEMO_URL = IS_STATIC ? 'demo/' : LOCAL_DEMO_URL;
const SIGNUP_URL = IS_STATIC ? '#download' : '/signup';
const LOGIN_URL = IS_STATIC ? '#download' : '/login';

function Nav() {
  return (
    <header className="s-nav">
      <div className="s-wrap s-nav__inner">
        <a href="#top" className="s-nav__home" aria-label="navoro, back to top">
          <Logo size={26} />
        </a>
        <nav aria-label="Primary" className="s-nav__links">
          <a href="#product">Product</a>
          <a href="#learning">How it learns</a>
          <a href="#privacy">Privacy</a>
          <a href="#install">Install</a>
          {IS_STATIC ? <a href="#download">Download</a> : null}
        </nav>
        <div className="s-nav__actions">
          <a href={LOGIN_URL} className="s-nav__signin">
            Sign in
          </a>
          <a href={SIGNUP_URL} className="s-btn s-btn--ink s-btn--sm">
            Create a workspace
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="s-hero" id="top" aria-labelledby="hero-title">
      <div className="s-wrap">
        <h1 className="s-hero__title" id="hero-title">
          <span className="s-hero__line">Less searching.</span>
          <span className="s-hero__line s-hero__line--two">
            More doing<span className="s-hero__dot" aria-hidden="true" />
            <span className="s-sr">.</span>
          </span>
        </h1>
        <div className="s-hero__foot">
          <p className="s-hero__sub">
            Navoro lives inside your product, answers your users’ questions, and points to the exact control they need.
          </p>
          {IS_STATIC ? (
            <div className="s-hero__ctas">
              <a href={DEMO_URL} className="s-btn s-btn--lime">
                Try the live demo
              </a>
              <a href={DOWNLOAD_URL} className="s-btn s-btn--line">
                <DownloadIcon />
                Download Navoro
              </a>
            </div>
          ) : (
            <div className="s-hero__ctas">
              <a href={DEMO_URL} className="s-btn s-btn--lime">
                Try the live demo
              </a>
              <a href={SIGNUP_URL} className="s-btn s-btn--line">
                Create a workspace
              </a>
            </div>
          )}
        </div>
      </div>
      <div className="s-wrap s-hero__demo" id="product">
        <Demo />
      </div>
    </section>
  );
}

function Why() {
  return (
    <section className="s-section s-why" aria-labelledby="why-title">
      <div className="s-wrap s-split">
        <div className="s-split__lead">
          <h2 className="s-h2" id="why-title">
            Help that knows where the button is.
          </h2>
          <p className="s-lede">
            Contextual visual guidance answers a question where it was asked, then shows the way on the screen the user is
            already looking at. One step at a time, until they arrive.
          </p>
        </div>
        <ol className="s-paths" aria-label="Three ways a user can get help">
          <li className="s-path">
            <h3>The help center</h3>
            <p>A new tab, a search box, an article written for last year’s layout. Then back to the app to find it again.</p>
            <span className="s-path__verdict">Leaves the app</span>
          </li>
          <li className="s-path">
            <h3>A generic chatbot</h3>
            <p>Fluent, confident, and guessing. It can’t see your interface, so “click Settings” is the best it can do.</p>
            <span className="s-path__verdict">Can’t see the screen</span>
          </li>
          <li className="s-path s-path--navoro">
            <h3>Navoro</h3>
            <p>Answers from your own docs, then rings the exact control, in place. The user keeps their context and their momentum.</p>
            <span className="s-path__verdict">Points at it</span>
          </li>
        </ol>
      </div>
    </section>
  );
}

function Pillars() {
  const items = [
    {
      title: 'Guided onboarding',
      body: 'New users reach their first win through your real interface, not a product tour that breaks on the next release.',
      Illo: OnboardingIllo,
    },
    {
      title: 'Contextual troubleshooting',
      body: 'When something fails, Navoro recognizes the known error and walks the user to the field that fixes it.',
      Illo: TroubleshootIllo,
    },
    {
      title: 'On-demand visual assistance',
      body: 'Any question, any page. A short answer, and a ring around the control that does it.',
      Illo: AssistIllo,
    },
  ];
  return (
    <section className="s-section s-pillars" aria-labelledby="pillars-title">
      <div className="s-wrap">
        <div className="s-head">
          <h2 className="s-h2" id="pillars-title">
            Three jobs. One intelligence layer.
          </h2>
          <p className="s-lede">
            Each runs on the same knowledge of your product, so an improvement in one shows up in all three.
          </p>
        </div>
        <ul className="s-pillars__grid">
          {items.map(({ title, body, Illo }) => (
            <li className="s-pillar" key={title}>
              <div className="s-pillar__art">
                <Illo />
              </div>
              <h3 className="s-h3">{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Learning() {
  const stages = [
    {
      title: 'Your sources',
      body: 'Help docs, pasted articles, Markdown files, public doc URLs and YouTube transcripts.',
      chips: ['docs', 'articles', '.md', 'URLs', 'transcripts'],
    },
    {
      title: 'Structured knowledge',
      body: 'Workflows, steps, known errors and UI terms, each one keeping a link back to where it came from.',
      chips: ['workflows', 'steps', 'errors', 'UI terms'],
    },
    {
      title: 'Validated mappings',
      body: 'Steps are matched to real elements in your app, using approved metadata and stable data-navoro-id targets.',
      chips: ['reports.new', 'nav.reports'],
    },
    {
      title: 'Refresh Learning',
      body: 'When your product changes, re-run learning. Stale steps are flagged instead of quietly pointing at nothing.',
      chips: ['re-validate'],
    },
  ];
  return (
    <section className="s-section s-learn" id="learning" aria-labelledby="learn-title">
      <div className="s-wrap">
        <div className="s-head">
          <h2 className="s-h2" id="learn-title">
            How Navoro learns your product.
          </h2>
          <p className="s-lede">
            From the material you already have to guidance that lands on the right pixel. Every answer is traceable to its
            source.
          </p>
        </div>
        <ol className="s-flow">
          {stages.map((s, i) => (
            <li className="s-flow__stage" key={s.title}>
              <div className="s-flow__rail" aria-hidden="true">
                <span className="s-flow__num">{i + 1}</span>
              </div>
              <h3 className="s-h3">{s.title}</h3>
              <p>{s.body}</p>
              <ul className="s-chips" aria-label={`${s.title} examples`}>
                {s.chips.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        <div className="s-trace">
          <div className="s-trace__answer">
            <span className="s-trace__label">Answer</span>
            Open Reports, then choose New report.
          </div>
          <svg className="s-trace__link" viewBox="0 0 48 12" aria-hidden="true">
            <path d="M2 6h40" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="0.1 5" />
            <circle cx="43" cy="6" r="3" fill="#D2F53C" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          <div className="s-trace__source">
            <span className="s-trace__label">Source</span>
            Creating reports · Lumen Help · section 2
          </div>
        </div>
      </div>
    </section>
  );
}

function Privacy() {
  const items = [
    {
      title: 'Allowlist first',
      body: 'Navoro only reads the context you explicitly approve. Everything else is out of scope by default.',
    },
    {
      title: 'Privacy Blinders',
      body: 'Password fields, payment details and regions an admin marks in Training Mode are excluded in the browser, before anything is sent.',
    },
    {
      title: 'Keys stay server-side',
      body: 'Model and service credentials never reach the browser. The public key in your snippet is an identifier, not a secret.',
    },
    {
      title: 'Origin-verified SDK',
      body: 'Each public key is bound to the origins you list. Requests from anywhere else are refused.',
    },
    {
      title: 'Minimal retention',
      body: 'Navoro keeps what it needs to answer and improve, for as short a time as that takes.',
    },
    {
      title: 'Read-only guidance',
      body: 'Navoro points. It never clicks, types or submits on a user’s behalf.',
    },
  ];
  return (
    <section className="s-section s-privacy" id="privacy" aria-labelledby="privacy-title">
      <div className="s-wrap">
        <div className="s-head">
          <h2 className="s-h2" id="privacy-title">
            Private by construction.
          </h2>
          <p className="s-lede">
            Sensitive data is filtered out on the user’s device, not cleaned up afterwards. The safest data is the data that
            never leaves.
          </p>
        </div>
        <dl className="s-privacy__list">
          {items.map((it) => (
            <div className="s-privacy__item" key={it.title}>
              <dt>{it.title}</dt>
              <dd>{it.body}</dd>
            </div>
          ))}
        </dl>
        <p className="s-privacy__note">
          Plainly: Navoro does not currently claim any compliance certifications. Ask us what we do, and we’ll show you.
        </p>
      </div>
    </section>
  );
}

function Install() {
  return (
    <section className="s-section s-install" id="install" aria-labelledby="install-title">
      <div className="s-wrap s-split s-split--install">
        <div className="s-split__lead">
          <h2 className="s-h2" id="install-title">
            One script tag. No server.
          </h2>
          <ol className="s-steps">
            <li>
              <h3>Point it at your docs</h3>
              <p>
                List your help articles and privacy rules in <code>navoro.config.json</code>, then run{' '}
                <code>navoro-pack</code>. It writes one small knowledge file.
              </p>
            </li>
            <li>
              <h3>Add the script tag</h3>
              <p>Serve the SDK and the knowledge file from your own site. Everything runs in your users’ browsers, offline too.</p>
            </li>
            <li>
              <h3>Mark key controls (optional)</h3>
              <p>
                Add <code>data-navoro-id</code> to the buttons that matter, so pointing survives redesigns.
              </p>
            </li>
          </ol>
        </div>
        <div className="s-code-stack">
          <figure className="s-code">
            <figcaption className="s-code__name">index.html</figcaption>
            <pre tabIndex={0}>
              <code>
                <span className="t-p">&lt;</span>
                <span className="t-tag">script</span>
                {'\n  '}
                <span className="t-attr">src</span>
                <span className="t-p">=</span>
                <span className="t-str">"/navoro/navoro.js"</span>
                {'\n  '}
                <span className="t-attr">data-navoro-pack</span>
                <span className="t-p">=</span>
                <span className="t-str">"/navoro/navoro-pack.json"</span>
                {'\n  '}
                <span className="t-attr">defer</span>
                <span className="t-p">&gt;&lt;/</span>
                <span className="t-tag">script</span>
                <span className="t-p">&gt;</span>
              </code>
            </pre>
          </figure>
          <figure className="s-code">
            <figcaption className="s-code__name">reports.html</figcaption>
            <pre tabIndex={0}>
              <code>
                <span className="t-p">&lt;</span>
                <span className="t-tag">button</span> <span className="t-attr t-hl">data-navoro-id</span>
                <span className="t-p">=</span>
                <span className="t-str">"reports.new"</span>
                <span className="t-p">&gt;</span>
                {'\n  New report\n'}
                <span className="t-p">&lt;/</span>
                <span className="t-tag">button</span>
                <span className="t-p">&gt;</span>
              </code>
            </pre>
          </figure>
        </div>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="s-close" aria-labelledby="close-title">
      <div className="s-wrap s-close__inner">
        <h2 className="s-close__title" id="close-title">
          See it find the button.
        </h2>
        {IS_STATIC ? (
          <>
            <p className="s-close__sub">
              Try Navoro inside a sample app right in your browser — nothing is sent anywhere. Or download it and run the
              whole thing, dashboard included, with one command.
            </p>
            <div className="s-hero__ctas">
              <a href={DOWNLOAD_URL} className="s-btn s-btn--lime">
                <DownloadIcon />
                Download Navoro
              </a>
              <a href={DEMO_URL} className="s-btn s-btn--paper">
                Try the live demo
              </a>
            </div>
          </>
        ) : (
          <>
            <p className="s-close__sub">Open the Lumen demo and ask it anything, or set up Navoro for your own product.</p>
            <div className="s-hero__ctas">
              <a href={DEMO_URL} className="s-btn s-btn--lime">
                Explore the demo
              </a>
              <a href={SIGNUP_URL} className="s-btn s-btn--paper">
                Create a workspace
              </a>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="s-foot">
      <div className="s-wrap s-foot__inner">
        <Logo size={22} />
        <nav aria-label="Footer" className="s-foot__links">
          <a href="#privacy">Privacy</a>
          <a href="#install">Install</a>
          {IS_STATIC ? <a href="#download">Download</a> : <a href={LOGIN_URL}>Sign in</a>}
          <a href={REPO_URL}>GitHub</a>
        </nav>
        <p className="s-foot__copy">© 2026 Navoro</p>
      </div>
    </footer>
  );
}

export function Site() {
  return (
    <>
      <a className="s-skip" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1}>
        <Hero />
        <Why />
        <Pillars />
        <Learning />
        <Privacy />
        <Install />
        <RunLocally />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
