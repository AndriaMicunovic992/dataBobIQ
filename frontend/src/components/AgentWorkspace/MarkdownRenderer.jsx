import { memo } from 'react';
import { colors, spacing, radius, typography } from '../../theme.js';

/**
 * Lightweight markdown renderer for assistant chat bubbles and canvas snippets.
 * Handles: tables, bold, italic, bullet/numbered lists, headings, code spans.
 * No external dependencies.
 */

function parseInline(text) {
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Italic: *text* (but not **)
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    // Code: `text`
    const codeMatch = remaining.match(/`([^`]+)`/);

    const candidates = [
      boldMatch && { idx: boldMatch.index, len: boldMatch[0].length, type: 'bold', content: boldMatch[1] },
      italicMatch && { idx: italicMatch.index, len: italicMatch[0].length, type: 'italic', content: italicMatch[1] },
      codeMatch && { idx: codeMatch.index, len: codeMatch[0].length, type: 'code', content: codeMatch[1] },
    ].filter(Boolean);

    if (candidates.length === 0) {
      parts.push(remaining);
      break;
    }

    candidates.sort((a, b) => a.idx - b.idx);
    const first = candidates[0];

    if (first.idx > 0) {
      parts.push(remaining.slice(0, first.idx));
    }

    if (first.type === 'bold') {
      parts.push(<strong key={key++}>{first.content}</strong>);
    } else if (first.type === 'italic') {
      parts.push(<em key={key++}>{first.content}</em>);
    } else if (first.type === 'code') {
      parts.push(
        <code key={key++} style={{
          background: colors.bgHover || '#f1f5f9',
          padding: '1px 4px',
          borderRadius: radius.sm,
          fontSize: '0.9em',
          fontFamily: 'monospace',
        }}>
          {first.content}
        </code>
      );
    }

    remaining = remaining.slice(first.idx + first.len);
  }

  return parts;
}

function isTableBlock(lines) {
  if (lines.length < 2) return false;
  const hasPipes = lines[0].includes('|') && lines[1].includes('|');
  const isSeparator = /^\|?[\s\-:|]+\|/.test(lines[1]);
  return hasPipes && isSeparator;
}

function parseTableRows(line) {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function TableBlock({ lines }) {
  const headers = parseTableRows(lines[0]);
  const dataLines = lines.slice(2);
  const rows = dataLines.map((l) => parseTableRows(l)).filter((r) => r.some((c) => c));

  return (
    <div style={{ overflowX: 'auto', margin: `${spacing.xs}px 0` }}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: typography.fontSizes.xs,
        fontFamily: typography.fontFamily,
      }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{
                textAlign: 'left',
                padding: `${spacing.xs}px ${spacing.sm}px`,
                borderBottom: `2px solid ${colors.border}`,
                color: colors.textSecondary,
                fontWeight: typography.fontWeights.semibold,
                whiteSpace: 'nowrap',
              }}>
                {parseInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: `${spacing.xs}px ${spacing.sm}px`,
                  borderBottom: `1px solid ${colors.border}`,
                  color: colors.textPrimary,
                  whiteSpace: 'nowrap',
                }}>
                  {parseInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkdownRendererImpl({ text }) {
  if (!text) return null;

  const lines = text.split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const prevI = i;
    const line = lines[i];

    // Detect table blocks (consecutive pipe-containing lines starting with header + separator)
    if (line.includes('|')) {
      const tableLines = [];
      let j = i;
      while (j < lines.length && lines[j].includes('|')) {
        tableLines.push(lines[j]);
        j++;
      }
      if (isTableBlock(tableLines)) {
        blocks.push(<TableBlock key={key++} lines={tableLines} />);
      } else {
        // Not a proper table yet (e.g. still streaming) — render as paragraph
        // so lines with `|` don't trap the outer loop.
        blocks.push(
          <p key={key++} style={{ margin: `${spacing.xs}px 0` }}>
            {parseInline(tableLines.join('\n'))}
          </p>
        );
      }
      i = j;
      continue;
    }

    // Headings: ## Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizes = { 1: typography.fontSizes.md, 2: typography.fontSizes.sm, 3: typography.fontSizes.sm };
      blocks.push(
        <div key={key++} style={{
          fontSize: sizes[level],
          fontWeight: typography.fontWeights.semibold,
          color: colors.textPrimary,
          margin: `${spacing.sm}px 0 ${spacing.xs}px`,
        }}>
          {parseInline(headingMatch[2])}
        </div>
      );
      i++;
      continue;
    }

    // Bullet list items: - item or * item
    if (/^\s*[-*]\s+/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} style={{
          margin: `${spacing.xs}px 0`,
          paddingLeft: spacing.lg,
          listStyle: 'disc',
        }}>
          {listItems.map((item, li) => (
            <li key={li} style={{ marginBottom: 2 }}>{parseInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list: 1. item
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const listItems = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} style={{
          margin: `${spacing.xs}px 0`,
          paddingLeft: spacing.lg,
        }}>
          {listItems.map((item, li) => (
            <li key={li} style={{ marginBottom: 2 }}>{parseInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line → spacing
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph — collect consecutive non-special lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].includes('|') &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(
        <p key={key++} style={{ margin: `${spacing.xs}px 0` }}>
          {parseInline(paraLines.join('\n'))}
        </p>
      );
    }

    // Defensive safeguard: ensure we always make forward progress, so a
    // future regression can't hang the browser mid-stream.
    if (i === prevI) i++;
  }

  return <div>{blocks}</div>;
}

const MarkdownRenderer = memo(MarkdownRendererImpl);
export default MarkdownRenderer;
