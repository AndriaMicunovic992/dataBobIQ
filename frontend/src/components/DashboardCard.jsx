import { useMemo } from 'react';
import { usePivot } from '../hooks/usePivot.js';
import { colors, spacing, radius, typography } from '../theme.js';

function formatBigNum(val) {
  if (val === null || val === undefined) return '—';
  const abs = Math.abs(val);
  if (abs >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default function DashboardCard({ widget, scenarioId, yearFilter, metadata }) {
  const config = widget.config || {};

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
      row_dimensions: [],
      column_dimension: null,
      measures: config.measures,
      filters,
      scenario_ids: scenarioId ? [scenarioId] : [],
      join_dimensions: Object.keys(joinDims).length > 0 ? joinDims : undefined,
      limit: 1,
    };
  }, [config, scenarioId, yearFilter, metadata]);

  const { data, isLoading, error } = usePivot(apiConfig);
  const missingData = error && /missing its data file|re-upload|missing_parquet/i.test(String(error.message || ''));

  const value = useMemo(() => {
    if (!data?.rows?.length) return null;
    const row = data.rows[0];
    // First numeric value
    const measureIdx = data.columns?.findIndex((c) => c.type === 'measure');
    return measureIdx >= 0 ? row[measureIdx] : row[0];
  }, [data]);

  // If scenario is active, try to find variance column
  const scenarioValue = useMemo(() => {
    if (!scenarioId || !data?.rows?.length || !data.columns) return null;
    const row = data.rows[0];
    const varIdx = data.columns.findIndex((c) => c.type === 'variance');
    const scIdx = data.columns.findIndex((c) => c.type === 'scenario');
    if (scIdx >= 0) return { scenario: row[scIdx], variance: varIdx >= 0 ? row[varIdx] : null };
    return null;
  }, [data, scenarioId]);

  const measureLabel = config.measures?.[0]?.label || config.measures?.[0]?.field || widget.name;

  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center',
      padding: `${spacing.sm}px ${spacing.lg}px`,
      boxSizing: 'border-box',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: typography.fontSizes.xs, color: colors.textMuted,
          fontFamily: typography.fontFamily, textTransform: 'uppercase',
          letterSpacing: '0.05em', marginBottom: spacing.xs,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {measureLabel}
        </div>
        {isLoading ? (
          <div style={{ fontSize: typography.fontSizes.lg, color: colors.textMuted, fontFamily: 'monospace' }}>...</div>
        ) : missingData ? (
          <div style={{
            fontSize: typography.fontSizes.xs,
            color: colors.textSecondary,
            fontFamily: typography.fontFamily,
            lineHeight: 1.4,
          }}>
            <div style={{ fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, marginBottom: 2 }}>
              Data missing
            </div>
            Re-upload dataset
          </div>
        ) : error ? (
          <div style={{
            fontSize: typography.fontSizes.xs,
            color: colors.danger,
            fontFamily: typography.fontFamily,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {error.message}
          </div>
        ) : (
          <>
            <div style={{
              fontSize: 26, fontWeight: typography.fontWeights.bold,
              color: colors.textPrimary, fontFamily: typography.fontFamily, lineHeight: 1.2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {formatBigNum(value)}
            </div>
            {scenarioValue && (
              <div style={{ display: 'flex', gap: spacing.sm, marginTop: 2, alignItems: 'baseline' }}>
                <span style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: 'monospace' }}>
                  {formatBigNum(scenarioValue.scenario)}
                </span>
                {scenarioValue.variance != null && (
                  <span style={{
                    fontSize: typography.fontSizes.xs, fontFamily: 'monospace',
                    color: scenarioValue.variance > 0 ? colors.success : scenarioValue.variance < 0 ? colors.danger : colors.textMuted,
                  }}>
                    {scenarioValue.variance > 0 ? '+' : ''}{formatBigNum(scenarioValue.variance)}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
