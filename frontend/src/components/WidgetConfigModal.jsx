import { useState, useMemo } from 'react';
import { colors, spacing, radius, typography, shadows, inputStyle, labelStyle } from '../theme.js';
import { Button } from './common/Button.jsx';
import FieldManager from './FieldManager.jsx';
import FilterManager from './FilterManager.jsx';

export default function WidgetConfigModal({ modelId, metadata, widget, onSave, onClose, saving }) {
  // Initialize from existing widget or empty
  const existing = widget?.config || {};
  const [name, setName] = useState(widget?.name || '');
  const [widgetType, setWidgetType] = useState(widget?.widget_type || 'table');
  const [pivotConfig, setPivotConfig] = useState({
    model_id: modelId,
    rows: existing.row_dimensions || [],
    columns: existing.column_dimension ? [existing.column_dimension] : [],
    values: (existing.measures || []).map((m) => m.field),
    aggregations: (existing.measures || []).reduce((acc, m) => { acc[m.field] = m.aggregation || 'sum'; return acc; }, {}),
    filters: Object.entries(existing.filters || {}).map(([field, values]) => ({ field, values })),
    limit: existing.limit || 500,
  });

  const allDimensions = metadata?.dimensions || [];
  const allMeasures = metadata?.measures || [];

  // Resolve fact dataset
  const datasetId = useMemo(() => {
    if (!metadata?.datasets?.length) return null;
    const map = metadata.fieldDatasetMap || {};
    for (const f of (pivotConfig.values || [])) {
      if (map[f]) return map[f];
    }
    return metadata.datasets[0].id;
  }, [metadata, pivotConfig.values]);

  // Build join_dimensions
  const joinDims = useMemo(() => {
    if (!datasetId || !metadata) return {};
    const map = metadata.fieldDatasetMap || {};
    const filterFields = (pivotConfig.filters || []).map((f) => f.field).filter(Boolean);
    const allDims = [...(pivotConfig.rows || []), ...(pivotConfig.columns || []), ...filterFields];
    const result = {};
    for (const dim of allDims) {
      const dimDs = map[dim];
      if (dimDs && dimDs !== datasetId) result[dim] = dimDs;
    }
    return result;
  }, [datasetId, pivotConfig, metadata]);

  const handleSave = () => {
    if (!name.trim() || pivotConfig.values.length === 0) return;

    const config = {
      model_id: modelId,
      dataset_id: datasetId,
      row_dimensions: widgetType === 'card' ? [] : pivotConfig.rows,
      column_dimension: pivotConfig.columns[0] || null,
      measures: pivotConfig.values.map((v) => ({
        field: v,
        aggregation: pivotConfig.aggregations[v] || 'sum',
      })),
      filters: (pivotConfig.filters || []).reduce((acc, f) => {
        if (f.field && f.values?.length) acc[f.field] = f.values;
        return acc;
      }, {}),
      join_dimensions: Object.keys(joinDims).length > 0 ? joinDims : undefined,
      limit: pivotConfig.limit || 500,
    };

    onSave({ name: name.trim(), widget_type: widgetType, config });
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: colors.bgCard, borderRadius: radius.lg, boxShadow: shadows.xl,
        width: 720, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto',
        padding: spacing.xl,
      }}>
        <h3 style={{ margin: `0 0 ${spacing.lg}px`, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
          {widget ? 'Edit Widget' : 'Add Widget'}
        </h3>

        {/* Name + Type row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: spacing.md, marginBottom: spacing.md }}>
          <div>
            <label style={labelStyle}>Widget Name *</label>
            <input style={inputStyle} placeholder="e.g. Revenue by Region" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <div style={{ display: 'flex', gap: spacing.xs, flexWrap: 'wrap' }}>
              {[
                { key: 'table', icon: '◈', label: 'Table' },
                { key: 'card', icon: '#', label: 'Card' },
                { key: 'bar', icon: '▥', label: 'Bar' },
                { key: 'line', icon: '⟋', label: 'Line' },
                { key: 'area', icon: '▤', label: 'Area' },
              ].map(({ key, icon, label }) => (
                <button
                  key={key}
                  onClick={() => setWidgetType(key)}
                  style={{
                    padding: `${spacing.xs}px ${spacing.sm}px`, borderRadius: radius.md,
                    border: `1px solid ${widgetType === key ? colors.primary : colors.border}`,
                    background: widgetType === key ? colors.primaryLight : 'transparent',
                    color: widgetType === key ? colors.primary : colors.textSecondary,
                    fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm,
                    fontWeight: typography.fontWeights.medium, cursor: 'pointer',
                  }}
                >
                  {icon} {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {widgetType === 'card' && (
          <p style={{ margin: `0 0 ${spacing.md}px`, fontSize: typography.fontSizes.sm, color: colors.textMuted, fontFamily: typography.fontFamily }}>
            Cards show a single aggregated number. Pick one measure and optional filters.
          </p>
        )}
        {['bar', 'line', 'area'].includes(widgetType) && (
          <p style={{ margin: `0 0 ${spacing.md}px`, fontSize: typography.fontSizes.sm, color: colors.textMuted, fontFamily: typography.fontFamily }}>
            Charts plot measures along a dimension. Add at least one row dimension (x-axis) and one or more measures (y-axis).
          </p>
        )}

        {/* Field manager */}
        <div style={{ marginBottom: spacing.md }}>
          <FieldManager
            metadata={metadata}
            pivotConfig={pivotConfig}
            onConfigChange={setPivotConfig}
          />
        </div>

        {/* Filters */}
        <div style={{ marginBottom: spacing.lg }}>
          <FilterManager
            metadata={metadata}
            filters={pivotConfig.filters || []}
            onFiltersChange={(filters) => setPivotConfig((prev) => ({ ...prev, filters }))}
          />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!name.trim() || pivotConfig.values.length === 0}
            onClick={handleSave}
          >
            {widget ? 'Save Changes' : 'Create Widget'}
          </Button>
        </div>
      </div>
    </div>
  );
}
