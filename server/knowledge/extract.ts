/**
 * Deterministic structured-knowledge extraction from normalized documentation.
 *
 * Recognizes common help-center structure:
 *   - "## How to …" / any section with an ordered list  → Workflow + steps
 *   - "Prerequisites: …"                                → workflow prerequisites
 *   - "## Feature: …" / "## Overview: …"                → Feature
 *   - "## Troubleshooting: <message> (CODE)"            → Known error + resolution
 *   - "## Glossary" lists of "**Term** — definition"    → UI concepts
 *   - **Bold** text inside steps                        → UI label hints for element mapping
 *
 * This runs without any model, so ingestion works offline and is fully
 * reproducible. When a model is configured, `server/ai/extraction.ts` can
 * refine summaries, but targets are always resolved here against approved
 * application metadata — never taken from model output.
 */
import { contentHash } from './normalize.ts';
import type { DerivedChunk, DerivedItem } from '../data/knowledge.ts';
import type { ExtractedWorkflow } from '../data/guidance.ts';

export interface Section {
  level: number;
  heading: string | null;
  lines: string[];
}

export interface ExtractionResult {
  chunks: DerivedChunk[];
  items: DerivedItem[];
  workflows: Array<Omit<ExtractedWorkflow, 'steps' | 'confidence' | 'contentHash'> & { steps: Array<{ title: string; instruction: string; label: string | null; excerpt: string }> }>;
  warnings: string[];
}

const MAX_CHUNK_CHARS = 1_400;

export function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|\W)[*_](\S.*?\S|\S)[*_](?=\W|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function boldLabels(text: string): string[] {
  const labels: string[] = [];
  for (const match of text.matchAll(/\*\*(.+?)\*\*/g)) {
    const label = match[1]?.trim();
    if (label && label.length <= 60) labels.push(label);
  }
  return labels;
}

export function parseSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { level: 0, heading: null, lines: [] };
  for (const line of text.split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1] && heading[2]) {
      if (current.heading !== null || current.lines.some((l) => l.trim())) sections.push(current);
      current = { level: heading[1].length, heading: stripMarkdown(heading[2]), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading !== null || current.lines.some((l) => l.trim())) sections.push(current);
  return sections;
}

/** Splits text into retrieval chunks, one or more per section, preserving headings. */
export function chunkSections(sections: Section[]): DerivedChunk[] {
  const chunks: DerivedChunk[] = [];
  for (const section of sections) {
    const body = section.lines.join('\n').trim();
    if (!body && !section.heading) continue;
    if (!body) continue;
    const paragraphs = body.split(/\n{2,}/);
    let buffer = '';
    for (const paragraph of paragraphs) {
      if (buffer && buffer.length + paragraph.length > MAX_CHUNK_CHARS) {
        chunks.push({ heading: section.heading, text: buffer.trim() });
        buffer = '';
      }
      if (paragraph.length > MAX_CHUNK_CHARS) {
        for (let index = 0; index < paragraph.length; index += MAX_CHUNK_CHARS) {
          chunks.push({ heading: section.heading, text: paragraph.slice(index, index + MAX_CHUNK_CHARS).trim() });
        }
        continue;
      }
      buffer += `${paragraph}\n\n`;
    }
    if (buffer.trim()) chunks.push({ heading: section.heading, text: buffer.trim() });
  }
  return chunks;
}

interface ListItem {
  ordered: boolean;
  text: string;
}

function listItems(lines: string[]): ListItem[] {
  const items: ListItem[] = [];
  for (const line of lines) {
    const ordered = /^\s{0,3}(\d{1,2})[.)]\s+(.+)$/.exec(line);
    const bullet = /^\s{0,3}[-*+]\s+(.+)$/.exec(line);
    if (ordered?.[2]) items.push({ ordered: true, text: ordered[2].trim() });
    else if (bullet?.[1]) items.push({ ordered: false, text: bullet[1].trim() });
    else if (items.length && /^\s{2,}\S/.test(line)) {
      const last = items[items.length - 1];
      if (last) last.text += ` ${line.trim()}`;
    }
  }
  return items;
}

function paragraphsOf(lines: string[]): string[] {
  return lines
    .join('\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !/^\s*(\d{1,2}[.)]|[-*+])\s/.test(paragraph));
}

function prerequisitesOf(lines: string[]): string[] {
  const line = lines.find((l) => /^\s*(prerequisites?|before you (begin|start)|requirements?)\s*:/i.test(l));
  if (!line) return [];
  return line
    .replace(/^\s*[^:]+:\s*/, '')
    .split(/(?<=\.)\s+|;\s*/)
    .map((part) => stripMarkdown(part).replace(/\.$/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** "Click **New report** in the top right" → "Click New report". */
export function stepTitle(rawText: string): string {
  const firstBold = /\*\*(.+?)\*\*/.exec(rawText);
  let title: string;
  if (firstBold && firstBold.index < 80) {
    title = stripMarkdown(rawText.slice(0, firstBold.index + firstBold[0].length));
  } else {
    title = stripMarkdown(rawText).split(/(?<=[.!?])\s|,\s/)[0] ?? stripMarkdown(rawText);
  }
  title = title.replace(/[.:,;]+$/, '').trim();
  return title.length > 70 ? `${title.slice(0, 67).trimEnd()}…` : title;
}

function workflowTitle(heading: string): string {
  const stripped = heading.replace(/^how\s+(do\s+i|to|can\s+i)\s+/i, '').replace(/\?$/, '').trim();
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function workflowKind(title: string): 'task' | 'onboarding' {
  return /\b(first|get(ting)?\s+started|set\s*up|setup|onboard|invite|connect)\b/i.test(title) ? 'onboarding' : 'task';
}

export function extractKnowledge(text: string): ExtractionResult {
  const sections = parseSections(text);
  const chunks = chunkSections(sections);
  const items: DerivedItem[] = [];
  const workflows: ExtractionResult['workflows'] = [];
  const warnings: string[] = [];
  const usedKeys = new Set<string>();

  for (const section of sections) {
    const heading = section.heading ?? '';
    const body = section.lines.join('\n').trim();
    const paragraphs = paragraphsOf(section.lines);
    const list = listItems(section.lines);

    const featureMatch = /^(feature|overview|about)\s*[:—-]\s*(.+)$/i.exec(heading);
    if (featureMatch?.[2]) {
      items.push({ kind: 'feature', title: featureMatch[2].trim(), body: stripMarkdown(paragraphs.join(' ')).slice(0, 1200), data: {}, excerpt: body.slice(0, 300) });
      continue;
    }

    const troubleMatch = /^(troubleshooting|error|known issue)\s*[:—-]\s*(.+?)(?:\s*\(([A-Z][A-Z0-9_]{2,})\))?$/i.exec(heading);
    if (troubleMatch?.[2]) {
      const resolutionParagraph = paragraphs.find((p) => /^\s*(resolution|fix|solution|how to fix)\s*:/i.test(p));
      const resolution = resolutionParagraph ? stripMarkdown(resolutionParagraph.replace(/^\s*[^:]+:\s*/, '')) : null;
      const description = stripMarkdown(paragraphs.filter((p) => p !== resolutionParagraph).join(' '));
      items.push({
        kind: 'known_error',
        title: troubleMatch[2].trim(),
        body: [description, resolution ? `Resolution: ${resolution}` : ''].filter(Boolean).join('\n\n').slice(0, 1600),
        data: {
          code: troubleMatch[3] ?? null,
          message: troubleMatch[2].trim(),
          resolution,
          labels: [...new Set([...boldLabels(resolutionParagraph ?? ''), ...boldLabels(body)])],
        },
        excerpt: body.slice(0, 400),
      });
      continue;
    }

    if (/^(glossary|terms|terminology|fields|definitions)$/i.test(heading)) {
      for (const item of list) {
        const match = /^\*\*(.+?)\*\*\s*(?:[—–:-]+)\s*(.+)$/.exec(item.text);
        if (match?.[1] && match[2]) {
          items.push({ kind: 'ui_concept', title: match[1].trim(), body: stripMarkdown(match[2]), data: { label: match[1].trim() }, excerpt: item.text.slice(0, 300) });
        }
      }
      continue;
    }

    const orderedItems = list.filter((item) => item.ordered);
    if (orderedItems.length >= 2 && heading) {
      const title = workflowTitle(heading);
      let key = slug(title) || `workflow-${workflows.length + 1}`;
      while (usedKeys.has(key)) key = `${key}-2`;
      usedKeys.add(key);
      const summaryParagraph = paragraphs.find((p) => !/^\s*(prerequisites?|before you|requirements?)\s*:/i.test(p));
      const steps = orderedItems.map((item) => ({
        title: stepTitle(item.text),
        instruction: stripMarkdown(item.text),
        label: boldLabels(item.text)[0] ?? null,
        excerpt: item.text.slice(0, 300),
      }));
      workflows.push({
        key,
        title,
        summary: summaryParagraph
          ? stripMarkdown(summaryParagraph).slice(0, 400)
          : `${steps.length} steps, from “${steps[0]?.title ?? ''}” to “${steps[steps.length - 1]?.title ?? ''}”.`,
        kind: workflowKind(title),
        prerequisites: prerequisitesOf(section.lines),
        steps,
      });
      if (steps.some((step) => !step.label)) {
        warnings.push(`"${title}": ${steps.filter((step) => !step.label).length} step(s) name no UI control, so they will show without a highlight.`);
      }
      continue;
    }

    if (heading && paragraphs.length && section.level >= 2) {
      // Plain explanatory section: keep it as retrievable text (already chunked).
      continue;
    }
  }

  if (!sections.some((section) => section.heading)) {
    warnings.push('No headings found. The text is searchable, but no workflows or troubleshooting rules could be structured from it.');
  }
  return { chunks, items, workflows, warnings };
}

/** Stable content hash of an extracted workflow, used to detect changes across reprocessing. */
export function workflowContentHash(workflow: ExtractionResult['workflows'][number]): string {
  return contentHash(JSON.stringify([workflow.title, workflow.summary, workflow.prerequisites, workflow.steps.map((step) => [step.instruction, step.label])]));
}
