import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { colors, spacing, radius, typography, shadows, transitions } from '../../theme.js';
import StructuredMessage from './StructuredMessage.jsx';

const GRID_COLS = 12;
const ROW_HEIGHT = 60;
const GAP = 12;

function defaultPosition(index) {
  const colSpan = 12;
  const rowSpan = 5;
  const row = 1 + index * (rowSpan + 0);
  return { col: 1, row, colSpan, rowSpan };
}

function useCanvasGrid(artifacts, onUpdateArtifact) {
  const [active, setActive] = useState(null);
  const containerRef = useRef(null);

  const getCellSize = useCallback(() => {
    if (!containerRef.current) return { cellW: 60, cellH: ROW_HEIGHT };
    const rect = containerRef.current.getBoundingClientRect();
    const totalGap = (GRID_COLS - 1) * GAP;
    const cellW = (rect.width - totalGap) / GRID_COLS;
    return { cellW, cellH: ROW_HEIGHT };
  }, []);

  const handleResizeStart = useCallback((e, artifactId, pos) => {
    e.preventDefault();
    e.stopPropagation();
    setActive({ type: 'resize', id: artifactId, startX: e.clientX, startY: e.clientY, origPos: { ...pos } });
  }, []);

  const handleDragStart = useCallback((e, artifactId, pos) => {
    e.preventDefault();
    setActive({ type: 'drag', id: artifactId, startX: e.clientX, startY: e.clientY, origPos: { ...pos } });
  }, []);

  useEffect(() => {
    if (!active) return;

    const handleMouseMove = (e) => {
      const { cellW, cellH } = getCellSize();
      const dx = Math.round((e.clientX - active.startX) / (cellW + GAP));
      const dy = Math.round((e.clientY - active.startY) / (cellH + GAP));
      const orig = active.origPos;

      if (active.type === 'resize') {
        const newColSpan = Math.max(3, Math.min(GRID_COLS - (orig.col || 1) + 1, (orig.colSpan || 12) + dx));
        const newRowSpan = Math.max(2, (orig.rowSpan || 5) + dy);
        onUpdateArtifact(active.id, {
          position: { ...orig, colSpan: newColSpan, rowSpan: newRowSpan },
        });
      } else {
        const newCol = Math.max(1, Math.min(GRID_COLS - (orig.colSpan || 12) + 1, (orig.col || 1) + dx));
        const newRow = Math.max(1, (orig.row || 1) + dy);
        onUpdateArtifact(active.id, {
          position: { ...orig, col: newCol, row: newRow },
        });
      }
    };

    const handleMouseUp = () => setActive(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [active, getCellSize, onUpdateArtifact]);

  return { containerRef, handleDragStart, handleResizeStart, isInteracting: !!active };
}

function EditableTitle({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
    else setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
        style={{
          fontSize: typography.fontSizes.sm,
          fontWeight: typography.fontWeights.semibold,
          color: colors.textPrimary,
          fontFamily: typography.fontFamily,
          border: `1px solid ${colors.primary}`,
          borderRadius: radius.sm,
          outline: 'none',
          padding: '1px 4px',
          background: colors.bgCard,
          width: '100%',
        }}
      />
    );
  }

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      title="Double-click to rename"
      style={{
        fontSize: typography.fontSizes.sm,
        fontWeight: typography.fontWeights.semibold,
        color: colors.textPrimary,
        fontFamily: typography.fontFamily,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        cursor: 'text',
      }}
    >
      {value}
    </div>
  );
}

function ArtifactFrame({ artifact, index, onRemove, onUpdateArtifact, onDragStart, onResizeStart }) {
  const [hovered, setHovered] = useState(false);
  const pos = artifact.position || defaultPosition(index);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        gridColumn: `${pos.col} / span ${pos.colSpan}`,
        gridRow: `${pos.row} / span ${pos.rowSpan}`,
        background: colors.bgCard,
        borderRadius: radius.lg,
        border: `1px solid ${hovered ? colors.borderFocus : colors.border}`,
        boxShadow: shadows.sm,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        transition: transitions.fast,
        minHeight: 0,
      }}
    >
      {/* Drag header */}
      <div
        onMouseDown={(e) => onDragStart(e, artifact.id, pos)}
        style={{
          padding: `${spacing.sm}px ${spacing.md}px`,
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          minHeight: 36,
          cursor: 'grab',
          userSelect: 'none',
          background: colors.bgMuted,
        }}
      >
        <span style={{ fontSize: 10, color: colors.textMuted, cursor: 'grab', marginRight: 2 }}>
          &#x2630;
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <EditableTitle
            value={artifact.title}
            onChange={(newTitle) => onUpdateArtifact(artifact.id, { title: newTitle })}
          />
          {artifact.subtitle && (
            <div style={{
              fontSize: typography.fontSizes.xs,
              color: colors.textMuted,
              fontFamily: typography.fontFamily,
            }}>
              {artifact.subtitle}
            </div>
          )}
        </div>
        {hovered && (
          <button
            onClick={() => onRemove(artifact.id)}
            title="Remove from canvas"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: colors.textMuted,
              fontSize: 16,
              lineHeight: 1,
              padding: 2,
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
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: spacing.md,
        minHeight: 0,
      }}>
        <ArtifactBody content={artifact.content} type={artifact.type} />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={(e) => onResizeStart(e, artifact.id, pos)}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 16,
          height: 16,
          cursor: 'nwse-resize',
          background: hovered ? colors.primary : 'transparent',
          borderRadius: `0 0 ${radius.lg}px 0`,
          opacity: hovered ? 0.3 : 0,
          transition: transitions.fast,
        }}
      />
    </div>
  );
}

function ArtifactBody({ content, type }) {
  if (type === 'markdown' && typeof content === 'string') {
    return (
      <div style={{
        fontSize: typography.fontSizes.sm,
        fontFamily: typography.fontFamily,
        color: colors.textPrimary,
        lineHeight: 1.6,
      }}>
        <StructuredMessage text={content} variant="canvas" />
      </div>
    );
  }

  const rows = Array.isArray(content)
    ? content
    : (content?.rows && Array.isArray(content.rows)) ? content.rows : null;

  if (rows && rows.length > 0 && typeof rows[0] === 'object') {
    const cols = content?.columns || Object.keys(rows[0]);
    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontSize: typography.fontSizes.xs,
          fontFamily: typography.fontFamily,
        }}>
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={col} style={{
                  textAlign: 'left',
                  padding: `${spacing.xs}px ${spacing.sm}px`,
                  borderBottom: `2px solid ${colors.border}`,
                  color: colors.textSecondary,
                  fontWeight: typography.fontWeights.semibold,
                  whiteSpace: 'nowrap',
                  position: 'sticky', top: 0,
                  background: colors.bgCard,
                }}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 100).map((row, ri) => (
              <tr key={ri}>
                {cols.map((col) => (
                  <td key={col} style={{
                    padding: `${spacing.xs}px ${spacing.sm}px`,
                    borderBottom: `1px solid ${colors.border}`,
                    color: colors.textPrimary,
                    whiteSpace: 'nowrap',
                  }}>
                    {formatCell(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 100 && (
          <div style={{
            padding: spacing.sm, textAlign: 'center',
            color: colors.textMuted, fontSize: typography.fontSizes.xs,
          }}>
            Showing first 100 of {rows.length} rows
          </div>
        )}
      </div>
    );
  }

  const display = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  return (
    <pre style={{
      margin: 0, fontSize: typography.fontSizes.xs,
      fontFamily: 'monospace', color: colors.textSecondary,
      whiteSpace: 'pre-wrap',
    }}>
      {display}
    </pre>
  );
}

function formatCell(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function Canvas({ tab, onRemoveArtifact, onUpdateArtifact }) {
  const artifacts = tab.artifacts || [];

  const safeUpdateArtifact = onUpdateArtifact || (() => {});

  const { containerRef, handleDragStart, handleResizeStart } = useCanvasGrid(
    artifacts,
    safeUpdateArtifact,
  );

  const maxRow = useMemo(() => {
    let max = 1;
    artifacts.forEach((a, i) => {
      const pos = a.position || defaultPosition(i);
      const end = (pos.row || 1) + (pos.rowSpan || 5);
      if (end > max) max = end;
    });
    return max + 2;
  }, [artifacts]);

  if (artifacts.length === 0) {
    return (
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        padding: spacing.xl,
        background: colors.bgMain,
      }}>
        <div style={{
          border: `1px dashed ${colors.border}`,
          borderRadius: radius.lg,
          padding: `${spacing.xxl}px ${spacing.xl}px`,
          textAlign: 'center',
          color: colors.textMuted,
          fontFamily: typography.fontFamily,
          fontSize: typography.fontSizes.sm,
          background: colors.bgCard,
        }}>
          <div style={{
            fontSize: typography.fontSizes.md,
            fontWeight: typography.fontWeights.semibold,
            color: colors.textSecondary,
            marginBottom: spacing.xs,
          }}>
            Canvas
          </div>
          <div>
            Artifacts Bob produces in this thread (charts, tables, draft
            commentary) will show up here. Ask a question on the left to get
            started.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      flex: 1, minHeight: 0, overflowY: 'auto',
      padding: spacing.md,
      background: colors.bgMain,
    }}>
      <div
        ref={containerRef}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
          gridAutoRows: ROW_HEIGHT,
          gap: GAP,
          minHeight: maxRow * (ROW_HEIGHT + GAP),
        }}
      >
        {artifacts.map((a, i) => (
          <ArtifactFrame
            key={a.id}
            artifact={a}
            index={i}
            onRemove={onRemoveArtifact}
            onUpdateArtifact={safeUpdateArtifact}
            onDragStart={handleDragStart}
            onResizeStart={handleResizeStart}
          />
        ))}
      </div>
    </div>
  );
}
