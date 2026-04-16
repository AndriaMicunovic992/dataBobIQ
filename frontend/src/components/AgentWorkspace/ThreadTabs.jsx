import { colors, spacing, radius, typography, transitions } from '../../theme.js';

/**
 * Top tab bar for the Agent Workspace. Home tab is always first and can't be
 * closed; thread tabs are appended as the user opens new conversations. The
 * active tab is highlighted with a bottom border in the primary color.
 */

function Tab({ tab, active, onClick, onClose }) {
  const isHome = tab.kind === 'home';
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: spacing.xs,
        padding: `${spacing.sm}px ${spacing.md}px`,
        cursor: 'pointer',
        borderBottom: `2px solid ${active ? colors.primary : 'transparent'}`,
        color: active ? colors.textPrimary : colors.textSecondary,
        fontSize: typography.fontSizes.sm,
        fontWeight: active ? typography.fontWeights.semibold : typography.fontWeights.medium,
        fontFamily: typography.fontFamily,
        transition: transitions.fast,
        minWidth: 0,
        maxWidth: 240,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = colors.textPrimary;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = colors.textSecondary;
      }}
    >
      {isHome && <span style={{ fontSize: 12 }}>⌂</span>}
      <span style={{
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1, minWidth: 0,
      }}>
        {tab.title}
      </span>
      {!isHome && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          aria-label="Close tab"
          style={{
            background: 'none', border: 'none',
            color: colors.textMuted,
            cursor: 'pointer',
            fontSize: 14, lineHeight: 1,
            padding: 2, borderRadius: radius.sm,
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgHover; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function ThreadTabs({ tabs, activeId, onSelect, onClose, onExit }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'stretch',
      borderBottom: `1px solid ${colors.border}`,
      background: colors.bgCard,
      paddingLeft: spacing.md,
      flexShrink: 0,
      minHeight: 44,
    }}>
      <div style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflowX: 'auto' }}>
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            onClick={() => onSelect(tab.id)}
            onClose={() => onClose(tab.id)}
          />
        ))}
      </div>
      {onExit && (
        <button
          onClick={onExit}
          title="Close workspace"
          style={{
            background: 'none', border: 'none',
            color: colors.textSecondary,
            cursor: 'pointer',
            padding: `0 ${spacing.md}px`,
            fontSize: typography.fontSizes.sm,
            fontFamily: typography.fontFamily,
            fontWeight: typography.fontWeights.medium,
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.textPrimary; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textSecondary; }}
        >
          ✕ Exit
        </button>
      )}
    </div>
  );
}
