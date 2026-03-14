import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { colors, typography, spacing, radius } from '../theme.js';

function formatNum(val) {
  if (val === null || val === undefined) return '—';
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(val);
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: colors.sidebar, borderRadius: radius.md,
      padding: `${spacing.sm}px ${spacing.md}px`,
      border: `1px solid rgba(255,255,255,0.1)`,
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    }}>
      <p style={{ margin: `0 0 ${spacing.xs}px`, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold, color: '#e2e8f0', fontFamily: typography.fontFamily }}>
        {label}
      </p>
      {payload.map((entry, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginTop: 2 }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, flexShrink: 0 }} />
          <span style={{ fontSize: typography.fontSizes.xs, color: '#94a3b8', fontFamily: typography.fontFamily }}>{entry.name}:</span>
          <span style={{ fontSize: typography.fontSizes.xs, color: '#e2e8f0', fontFamily: 'monospace' }}>{formatNum(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

export default function PivotChart({ data, stacked = false }) {
  const { chartData, measures, labelKey } = useMemo(() => {
    if (!data || !data.rows || data.rows.length === 0) {
      return { chartData: [], measures: [], labelKey: null };
    }

    const allCols = data.columns || [];
    const rows = data.rows;

    // Detect numeric (measure) vs string (dimension) columns
    const numericCols = allCols.filter((c) => rows.some((r) => typeof r[c] === 'number'));
    const stringCols = allCols.filter((c) => rows.some((r) => typeof r[c] === 'string'));

    const lk = stringCols[0] || allCols[0];

    const chartData = rows.map((r) => {
      const entry = { __label: String(r[lk] ?? '') };
      numericCols.forEach((c) => { entry[c] = r[c]; });
      return entry;
    });

    return { chartData, measures: numericCols, labelKey: lk };
  }, [data]);

  if (!chartData.length) {
    return (
      <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textMuted, fontFamily: typography.fontFamily }}>
        No data to chart
      </div>
    );
  }

  const palette = colors.chart;

  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart
        data={chartData}
        margin={{ top: 8, right: 16, left: 8, bottom: 48 }}
        barSize={chartData.length > 20 ? 8 : chartData.length > 10 ? 14 : 22}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
        <XAxis
          dataKey="__label"
          tick={{ fontSize: typography.fontSizes.xs, fill: colors.textMuted, fontFamily: typography.fontFamily }}
          tickLine={false}
          axisLine={{ stroke: colors.border }}
          angle={chartData.length > 8 ? -35 : 0}
          textAnchor={chartData.length > 8 ? 'end' : 'middle'}
          height={chartData.length > 8 ? 60 : 30}
          interval={chartData.length > 30 ? 'preserveStartEnd' : 0}
        />
        <YAxis
          tickFormatter={formatNum}
          tick={{ fontSize: typography.fontSizes.xs, fill: colors.textMuted, fontFamily: typography.fontFamily }}
          tickLine={false}
          axisLine={false}
          width={72}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
        {measures.length > 1 && (
          <Legend
            wrapperStyle={{ fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily, paddingTop: 8 }}
          />
        )}
        {measures.map((m, i) => (
          <Bar
            key={m}
            dataKey={m}
            name={m}
            stackId={stacked ? 'stack' : undefined}
            fill={palette[i % palette.length]}
            radius={stacked ? [0, 0, 0, 0] : (i === measures.length - 1 || !stacked) ? [3, 3, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
