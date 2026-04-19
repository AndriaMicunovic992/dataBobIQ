import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { executePivot } from '../api.js';
import { colors, spacing, radius, typography } from '../theme.js';

export const ACTUALS_ID = '__actuals';
const ACTUALS_COLOR = colors.textSecondary;
const CHART_TYPES = new Set(['bar', 'line', 'area']);

function formatNum(val) {
  if (val === null || val === undefined) return '—';
  const abs = Math.abs(val);
  if (abs >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// Build the series list from the current selection. Actuals is included only
// when ACTUALS_ID is in the selection — it is no longer always-on.
function buildSeries(selectedIds, scenariosById) {
  const series = [];
  for (const id of selectedIds) {
    if (id === ACTUALS_ID) {
      series.push({ key: ACTUALS_ID, label: 'Actuals', scenarioId: null, color: ACTUALS_COLOR });
    } else {
      const s = scenariosById[id];
      if (!s) continue;
      series.push({
        key: id,
        label: s.name,
        scenarioId: id,
        color: s.color || colors.primary,
      });
    }
  }
  return series;
}

// Build per-series pivot configs from a base config. Actuals gets an empty
// scenario_ids array; each scenario gets its own.
function buildConfigs(baseConfig, series) {
  if (!baseConfig) return [];
  return series.map((s) => ({
    ...baseConfig,
    scenario_ids: s.scenarioId ? [s.scenarioId] : [],
  }));
}

export function useCompareQueries(baseConfig, series) {
  const configs = useMemo(() => buildConfigs(baseConfig, series), [baseConfig, series]);

  return useQueries({
    queries: configs.map((cfg) => ({
      queryKey: ['pivot', cfg],
      queryFn: () => executePivot(cfg),
      enabled: !!baseConfig,
      staleTime: 10_000,
    })),
  });
}

// ---------------------------------------------------------------------------
// Card compare — primary (Actuals) big, deltas below for each scenario.
// ---------------------------------------------------------------------------
export function CompareCard({ baseConfig, series }) {
  const results = useCompareQueries(baseConfig, series);
  const isLoading = results.some((r) => r.isLoading);

  const values = useMemo(() => {
    return results.map((r, i) => {
      const data = r.data;
      if (!data?.rows?.length) return { ...series[i], value: null };
      const row = data.rows[0];
      const measureIdx = data.columns?.findIndex((c) => c.type === 'measure');
      const v = measureIdx >= 0 ? row[measureIdx] : row[0];
      return { ...series[i], value: typeof v === 'number' ? v : null };
    });
  }, [results, series]);

  if (isLoading) {
    return <div style={{ flex: 1, padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>Loading…</div>;
  }

  const primary = values[0];
  const rest = values.slice(1);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: spacing.md, minHeight: 0, overflow: 'hidden', fontFamily: typography.fontFamily }}>
      <div style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, marginBottom: 2 }}>
        {primary.label}
      </div>
      <div style={{ fontSize: typography.fontSizes.xxl, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, lineHeight: 1.1 }}>
        {formatNum(primary.value)}
      </div>
      <div style={{ marginTop: spacing.sm, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto' }}>
        {rest.map((s) => {
          const diff = s.value != null && primary.value != null ? s.value - primary.value : null;
          const pct = diff != null && primary.value ? (diff / Math.abs(primary.value)) * 100 : null;
          const up = diff != null && diff > 0;
          const down = diff != null && diff < 0;
          const deltaColor = up ? colors.success : down ? colors.danger : colors.textMuted;
          return (
            <div key={s.key} style={{ display: 'flex', alignItems: 'baseline', gap: spacing.xs, fontSize: typography.fontSizes.xs }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, display: 'inline-block', flexShrink: 0 }} />
              <span style={{ color: colors.textSecondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.label}
              </span>
              <span style={{ fontFamily: 'monospace', color: colors.textPrimary }}>
                {formatNum(s.value)}
              </span>
              {diff != null && pct != null && (
                <span style={{ color: deltaColor, fontFamily: 'monospace', minWidth: 46, textAlign: 'right' }}>
                  {up ? '+' : ''}{pct.toFixed(1)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart compare — N series per measure, colored by scenario.
// ---------------------------------------------------------------------------
export function CompareChart({ baseConfig, series, chartType }) {
  const results = useCompareQueries(baseConfig, series);
  const isLoading = results.some((r) => r.isLoading);

  const { chartData, seriesKeys } = useMemo(() => {
    // Merge rows by their label (first dimension value). Each series adds one
    // data key per measure: `${seriesKey}::${measureField}`.
    const merged = new Map(); // label -> row
    const seriesKeys = [];

    results.forEach((r, i) => {
      const data = r.data;
      const seriesMeta = series[i];
      if (!data?.rows?.length || !data?.columns?.length) return;

      const cols = data.columns;
      const dimIdx = cols.findIndex((c) => c.type === 'dimension');
      const measureCols = cols.filter((c) => c.type === 'measure');

      measureCols.forEach((m) => {
        const key = `${seriesMeta.key}::${m.field}`;
        const label = measureCols.length === 1
          ? seriesMeta.label
          : `${seriesMeta.label} · ${m.field}`;
        seriesKeys.push({ key, label, color: seriesMeta.color });
      });

      for (const row of data.rows) {
        const labelRaw = dimIdx >= 0 ? row[dimIdx] : row[0];
        const label = String(labelRaw ?? '');
        if (!merged.has(label)) merged.set(label, { __label: label });
        const entry = merged.get(label);
        measureCols.forEach((m) => {
          const colIdx = cols.indexOf(m);
          entry[`${seriesMeta.key}::${m.field}`] = row[colIdx];
        });
      }
    });

    return { chartData: Array.from(merged.values()), seriesKeys };
  }, [results, series]);

  if (isLoading) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>Loading…</div>;
  }

  if (!chartData.length) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>No data to chart</div>;
  }

  const xAngle = chartData.length > 8 ? -35 : 0;
  const xAnchor = chartData.length > 8 ? 'end' : 'middle';
  const xHeight = chartData.length > 8 ? 60 : 30;
  const margin = { top: 8, right: 16, left: 8, bottom: xHeight };

  const xProps = {
    dataKey: '__label',
    tick: { fontSize: typography.fontSizes.xs, fill: colors.textMuted, fontFamily: typography.fontFamily },
    tickLine: false,
    axisLine: { stroke: colors.border },
    angle: xAngle, textAnchor: xAnchor, height: xHeight,
  };
  const yProps = {
    tickFormatter: formatNum,
    tick: { fontSize: typography.fontSizes.xs, fill: colors.textMuted, fontFamily: typography.fontFamily },
    tickLine: false,
    axisLine: false,
    width: 72,
  };
  const legend = <Legend wrapperStyle={{ fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily, paddingTop: 8 }} />;

  let body;
  if (chartType === 'line') {
    body = (
      <LineChart data={chartData} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
        <XAxis {...xProps} />
        <YAxis {...yProps} />
        <Tooltip formatter={formatNum} />
        {legend}
        {seriesKeys.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        ))}
      </LineChart>
    );
  } else if (chartType === 'area') {
    body = (
      <AreaChart data={chartData} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
        <XAxis {...xProps} />
        <YAxis {...yProps} />
        <Tooltip formatter={formatNum} />
        {legend}
        {seriesKeys.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.15} strokeWidth={2} />
        ))}
      </AreaChart>
    );
  } else {
    const barSize = chartData.length > 20 ? 6 : chartData.length > 10 ? 10 : 16;
    body = (
      <BarChart data={chartData} margin={margin} barSize={barSize}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
        <XAxis {...xProps} />
        <YAxis {...yProps} />
        <Tooltip formatter={formatNum} />
        {legend}
        {seriesKeys.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} />
        ))}
      </BarChart>
    );
  }

  return (
    <div style={{ flex: 1, padding: spacing.sm, minHeight: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        {body}
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table compare — dimension columns, then measure columns grouped by scenario.
// Renders as a compact HTML table with scenario header grouping.
// ---------------------------------------------------------------------------
export function CompareTable({ baseConfig, series }) {
  const results = useCompareQueries(baseConfig, series);
  const isLoading = results.some((r) => r.isLoading);

  const { dimCols, measureFields, rowsByKey, rowOrder } = useMemo(() => {
    // Use the first non-empty result as the layout skeleton.
    let layout = null;
    for (const r of results) {
      if (r.data?.columns?.length) { layout = r.data; break; }
    }
    if (!layout) return { dimCols: [], measureFields: [], rowsByKey: new Map(), rowOrder: [] };

    const dimCols = layout.columns.filter((c) => c.type === 'dimension').map((c) => c.field);
    const measureFields = layout.columns.filter((c) => c.type === 'measure').map((c) => c.field);

    const rowsByKey = new Map(); // key -> { __key, dims: {}, cells: { [seriesKey]: { [measure]: value } } }
    const rowOrder = [];

    const dimIndexByField = {};
    layout.columns.forEach((c, i) => { if (c.type === 'dimension') dimIndexByField[c.field] = i; });

    results.forEach((r, i) => {
      const data = r.data;
      const seriesMeta = series[i];
      if (!data?.rows?.length || !data?.columns?.length) return;

      const colsForThisResult = data.columns;
      const dimIdxThis = {};
      const measIdxThis = {};
      colsForThisResult.forEach((c, idx) => {
        if (c.type === 'dimension') dimIdxThis[c.field] = idx;
        else if (c.type === 'measure') measIdxThis[c.field] = idx;
      });

      for (const row of data.rows) {
        const dimVals = dimCols.map((d) => row[dimIdxThis[d]] ?? null);
        const key = dimVals.map((v) => String(v ?? '')).join('||');
        if (!rowsByKey.has(key)) {
          const dims = {};
          dimCols.forEach((d, j) => { dims[d] = dimVals[j]; });
          rowsByKey.set(key, { __key: key, dims, cells: {} });
          rowOrder.push(key);
        }
        const r2 = rowsByKey.get(key);
        if (!r2.cells[seriesMeta.key]) r2.cells[seriesMeta.key] = {};
        for (const m of measureFields) {
          const idx = measIdxThis[m];
          if (idx != null) r2.cells[seriesMeta.key][m] = row[idx];
        }
      }
    });

    return { dimCols, measureFields, rowsByKey, rowOrder };
  }, [results, series]);

  if (isLoading) {
    return <div style={{ flex: 1, padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>Loading…</div>;
  }

  if (!rowOrder.length) {
    return <div style={{ flex: 1, padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>No data.</div>;
  }

  const thBase = {
    padding: `${spacing.xs}px ${spacing.sm}px`,
    background: colors.bgMain,
    color: colors.textSecondary,
    fontSize: typography.fontSizes.xs,
    fontWeight: typography.fontWeights.semibold,
    borderBottom: `1px solid ${colors.border}`,
    textAlign: 'left', whiteSpace: 'nowrap',
    position: 'sticky', top: 0, zIndex: 1,
  };
  const td = {
    padding: `${spacing.xs}px ${spacing.sm}px`,
    fontSize: typography.fontSizes.sm,
    color: colors.textPrimary,
    borderBottom: `1px solid ${colors.border}`,
    fontFamily: 'monospace',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', fontFamily: typography.fontFamily }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          {/* Scenario group header row */}
          <tr>
            {dimCols.map((d) => (
              <th key={`dim-group-${d}`} style={{ ...thBase, borderBottom: 'none' }} rowSpan={2}>
                {d}
              </th>
            ))}
            {series.map((s) => (
              <th
                key={`series-${s.key}`}
                colSpan={measureFields.length}
                style={{
                  ...thBase,
                  borderBottom: `2px solid ${s.color}`,
                  textAlign: 'center',
                  color: s.color,
                }}
              >
                {s.label}
              </th>
            ))}
          </tr>
          {/* Measure header row */}
          <tr>
            {series.map((s) => (
              measureFields.map((m) => (
                <th key={`mh-${s.key}-${m}`} style={{ ...thBase, textAlign: 'right' }}>
                  {m}
                </th>
              ))
            ))}
          </tr>
        </thead>
        <tbody>
          {rowOrder.map((key) => {
            const r = rowsByKey.get(key);
            return (
              <tr key={key}>
                {dimCols.map((d) => (
                  <td key={`${key}-${d}`} style={{ ...td, fontFamily: typography.fontFamily, fontWeight: typography.fontWeights.medium }}>
                    {String(r.dims[d] ?? '')}
                  </td>
                ))}
                {series.map((s) => (
                  measureFields.map((m) => {
                    const v = r.cells[s.key]?.[m];
                    return (
                      <td key={`${key}-${s.key}-${m}`} style={{ ...td, textAlign: 'right' }}>
                        {typeof v === 'number' ? formatNum(v) : '—'}
                      </td>
                    );
                  })
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { CHART_TYPES, buildSeries, ACTUALS_COLOR };
