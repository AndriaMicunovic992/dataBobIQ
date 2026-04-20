import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listKPIs } from '../api.js';
import { useMetadata, parseFieldKey } from '../hooks/useMetadata.js';
import { usePivot } from '../hooks/usePivot.js';
import { colors, spacing, radius, typography, shadows, cardStyle } from '../theme.js';
import { KPICard } from './common/Card.jsx';
import FieldManager from './FieldManager.jsx';
import FilterManager from './FilterManager.jsx';
import PivotTable from './PivotTable.jsx';
export default function PivotView({ modelId }) {
  const [pivotConfig, setPivotConfig] = useState({
    model_id: modelId,
    rows: [],
    columns: [],
    values: [],
    aggregations: {},
    filters: [],
    limit: 500,
  });

  const { data: metadata, isLoading: metaLoading } = useMetadata(modelId);

  // Resolve the primary (fact) dataset_id from the first selected value.
  // Selections are uniqueKeys ("{ds_id}:{field}"), so the dataset_id is
  // carried directly by the selection — no name-based lookup that could
  // resolve to the wrong dataset when two tables share a field name.
  const datasetId = useMemo(() => {
    if (!metadata?.datasets?.length) return null;
    for (const k of (pivotConfig.values || [])) {
      const parsed = parseFieldKey(k);
      if (parsed.dataset_id) return parsed.dataset_id;
    }
    return metadata.datasets[0].id;
  }, [metadata, pivotConfig.values]);

  // Build the API-shaped pivot request from UI config.
  const apiConfig = useMemo(() => {
    if (!datasetId || pivotConfig.values.length === 0) return null;

    const rows = (pivotConfig.rows || []).map(parseFieldKey);
    const cols = (pivotConfig.columns || []).map(parseFieldKey);
    const vals = (pivotConfig.values || []).map((k) => ({ key: k, ...parseFieldKey(k) }));
    const filters = (pivotConfig.filters || []).map((f) => ({
      ...f,
      ...parseFieldKey(f.field),
    }));

    // Row/column/filter dimensions from a non-fact dataset need a JOIN.
    const joinDims = {};
    for (const d of [...rows, ...cols, ...filters]) {
      if (d.dataset_id && d.dataset_id !== datasetId && d.field) {
        joinDims[d.field] = d.dataset_id;
      }
    }

    return {
      model_id: modelId,
      dataset_id: datasetId,
      row_dimensions: rows.map((r) => r.field),
      column_dimension: cols[0]?.field || null,
      measures: vals.map((v) => ({
        field: v.field,
        aggregation: pivotConfig.aggregations[v.key] || 'sum',
      })),
      filters: filters.reduce((acc, f) => {
        if (f.field && f.values?.length) acc[f.field] = f.values;
        return acc;
      }, {}),
      scenario_ids: [],
      include_totals: true,
      limit: pivotConfig.limit || 500,
      join_dimensions: Object.keys(joinDims).length > 0 ? joinDims : undefined,
    };
  }, [modelId, datasetId, pivotConfig]);

  const { data: pivotData, isLoading, error } = usePivot(apiConfig);

  const { data: kpis = [] } = useQuery({
    queryKey: ['kpis', modelId],
    queryFn: () => listKPIs(modelId),
    enabled: !!modelId,
  });

  const handleConfigChange = (patch) => {
    setPivotConfig((prev) => ({ ...prev, ...patch, model_id: modelId }));
  };

  const handleFiltersChange = (filters) => {
    setPivotConfig((prev) => ({ ...prev, filters }));
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Left panel - Field Manager */}
      <div style={{
        width: 240, flexShrink: 0,
        background: colors.bgCard,
        borderRight: `1px solid ${colors.border}`,
        overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: `${spacing.md}px ${spacing.md}px ${spacing.xs}px`, borderBottom: `1px solid ${colors.border}` }}>
          <h3 style={{ margin: 0, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
            Fields
          </h3>
        </div>
        {metaLoading ? (
          <div style={{ padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
            Loading fields...
          </div>
        ) : (
          <FieldManager
            metadata={metadata}
            pivotConfig={pivotConfig}
            onConfigChange={handleConfigChange}
          />
        )}
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top bar */}
        <div style={{
          padding: `${spacing.sm}px ${spacing.lg}px`,
          background: colors.bgCard, borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap',
        }}>
          <h2 style={{ margin: 0, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, fontFamily: typography.fontFamily, flexShrink: 0 }}>
            Actuals
          </h2>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FilterManager
              metadata={metadata}
              filters={pivotConfig.filters}
              onFiltersChange={handleFiltersChange}
            />
          </div>
          <div style={{ display: 'flex', gap: spacing.xs, flexShrink: 0 }}>
          </div>
        </div>

        {/* KPI cards */}
        {kpis.length > 0 && (
          <div style={{
            display: 'flex', gap: spacing.md, overflowX: 'auto',
            padding: `${spacing.md}px ${spacing.lg}px`,
            background: colors.bgMain, borderBottom: `1px solid ${colors.border}`,
          }}>
            {kpis.slice(0, 8).map((kpi) => (
              <KPICard
                key={kpi.id}
                label={kpi.name}
                value={kpi.current_value !== undefined ? kpi.current_value : '—'}
                trend={kpi.trend}
              />
            ))}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: spacing.lg }}>
          {pivotConfig.values.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ ...cardStyle, padding: 0, overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <PivotTable data={pivotData} loading={isLoading} error={error} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: spacing.xxl, textAlign: 'center', color: colors.textMuted,
    }}>
      <div style={{ fontSize: 48, marginBottom: spacing.md }}>◈</div>
      <h3 style={{ margin: `0 0 ${spacing.sm}px`, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold, color: colors.textSecondary, fontFamily: typography.fontFamily }}>
        Configure your pivot
      </h3>
      <p style={{ margin: 0, fontSize: typography.fontSizes.md, fontFamily: typography.fontFamily, maxWidth: 360, lineHeight: 1.6 }}>
        Select at least one <strong>Value</strong> (measure) from the left panel to run a query.
        Add rows to group your data.
      </p>
    </div>
  );
}
