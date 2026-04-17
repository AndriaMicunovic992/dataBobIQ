import { useState, useRef, useEffect } from 'react';
import { colors, spacing, radius, typography, transitions } from '../../theme.js';

function Tab({ tab, active, onClick, onClose, onRename }) {
  const isHome = tab.kind === 'home';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tab.title);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== tab.title) {
      onRename?.(trimmed);
    }
    setEditing(false);
  };

  return (
    <div
      onClick={onClick}
      onDoubleClick={() => {
        if (!isHome) {
          setDraft(tab.title);
          setEditing(true);
        }
      }}
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
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'transparent',
            border: `1px solid ${colors.borderFocus}`,
            borderRadius: radius.sm,
            color: 'inherit',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            fontFamily: 'inherit',
            padding: '0 4px',
            outline: 'none',
            width: '100%',
            minWidth: 60,
          }}
        />
      ) : (
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1, minWidth: 0,
        }}>
          {tab.title}
        </span>
      )}
      {!isHome && !editing && (
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

export default function ThreadTabs({ tabs, activeId, onSelect, onClose, onRename, onExit }) {
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
            onRename={(title) => onRename?.(tab.id, title)}
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
