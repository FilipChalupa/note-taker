import type { ReactNode } from "react";

/** Inline: **bold**, *italic*, `code`, [text](http(s) url). */
function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={k}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k} className="rounded bg-zinc-100 px-1 text-[0.9em] dark:bg-zinc-800">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("*")) out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    else {
      const label = tok.slice(1, tok.indexOf("]("));
      out.push(
        <a key={k} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline dark:text-blue-400">
          {label}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Minimal Markdown: headings, bullet/numbered lists, task boxes, paragraphs with line breaks. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (para.length) {
      blocks.push(
        <p key={blocks.length}>
          {para.map((l, i) => (
            <span key={i}>
              {inline(l, i)}
              {i < para.length - 1 && <br />}
            </span>
          ))}
        </p>,
      );
      para = [];
    }
    if (list) {
      const items = list.items.map((it, i) => {
        const task = /^\[([ xX])\]\s+/.exec(it);
        return (
          <li key={i}>
            {task && <input type="checkbox" readOnly checked={task[1] !== " "} className="mr-1 align-middle" />}
            {inline(task ? it.slice(task[0].length) : it, i)}
          </li>
        );
      });
      blocks.push(list.ordered ? <ol key={blocks.length} className="list-decimal pl-5">{items}</ol> : <ul key={blocks.length} className="list-disc pl-5">{items}</ul>);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      const Tag = (["h1", "h2", "h3"] as const)[h[1].length - 1];
      blocks.push(<Tag key={blocks.length} className={h[1].length === 1 ? "text-base font-semibold" : "text-sm font-semibold"}>{inline(h[2])}</Tag>);
    } else if (li) {
      const ordered = Boolean(li[1]);
      if (list && list.ordered !== ordered) flush();
      (list ??= { ordered, items: [] }).items.push(li[2]);
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return <div className={`space-y-2 text-sm leading-relaxed ${className ?? ""}`}>{blocks}</div>;
}
