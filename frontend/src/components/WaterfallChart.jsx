import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ReferenceLine,
} from 'recharts';
import { colors, typography, spacing, radius } from '../theme.js';

function formatNum(val) {
  if (val === null || val === undefined) return '—';
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${Number(val).toLocaleString()}`;
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0]?.payload;
  if (!entry) return null;

  return (
    <div style={{
      background: colors.sidebar, borderRadius: radius.md,
      padding: `${spacing.sm}px ${spacing.md}px`,
      border: `1px solid rgba(255,255,255,0.1)`,
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    }}>
      <p style={{ margin: `0 0 4px`, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold, color: '#e2e8f0', fontFamily: typography.fontFamily }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: typography.fontSizes.xs, color: entry.delta > 0 ? '#34d399' : entry.delta < 0 ? '#f87171' : '#94a3b8', fontFamily: 'monospace' }}>
        {entry.delta !== undefined ? (entry.delta >= 0 ? '+' : '') + formatNum(entry.delta) : formatNum(entry.value)}
      </p>
      {entry.running !== undefined && (
        <p style={{ margin: `2px 0 0`, fontSize: typography.fontSizes.xs, color: '#94a3b8', fontFamily: 'monospace' }}>
          Running total: {formatNum(entry.running)}
        </p>
      )}
    </div>
  );
};

/**
 * WaterfallChart
 * Expects `items`: Array of { label, value, type } where type is 'start' | 'delta' | 'end' | 'total'
 * Or accepts raw waterfall API response: { items: [...] }
 */
export default function WaterfallChart({ data, height = 340 }) {
  const chartData = useMemo(() => {
    if (!data) return [];

    const items = Array.isArray(data) ? data : (data.items || data.steps || []);
    if (items.length === 0) return [];

    let running = 0;
    return items.map((item, i) => {
      const isStart = item.type === 'start' || i === 0;
      const isEnd = item.type === 'end' || item.type === 'total';
      const delta = item.value ?? item.delta ?? 0;

      const base = isStart || isEnd ? 0 : running;
      const barHeight = isStart || isEnd ? Math.abs(delta || running) : Math.abs(delta);
      const barBase = isEnd ? 0 : isStart ? 0 : delta >= 0 ? running : running + delta;

      if (!isEnd) running += delta;
      else running = delta;

      return {
        label: item.label || item.name || `Step ${i + 1}`,
        delta: isStart || isEnd ? undefined : delta,
        value: isEnd ? delta : running,
        running,
        barBase,
        barHeight,
        type: isStart ? 'start' : isEnd ? 'end' : delta >= 0 ? 'positive' : 'negative',
        originalDelta: delta,
      };
    });
  }, [data]);

  if (!chartData.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textMuted, fontFamily: typography.fontFamily }}>
        No waterfall data available
      </div>
    );
  }

  const getColor = (entry) => {
    switch (entry.type) {
      case 'start': return colors.primary;
      case 'end': return '#7c3aed';
      case 'positive': return colors.success;
      case 'negative': return colors.danger;
      default: return colors.textMuted;
    }
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={chartData}
          margin={{ top: 16, right: 16, left: 8, bottom: 48 }}
          barSize={chartData.length > 12 ? 16 : 28}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: typography.fontSizes.xs, fill: colors.textMuted, fontFamily: typography.fontFamily }}
            tickLine={false}
            axisLine={{ stroke: colors.border }}
            angle={-30}
            textAnchor="end"
            height={56}
          />
          <YAxis
            tickFormatter={formatNum}
            tick={{ fontSize: typography.fontSizes.xs, fill: colors.textMuted, fontFamily: typography.fontFamily }}
            tickLine={false}
            axisLine={false}
            width={72}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
          <ReferenceLine y={0} stroke={colors.border} strokeWidth={1.5} />

          {/* Invisible base bar to lift the actual bar */}
          <Bar dataKey="barBase" stackId="wf" fill="transparent" />

          {/* Visible delta/value bar */}
          <Bar dataKey="barHeight" stackId="wf" radius={[3, 3, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={getColor(entry)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: spacing.lg, flexWrap: 'wrap', marginTop: spacing.sm }}>
        {[
          { color: colors.primary, label: 'Start' },
          { color: colors.success, label: 'Positive' },
          { color: colors.danger, label: 'Negative' },
          { color: '#7c3aed', label: 'End' },
        ].map((item) => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: item.color }} />
            <span style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
