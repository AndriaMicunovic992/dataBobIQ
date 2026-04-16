import { colors, spacing, radius, typography, shadows, transitions } from '../../theme.js';

/**
 * Wrapper for a single canvas artifact. Title bar with Pin / Export / Share
 * (Phase 2 stubs) and a Remove button to dismiss the card from the canvas.
 */
export default function ArtifactCard({ title, subtitle, children, onPin, onExport, onShare, onRemove }) {
  return (
    <div style={{
      background: colors.bgCard,
      borderRadius: radius.lg,
      border: `1px solid ${colors.border}`,
      boxShadow: shadows.sm,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      transition: transitions.fast,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center',
        padding: `${spacing.sm}px ${spacing.md}px`,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgMuted,
        gap: spacing.sm,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: typography.fontSizes.sm,
            fontWeight: typography.fontWeights.semibold,
            color: colors.textPrimary,
            fontFamily: typography.fontFamily,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {title}
          </div>
          {subtitle && (
            <div style={{
              fontSize: typography.fontSizes.xs,
              color: colors.textMuted,
              fontFamily: typography.fontFamily,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {subtitle}
            </div>
          )}
        </div>
        <ToolbarButton label="Pin" onClick={onPin} />
        <ToolbarButton label="Export" onClick={onExport} />
        {onRemove && (
          <button
            onClick={onRemove}
            title="Remove from canvas"
            style={{
              background: 'none', border: 'none',
              cursor: 'pointer', color: colors.textMuted,
              fontSize: 16, lineHeight: 1, padding: 2,
              borderRadius: radius.sm,
              transition: transitions.fast,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.danger; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = colors.textMuted; }}
          >
            ×
          </button>
        )}
      </div>
      {/* Body */}
      <div style={{ padding: spacing.md }}>
        {children}
      </div>
    </div>
  );
}

function ToolbarButton({ label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        padding: `${spacing.xs}px ${spacing.sm}px`,
        fontSize: typography.fontSizes.xs,
        fontFamily: typography.fontFamily,
        fontWeight: typography.fontWeights.medium,
        color: colors.textSecondary,
        cursor: 'pointer',
        transition: transitions.fast,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = colors.borderFocus;
        e.currentTarget.style.color = colors.primary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.color = colors.textSecondary;
      }}
    >
      {label}
    </button>
  );
}
