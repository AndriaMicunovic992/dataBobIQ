import { useState, useMemo, useCallback } from 'react';
import { useWidgets, useCreateWidget, useUpdateWidget, useDeleteWidget } from '../hooks/useDashboard.js';
import { useScenarios } from '../hooks/useScenarios.js';
import { useMetadata } from '../hooks/useMetadata.js';
import { usePivot } from '../hooks/usePivot.js';
import { colors, spacing, radius, typography, shadows, cardStyle, inputStyle, labelStyle } from '../theme.js';
import { Button } from './common/Button.jsx';
import { Badge } from './common/Badge.jsx';
import PivotTable from './PivotTable.jsx';
import DashboardCard from './DashboardCard.jsx';
import WidgetConfigModal from './WidgetConfigModal.jsx';

// ---------------------------------------------------------------------------
// Single table widget — calls /pivot with saved config
// ---------------------------------------------------------------------------
function DashboardTableWidget({ widget, scenarioId }) {
  const config = widget.config || {};

  const apiConfig = useMemo(() => {
    if (!config.dataset_id || !config.measures?.length) return null;
    return {
      model_id: config.model_id,
      dataset_id: config.dataset_id,
      row_dimensions: config.row_dimensions || [],
      column_dimension: config.column_dimension || null,
      measures: config.measures,
      filters: config.filters || {},
      scenario_ids: scenarioId ? [scenarioId] : [],
      join_dimensions: config.join_dimensions || undefined,
      include_totals: true,
      limit: config.limit || 500,
    };
  }, [config, scenarioId]);

  const { data, isLoading, error } = usePivot(apiConfig);

  if (!apiConfig) return <div style={{ padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>Widget not configured.</div>;
  if (isLoading) return <div style={{ padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>Loading...</div>;
  if (error) return <div style={{ padding: spacing.md, color: colors.danger, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>{error.message}</div>;
  if (!data) return null;

  return <PivotTable data={data} />;
}

// ---------------------------------------------------------------------------
// Widget wrapper with header
// ---------------------------------------------------------------------------
function WidgetFrame({ widget, onEdit, onDelete, scenarioId }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: colors.bgCard, borderRadius: radius.lg,
        border: `1px solid ${colors.border}`, boxShadow: shadows.sm,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: `${spacing.sm}px ${spacing.md}px`,
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex', alignItems: 'center', gap: spacing.sm,
        minHeight: 36,
      }}>
        <span style={{ fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {widget.name}
        </span>
        <Badge variant="muted">{widget.widget_type}</Badge>
        {hovered && (
          <>
            <button onClick={() => onEdit(widget)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, fontSize: 12, fontFamily: typography.fontFamily }}>Edit</button>
            <button onClick={() => onDelete(widget.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.danger, fontSize: 14, lineHeight: 1 }}>×</button>
          </>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: widget.widget_type === 'card' ? 0 : undefined }}>
        {widget.widget_type === 'card' ? (
          <DashboardCard widget={widget} scenarioId={scenarioId} />
        ) : (
          <DashboardTableWidget widget={widget} scenarioId={scenarioId} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard view
// ---------------------------------------------------------------------------
export default function DashboardView({ modelId }) {
  const { data: widgets = [], isLoading } = useWidgets(modelId);
  const { data: scenarios = [] } = useScenarios(modelId);
  const { data: metadata } = useMetadata(modelId);
  const createMut = useCreateWidget(modelId);
  const updateMut = useUpdateWidget(modelId);
  const deleteMut = useDeleteWidget(modelId);

  const [editingWidget, setEditingWidget] = useState(null); // null | 'new' | widget object
  const [scenarioId, setScenarioId] = useState('');

  const handleSaveWidget = useCallback((widgetData) => {
    if (editingWidget && editingWidget.id) {
      updateMut.mutate({ id: editingWidget.id, ...widgetData }, { onSuccess: () => setEditingWidget(null) });
    } else {
      createMut.mutate(widgetData, { onSuccess: () => setEditingWidget(null) });
    }
  }, [editingWidget, createMut, updateMut]);

  const handleDelete = useCallback((id) => {
    deleteMut.mutate(id);
  }, [deleteMut]);

  return (
    <div style={{ padding: spacing.xl, height: '100vh', overflow: 'auto' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
          Dashboard
        </h2>
        <div style={{ flex: 1 }} />

        {/* Scenario selector */}
        {scenarios.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
            <label style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>Scenario:</label>
            <select
              style={{ ...inputStyle, marginBottom: 0, minWidth: 160, padding: '4px 8px', fontSize: typography.fontSizes.xs }}
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
            >
              <option value="">Actuals only</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({(s.rules || []).length} rules)</option>
              ))}
            </select>
          </div>
        )}

        <Button variant="primary" size="sm" onClick={() => setEditingWidget('new')}>
          + Add Widget
        </Button>
      </div>

      {/* Widget grid */}
      {isLoading ? (
        <div style={{ color: colors.textMuted, fontFamily: typography.fontFamily }}>Loading dashboard...</div>
      ) : widgets.length === 0 ? (
        <div style={{
          ...cardStyle, textAlign: 'center', padding: `${spacing.xl * 2}px ${spacing.xl}px`,
          color: colors.textMuted, maxWidth: 500, margin: '80px auto',
        }}>
          <div style={{ fontSize: 48, marginBottom: spacing.md }}>◈</div>
          <h3 style={{ margin: `0 0 ${spacing.sm}px`, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold, color: colors.textSecondary, fontFamily: typography.fontFamily }}>
            No widgets yet
          </h3>
          <p style={{ margin: `0 0 ${spacing.lg}px`, fontSize: typography.fontSizes.md, fontFamily: typography.fontFamily }}>
            Add a table or card widget to build your dashboard. Configure rows, columns, measures, and filters — just like the Actuals tab. Then overlay scenarios to compare.
          </p>
          <Button variant="primary" onClick={() => setEditingWidget('new')}>+ Add Widget</Button>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
          gap: spacing.lg,
        }}>
          {widgets.map((w) => (
            <WidgetFrame
              key={w.id}
              widget={w}
              scenarioId={scenarioId || null}
              onEdit={setEditingWidget}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Config modal */}
      {editingWidget && (
        <WidgetConfigModal
          modelId={modelId}
          metadata={metadata}
          widget={editingWidget === 'new' ? null : editingWidget}
          onSave={handleSaveWidget}
          onClose={() => setEditingWidget(null)}
          saving={createMut.isPending || updateMut.isPending}
        />
      )}
    </div>
  );
}
