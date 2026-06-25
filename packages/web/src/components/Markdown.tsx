"use client";

import { Fragment, type ReactNode } from "react";

// Minimal, dependency-free Markdown renderer for transcript readability.
// Covers what Claude actually emits: fenced code, headings, ordered/unordered
// lists, blockquotes, horizontal rules, paragraphs, and inline **bold**,
// *italic*, `code`, and [links](url). Not a full CommonMark implementation —
// deliberately small (project forbids external UI/markdown libraries).

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string): ReactNode[] {
  const parts = text.split(INLINE_RE);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={i}
          className="rounded bg-[var(--color-bg-inset)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--color-text-primary)]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--color-accent)] underline"
        >
          {link[1]}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const HEADING_CLASS = ["text-base", "text-base", "text-sm", "text-sm", "text-sm", "text-sm"];

/** Split a GFM table row into trimmed cells, dropping the outer pipes. */
function parseTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** A GFM delimiter row: every cell is dashes with optional alignment colons. */
function isTableDelimiter(line: string): boolean {
  if (!line.includes("|") && !line.includes("-")) return false;
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/** Render a block of Markdown text as themed React elements. */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push(
      <p key={`p-${blocks.length}`} className="whitespace-pre-wrap break-words">
        {renderInline(para.join("\n"))}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => (
      <li key={i} className="break-words">
        {renderInline(it)}
      </li>
    ));
    blocks.push(
      list.ordered ? (
        <ol key={`l-${blocks.length}`} className="list-decimal pl-5">
          {items}
        </ol>
      ) : (
        <ul key={`l-${blocks.length}`} className="list-disc pl-5">
          {items}
        </ul>
      ),
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block
    const fence = line.match(/^\s*```/);
    if (fence) {
      flushPara();
      flushList();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="overflow-x-auto rounded border border-[var(--color-border-subtle)] bg-[var(--color-bg-inset)] p-2 font-mono text-[11px] text-[var(--color-text-secondary)]"
        >
          {code.join("\n")}
        </pre>,
      );
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }

    // GFM table: a header row followed by a delimiter row.
    if (line.includes("|") && i + 1 < lines.length && isTableDelimiter(lines[i + 1])) {
      flushPara();
      flushList();
      const header = parseTableRow(line);
      i += 2; // consume header + delimiter
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      i--; // step back so the for-loop's increment lands on the next line
      blocks.push(
        <div key={`t-${blocks.length}`} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="border border-[var(--color-border-subtle)] px-2 py-1 text-left font-semibold text-[var(--color-text-primary)]"
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_h, ci) => (
                    <td
                      key={ci}
                      className="border border-[var(--color-border-subtle)] px-2 py-1 align-top text-[var(--color-text-secondary)]"
                    >
                      {renderInline(r[ci] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      flushList();
      const level = heading[1].length;
      blocks.push(
        <p
          key={`h-${blocks.length}`}
          className={`font-semibold text-[var(--color-text-primary)] ${HEADING_CLASS[level - 1]}`}
        >
          {renderInline(heading[2])}
        </p>,
      );
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      flushList();
      blocks.push(<hr key={`hr-${blocks.length}`} className="border-[var(--color-border-subtle)]" />);
      continue;
    }

    const blockquote = line.match(/^>\s?(.*)$/);
    if (blockquote) {
      flushPara();
      flushList();
      blocks.push(
        <blockquote
          key={`q-${blocks.length}`}
          className="border-l-2 border-[var(--color-border-subtle)] pl-2 text-[var(--color-text-secondary)]"
        >
          {renderInline(blockquote[1])}
        </blockquote>,
      );
      continue;
    }

    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const listItem = ol ?? ul;
    if (listItem) {
      flushPara();
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(listItem[1] ?? "");
      continue;
    }

    flushList();
    para.push(line);
  }
  flushPara();
  flushList();

  return <div className="flex flex-col gap-2 text-sm text-[var(--color-text-primary)]">{blocks}</div>;
}
