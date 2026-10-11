/**
 * "Run Navoro on your machine": the download-and-run path. On the static landing
 * page (GitHub Pages) this is where every CTA leads; on a running Navoro server
 * it is phrased as "Run your own copy".
 */
import { useEffect, useRef, useState } from 'react';
import { DOWNLOAD_URL, IS_STATIC, LOCAL_APP_URL, LOCAL_DEMO_URL, REPO_URL } from './config.ts';

const COMMAND = 'node start.mjs';
const DEMO_EMAIL = 'demo@navoro.dev';
const DEMO_PASSWORD = 'navoro-demo-2026';

export function DownloadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path d="M10 3v9.5M6 9l4 4 4-4M4 16h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  };

  return (
    <button type="button" className="s-copy" onClick={() => void copy()} data-state={state}>
      <span aria-hidden="true">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Select & copy' : 'Copy'}</span>
      <span className="s-sr">Copy the command {text}</span>
      <span className="s-sr" role="status">
        {state === 'copied' ? 'Command copied to clipboard' : ''}
      </span>
    </button>
  );
}

export function RunLocally() {
  return (
    <section className="s-section s-run" id="download" aria-labelledby="run-title">
      <div className="s-wrap">
        <div className="s-head s-run__head">
          <h2 className="s-h2" id="run-title">
            {IS_STATIC ? 'Run Navoro on your machine.' : 'Run your own copy.'}
          </h2>
          <p className="s-lede">
            The whole product in one small download: dashboard, API, SDK and the Lumen demo app. No database to install, no
            build step, no <code>npm install</code>.
          </p>
          <ul className="s-chips s-run__facts" aria-label="Requirements">
            <li>Node.js 22.18+</li>
            <li>macOS · Windows · Linux</li>
            <li>Built-in SQLite</li>
          </ul>
        </div>

        <div className="s-split s-run__grid">
          <div className="s-run__lead">
            <ol className="s-steps s-run__steps">
              <li>
                <h3>Install Node.js 22.18 or newer</h3>
                <p>
                  Get the LTS from{' '}
                  <a href="https://nodejs.org" className="s-run__link">
                    nodejs.org
                  </a>
                  . Already have it? Check with <code>node --version</code>.
                </p>
              </li>
              <li>
                <h3>Download and unzip</h3>
                <p>
                  <a href={DOWNLOAD_URL} className="s-run__link">
                    navoro.zip
                  </a>{' '}
                  unpacks to a single <code>navoro</code> folder with everything prebuilt.
                </p>
              </li>
              <li>
                <h3>Run one command</h3>
                <p>
                  In that folder, run <code>{COMMAND}</code>. Your browser opens on the dashboard. Press Ctrl+C to stop.
                </p>
              </li>
            </ol>
            <div className="s-hero__ctas s-run__ctas">
              <a href={DOWNLOAD_URL} className="s-btn s-btn--lime">
                <DownloadIcon />
                Download Navoro
              </a>
              <a href={REPO_URL} className="s-btn s-btn--line">
                <GitHubIcon />
                View source on GitHub
              </a>
            </div>
          </div>

          <div className="s-run__side">
            <figure className="s-code s-term">
              <figcaption className="s-code__name s-term__bar">
                <span>Terminal</span>
                <CopyButton text={COMMAND} />
              </figcaption>
              <pre tabIndex={0} aria-label="Terminal session">
                <code>
                  <span className="t-p">$ </span>
                  <span className="t-tag">cd navoro</span>
                  {'\n'}
                  <span className="t-p">$ </span>
                  <span className="t-tag">{COMMAND}</span>
                  {'\n\n'}
                  <span className="t-attr">{'  navoro is running'}</span>
                  {'\n\n'}
                  <span className="t-p">{'  Dashboard   '}</span>
                  <span className="t-str">{LOCAL_APP_URL}</span>
                  {'\n'}
                  <span className="t-p">{'  Lumen demo  '}</span>
                  <span className="t-str">{LOCAL_DEMO_URL.replace(/\/$/, '')}</span>
                </code>
              </pre>
            </figure>

            <dl className="s-run__get">
              <div>
                <dt>Dashboard</dt>
                <dd>
                  <code>localhost:4400</code> with a seeded demo workspace. Sign in as <code>{DEMO_EMAIL}</code> /{' '}
                  <code>{DEMO_PASSWORD}</code>.
                </dd>
              </div>
              <div>
                <dt>Lumen demo app</dt>
                <dd>
                  <code>localhost:4500</code>, a sample product with the Navoro SDK installed. Ask it anything.
                </dd>
              </div>
            </dl>

            <p className="s-privacy__note s-run__note">
              Set <code>ANTHROPIC_API_KEY</code> (in your shell or a <code>.env</code> file) for model-generated answers.
              Without it, Navoro runs in clearly labelled demo mode, answering straight from your docs.
            </p>
          </div>
        </div>

      </div>
    </section>
  );
}
