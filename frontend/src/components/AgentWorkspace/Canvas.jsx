import { colors, spacing, radius, typography } from '../../theme.js';
import ArtifactCard from './ArtifactCard.jsx';

/**
 * Right-side artifact column for a thread tab. In Phase 1 this just shows
 * a placeholder until the chat agent emits structured artifacts the canvas
 * can render. Pin/Export/Share are stubbed to no-op toasts.
 */
export default function Canvas({ tab }) {
  const artifacts = tab.artifacts || [];

  const stub = (label) => () => {
    // Phase 1 stub — replace with real behavior in Phase 2.
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
          onShare={stub('Share')}
        >
          <pre style={{
            margin: 0, fontSize: typography.fontSizes.xs,
            fontFamily: 'monospace', color: colors.textSecondary,
            whiteSpace: 'pre-wrap',
          }}>
            {typeof a.content === 'string' ? a.content : JSON.stringify(a.content, null, 2)}
          </pre>
        </ArtifactCard>
      ))}
    </div>
  );
}
