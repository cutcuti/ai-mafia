import { Fragment, type ReactNode } from 'react';

/**
 * Minimal Markdown → React for our own trusted docs (docs/METHODOLOGY.md): #/##/### headings, paragraphs,
 * "- " lists, ``` code blocks, **bold**, `code`, [links](url). Text is rendered as React text (auto-escaped);
 * no raw HTML is ever injected. Links are limited to http(s) and same-site paths.
 */
export function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3]) out.push(<code key={k} className="rounded bg-panel-2 px-1 py-0.5 text-[0.9em]">{m[3]}</code>);
    else {
      const href = m[5];
      const safe = /^(https?:\/\/|\/|#)/.test(href) ? href : '#';
      const external = safe.startsWith('http');
      out.push(
        <a key={k} href={safe} className="text-neon-cyan underline underline-offset-2" {...(external ? { rel: 'noopener noreferrer' } : {})}>
          {m[4]}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const key = `b${b++}`;
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key} className="my-4 overflow-x-auto rounded-xl border border-line bg-panel p-4 text-sm">
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? 'mt-2 font-display text-4xl font-extrabold' : level === 2 ? 'mt-10 font-display text-2xl font-extrabold' : 'mt-6 text-lg font-bold';
      const Tag = (`h${Math.min(level + 1, 4)}`) as 'h2' | 'h3' | 'h4';
      blocks.push(
        <Tag key={key} id={slug(h[2])} className={cls}>
          {inline(h[2], key)}
        </Tag>,
      );
      i++;
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) items.push(lines[i++].slice(2));
      blocks.push(
        <ul key={key} className="my-3 list-disc space-y-2 pl-6 text-muted">
          {items.map((t, j) => (
            <li key={j}>{inline(t, `${key}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|- |```)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={key} className="my-3 leading-relaxed text-muted">
        {inline(para.join(' '), key)}
      </p>,
    );
  }
  return <Fragment>{blocks}</Fragment>;
}
