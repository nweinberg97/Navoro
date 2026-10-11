/**
 * Safe retrieval of public documentation URLs and YouTube transcripts.
 *
 * SSRF protections: http(s) only, no credentials in URLs, DNS answers are
 * validated inside the socket `lookup` hook (so the checked address is the one
 * connected to), private/loopback/link-local ranges are refused unless
 * NAVORO_ALLOW_PRIVATE_URLS is enabled (development only), redirects are
 * re-validated hop by hop (max 3), responses are size- and time-limited, and
 * only text content types are accepted.
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { decodeEntities, htmlToText, normalizeText } from './normalize.ts';

export class FetchError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.userMessage = userMessage;
  }
}

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower.startsWith('ff');
}

interface FetchOptions {
  allowPrivate: boolean;
  accept?: string;
}

function guardedLookup(allowPrivate: boolean): net.LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, '', 4);
      const list = (Array.isArray(addresses) ? addresses : []) as dns.LookupAddress[];
      const blocked = list.find((entry) => isPrivateAddress(entry.address));
      if (!allowPrivate && blocked) {
        return callback(new FetchError('That address points to a private network, which Navoro will not fetch.') as NodeJS.ErrnoException, '', 4);
      }
      const first = list[0];
      if (!first) return callback(new Error('No DNS answer') as NodeJS.ErrnoException, '', 4);
      if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
      callback(null, first.address, first.family);
    });
  };
}

export function validatePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new FetchError('Enter a full URL, starting with https://');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchError('Only http(s) URLs can be imported.');
  if (url.username || url.password) throw new FetchError('URLs with embedded credentials are not allowed.');
  return url;
}

function request(url: URL, options: FetchOptions): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup(options.allowPrivate),
        headers: {
          'user-agent': 'NavoroKnowledgeBot/0.1 (+documentation import)',
          accept: options.accept ?? 'text/html,text/markdown,text/plain;q=0.9,*/*;q=0.1',
          'accept-language': 'en',
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new FetchError('The page is larger than 2 MB.'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new FetchError('The site took longer than 10 seconds to respond.')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchWithRedirects(start: URL, options: FetchOptions): Promise<{ url: URL; contentType: string; body: string }> {
  let url = start;
  for (let hop = 0; hop <= 3; hop += 1) {
    let response;
    try {
      response = await request(url, options);
    } catch (error) {
      if (error instanceof FetchError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new FetchError(`Couldn't resolve ${url.hostname}.`);
      if (code === 'ECONNREFUSED') throw new FetchError(`${url.host} refused the connection.`);
      throw new FetchError(`Couldn't reach ${url.host} (${code ?? 'network error'}).`);
    }
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      url = validatePublicUrl(new URL(response.headers.location, url).toString());
      continue;
    }
    if (response.status === 401 || response.status === 403) throw new FetchError(`The page requires sign-in or blocks automated access (HTTP ${response.status}). Paste the article text instead.`);
    if (response.status === 404) throw new FetchError('The page was not found (HTTP 404).');
    if (response.status < 200 || response.status >= 300) throw new FetchError(`The site responded with HTTP ${response.status}.`);
    const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
    return { url, contentType, body: response.body };
  }
  throw new FetchError('Too many redirects.');
}

export interface FetchedDocument {
  text: string;
  title: string | null;
  finalUrl: string;
  contentType: string;
}

export async function fetchDocumentationUrl(raw: string, allowPrivate: boolean): Promise<FetchedDocument> {
  const url = validatePublicUrl(raw);
  const { url: finalUrl, contentType, body } = await fetchWithRedirects(url, { allowPrivate });
  if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
    const { text, title } = htmlToText(body);
    return { text, title, finalUrl: finalUrl.toString(), contentType };
  }
  if (contentType.startsWith('text/') || contentType.includes('markdown') || contentType === '') {
    return { text: normalizeText(body), title: null, finalUrl: finalUrl.toString(), contentType: contentType || 'text/plain' };
  }
  throw new FetchError(`Unsupported content type "${contentType}". Navoro imports HTML, Markdown and plain-text pages.`);
}

export function youtubeVideoId(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.replace(/^www\.|^m\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.slice(1);
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = url.searchParams.get('v') ?? (/^\/(embed|shorts|live)\/([^/?]+)/.exec(url.pathname)?.[2] ?? null);
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Retrieves a public caption track for a YouTube video. Works only when the
 * video exposes captions publicly; otherwise fails with a clear explanation.
 */
export async function fetchYouTubeTranscript(raw: string): Promise<FetchedDocument> {
  const videoId = youtubeVideoId(raw);
  if (!videoId) throw new FetchError('That doesn’t look like a YouTube video URL.');
  const watchUrl = new URL(`https://www.youtube.com/watch?v=${videoId}&hl=en`);
  const page = await fetchWithRedirects(watchUrl, { allowPrivate: false });
  const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(page.body);
  const title = titleMatch?.[1] ? decodeEntities(titleMatch[1]).replace(/\s*-\s*YouTube\s*$/, '').trim() : null;
  const tracksMatch = /"captionTracks":(\[.*?\])/.exec(page.body);
  if (!tracksMatch?.[1]) {
    throw new FetchError('This video has no publicly accessible transcript (captions are disabled, private, or require sign-in). Paste a transcript as text instead.');
  }
  let tracks: Array<{ baseUrl: string; languageCode?: string; kind?: string }>;
  try {
    tracks = JSON.parse(tracksMatch[1]) as typeof tracks;
  } catch {
    throw new FetchError('YouTube returned caption data Navoro could not read. Paste a transcript as text instead.');
  }
  const track = tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ?? tracks.find((t) => t.languageCode?.startsWith('en')) ?? tracks[0];
  if (!track?.baseUrl) throw new FetchError('No usable caption track was found for this video.');
  const captionUrl = validatePublicUrl(track.baseUrl.replace(/\\u0026/g, '&'));
  if (!captionUrl.hostname.endsWith('youtube.com')) throw new FetchError('Unexpected caption host; refusing to fetch.');
  const captions = await fetchWithRedirects(captionUrl, { allowPrivate: false, accept: 'text/xml,application/xml,*/*;q=0.1' });
  const lines = [...captions.body.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((match) => decodeEntities(decodeEntities(match[1] ?? '')).replace(/\s+/g, ' ').trim());
  const text = normalizeText(lines.filter(Boolean).join(' ').replace(/([.!?])\s+/g, '$1\n'));
  if (text.length < 40) throw new FetchError('The transcript was empty.');
  return { text: `# ${title ?? 'Video transcript'}\n\n${text}`, title, finalUrl: watchUrl.toString(), contentType: 'transcript' };
}
