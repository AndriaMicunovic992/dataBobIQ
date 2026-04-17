import { useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { usePivot } from '../hooks/usePivot.js';
import { colors, typography, spacing, radius } from '../theme.js';

function formatNum(val) {
  if (val === null || val === undefined) return '—';
  const abs = Math.abs(val);
  if (abs >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: colors.sidebar, borderRadius: radius.md,
      padding: `${spacing.sm}px ${spacing.md}px`,
      border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    }}>
      <p style={{
        margin: `0 0 ${spacing.xs}px`, fontSize: typography.fontSizes.sm,
        fontWeight: typography.fontWeights.semibold, color: '#e2e8f0',
        fontFamily: typography.fontFamily,
      }}>
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

const PALETTE = colors.chart;

function buildChartData(data) {
  if (!data?.rows?.length || !data?.columns?.length) return { chartData: [], measures: [] };

  const cols = data.columns;
  const dimCols = cols.filter((c) => c.type === 'dimension').map((c) => c.field);
  const measureCols = cols.filter((c) => c.type === 'measure');

  const labelKey = dimCols[0] || cols[0]?.field;

  const chartData = data.rows.map((row) => {
    const entry = { __label: String(row[cols.findIndex((c) => c.field === labelKey)] ?? '') };
    measureCols.forEach((m) => {
      const idx = cols.indexOf(m);
      entry[m.field] = row[idx];
    });
    return entry;
  });

  return { chartData, measures: measureCols.map((m) => m.field) };
}

const SHARED_AXIS_PROPS = {
  x: {
    dataKey: '__label',
    tick: { fontSize: typography.fontSizes.xs, fill: colors.textMuted, fontFamily: typography.fontFamily },
    tickLine: false,
    axisLine: { stroke: colors.border },
  },
  y: {
    tickFormatter: formatNum,
    tick: { fontSize: typography.fontSizes.xs, fill: colors.textMuted, fontFamily: typography.fontFamily },
    tickLine: false,
    axisLine: false,
    width: 72,
  },
};

// Build the single Recharts chart element that will be the direct child of
// <ResponsiveContainer>. Recharts clones its direct child to inject width +
// height, so wrapping in another component breaks sizing — the chart must be
// returned as the immediate child.
function renderChart(chartType, chartData, measures) {
  const margin = { top: 8, right: 16, left: 8, bottom: chartData.length > 8 ? 60 : 30 };
  const xAngle = chartData.length > 8 ? -35 : 0;
  const xAnchor = chartData.length > 8 ? 'end' : 'middle';
  const xHeight = chartData.length > 8 ? 60 : 30;
  const xProps = { ...SHARED_AXIS_PROPS.x, angle: xAngle, textAnchor: xAnchor, height: xHeight };
  const legend = measures.length > 1
    ? <Legend wrapperStyle={{ fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily, paddingTop: 8 }} />
    : null;

  if (chartType === 'line') {
    return (
      <LineChart data={chartData} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
        <XAxis {...xProps} />
        <YAxis {...SHARED_AXIS_PROPS.y} />
        <Tooltip content={<ChartTooltip />} />
        {legend}
        {measures.map((m, i) => (
          <Line key={m} type="monotone" dataKey={m} name={m} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        ))}
      </LineChart>
    );
  }

  if (chartType === 'area') {
    return (
      <AreaChart data={chartData} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
        <XAxis {...xProps} />
        <YAxis {...SHARED_AXIS_PROPS.y} />
        <Tooltip content={<ChartTooltip />} />
        {legend}
        {measures.map((m, i) => (
          <Area key={m} type="monotone" dataKey={m} name={m} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.15} strokeWidth={2} />
        ))}
      </AreaChart>
    );
  }

  const barSize = chartData.length > 20 ? 8 : chartData.length > 10 ? 14 : 22;
  return (
    <BarChart data={chartData} margin={margin} barSize={barSize}>
      <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
      <XAxis {...xProps} />
      <YAxis {...SHARED_AXIS_PROPS.y} />
      <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(37,99,235,0.06)' }} />
      {legend}
      {measures.map((m, i) => (
        <Bar key={m} dataKey={m} name={m} fill={PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} />
      ))}
    </BarChart>
  );
}

export default function DashboardChartWidget({ widget, scenarioId, yearFilter, metadata }) {
  const config = widget.config || {};
  const chartType = widget.widget_type; // 'bar', 'line', or 'area'

  const apiConfig = useMemo(() => {
    if (!config.dataset_id || !config.measures?.length) return null;
    const filters = { ...(config.filters || {}) };
    const joinDims = { ...(config.join_dimensions || {}) };
    if (yearFilter) {
      filters.year = [String(yearFilter)];
      const yearOwner = metadata?.fieldDatasetMap?.year;
      if (yearOwner && yearOwner !== config.dataset_id) {
        joinDims.year = yearOwner;
      }
    }
    return {
      model_id: config.model_id,
      dataset_id: config.dataset_id,
      row_dimensions: config.row_dimensions || [],
      column_dimension: config.column_dimension || null,
      measures: config.measures,
      filters,
      scenario_ids: scenarioId ? [scenarioId] : [],
      join_dimensions: Object.keys(joinDims).length > 0 ? joinDims : undefined,
      limit: config.limit || 500,
    };
  }, [config, scenarioId, yearFilter, metadata]);

  const { data, isLoading, error } = usePivot(apiConfig);
  const missingData = error && /missing its data file|re-upload|missing_parquet/i.test(String(error.message || ''));

  const { chartData, measures } = useMemo(() => buildChartData(data), [data]);

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
        Loading…
      </div>
    );
  }

  if (missingData) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm, textAlign: 'center' }}>
        Dataset missing — re-upload to restore.
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: spacing.md, color: colors.danger, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm, textAlign: 'center' }}>
        {error.message || 'Error loading data'}
      </div>
    );
  }

  if (!chartData.length) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
        No data to chart
      </div>
    );
  }

  return (
    <div style={{ flex: 1, padding: spacing.sm, minWidth: 0, minHeight: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        {renderChart(chartType, chartData, measures)}
      </ResponsiveContainer>
    </div>
  );
}
