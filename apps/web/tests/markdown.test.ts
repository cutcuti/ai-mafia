import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Markdown } from '../lib/markdown';

const html = (src: string) => renderToStaticMarkup(createElement(Markdown, { source: src }));

test('renders headings, lists, bold, code and links', () => {
  const out = html('# Title\n\n## Sub section\n\nSome **bold** and `code`.\n\n- one\n- [two](https://x.org)\n\n```\npnpm x\n```');
  assert.match(out, /<h2 id="title"[^>]*>Title<\/h2>/);
  assert.match(out, /<h3 id="sub-section"/);
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<code[^>]*>code<\/code>/);
  assert.match(out, /<li>one<\/li>/);
  assert.match(out, /<a href="https:\/\/x.org"[^>]*rel="noopener noreferrer">two<\/a>/);
  assert.match(out, /<pre[^>]*><code>pnpm x<\/code><\/pre>/);
});

test('escapes HTML and neutralises unsafe link schemes', () => {
  const out = html('<script>alert(1)</script> and [x](javascript:alert(1))');
  assert.ok(!out.includes('<script>'));
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /<a href="#"/);
});

test('the real methodology doc renders every section', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../../docs/METHODOLOGY.md', import.meta.url), 'utf8');
  const out = html(src);
  for (const id of ['the-game', 'information-isolation', 'ratings', 'win-rates-and-confidence-intervals', 'metrics', 'limitations']) {
    assert.match(out, new RegExp(`id="${id}"`), id);
  }
});
