/**
 * Knowledge-entry mention tokens embedded in content text.
 * Format: @[Title](knowledge:entry-id)
 *
 * The display title is a user-facing label only; the canonical reference is
 * the entry id. If the referenced entry is renamed, we still resolve by id.
 */

export const MENTION_RE = /@\[([^\]]+)\]\(knowledge:([^)]+)\)/g;

export function formatMentionToken(title, id) {
  const safeTitle = (title || 'entry').replace(/[\]]/g, '');
  return `@[${safeTitle}](knowledge:${id})`;
}

/**
 * Split text into an array of string/mention parts so the caller can render
 * chips in place. Returns items shaped as either a string or
 * `{ type: 'mention', title, id }`.
 */
export function splitWithMentions(text) {
  if (!text) return [];
  const parts = [];
  let lastIdx = 0;
  const re = new RegExp(MENTION_RE.source, 'g');
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    parts.push({ type: 'mention', title: match[1], id: match[2] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

export function extractMentionIds(text) {
  if (!text) return [];
  const ids = new Set();
  const re = new RegExp(MENTION_RE.source, 'g');
  let match;
  while ((match = re.exec(text)) !== null) ids.add(match[2]);
  return [...ids];
}
