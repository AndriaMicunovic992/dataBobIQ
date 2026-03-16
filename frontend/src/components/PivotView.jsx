import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listKPIs } from '../api.js';
import { useMetadata } from '../hooks/useMetadata.js';
import { usePivot } from '../hooks/usePivot.js';
import { colors, spacing, radius, typography, shadows, cardStyle } from '../theme.js';
import { Button } from './common/Button.jsx';
import { KPICard } from './common/Card.jsx';
import FieldManager from './FieldManager.jsx';
import FilterManager from './FilterManager.jsx';
import PivotTable from './PivotTable.jsx';
import PivotChart from './PivotChart.jsx';

export default function PivotView({ modelId }) {
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'chart'
  const [stacked, setStacked] = useState(false);
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

  // Pick the first dataset_id from metadata for pivot queries
  const datasetId = useMemo(() => {
    if (!metadata?.datasets?.length) return null;
    return metadata.datasets[0].id;
  }, [metadata]);

  // Build the API-shaped pivot request from UI config
  const apiConfig = useMemo(() => {
    if (!datasetId || pivotConfig.values.length === 0) return null;
    return {
      model_id: modelId,
      dataset_id: datasetId,
      row_dimensions: pivotConfig.rows,
      column_dimension: pivotConfig.columns[0] || null,
      measures: pivotConfig.values.map((v) => ({
        field: v,
        aggregation: pivotConfig.aggregations[v] || 'sum',
      })),
      filters: (pivotConfig.filters || []).reduce((acc, f) => {
        if (f.field && f.values?.length) acc[f.field] = f.values;
        return acc;
      }, {}),
      scenario_ids: [],
      limit: pivotConfig.limit || 500,
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
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            {viewMode === 'chart' && (
              <Button variant="ghost" size="sm" onClick={() => setStacked((v) => !v)}>
                {stacked ? '≡ Grouped' : '⊟ Stacked'}
              </Button>
            )}
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
        <div style={{ flex: 1, overflowY: 'auto', padding: spacing.lg }}>
          {pivotConfig.values.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
              {viewMode === 'table' ? (
                <PivotTable data={pivotData} loading={isLoading} error={error} />
              ) : (
                <div style={{ padding: spacing.md }}>
                  <PivotChart data={pivotData} stacked={stacked} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ViewToggle({ mode, onChange }) {
  return (
    <div style={{
      display: 'inline-flex', borderRadius: radius.md,
      border: `1px solid ${colors.border}`, overflow: 'hidden',
    }}>
      {[
        { id: 'table', label: '⊞ Table' },
        { id: 'chart', label: '◫ Chart' },
      ].map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          style={{
            padding: `${spacing.xs}px ${spacing.sm}px`,
            background: mode === opt.id ? colors.primary : colors.bgCard,
            color: mode === opt.id ? 'white' : colors.textSecondary,
            border: 'none', cursor: 'pointer',
            fontSize: typography.fontSizes.xs,
            fontFamily: typography.fontFamily,
            fontWeight: typography.fontWeights.medium,
            transition: 'all 0.1s',
          }}
        >
          {opt.label}
        </button>
      ))}
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
