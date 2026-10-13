/**
 * On-device guidance engine. Answers a question from a knowledge pack and the
 * sanitized screen context, with no network and no model. Pure and synchronous:
 * it runs in the browser SDK (local mode) and is unit-tested in Node.
 *
 * It uses context in three ways:
 *   1. Visible error codes/messages on screen select the matching troubleshooting rule
 *      ("what's wrong?" next to a validation error).
 *   2. Workflows whose controls are on the current screen rank higher, so ambiguous
 *      questions resolve to what the user is looking at.
 *   3. (In the SDK) walkthroughs start at the step matching where the user already is.
 *
 * It never invents: every step and target comes from the pack, and when nothing in
 * the pack matches it says so instead of guessing.
 */
import type {
  Citation,
  GuidanceKind,
  GuidanceResult,
  GuidanceStep,
  GuidanceTarget,
  KnowledgePack,
  PackChunk,
  PackItem,
  PackMapping,
  PackWorkflow,
  SanitizedContext,
} from '../../contracts/src/sdk-types.ts';
import { bm25, tokenize, type Scored } from './retrieve.ts';

export function normalizeLabel(label: string): string {
  return label.toLowerCase().replace(/[“”"'’]/g, '').replace(/\s+/g, ' ').trim();
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const PROCEDURAL = /\b(how|where|create|add|make|new|connect|set|setup|change|edit|update|invite|find|open|start|configure|enable|turn|schedule|build|use|delete|remove|download|import|export|send|save)\b/i;
const TROUBLE = /\b(why|error|can'?t|cannot|won'?t|doesn'?t|isn'?t|fail(ed|ing|s)?|broken|wrong|problem|issue|stuck|denied|fix|full)\b/i;
const DEFINITION = /\b(what\s+(is|are|does|do)|what'?s|mean(s|ing)?|define|definition|difference)\b/i;
/**
 * Problems a how-to guide can't solve: the user wants a person, money or account
 * changes, or reports something broken that the docs don't cover. These go straight
 * to support instead of a guessed answer.
 */
const HANDOFF = /\b((talk|speak|chat)\s+(to|with)\s+(a\s+|an\s+|your\s+)?(human|person|someone|agent|support|rep(resentative)?)|contact\s+(support|you|someone|a\s+human)|customer\s+(service|support)|real\s+person|refund|charged|overcharged|invoice\s+is\s+wrong|billing\s+(issue|problem)|cancel\s+my\s+(account|subscription|plan)|delete\s+my\s+account|bug|crash(ed|es|ing)?|data\s+(is\s+)?(gone|lost|missing)|lost\s+(my\s+|all\s+(my\s+)?)?(data|work|everything|cards?|notes?|files?)|still\s+(broken|not\s+working|doesn'?t\s+work)|(didn'?t|doesn'?t|did\s+not)\s+help)\b/i;

/** Contact action for unsolved problems: a pre-filled email the user reviews and sends themselves. */
export function contactFallback(pack: Pick<KnowledgePack, 'application' | 'supportEmail' | 'supportUrl'>, question: string, context: SanitizedContext): GuidanceResult['fallback'] {
  const app = pack.application.name;
  if (pack.supportEmail && /^[^\s@<>()"]+@[^\s@<>()"]+\.[^\s@<>()"]+$/.test(pack.supportEmail)) {
    const subject = `Help with ${app}: ${question.slice(0, 80)}`;
    const body = [question, '', '—', context.route ? `Page: ${context.route}` : null, `Sent from ${app}'s in-app help. Edit anything before sending.`]
      .filter((line) => line !== null)
      .join('\n');
    return { label: 'Email support', url: `mailto:${pack.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` };
  }
  if (pack.supportUrl && /^https?:\/\//.test(pack.supportUrl)) return { label: 'Contact support', url: pack.supportUrl };
  return { label: `Contact ${app}'s support team`, url: null };
}

interface Candidates {
  workflows: Array<Scored<PackWorkflow>>;
  errors: Array<Scored<PackItem>>;
  contextErrors: PackItem[];
  concepts: Array<Scored<PackItem>>;
  chunks: Array<Scored<PackChunk>>;
}

function confidenceFrom(hit: { score: number; coverage: number }): number {
  return Math.round(Math.min(0.95, 0.3 + 0.5 * hit.coverage + 0.15 * Math.min(1, hit.score / 6)) * 100) / 100;
}

function excerpt(text: string, max = 220): string {
  const clean = text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function bestSentences(text: string, question: string, count = 2): string {
  const terms = new Set(tokenize(question));
  const sentences = text
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  if (!sentences.length) return excerpt(text, 400);
  return sentences
    .map((sentence, index) => ({ sentence, index, score: tokenize(sentence).filter((token) => terms.has(token)).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, count)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence)
    .join(' ');
}

/** Ids of approved controls currently on screen (from the sanitized context). */
function onScreen(context: SanitizedContext): Set<string> {
  return new Set((context.elements ?? []).map((element) => element.navoroId));
}

function navoroIdOf(mapping: PackMapping | undefined): string | null {
  const strategy = mapping?.strategies.find((entry) => entry.type === 'navoro_id');
  return strategy ? strategy.value : null;
}

function retrieve(pack: KnowledgePack, question: string, context: SanitizedContext, mappings: Map<string, PackMapping>): Candidates {
  const errorItems = pack.items.filter((item) => item.kind === 'known_error' || item.kind === 'troubleshooting');
  const visible = context.visibleErrors ?? [];
  const codes = visible.map((error) => error.code).filter((code): code is string => Boolean(code));
  const messages = visible.map((error) => error.message ?? '').filter(Boolean);
  const contextErrors = errorItems.filter((item) => {
    if (item.data.code && codes.includes(item.data.code)) return true;
    return messages.some((message) => normalizeLabel(message).includes(normalizeLabel(item.title)) || normalizeLabel(item.title).includes(normalizeLabel(message)));
  });

  // Context: favour workflows whose controls are on the current screen.
  const present = onScreen(context);
  const workflows = bm25(
    question,
    pack.workflows.map((workflow) => ({
      item: workflow,
      fields: [
        { text: workflow.title, weight: 3 },
        { text: workflow.summary, weight: 1 },
        { text: workflow.steps.map((step) => step.instruction).join(' '), weight: 0.5 },
      ],
    })),
  )
    .map((hit) => {
      if (!present.size) return hit;
      const ids = hit.item.steps.map((step) => navoroIdOf(step.targetKey ? mappings.get(step.targetKey) : undefined)).filter(Boolean);
      const share = ids.length ? ids.filter((id) => present.has(id as string)).length / ids.length : 0;
      return { ...hit, score: hit.score * (1 + 0.2 * share) };
    })
    .sort((a, b) => b.score - a.score);

  return {
    workflows,
    errors: bm25(question, errorItems.map((item) => ({ item, fields: [{ text: item.title, weight: 3 }, { text: item.body, weight: 1 }] }))),
    contextErrors,
    concepts: bm25(
      question,
      pack.items.filter((item) => item.kind === 'ui_concept').map((item) => ({ item, fields: [{ text: item.title, weight: 4 }, { text: item.body, weight: 0.5 }] })),
    ),
    chunks: bm25(question, pack.chunks.map((chunk) => ({ item: chunk, fields: [{ text: chunk.heading ?? '', weight: 2 }, { text: chunk.text, weight: 1 }] }))),
  };
}

function toTarget(mapping: PackMapping | undefined): { target: GuidanceTarget | null; note: string | null } {
  if (!mapping) return { target: null, note: 'No interface control is mapped for this step.' };
  if (mapping.validation === 'broken') {
    return { target: null, note: `The control for this step (“${mapping.label}”) changed and is awaiting review, so it isn’t highlighted.` };
  }
  if (!mapping.strategies.length) return { target: null, note: 'No interface control is mapped for this step.' };
  return {
    target: { key: mapping.key, label: mapping.label, strategies: mapping.strategies, confidence: mapping.confidence, validation: mapping.validation },
    note: null,
  };
}

function workflowSteps(workflow: PackWorkflow, mappings: Map<string, PackMapping>): GuidanceStep[] {
  return workflow.steps.map((step, index) => {
    const { target, note } = step.targetKey ? toTarget(mappings.get(step.targetKey)) : { target: null, note: null };
    return { index, title: step.title, instruction: step.instruction, target, targetNote: note };
  });
}

function singleTargetStep(mappings: Map<string, PackMapping>, labels: string[], nearNavoroId: string | null, title: string, instruction: string): GuidanceStep[] {
  let mapping: PackMapping | undefined;
  if (nearNavoroId) mapping = [...mappings.values()].find((entry) => navoroIdOf(entry) === nearNavoroId);
  for (const label of labels) {
    if (mapping) break;
    mapping = mappings.get(slug(label));
  }
  const { target, note } = toTarget(mapping);
  if (!target) return [];
  return [{ index: 0, title, instruction, target, targetNote: note }];
}

export interface LocalAnswer {
  result: GuidanceResult;
  /** Short topic label (workflow / error / term title) for any on-device analytics the host keeps. */
  topic: string;
}

export function answerLocally(
  pack: KnowledgePack,
  input: { question: string; context: SanitizedContext; requestId: string; sessionId?: string },
): LocalAnswer {
  const question = input.question.trim().slice(0, 500);
  const context = input.context;
  const mappings = new Map(pack.mappings.map((mapping) => [mapping.key, mapping]));
  const candidates = retrieve(pack, question, context, mappings);

  let kind: GuidanceKind = 'unresolved';
  let answer = `I couldn't find this in ${pack.application.name}'s help, so I'd rather not guess. Try naming the feature or screen you're working with.`;
  let grounded = false;
  let confidence = 0;
  let workflow: PackWorkflow | null = null;
  let steps: GuidanceStep[] = [];
  let citations: Citation[] = [];
  let topic = 'Unmatched questions';

  const topWorkflow = candidates.workflows[0];
  const troubleIntent = TROUBLE.test(question);
  const contextError = candidates.contextErrors[0];
  const questionError = candidates.errors[0];
  // An error on screen only answers questions about a problem ("why", "what's wrong"),
  // vague ones ("help?"), or ones that match that error — never unrelated questions.
  // Vague = short and not clearly about any documented task ("help?", "what now").
  const vague = tokenize(question).length <= 3 && !(topWorkflow && topWorkflow.coverage >= 0.5);
  const handoffIntent = HANDOFF.test(question);
  const errorPick = handoffIntent
    ? null
    : contextError && (troubleIntent || vague || questionError?.item.id === contextError.id)
    ? { item: contextError, confidence: 0.9 }
    : questionError && troubleIntent && questionError.coverage >= 0.4
      ? { item: questionError.item, confidence: confidenceFrom(questionError) }
      : null;

  if (handoffIntent) {
    kind = 'unresolved';
    answer = `That sounds like something the ${pack.application.name} support team needs to handle — I can only show you how to do things in the app. I've filled in your question below; check it and send it.`;
    topic = 'Handed off to support';
  } else if (errorPick) {
    const data = errorPick.item.data;
    const description = errorPick.item.body.split('\n\n')[0] ?? '';
    const resolution = data.resolution ?? '';
    const near = (context.visibleErrors ?? []).find((error) => error.code && error.code === data.code)?.nearNavoroId ?? null;
    kind = 'troubleshooting';
    answer = [description, resolution].filter(Boolean).join(' ').trim();
    grounded = true;
    confidence = errorPick.confidence;
    steps = singleTargetStep(mappings, data.labels ?? [], near, 'Fix it here', resolution || description);
    citations = [{ sourceId: errorPick.item.id, sourceTitle: errorPick.item.sourceTitle, excerpt: excerpt(errorPick.item.body) }];
    topic = errorPick.item.title;
  } else if (topWorkflow && topWorkflow.coverage >= 0.5 && topWorkflow.score >= 1 && (PROCEDURAL.test(question) || topWorkflow.coverage >= 0.75) && !DEFINITION.test(question)) {
    workflow = topWorkflow.item;
    steps = workflowSteps(workflow, mappings);
    const lead = `Here's how to ${workflow.title.charAt(0).toLowerCase()}${workflow.title.slice(1)}: ${steps.length} step${steps.length === 1 ? '' : 's'}. I'll point to each control as you go.`;
    const prereq = workflow.prerequisites.length ? ` Before you start: ${workflow.prerequisites.join('; ')}.` : '';
    kind = 'workflow';
    answer = `${lead}${prereq}`;
    grounded = true;
    confidence = Math.min(confidenceFrom(topWorkflow), workflow.confidence + 0.05);
    citations = [{ sourceId: workflow.id, sourceTitle: workflow.sourceTitle, excerpt: excerpt(workflow.excerpt || workflow.summary) }];
    topic = workflow.title;
  } else {
    const concept = candidates.concepts[0];
    const chunk = candidates.chunks[0];
    if (concept && concept.coverage >= 0.5 && (DEFINITION.test(question) || concept.coverage === 1)) {
      const label = concept.item.data.label ?? concept.item.title;
      kind = 'answer';
      answer = `${concept.item.title}: ${concept.item.body}`;
      grounded = true;
      confidence = confidenceFrom(concept);
      steps = singleTargetStep(mappings, [label], null, `Here’s “${label}”`, concept.item.body);
      citations = [{ sourceId: concept.item.id, sourceTitle: concept.item.sourceTitle, excerpt: excerpt(concept.item.body) }];
      topic = concept.item.title;
    } else if (chunk && chunk.coverage >= 0.5) {
      kind = 'answer';
      answer = bestSentences(chunk.item.text, question);
      grounded = true;
      confidence = confidenceFrom(chunk);
      citations = [{ sourceId: chunk.item.id, sourceTitle: chunk.item.sourceTitle, excerpt: excerpt(chunk.item.text) }];
      topic = chunk.item.heading ?? chunk.item.sourceTitle;
    }
  }

  // Always attached: the panel shows it up front when the answer is unresolved or
  // low-confidence, and after "Not helpful" otherwise.
  const fallback = contactFallback(pack, question, context);

  return {
    topic,
    result: {
      sessionId: input.sessionId ?? `local-${input.requestId}`,
      requestId: input.requestId,
      kind,
      answer: answer.slice(0, 1200),
      grounded,
      confidence,
      workflow: workflow ? { id: workflow.id, title: workflow.title } : null,
      steps,
      citations: citations.slice(0, 4),
      mode: 'local',
      fallback,
    },
  };
}
