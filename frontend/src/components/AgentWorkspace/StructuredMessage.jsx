import { useState, memo } from 'react';
import { colors, spacing, radius, typography } from '../../theme.js';
import MarkdownRenderer from './MarkdownRenderer.jsx';

/**
 * Parses assistant text for structured <reasoning>, <output>, <commentary>
 * sections. Unclosed tags (during streaming) are captured up to the current
 * end of text. Falls back to plain markdown when no tags are present.
 */
function parseSection(text, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)(?:<\\/${tag}>|$)`);
  const match = text.match(re);
  return match ? match[1].trim() : '';
}

export function parseStructured(text) {
  if (!text) return { plain: '' };
  const hasAnyTag = /<(reasoning|output|commentary)>/.test(text);
  if (!hasAnyTag) return { plain: text };
  return {
    reasoning: parseSection(text, 'reasoning'),
    output: parseSection(text, 'output'),
    commentary: parseSection(text, 'commentary'),
  };
}

function SectionHeader({ label, expanded, onToggle, tone }) {
  const toneColor = {
    reasoning: colors.textMuted,
    output: colors.primary,
    commentary: colors.success,
  }[tone] || colors.textSecondary;

  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: 'none',
        border: 'none',
        padding: `${spacing.xs}px 0`,
        cursor: 'pointer',
        fontSize: 10,
        fontWeight: typography.fontWeights.semibold,
        color: toneColor,
        fontFamily: typography.fontFamily,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        width: '100%',
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 9 }}>{expanded ? '▼' : '▶'}</span>
      <span>{label}</span>
    </button>
  );
}

function Section({ tag, content, defaultExpanded, label }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (!content) return null;

  return (
    <div style={{ marginBottom: spacing.sm }}>
      <SectionHeader
        label={label}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        tone={tag}
      />
      {expanded && (
        <div style={{
          padding: `${spacing.xs}px 0 0 ${spacing.sm}px`,
          borderLeft: `2px solid ${colors.border}`,
          marginLeft: 4,
        }}>
          <MarkdownRenderer text={content} />
        </div>
      )}
    </div>
  );
}

/**
 * Renders assistant text. If the AI produced <reasoning>/<output>/<commentary>
 * tags, render each as a collapsible section. Otherwise render as plain markdown.
 *
 * @param {string} text - the full assistant text
 * @param {'chat'|'canvas'} variant - changes default expansion (canvas hides reasoning by default)
 */
function StructuredMessageImpl({ text, variant = 'chat' }) {
  const parsed = parseStructured(text);

  if (parsed.plain !== undefined) {
    return <MarkdownRenderer text={parsed.plain} />;
  }

  const reasoningExpanded = variant === 'chat' ? false : false;

  return (
    <div>
      <Section
        tag="reasoning"
        label="Reasoning"
        content={parsed.reasoning}
        defaultExpanded={reasoningExpanded}
      />
      <Section
        tag="output"
        label="Output"
        content={parsed.output}
        defaultExpanded={true}
      />
      <Section
        tag="commentary"
        label="Commentary"
        content={parsed.commentary}
        defaultExpanded={true}
      />
    </div>
  );
}

const StructuredMessage = memo(StructuredMessageImpl);
export default StructuredMessage;
