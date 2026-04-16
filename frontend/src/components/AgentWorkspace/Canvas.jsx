import { colors, spacing, radius, typography } from '../../theme.js';
import ArtifactCard from './ArtifactCard.jsx';

/**
 * Right-side artifact column for a thread tab. Renders structured results
 * from tool calls (query_data tables, scenario comparisons, KPI values)
 * that the ConversationPane pushes onto `tab.artifacts`.
 */
export default function Canvas({ tab, onRemoveArtifact }) {
  const artifacts = tab.artifacts || [];

  const stub = (label) => () => {
    // eslint-disable-next-line no-alert
    alert(`${label} — coming in Phase 2.`);
  };

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
      padding: spacing.xl,
      background: colors.bgMain,
      display: 'flex', flexDirection: 'column', gap: spacing.md,
    }}>
      {artifacts.map((a) => (
        <ArtifactCard
          key={a.id}
          title={a.title}
          subtitle={a.subtitle}
          onPin={stub('Pin to dashboard')}
          onExport={stub('Export')}
          onRemove={() => onRemoveArtifact?.(a.id)}
        >
          <ArtifactBody content={a.content} />
        </ArtifactCard>
      ))}
    </div>
  );
}

/** Render artifact content — tries table layout for row data, otherwise JSON. */
function ArtifactBody({ content }) {
  const rows = Array.isArray(content)
    ? content
    : (content?.rows && Array.isArray(content.rows)) ? content.rows : null;

  if (rows && rows.length > 0 && typeof rows[0] === 'object') {
    const cols = content?.columns || Object.keys(rows[0]);
    return (
      <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
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
      whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto',
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
