/**
 * Build-time site configuration. The same site ships in two modes:
 *   - 'app'    served by a running Navoro server: CTAs go to the live dashboard and demo.
 *   - 'static' the GitHub Pages landing page: CTAs download the runnable zip instead,
 *              and nothing points at localhost.
 */
export const SITE_MODE: 'app' | 'static' =
  typeof __NAVORO_SITE_MODE__ !== 'undefined' && __NAVORO_SITE_MODE__ === 'static' ? 'static' : 'app';

export const IS_STATIC = SITE_MODE === 'static';

export const REPO_URL: string =
  typeof __NAVORO_REPO_URL__ !== 'undefined' ? __NAVORO_REPO_URL__ : 'https://github.com/nweinberg97/Navoro';

export const DOWNLOAD_URL: string =
  typeof __NAVORO_DOWNLOAD_URL__ !== 'undefined'
    ? __NAVORO_DOWNLOAD_URL__
    : 'https://github.com/nweinberg97/Navoro/releases/latest/download/navoro.zip';

/** The Lumen demo app a local Navoro serves next to the dashboard. */
export const LOCAL_DEMO_URL = 'http://localhost:4500/';
export const LOCAL_APP_URL = 'http://localhost:4400';
