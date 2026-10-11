import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash, decodeEntities, htmlToText, inferTitle, normalizeText } from '../../server/knowledge/normalize.ts';
import { chunkSections, extractKnowledge, parseSections, stepTitle, workflowContentHash } from '../../server/knowledge/extract.ts';
import { bm25, stem, tokenize } from '../../server/knowledge/retrieve.ts';
import { SAMPLE_DOC } from '../helpers/harness.ts';

const LUMEN = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../server/seed/lumen-help-center.md'), 'utf8');

describe('normalizeText', () => {
  test('normalizes CRLF and lone CR to LF', () => {
    assert.equal(normalizeText('a\r\nb\rc'), 'a\nb\nc');
  });

  test('strips control and bidi/zero-width characters but keeps newlines', () => {
    assert.equal(normalizeText('he\u0000ll\u0007o​ w‮orld\u007F'), 'hello world');
  });

  test('collapses 3+ blank lines, strips trailing spaces, expands tabs and trims', () => {
    assert.equal(normalizeText('  a   \n\n\n\n\tb  '), 'a\n\n  b');
  });
});

describe('htmlToText', () => {
  const html = `<html><head><title>Docs &amp; Help</title><script>alert("x")</script><style>.a{color:red}</style></head>
    <body><nav><a href="/">Menu link</a></nav>
    <main><h2>Create a <em>report</em></h2><p>Click <strong>New report</strong> &mdash; then &lt;save&gt; &#169; &#x41;.</p>
    <ul><li>First</li><li>Second</li></ul><footer>Footer text</footer></main></body></html>`;

  test('drops script, style, nav and footer content', () => {
    const { text } = htmlToText(html);
    assert.doesNotMatch(text, /alert|color:red|Menu link|Footer text/);
  });

  test('keeps headings as markdown and bold as **label**', () => {
    const { text } = htmlToText(html);
    assert.match(text, /^## Create a report$/m);
    assert.match(text, /\*\*New report\*\*/);
    assert.match(text, /- First\n+- Second/);
  });

  test('numbers ordered-list items so they extract as workflow steps', () => {
    const { text } = htmlToText('<main><h2>How to archive</h2><ol><li>Open <b>Projects</b></li><li>Click <b>Archive</b></li></ol><ul><li>Note</li></ul></main>');
    assert.match(text, /^1\. Open \*\*Projects\*\*$/m);
    assert.match(text, /^2\. Click \*\*Archive\*\*$/m);
    assert.match(text, /^- Note$/m);
    assert.deepEqual(extractKnowledge(text).workflows[0]?.steps.map((step) => step.label), ['Projects', 'Archive']);
  });

  test('decodes named and numeric entities, and extracts the title', () => {
    const { text, title } = htmlToText(html);
    assert.equal(title, 'Docs & Help');
    assert.match(text, /— then <save> © A\./);
    assert.equal(decodeEntities('&unknown; &#0;'), '&unknown; ');
  });
});

describe('contentHash and inferTitle', () => {
  test('contentHash is stable, 32 hex chars, and content-sensitive', () => {
    assert.equal(contentHash('abc'), contentHash('abc'));
    assert.match(contentHash('abc'), /^[0-9a-f]{32}$/);
    assert.notEqual(contentHash('abc'), contentHash('abd'));
  });

  test('inferTitle prefers the first heading, then the first line, then the fallback', () => {
    assert.equal(inferTitle('intro\n# **Main** title\ntext', 'x'), 'Main title');
    assert.equal(inferTitle('\n\n  First line here\nsecond', 'x'), 'First line here');
    assert.equal(inferTitle('   ', 'Fallback'), 'Fallback');
    assert.equal(inferTitle(`# ${'a'.repeat(200)}`, 'x').length, 120);
  });
});

describe('extractKnowledge on SAMPLE_DOC', () => {
  const result = extractKnowledge(SAMPLE_DOC);

  test('extracts one workflow with title, key, kind and prerequisites', () => {
    assert.equal(result.workflows.length, 1);
    const [workflow] = result.workflows;
    assert.ok(workflow);
    assert.equal(workflow.key, 'create-a-project');
    assert.equal(workflow.title, 'Create a project');
    assert.equal(workflow.kind, 'task');
    assert.deepEqual(workflow.prerequisites, ['Admin role']);
  });

  test('step titles stop after the first bold label and labels come from bold text', () => {
    const steps = result.workflows[0]?.steps ?? [];
    assert.deepEqual(steps.map((step) => step.title), ['Open Projects', 'Click New project', 'Enter a Project name', 'Click Save project']);
    assert.deepEqual(steps.map((step) => step.label), ['Projects', 'New project', 'Project name', 'Save project']);
    assert.equal(steps[0]?.instruction, 'Open Projects from the sidebar.');
  });

  test('known error keeps code, resolution and lists resolution labels first', () => {
    const error = result.items.find((item) => item.kind === 'known_error');
    assert.ok(error);
    assert.equal(error.title, 'Project name is required');
    assert.equal(error.data.code, 'PROJECT_NAME_REQUIRED');
    assert.equal(error.data.resolution, 'Type a name into Project name and save again.');
    assert.deepEqual(error.data.labels, ['Project name', 'Save project']);
    assert.match(error.body, /Resolution: Type a name/);
  });

  test('extracts feature and glossary concept', () => {
    const feature = result.items.find((item) => item.kind === 'feature');
    assert.equal(feature?.title, 'Projects');
    assert.equal(feature?.body, 'Projects group tasks for a team.');
    const concept = result.items.find((item) => item.kind === 'ui_concept');
    assert.equal(concept?.title, 'Project name');
    assert.deepEqual(concept?.data, { label: 'Project name' });
    assert.deepEqual(result.warnings, []);
  });
});

describe('extractKnowledge on the Lumen help center', () => {
  const result = extractKnowledge(LUMEN);

  test('extracts every how-to workflow with kinds and prerequisites', () => {
    assert.deepEqual(
      result.workflows.map((workflow) => [workflow.key, workflow.kind]),
      [
        ['create-a-report', 'task'],
        ['connect-a-data-warehouse', 'onboarding'],
        ['invite-a-teammate', 'onboarding'],
        ['change-the-workspace-time-zone', 'task'],
      ],
    );
    const report = result.workflows[0];
    assert.deepEqual(report?.prerequisites, ['At least one connected data source', 'You need the Editor role or higher']);
    assert.equal(report?.steps.length, 7);
    assert.equal(report?.steps[1]?.title, 'Click New report');
    assert.equal(report?.steps[6]?.label, 'Create report');
    assert.deepEqual(result.workflows[3]?.prerequisites, []);
  });

  test('known errors carry codes and resolution labels first', () => {
    const errors = result.items.filter((item) => item.kind === 'known_error');
    assert.deepEqual(errors.map((item) => item.data.code), ['REPORT_SOURCE_REQUIRED', 'WAREHOUSE_AUTH_FAILED']);
    assert.deepEqual(errors[0]?.data.labels, ['Data source', 'Integrations', 'Create report']);
    assert.deepEqual(errors[1]?.data.labels, ['Username', 'Password', 'Test connection']);
  });

  test('features and glossary concepts', () => {
    assert.deepEqual(result.items.filter((item) => item.kind === 'feature').map((item) => item.title), ['Reports', 'Integrations']);
    assert.deepEqual(
      result.items.filter((item) => item.kind === 'ui_concept').map((item) => item.title),
      ['Data source', 'Chart type', 'Schedule', 'Workspace name', 'Time zone'],
    );
  });

  test('warns about steps without a UI label', () => {
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0] ?? '', /"Invite a teammate": 1 step\(s\) name no UI control/);
  });
});

describe('extraction edge cases', () => {
  test('unstructured text warns and produces no workflows', () => {
    const result = extractKnowledge('Just a paragraph of prose about the product without any headings at all.');
    assert.equal(result.workflows.length, 0);
    assert.equal(result.items.length, 0);
    assert.equal(result.chunks.length, 1);
    assert.match(result.warnings[0] ?? '', /No headings found/);
  });

  test('duplicate workflow titles get unique keys', () => {
    const doc = '## How to do it\n1. A **X**\n2. B **Y**\n\n## How to do it\n1. C **Z**\n2. D **W**\n';
    assert.deepEqual(extractKnowledge(doc).workflows.map((w) => w.key), ['do-it', 'do-it-2']);
  });

  test('chunks are capped at 1400 characters and keep their heading', () => {
    const longParagraph = 'word '.repeat(1000).trim();
    const many = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} ${'x'.repeat(400)}`).join('\n\n');
    const chunks = chunkSections(parseSections(`## Big\n\n${longParagraph}\n\n## Many\n\n${many}`));
    assert.ok(chunks.length >= 6);
    for (const chunk of chunks) {
      assert.ok(chunk.text.length <= 1400, `chunk too long: ${chunk.text.length}`);
      assert.ok(chunk.heading === 'Big' || chunk.heading === 'Many');
    }
  });

  test('stepTitle truncates long titles without bold', () => {
    const title = stepTitle(`${'Lorem ipsum '.repeat(10)}end`);
    assert.ok(title.length <= 70);
    assert.ok(title.endsWith('…'));
  });

  test('workflowContentHash changes when steps change and is stable otherwise', () => {
    const [a] = extractKnowledge(SAMPLE_DOC).workflows;
    const [b] = extractKnowledge(SAMPLE_DOC).workflows;
    const [c] = extractKnowledge(SAMPLE_DOC.replace('Click **New project**.', 'Click **Add project**.')).workflows;
    assert.ok(a && b && c);
    assert.equal(workflowContentHash(a), workflowContentHash(b));
    assert.notEqual(workflowContentHash(a), workflowContentHash(c));
  });
});

describe('retrieval', () => {
  test('tokenize lowercases, drops stopwords and stems', () => {
    assert.deepEqual(tokenize('How do I create the Reports?'), ['creat', 'report']);
    assert.equal(stem('reports'), stem('report'));
    assert.equal(stem('creating'), stem('create'));
    assert.equal(stem('ox'), 'ox');
  });

  test('bm25 ranks the best match first and reports coverage', () => {
    const docs = [
      { item: 'invite', fields: [{ text: 'Invite a teammate to the workspace', weight: 1 }] },
      { item: 'report', fields: [{ text: 'Create a report', weight: 3 }, { text: 'Reports chart data from a source', weight: 1 }] },
      { item: 'other', fields: [{ text: 'Unrelated content about billing', weight: 1 }] },
    ];
    const results = bm25('create a report', docs);
    assert.equal(results[0]?.item, 'report');
    assert.equal(results[0]?.coverage, 1);
    assert.ok(!results.some((result) => result.item === 'other'));
    const partial = bm25('create invoices', docs);
    assert.equal(partial[0]?.coverage, 0.5);
  });

  test('bm25 returns nothing for empty queries or corpora', () => {
    assert.deepEqual(bm25('the and of', [{ item: 1, fields: [{ text: 'the', weight: 1 }] }]), []);
    assert.deepEqual(bm25('report', []), []);
  });
});
