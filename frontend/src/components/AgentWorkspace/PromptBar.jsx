import { useState, useRef, useEffect } from 'react';
import { colors, spacing, radius, typography, shadows, inputStyle } from '../../theme.js';

/**
 * The sticky fat prompt bar at the bottom of the workspace. The CFO's
 * muscle-memory anchor — one text area, one send button, always visible.
 *
 * Controlled externally: parent owns the text if it needs to (for
 * pre-seeding from a suggestion chip), otherwise we manage it internally.
 */
export default function PromptBar({
  placeholder = 'Ask Bob about your scenarios...',
  onSubmit,
  disabled = false,
  initialValue = '',
}) {
  const [value, setValue] = useState(initialValue);
  const areaRef = useRef(null);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSubmit(text);
    setValue('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div style={{
      padding: `${spacing.md}px ${spacing.xl}px`,
      background: colors.bgCard,
      borderTop: `1px solid ${colors.border}`,
      flexShrink: 0,
    }}>
      <div style={{
        maxWidth: 900,
        margin: '0 auto',
        position: 'relative',
        background: colors.bgCard,
        borderRadius: radius.xl,
        border: `1px solid ${colors.border}`,
        boxShadow: shadows.sm,
      }}>
        <textarea
          ref={areaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={2}
          style={{
            ...inputStyle,
            border: 'none',
            outline: 'none',
            boxShadow: 'none',
            background: 'transparent',
            resize: 'none',
            padding: `${spacing.md}px ${spacing.xl * 2}px ${spacing.md}px ${spacing.lg}px`,
            fontSize: typography.fontSizes.md,
            lineHeight: 1.5,
            marginBottom: 0,
          }}
        />
        <button
          onClick={submit}
          disabled={!value.trim() || disabled}
          aria-label="Send"
          style={{
            position: 'absolute',
            right: spacing.sm,
            bottom: spacing.sm,
            width: 36, height: 36,
            borderRadius: radius.full,
            border: 'none',
            cursor: value.trim() && !disabled ? 'pointer' : 'default',
            background: value.trim() && !disabled
              ? `linear-gradient(135deg, ${colors.primary}, #7c3aed)`
              : colors.bgHover,
            color: value.trim() && !disabled ? 'white' : colors.textMuted,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16,
            transition: 'all 0.15s ease',
          }}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
