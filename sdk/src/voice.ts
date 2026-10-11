/**
 * Voice questions via the browser's SpeechRecognition.
 *
 * Privacy: some browsers (notably Chrome by default) send audio to a cloud speech
 * service. Navoro therefore defaults to 'on-device': the mic is offered only when the
 * browser can recognise speech locally (Chrome's `processLocally` API). Apps that
 * accept cloud recognition opt in with voice: 'any'. 'off' hides the mic entirely.
 */

export type VoiceMode = 'on-device' | 'any' | 'off';

interface RecognitionResultEvent {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface RecognitionCtor {
  new (): Recognition;
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
}

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceLang(): string {
  return document.documentElement.lang || navigator.language || 'en-US';
}

/** Resolves to how voice can be offered: 'local', 'local-download' (needs a one-time model install), 'cloud', or null. */
export async function voiceAvailability(mode: VoiceMode): Promise<'local' | 'local-download' | 'cloud' | null> {
  if (mode === 'off') return null;
  // Automated browsers (tests, crawlers) may have no speech service; probing it can
  // crash the tab there, and nobody speaks to a headless browser anyway.
  if (navigator.webdriver) return null;
  const Ctor = ctor();
  if (!Ctor) return null;
  if (typeof Ctor.available === 'function') {
    try {
      const status = await Ctor.available({ langs: [voiceLang()], processLocally: true });
      if (status === 'available') return 'local';
      if (status === 'downloadable' || status === 'downloading') return 'local-download';
    } catch {
      // fall through
    }
  }
  return mode === 'any' ? 'cloud' : null;
}

export interface Listening {
  stop(): void;
}

/**
 * Starts one utterance. `onText(text, final)` receives interim and final transcripts;
 * `onEnd(error?)` fires once. Returns a handle to stop early.
 */
export async function listen(
  how: 'local' | 'local-download' | 'cloud',
  onText: (text: string, final: boolean) => void,
  onEnd: (error?: string) => void,
): Promise<Listening> {
  const Ctor = ctor();
  if (!Ctor) {
    onEnd('unsupported');
    return { stop: () => undefined };
  }
  const lang = voiceLang();
  if (how === 'local-download' && typeof Ctor.install === 'function') {
    const ok = await Ctor.install({ langs: [lang], processLocally: true }).catch(() => false);
    if (!ok) {
      onEnd('install-failed');
      return { stop: () => undefined };
    }
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  if (how !== 'cloud') rec.processLocally = true;
  let ended = false;
  const finish = (error?: string) => {
    if (ended) return;
    ended = true;
    onEnd(error);
  };
  rec.onresult = (event) => {
    let text = '';
    let final = false;
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result) continue;
      text += result[0]?.transcript ?? '';
      if (result.isFinal) final = true;
    }
    onText(text.trim(), final);
  };
  rec.onerror = (event) => finish(event.error || 'error');
  rec.onend = () => finish();
  try {
    rec.start();
  } catch {
    finish('start-failed');
  }
  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        // already stopped
      }
    },
  };
}
