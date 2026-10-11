/**
 * Local mode: everything runs in the page. The SDK loads a knowledge pack (built by
 * navoro-pack) from the app's own origin — or receives it inline — and answers with
 * the on-device engine. No question, context or event is ever sent anywhere.
 */
import type { EnvironmentName, KnowledgePack, PublicSdkConfig, SanitizedContext, GuidanceResult } from '../../packages/contracts/src/sdk-types.ts';
import { answerLocally } from '../../packages/engine/src/answer.ts';
import { PackError, validatePack } from '../../packages/engine/src/pack.ts';

const MAX_PACK_BYTES = 5 * 1024 * 1024;

export class LocalSource {
  readonly #ref: string | KnowledgePack;
  readonly #environment: EnvironmentName;
  #pack: KnowledgePack | null = null;

  constructor(ref: string | KnowledgePack, environment: EnvironmentName) {
    this.#ref = ref;
    this.#environment = environment;
  }

  get pack(): KnowledgePack | null {
    return this.#pack;
  }

  /** Loads and validates the pack; returns the public config the UI needs. */
  async load(signal?: AbortSignal): Promise<PublicSdkConfig> {
    let data: unknown = this.#ref;
    if (typeof this.#ref === 'string') {
      const url = new URL(this.#ref, location.href);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new PackError('Knowledge pack URL must be http(s).');
      // Only fetching a static file; nothing about the user is sent.
      const res = await fetch(url.href, { credentials: 'same-origin', cache: 'no-cache', signal });
      if (!res.ok) throw new PackError(`Knowledge pack not found (${res.status}) at ${url.pathname}.`);
      const text = await res.text();
      if (text.length > MAX_PACK_BYTES) throw new PackError('Knowledge pack is larger than 5 MB.');
      try {
        data = JSON.parse(text);
      } catch {
        throw new PackError('Knowledge pack is not valid JSON.');
      }
    }
    const pack = validatePack(data);
    this.#pack = pack;
    return {
      applicationName: pack.application.name,
      environment: this.#environment,
      configVersion: 0,
      privacy: {
        observe: pack.privacy.observe,
        // Nothing is transmitted in local mode; "transmit" here means "given to the on-device engine".
        transmit: pack.privacy.observe,
        blockedNavoroIds: pack.privacy.blockedNavoroIds,
        blockedSelectors: pack.privacy.blockedSelectors,
        approvedNavoroIds: pack.privacy.approvedNavoroIds,
        allowlistOnly: true,
      },
      analyticsEnabled: false,
      discoveryEnabled: false,
      launcher: { position: 'bottom-right', greeting: pack.launcher.greeting, suggestions: pack.launcher.suggestions },
      supportUrl: pack.supportUrl,
    };
  }

  answer(input: { question: string; context: SanitizedContext; requestId: string; sessionId?: string }): GuidanceResult {
    if (!this.#pack) throw new PackError('Knowledge pack not loaded.');
    return answerLocally(this.#pack, input).result;
  }
}
