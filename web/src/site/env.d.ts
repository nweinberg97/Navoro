declare module '*.css';

/**
 * Injected by esbuild `define` (scripts/build.ts, scripts/build-pages.ts).
 * Read them through ./config.ts, which falls back to defaults when undefined.
 */
/** 'app' when served by the Navoro server, 'static' for the GitHub Pages landing page. */
declare const __NAVORO_SITE_MODE__: 'app' | 'static';
/** Where "Download Navoro" points (the rolling release zip). */
declare const __NAVORO_DOWNLOAD_URL__: string;
/** Public source repository. */
declare const __NAVORO_REPO_URL__: string;
