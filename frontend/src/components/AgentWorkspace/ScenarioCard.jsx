import { colors, spacing, radius, typography, shadows, transitions } from '../../theme.js';

/**
 * A single scenario cockpit card. Shows name, headline delta vs. actuals,
 * rule count, and a tiny dual-line sparkline (baseline vs. scenario).
 *
 * Two actions: "Ask" opens a thread in the workspace with this scenario as
 * the context; "Open" jumps back to the dashboard with this scenario
 * selected. The parent wires both.
 */

function formatCompact(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatPct(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return '—';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

/** Two-line SVG sparkline — baseline (grey) + scenario (colored). */
function Sparkline({ points, scenarioColor }) {
  if (!points || points.length === 0) {
    return (
      <div style={{
        height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: colors.textMuted, fontSize: typography.fontSizes.xs,
        fontFamily: typography.fontFamily,
      }}>
        No time series available
      </div>
    );
  }

  const width = 240;
  const height = 40;
  const pad = 2;

  const baselineVals = points.map((p) => p.baseline);
  const scenarioVals = points.map((p) => p.scenario);
  const all = [...baselineVals, ...scenarioVals];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;

  const toPath = (vals) => {
    if (vals.length === 0) return '';
    const step = (width - pad * 2) / Math.max(1, vals.length - 1);
    return vals
      .map((v, i) => {
        const x = pad + i * step;
        const y = pad + (1 - (v - min) / range) * (height - pad * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path
        d={toPath(baselineVals)}
        fill="none"
        stroke={colors.textMuted}
        strokeWidth={1.25}
        strokeDasharray="2 2"
      />
      <path
        d={toPath(scenarioVals)}
        fill="none"
        stroke={scenarioColor}
        strokeWidth={1.75}
      />
    </svg>
  );
}

export default function ScenarioCard({ summary, onAsk, onOpen }) {
  const {
    id,
    name,
    color,
    rule_count: ruleCount,
    headline,
    sparkline,
  } = summary;

  const deltaPct = headline?.delta_pct;
  const deltaAbs = headline?.delta;
  const isUp = (deltaPct ?? 0) >= 0;
  const deltaColor = deltaPct === null || deltaPct === undefined
    ? colors.textMuted
    : isUp ? colors.success : colors.danger;

  const scenarioLineColor = color || colors.primary;

  return (
    <div style={{
      background: colors.bgCard,
      borderRadius: radius.lg,
      border: `1px solid ${colors.border}`,
      boxShadow: shadows.sm,
      padding: spacing.md,
      display: 'flex',
      flexDirection: 'column',
      gap: spacing.sm,
      transition: transitions.fast,
      minHeight: 180,
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.boxShadow = shadows.md;
      e.currentTarget.style.borderColor = colors.borderFocus;
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.boxShadow = shadows.sm;
      e.currentTarget.style.borderColor = colors.border;
    }}
    >
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
        <div style={{
          width: 10, height: 10, borderRadius: radius.full,
          background: scenarioLineColor, flexShrink: 0,
        }} />
        <h4 style={{
          margin: 0, flex: 1, minWidth: 0,
          fontSize: typography.fontSizes.md,
          fontWeight: typography.fontWeights.semibold,
          color: colors.textPrimary,
          fontFamily: typography.fontFamily,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </h4>
      </div>

      {/* Headline delta */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: spacing.xs }}>
        <span style={{
          fontSize: typography.fontSizes.xl,
          fontWeight: typography.fontWeights.bold,
          color: deltaColor,
          fontFamily: typography.fontFamily,
        }}>
          {deltaPct === null || deltaPct === undefined ? '—' : `${isUp ? '▲' : '▼'} ${formatPct(deltaPct)}`}
        </span>
        <span style={{
          fontSize: typography.fontSizes.xs,
          color: colors.textMuted,
          fontFamily: typography.fontFamily,
        }}>
          {deltaAbs !== null && deltaAbs !== undefined ? `(${deltaAbs >= 0 ? '+' : ''}${formatCompact(deltaAbs)})` : ''}
        </span>
      </div>

      {/* Sparkline */}
      <Sparkline points={sparkline} scenarioColor={scenarioLineColor} />

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginTop: 'auto' }}>
        <span style={{
          fontSize: typography.fontSizes.xs,
          color: colors.textMuted,
          fontFamily: typography.fontFamily,
          flex: 1,
        }}>
          {ruleCount} {ruleCount === 1 ? 'rule' : 'rules'}
        </span>
        <button
          onClick={() => onAsk?.(summary)}
          style={{
            background: 'none', border: `1px solid ${colors.border}`,
            borderRadius: radius.md, padding: `${spacing.xs}px ${spacing.sm}px`,
            cursor: 'pointer', color: colors.primary,
            fontSize: typography.fontSizes.xs,
            fontWeight: typography.fontWeights.medium,
            fontFamily: typography.fontFamily,
          }}
        >
          Ask
        </button>
        <button
          onClick={() => onOpen?.(summary)}
          style={{
            background: 'none', border: 'none',
            cursor: 'pointer', color: colors.textSecondary,
            fontSize: typography.fontSizes.xs,
            fontWeight: typography.fontWeights.medium,
            fontFamily: typography.fontFamily,
            padding: `${spacing.xs}px ${spacing.sm}px`,
          }}
        >
          Open
        </button>
      </div>
    </div>
  );
}
