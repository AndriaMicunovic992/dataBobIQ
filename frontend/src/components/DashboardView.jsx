import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useDashboard, useCreateWidget, useUpdateWidget, useDeleteWidget, useSaveLayout } from '../hooks/useDashboard.js';
import { useScenarios, useScenario, useAddRule, useDeleteRule } from '../hooks/useScenarios.js';
import { useMetadata } from '../hooks/useMetadata.js';
import { usePivot } from '../hooks/usePivot.js';
import { colors, spacing, radius, typography, shadows, cardStyle, inputStyle, labelStyle, transitions } from '../theme.js';
import { Button } from './common/Button.jsx';
import { Badge } from './common/Badge.jsx';
import PivotTable from './PivotTable.jsx';
import DashboardCard from './DashboardCard.jsx';
import WidgetConfigModal from './WidgetConfigModal.jsx';

const GRID_COLS = 12;
const ROW_HEIGHT_PX = 80;
const GAP_PX = 16;

const RULE_TYPES = [
  { value: 'multiplier', label: 'Multiplier', desc: 'e.g. x1.1 = +10%' },
  { value: 'offset', label: 'Offset (+/-)', desc: 'e.g. +50000' },
  { value: 'set_value', label: 'Set Value (=)', desc: 'Override to exact value' },
];

const RULE_TYPE_COLORS = {
  multiplier: { bg: '#dbeafe', text: '#1e40af', label: 'Revenue uplift' },
  offset: { bg: '#d1fae5', text: '#065f46', label: 'Cost reduction' },
  set_value: { bg: '#fef3c7', text: '#92400e', label: 'Set value' },
};

// ---------------------------------------------------------------------------
// KPI Summary Card
// ---------------------------------------------------------------------------
function KPISummaryCard({ label, value, sublabel }) {
  return (
    <div style={{
      background: colors.bgCard, borderRadius: radius.md,
      border: `1px solid ${colors.border}`, padding: `${spacing.sm}px ${spacing.md}px`,
      minWidth: 160, flex: '1 1 160px',
    }}>
      <div style={{
        fontSize: typography.fontSizes.xs, color: colors.textMuted,
        fontFamily: typography.fontFamily, fontWeight: typography.fontWeights.medium,
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.bold,
        color: colors.textPrimary, fontFamily: typography.fontFamily,
      }}>
        {value}
      </div>
      {sublabel && (
        <div style={{
          fontSize: typography.fontSizes.xs, color: colors.textMuted,
          fontFamily: typography.fontFamily, marginTop: 2,
        }}>
          {sublabel}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single table widget - calls /pivot with saved config
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
// Drag / Resize state machine
// ---------------------------------------------------------------------------
function useGridInteraction(widgets, onLayoutChange) {
  const [dragging, setDragging] = useState(null); // { widgetId, startX, startY, origPos }
  const [resizing, setResizing] = useState(null); // { widgetId, startX, startY, origPos }
  const containerRef = useRef(null);

  const getCellSize = useCallback(() => {
    if (!containerRef.current) return { cellW: 80, cellH: ROW_HEIGHT_PX };
    const rect = containerRef.current.getBoundingClientRect();
    const totalGap = (GRID_COLS - 1) * GAP_PX;
    const cellW = (rect.width - totalGap) / GRID_COLS;
    return { cellW, cellH: ROW_HEIGHT_PX };
  }, []);

  const handleDragStart = useCallback((e, widgetId, pos) => {
    e.preventDefault();
    setDragging({ widgetId, startX: e.clientX, startY: e.clientY, origPos: { ...pos } });
  }, []);

  const handleResizeStart = useCallback((e, widgetId, pos) => {
    e.preventDefault();
    e.stopPropagation();
    setResizing({ widgetId, startX: e.clientX, startY: e.clientY, origPos: { ...pos } });
  }, []);

  useEffect(() => {
    if (!dragging && !resizing) return;

    const handleMouseMove = (e) => {
      const { cellW, cellH } = getCellSize();

      if (dragging) {
        const dx = Math.round((e.clientX - dragging.startX) / (cellW + GAP_PX));
        const dy = Math.round((e.clientY - dragging.startY) / (cellH + GAP_PX));
        const newCol = Math.max(1, Math.min(GRID_COLS - (dragging.origPos.colSpan || 6) + 1, (dragging.origPos.col || 1) + dx));
        const newRow = Math.max(1, (dragging.origPos.row || 1) + dy);
        onLayoutChange(dragging.widgetId, { ...dragging.origPos, col: newCol, row: newRow });
      }

      if (resizing) {
        const dx = Math.round((e.clientX - resizing.startX) / (cellW + GAP_PX));
        const dy = Math.round((e.clientY - resizing.startY) / (cellH + GAP_PX));
        const newColSpan = Math.max(2, Math.min(GRID_COLS - (resizing.origPos.col || 1) + 1, (resizing.origPos.colSpan || 6) + dx));
        const newRowSpan = Math.max(2, (resizing.origPos.rowSpan || 4) + dy);
        onLayoutChange(resizing.widgetId, { ...resizing.origPos, colSpan: newColSpan, rowSpan: newRowSpan });
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
      setResizing(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, resizing, getCellSize, onLayoutChange]);

  return { containerRef, handleDragStart, handleResizeStart, isDragging: !!dragging, isResizing: !!resizing };
}

// ---------------------------------------------------------------------------
// Widget wrapper with drag header + resize handle
// ---------------------------------------------------------------------------
function WidgetFrame({ widget, onEdit, onDelete, scenarioId, onDragStart, onResizeStart }) {
  const [hovered, setHovered] = useState(false);
  const pos = widget.position || {};
  const col = pos.col || 1;
  const row = pos.row || 1;
  const colSpan = pos.colSpan || 6;
  const rowSpan = pos.rowSpan || 4;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        gridColumn: `${col} / span ${colSpan}`,
        gridRow: `${row} / span ${rowSpan}`,
        background: colors.bgCard, borderRadius: radius.lg,
        border: `1px solid ${hovered ? colors.borderFocus : colors.border}`,
        boxShadow: shadows.sm,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        position: 'relative', transition: transitions.fast,
        minHeight: 0,
      }}
    >
      {/* Drag header */}
      <div
        onMouseDown={(e) => onDragStart(e, widget.id, pos)}
        style={{
          padding: `${spacing.sm}px ${spacing.md}px`,
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', gap: spacing.sm,
          minHeight: 36, cursor: 'grab', userSelect: 'none',
        }}
      >
        <span style={{
          fontSize: 10, color: colors.textMuted, cursor: 'grab', marginRight: 2,
        }}>&#x2630;</span>
        <span style={{
          fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold,
          color: colors.textPrimary, fontFamily: typography.fontFamily,
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {widget.name}
        </span>
        <Badge variant="muted">{widget.widget_type}</Badge>
        {hovered && (
          <>
            <button onClick={() => onEdit(widget)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, fontSize: 12, fontFamily: typography.fontFamily }}>Edit</button>
            <button onClick={() => onDelete(widget.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.danger, fontSize: 14, lineHeight: 1 }}>x</button>
          </>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: widget.widget_type === 'card' ? 'hidden' : 'auto', padding: widget.widget_type === 'card' ? 0 : undefined }}>
        {widget.widget_type === 'card' ? (
          <DashboardCard widget={widget} scenarioId={scenarioId} />
        ) : (
          <DashboardTableWidget widget={widget} scenarioId={scenarioId} />
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={(e) => onResizeStart(e, widget.id, pos)}
        style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 16, height: 16, cursor: 'nwse-resize',
          background: hovered ? colors.primary : 'transparent',
          borderRadius: `0 0 ${radius.lg}px 0`,
          opacity: hovered ? 0.3 : 0,
          transition: transitions.fast,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario Sidebar - Rule Form
// ---------------------------------------------------------------------------
function RuleForm({ scenarioId, modelId, metadata, onClose }) {
  const [name, setName] = useState('');
  const [ruleType, setRuleType] = useState('multiplier');
  const [targetField, setTargetField] = useState('');
  const [value, setValue] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [filters, setFilters] = useState([]);
  const mut = useAddRule(scenarioId, modelId);

  const measures = useMemo(() => {
    const result = [];
    const seen = new Set();
    for (const ds of metadata?.datasets || []) {
      for (const m of ds.measures || []) {
        const key = m.canonical_name || m.field || m.name;
        if (key && !seen.has(key)) {
          seen.add(key);
          result.push({ ...m, _datasetName: ds.name });
        }
      }
    }
    return result;
  }, [metadata]);

  const dimensions = useMemo(() => {
    const result = [];
    const seen = new Set();
    for (const ds of metadata?.datasets || []) {
      for (const d of ds.dimensions || []) {
        const key = d.field;
        if (key && !seen.has(key)) {
          seen.add(key);
          result.push({ ...d, _datasetName: ds.name });
        }
      }
    }
    return result;
  }, [metadata]);

  const addFilter = () => setFilters([...filters, { column: '', values: [] }]);
  const removeFilter = (idx) => setFilters(filters.filter((_, i) => i !== idx));
  const updateFilterColumn = (idx, col) => {
    const updated = [...filters];
    updated[idx] = { column: col, values: [] };
    setFilters(updated);
  };
  const toggleFilterValue = (idx, val) => {
    const updated = [...filters];
    const f = updated[idx];
    if (f.values.includes(val)) {
      f.values = f.values.filter((v) => v !== val);
    } else {
      f.values = [...f.values, val];
    }
    setFilters(updated);
  };

  const getDimValues = (colName) => {
    for (const ds of metadata?.datasets || []) {
      for (const d of ds.dimensions || []) {
        if (d.field === colName && d.values?.length > 0) return d.values;
      }
    }
    return [];
  };

  const handleSubmit = () => {
    if (!targetField || !value) return;
    const numVal = parseFloat(value);
    const adjustment = ruleType === 'multiplier' ? { factor: numVal }
      : ruleType === 'offset' ? { offset: numVal }
      : { value: numVal };

    const filter_expr = {};
    for (const f of filters) {
      if (f.column && f.values.length > 0) {
        filter_expr[f.column] = f.values;
      }
    }

    const rule = {
      name: name.trim() || `${ruleType} on ${targetField}`,
      rule_type: ruleType,
      target_field: targetField,
      adjustment,
      filter_expr: Object.keys(filter_expr).length > 0 ? filter_expr : undefined,
      period_from: periodFrom || undefined,
      period_to: periodTo || undefined,
    };

    mut.mutate(rule, { onSuccess: onClose });
  };

  return (
    <div style={{ background: colors.bgMuted, borderRadius: radius.md, border: `1px solid ${colors.border}`, padding: spacing.md, marginBottom: spacing.md }}>
      <h4 style={{ margin: `0 0 ${spacing.sm}px`, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
        Add Rule
      </h4>

      <div style={{ marginBottom: spacing.sm }}>
        <label style={labelStyle}>Rule Name</label>
        <input style={inputStyle} placeholder="Optional name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm, marginBottom: spacing.sm }}>
        <div>
          <label style={labelStyle}>Type *</label>
          <select style={inputStyle} value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
            {RULE_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Target Field *</label>
          <select style={inputStyle} value={targetField} onChange={(e) => setTargetField(e.target.value)}>
            <option value="">Select...</option>
            {measures.map((m) => {
              const fieldName = m.canonical_name || m.field || m.name;
              return <option key={fieldName} value={fieldName}>{m.label || fieldName}</option>;
            })}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm, marginBottom: spacing.sm }}>
        <div>
          <label style={labelStyle}>
            {ruleType === 'multiplier' ? 'Factor (e.g. 1.1)' : ruleType === 'offset' ? 'Amount (+/-)' : 'Set to value'}
          </label>
          <input style={inputStyle} type="number" step={ruleType === 'multiplier' ? '0.01' : '1000'} placeholder={ruleType === 'multiplier' ? '1.10' : '50000'} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Period From</label>
          <input style={inputStyle} type="month" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
        </div>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: spacing.sm }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Filters</label>
          <button onClick={addFilter} style={{ background: 'none', border: `1px solid ${colors.border}`, borderRadius: radius.sm, cursor: 'pointer', color: colors.primary, fontSize: typography.fontSizes.xs, padding: '2px 6px', fontFamily: typography.fontFamily }}>
            + Filter
          </button>
        </div>
        {filters.map((f, idx) => {
          const dimValues = getDimValues(f.column);
          return (
            <div key={idx} style={{ display: 'flex', gap: spacing.xs, alignItems: 'flex-start', marginBottom: spacing.xs, background: colors.bgCard, padding: spacing.xs, borderRadius: radius.sm, border: `1px solid ${colors.border}` }}>
              <select style={{ ...inputStyle, width: 120, marginBottom: 0, flex: '0 0 120px' }} value={f.column} onChange={(e) => updateFilterColumn(idx, e.target.value)}>
                <option value="">Column...</option>
                {dimensions.map((d) => <option key={d.field} value={d.field}>{d.label || d.field}</option>)}
              </select>
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 3, maxHeight: 60, overflowY: 'auto' }}>
                {f.column && dimValues.map((v) => {
                  const selected = f.values.includes(String(v));
                  return (
                    <button key={v} onClick={() => toggleFilterValue(idx, String(v))} style={{
                      padding: '1px 6px', fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily,
                      borderRadius: radius.full, cursor: 'pointer', border: `1px solid ${selected ? colors.primary : colors.border}`,
                      background: selected ? colors.primaryLight : colors.bgCard, color: selected ? colors.primary : colors.textSecondary,
                    }}>
                      {v}
                    </button>
                  );
                })}
              </div>
              <button onClick={() => removeFilter(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.danger, fontSize: 12 }}>x</button>
            </div>
          );
        })}
      </div>

      {mut.isError && <p style={{ color: colors.danger, fontSize: typography.fontSizes.xs, margin: `0 0 ${spacing.xs}px`, fontFamily: typography.fontFamily }}>{mut.error?.message}</p>}

      <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" loading={mut.isPending} disabled={!targetField || !value} onClick={handleSubmit}>Add Rule</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario Sidebar - Rule display card
// ---------------------------------------------------------------------------
function RuleCard({ rule, onDelete }) {
  const ruleStyle = RULE_TYPE_COLORS[rule.rule_type] || RULE_TYPE_COLORS.multiplier;
  const filterEntries = Object.entries(rule.filter_expr || {});

  const formatAdjustment = (rule) => {
    const adj = rule.adjustment || {};
    if (rule.rule_type === 'multiplier') {
      const factor = adj.factor || 1;
      const pct = ((factor - 1) * 100).toFixed(1);
      return `${pct >= 0 ? '+' : ''}${pct}%`;
    }
    if (rule.rule_type === 'offset') {
      const offset = adj.offset || 0;
      return `${offset >= 0 ? '+' : ''}${offset.toLocaleString()}`;
    }
    return `= ${(adj.value || 0).toLocaleString()}`;
  };

  return (
    <div style={{
      background: colors.bgCard, borderRadius: radius.md,
      border: `1px solid ${colors.border}`, padding: spacing.md,
      marginBottom: spacing.sm,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
        <span style={{
          fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.semibold,
          padding: '2px 8px', borderRadius: radius.full,
          background: ruleStyle.bg, color: ruleStyle.text,
          fontFamily: typography.fontFamily,
        }}>
          {ruleStyle.label}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={() => onDelete(rule.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, fontSize: 12 }}>x</button>
      </div>

      {/* Filter chips */}
      {filterEntries.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: spacing.xs }}>
          {filterEntries.map(([col, vals]) => (
            <span key={col} style={{
              fontSize: typography.fontSizes.xs, padding: '1px 6px',
              borderRadius: radius.full, background: colors.bgMuted,
              color: colors.textSecondary, fontFamily: typography.fontFamily,
              border: `1px solid ${colors.border}`,
            }}>
              {vals.join(' / ')}
            </span>
          ))}
        </div>
      )}

      <div style={{
        fontSize: typography.fontSizes.sm, color: colors.textPrimary,
        fontFamily: typography.fontFamily, marginBottom: spacing.xs,
      }}>
        {rule.name}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
        <span style={{
          fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.bold,
          color: colors.textPrimary, fontFamily: typography.fontFamily,
        }}>
          IMPACT: {formatAdjustment(rule)}
        </span>
        {rule.period_from && (
          <span style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>
            {rule.period_from}{rule.period_to ? ` to ${rule.period_to}` : '+'}
          </span>
        )}
      </div>

      <div style={{
        fontSize: typography.fontSizes.xs, color: colors.textMuted,
        fontFamily: typography.fontFamily, marginTop: spacing.xs,
      }}>
        Target: {rule.target_field}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario Assumptions Sidebar
// ---------------------------------------------------------------------------
function ScenarioSidebar({ modelId, scenarioId, metadata }) {
  const { data: scenario } = useScenario(scenarioId);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [assumptionText, setAssumptionText] = useState('');
  const deleteRuleMut = useDeleteRule(scenarioId, modelId);

  const rules = scenario?.rules || [];

  const handleDeleteRule = useCallback((ruleId) => {
    deleteRuleMut.mutate(ruleId);
  }, [deleteRuleMut]);

  if (!scenarioId) {
    return (
      <div style={{ padding: spacing.md }}>
        <h3 style={{ margin: `0 0 ${spacing.md}px`, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
          Scenario Assumptions
        </h3>
        <p style={{ fontSize: typography.fontSizes.sm, color: colors.textMuted, fontFamily: typography.fontFamily, margin: 0 }}>
          Select a scenario from the toolbar to view and manage assumptions.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: spacing.md, height: '100%', overflowY: 'auto' }}>
      <h3 style={{ margin: `0 0 ${spacing.md}px`, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
        Scenario Assumptions
      </h3>

      {/* Add assumption input */}
      <div style={{ marginBottom: spacing.md }}>
        <input
          style={{ ...inputStyle, marginBottom: spacing.sm }}
          placeholder="Add an assumption..."
          value={assumptionText}
          onChange={(e) => setAssumptionText(e.target.value)}
        />
        <div style={{ display: 'flex', gap: spacing.sm }}>
          <Button variant="primary" size="sm" onClick={() => setShowRuleForm(true)}>
            + Add to scenario
          </Button>
          <Button variant="secondary" size="sm" onClick={() => {}}>
            Suggest AI
          </Button>
        </div>
      </div>

      {/* Rule form */}
      {showRuleForm && (
        <RuleForm
          scenarioId={scenarioId}
          modelId={modelId}
          metadata={metadata}
          onClose={() => setShowRuleForm(false)}
        />
      )}

      {/* Applied rules section */}
      <div style={{ marginTop: spacing.md }}>
        <div style={{
          fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium,
          color: colors.textMuted, fontFamily: typography.fontFamily,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          marginBottom: spacing.sm,
        }}>
          Applied to {scenario?.name || 'Scenario'}
        </div>

        {rules.length === 0 ? (
          <p style={{ fontSize: typography.fontSizes.sm, color: colors.textMuted, fontFamily: typography.fontFamily, margin: 0 }}>
            No rules yet. Add an assumption above.
          </p>
        ) : (
          rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} onDelete={handleDeleteRule} />
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard view
// ---------------------------------------------------------------------------
export default function DashboardView({ dashboardId, modelId }) {
  const { data: dashboard, isLoading } = useDashboard(dashboardId);
  const { data: scenarios = [] } = useScenarios(modelId);
  const { data: metadata } = useMetadata(modelId);
  const createMut = useCreateWidget(dashboardId);
  const updateMut = useUpdateWidget(dashboardId);
  const deleteMut = useDeleteWidget(dashboardId);
  const saveLayoutMut = useSaveLayout(dashboardId);

  const [editingWidget, setEditingWidget] = useState(null);
  const [scenarioId, setScenarioId] = useState('');
  const [localPositions, setLocalPositions] = useState({});

  const widgets = useMemo(() => {
    const raw = dashboard?.widgets || [];
    return raw.map((w) => ({
      ...w,
      position: localPositions[w.id] || w.position || { col: 1, row: 1, colSpan: 6, rowSpan: 4 },
    }));
  }, [dashboard, localPositions]);

  // Compute grid row count
  const maxRow = useMemo(() => {
    let max = 4;
    for (const w of widgets) {
      const pos = w.position || {};
      const end = (pos.row || 1) + (pos.rowSpan || 4);
      if (end > max) max = end;
    }
    return max + 2; // extra space for drops
  }, [widgets]);

  const handleLocalPositionChange = useCallback((widgetId, newPos) => {
    setLocalPositions((prev) => ({ ...prev, [widgetId]: newPos }));
  }, []);

  const { containerRef, handleDragStart, handleResizeStart } = useGridInteraction(
    widgets, handleLocalPositionChange
  );

  // Persist layout on mouseup (when localPositions change and no drag/resize active)
  const saveTimeoutRef = useRef(null);
  useEffect(() => {
    if (Object.keys(localPositions).length === 0) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const layoutData = Object.entries(localPositions).map(([id, position]) => ({ id, position }));
      if (layoutData.length > 0) {
        saveLayoutMut.mutate(layoutData);
      }
    }, 800);
    return () => clearTimeout(saveTimeoutRef.current);
  }, [localPositions]);

  const handleSaveWidget = useCallback((widgetData) => {
    if (editingWidget && editingWidget.id) {
      updateMut.mutate({ id: editingWidget.id, ...widgetData }, { onSuccess: () => setEditingWidget(null) });
    } else {
      // Auto-position: place new widget below existing ones
      let nextRow = 1;
      for (const w of widgets) {
        const pos = w.position || {};
        const endRow = (pos.row || 1) + (pos.rowSpan || 4);
        if (endRow > nextRow) nextRow = endRow;
      }
      const isCard = widgetData.widget_type === 'card';
      const position = {
        col: 1,
        row: nextRow,
        colSpan: isCard ? 3 : 6,
        rowSpan: isCard ? 2 : 4,
      };
      createMut.mutate({ ...widgetData, position }, { onSuccess: () => setEditingWidget(null) });
    }
  }, [editingWidget, createMut, updateMut, widgets]);

  const handleDelete = useCallback((id) => {
    deleteMut.mutate(id);
  }, [deleteMut]);

  const selectedScenario = scenarios.find((s) => s.id === scenarioId);

  // KPI summary values - computed from first widget data or scenario
  const kpiItems = useMemo(() => {
    const items = [];
    if (selectedScenario) {
      items.push({ label: 'SCENARIO', value: selectedScenario.name });
    } else {
      items.push({ label: 'SCENARIO', value: 'Base Case' });
    }
    return items;
  }, [selectedScenario]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{
          padding: `${spacing.md}px ${spacing.xl}px`,
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgCard,
          display: 'flex', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap',
        }}>
          <h2 style={{
            margin: 0, fontSize: typography.fontSizes.xl,
            fontWeight: typography.fontWeights.bold, color: colors.textPrimary,
            fontFamily: typography.fontFamily,
          }}>
            {dashboard?.name || 'Dashboard'}
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

        {/* KPI Summary Bar */}
        <div style={{
          padding: `${spacing.sm}px ${spacing.xl}px`,
          display: 'flex', gap: spacing.md, flexWrap: 'wrap',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgMuted,
        }}>
          {kpiItems.map((item, i) => (
            <KPISummaryCard key={i} label={item.label} value={item.value} sublabel={item.sublabel} />
          ))}
        </div>

        {/* Widget grid area */}
        <div style={{ flex: 1, overflow: 'auto', padding: spacing.xl }}>
          {isLoading ? (
            <div style={{ color: colors.textMuted, fontFamily: typography.fontFamily }}>Loading dashboard...</div>
          ) : widgets.length === 0 ? (
            <div style={{
              ...cardStyle, textAlign: 'center', padding: `${spacing.xl * 2}px ${spacing.xl}px`,
              color: colors.textMuted, maxWidth: 500, margin: '80px auto',
            }}>
              <div style={{ fontSize: 48, marginBottom: spacing.md }}>&#x25C8;</div>
              <h3 style={{
                margin: `0 0 ${spacing.sm}px`, fontSize: typography.fontSizes.lg,
                fontWeight: typography.fontWeights.semibold, color: colors.textSecondary,
                fontFamily: typography.fontFamily,
              }}>
                No widgets yet
              </h3>
              <p style={{
                margin: `0 0 ${spacing.lg}px`, fontSize: typography.fontSizes.md,
                fontFamily: typography.fontFamily,
              }}>
                Add a table or card widget to build your dashboard. Configure rows, columns, measures, and filters. Then overlay scenarios to compare.
              </p>
              <Button variant="primary" onClick={() => setEditingWidget('new')}>+ Add Widget</Button>
            </div>
          ) : (
            <div
              ref={containerRef}
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
                gridAutoRows: ROW_HEIGHT_PX,
                gap: GAP_PX,
                minHeight: maxRow * (ROW_HEIGHT_PX + GAP_PX),
              }}
            >
              {widgets.map((w) => (
                <WidgetFrame
                  key={w.id}
                  widget={w}
                  scenarioId={scenarioId || null}
                  onEdit={setEditingWidget}
                  onDelete={handleDelete}
                  onDragStart={handleDragStart}
                  onResizeStart={handleResizeStart}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right sidebar - Scenario Assumptions */}
      <aside style={{
        width: 320, flexShrink: 0,
        borderLeft: `1px solid ${colors.border}`,
        background: colors.bgCard,
        overflowY: 'auto',
      }}>
        <ScenarioSidebar
          modelId={modelId}
          scenarioId={scenarioId}
          metadata={metadata}
        />
      </aside>

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
