import { colors, spacing, radius, typography, shadows, transitions } from '../../theme.js';

/**
 * Wrapper for a single canvas artifact (a chart, a table, a commentary
 * draft). Provides a title bar with Pin / Export / Share affordances — all
 * stubbed as toast for Phase 1, wired for real in Phase 2.
 */
export default function ArtifactCard({ title, subtitle, children, onPin, onExport, onShare }) {
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
        <ToolbarButton label="Share" onClick={onShare} />
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
