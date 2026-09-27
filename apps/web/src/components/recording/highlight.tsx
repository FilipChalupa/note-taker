/** Wrap search matches in <mark>; `counter.n` is the running global match index, the one equal to
 *  `cursor` gets the ref for scrolling. */
export function highlightMatches(
  text: string,
  matcher: RegExp,
  counter: { n: number },
  cursor: number,
  cursorRef: React.RefObject<HTMLSpanElement | null>,
): React.ReactNode {
  const parts = text.split(matcher);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const idx = counter.n++;
    return (
      <mark
        key={i}
        ref={idx === cursor ? (cursorRef as React.RefObject<HTMLElement>) : undefined}
        className={`rounded px-0.5 ${idx === cursor ? "bg-orange-300 dark:bg-orange-600" : "bg-yellow-200 dark:bg-yellow-700/60"}`}
      >
        {part}
      </mark>
    );
  });
}
