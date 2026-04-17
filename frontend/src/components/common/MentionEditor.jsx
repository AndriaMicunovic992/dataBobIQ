import { useEffect, useMemo, useRef, useState } from 'react';
import { colors, spacing, radius, typography, shadows, inputStyle } from '../../theme.js';
import { formatMentionToken } from '../../utils/mentions.js';

/**
 * Textarea that supports @-mentions of knowledge entries.
 *
 * Typing `@` opens a dropdown filtered by the characters typed after it;
 * picking an entry replaces the trigger with a stable `@[Title](knowledge:id)`
 * token stored in the underlying value. The token is treated as plain text
 * by the textarea — rendering chips is done in KnowledgeCard, not here
 * (contenteditable-based chips are a rendering nightmare we don't need).
 */
export default function MentionEditor({
  value,
  onChange,
  entries = [],
  excludeId,
  placeholder,
  style,
  autoFocus,
}) {
  const textareaRef = useRef(null);
  const [trigger, setTrigger] = useState(null); // { start, query }
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    return entries
      .filter((e) => e.id !== excludeId)
      .filter((e) => !q || (e.title || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [trigger, entries, excludeId]);

  useEffect(() => { setHighlight(0); }, [trigger?.query]);

  // Detect `@query` ending at the caret.
  const scanTrigger = (text, caret) => {
    const before = text.slice(0, caret);
    const at = before.lastIndexOf('@');
    if (at < 0) return null;
    // Must be at start of text or preceded by whitespace/newline.
    if (at > 0 && !/\s/.test(before[at - 1])) return null;
    const query = before.slice(at + 1);
    // Cancel once query contains whitespace or closing bracket — keeps tokens
    // already in the text from re-triggering the popup.
    if (/[\s\]\(\)]/.test(query)) return null;
    return { start: at, query };
  };

  const handleChange = (e) => {
    const next = e.target.value;
    onChange(next);
    const caret = e.target.selectionStart ?? next.length;
    setTrigger(scanTrigger(next, caret));
  };

  const handleSelect = (entry) => {
    if (!trigger) return;
    const token = formatMentionToken(entry.title || 'entry', entry.id);
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const next = value.slice(0, trigger.start) + token + ' ' + value.slice(caret);
    onChange(next);
    setTrigger(null);
    // Restore focus and move caret after the inserted token.
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const pos = trigger.start + token.length + 1;
        el.focus();
        el.setSelectionRange(pos, pos);
      }
    });
  };

  const handleKeyDown = (e) => {
    if (!trigger || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      handleSelect(suggestions[highlight]);
    } else if (e.key === 'Escape') {
      setTrigger(null);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setTrigger(null), 120)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{ ...inputStyle, height: 100, resize: 'vertical', ...style }}
      />
      {trigger && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', zIndex: 10,
          top: '100%', left: 0, right: 0,
          marginTop: 4,
          background: colors.bgCard,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.md,
          boxShadow: shadows.lg,
          maxHeight: 220,
          overflowY: 'auto',
          fontFamily: typography.fontFamily,
        }}>
          <div style={{
            padding: `${spacing.xs}px ${spacing.sm}px`,
            fontSize: 10,
            color: colors.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            borderBottom: `1px solid ${colors.border}`,
          }}>
            Link knowledge entry
          </div>
          {suggestions.map((entry, i) => (
            <div
              key={entry.id}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(entry); }}
              onMouseEnter={() => setHighlight(i)}
              style={{
                padding: `${spacing.xs}px ${spacing.sm}px`,
                fontSize: typography.fontSizes.sm,
                color: colors.textPrimary,
                background: i === highlight ? colors.bgHover : 'transparent',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 2,
              }}
            >
              <span style={{ fontWeight: typography.fontWeights.medium }}>
                {entry.title || 'Untitled'}
              </span>
              {entry.content && (
                <span style={{
                  fontSize: typography.fontSizes.xs,
                  color: colors.textMuted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {String(entry.content).slice(0, 80)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
