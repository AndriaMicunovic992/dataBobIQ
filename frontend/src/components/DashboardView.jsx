import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useDashboard, useCreateWidget, useUpdateWidget, useDeleteWidget, useSaveLayout } from '../hooks/useDashboard.js';
import { useScenarios, useScenario, useAddRule, useUpdateRule, useDeleteRule } from '../hooks/useScenarios.js';
import { useMetadata } from '../hooks/useMetadata.js';
import { usePivot } from '../hooks/usePivot.js';
import { colors, spacing, radius, typography, shadows, cardStyle, inputStyle, labelStyle, transitions } from '../theme.js';
import { Button } from './common/Button.jsx';
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

// ---------------------------------------------------------------------------
// Error state — detects "missing parquet" and shows a re-upload prompt.
// ---------------------------------------------------------------------------
export function isMissingDataError(error) {
  const msg = String(error?.message || '');
  return /missing its data file|re-upload|missing_parquet/i.test(msg);
}

function WidgetErrorState({ error }) {
  if (isMissingDataError(error)) {
    return (
      <div style={{
        padding: spacing.md,
        margin: spacing.md,
        background: colors.bgMuted,
        border: `1px dashed ${colors.border}`,
        borderRadius: radius.md,
        fontFamily: typography.fontFamily,
      }}>
        <div style={{
          fontSize: typography.fontSizes.sm,
          fontWeight: typography.fontWeights.semibold,
          color: colors.textPrimary,
          marginBottom: spacing.xs,
        }}>
          Dataset unavailable
        </div>
        <div style={{
          fontSize: typography.fontSizes.xs,
          color: colors.textSecondary,
          lineHeight: 1.5,
        }}>
          The underlying data file is missing and needs to be re-uploaded.
          Open the Data Model tab to upload the dataset again.
        </div>
      </div>
    );
  }
  return (
    <div style={{ padding: spacing.md, color: colors.danger, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
      {error.message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single table widget - calls /pivot with saved config
// ---------------------------------------------------------------------------
function DashboardTableWidget({ widget, scenarioId, yearFilter, metadata }) {
  const config = widget.config || {};

  const apiConfig = useMemo(() => {
    if (!config.dataset_id || !config.measures?.length) return null;
    const filters = { ...(config.filters || {}) };
    const joinDims = { ...(config.join_dimensions || {}) };
    if (yearFilter) {
      filters.year = [String(yearFilter)];
      // The `year` column may live on a calendar/date dataset, not the fact
      // table. Route it via join_dimensions so the pivot engine joins the
      // right table and qualifies the filter column correctly.
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
      include_totals: true,
      limit: config.limit || 500,
    };
  }, [config, scenarioId, yearFilter, metadata]);

  const { data, isLoading, error } = usePivot(apiConfig);

  if (!apiConfig) return <div style={{ padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>Widget not configured.</div>;
  if (isLoading) return <div style={{ padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>Loading...</div>;
  if (error) return <WidgetErrorState error={error} />;
  if (!data) return null;

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
      <PivotTable data={data} />
    </div>
  );
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
function WidgetFrame({ widget, onEdit, onDelete, scenarioId, yearFilter, metadata, onDragStart, onResizeStart }) {
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
        {hovered && (
          <>
            <button onClick={() => onEdit(widget)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, fontSize: 12, fontFamily: typography.fontFamily }}>Edit</button>
            <button onClick={() => onDelete(widget.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.danger, fontSize: 14, lineHeight: 1 }}>x</button>
          </>
        )}
      </div>

      {/* Body — for tables, let PivotTable own its scroll so the sticky
          totals footer can anchor to the right scroll container. */}
      <div style={{
        flex: 1,
        overflow: 'hidden',
        minHeight: 0,
        padding: widget.widget_type === 'card' ? 0 : undefined,
        display: 'flex',
      }}>
        {widget.widget_type === 'card' ? (
          <DashboardCard widget={widget} scenarioId={scenarioId} yearFilter={yearFilter} metadata={metadata} />
        ) : (
          <DashboardTableWidget widget={widget} scenarioId={scenarioId} yearFilter={yearFilter} metadata={metadata} />
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
function RuleForm({ scenarioId, modelId, metadata, onClose, editRule }) {
  const isEdit = !!editRule;

  const initialAdjustmentValue = (() => {
    if (!editRule) return '';
    const adj = editRule.adjustment || {};
    if (editRule.rule_type === 'multiplier') return String(adj.factor ?? '');
    if (editRule.rule_type === 'offset') return String(adj.offset ?? '');
    return String(adj.value ?? '');
  })();

  const initialFilters = (() => {
    if (!editRule?.filter_expr) return [];
    return Object.entries(editRule.filter_expr).map(([column, values]) => ({
      column,
      values: (values || []).map((v) => String(v)),
    }));
  })();

  const [name, setName] = useState(editRule?.name || '');
  const [ruleType, setRuleType] = useState(editRule?.rule_type || 'multiplier');
  const [targetField, setTargetField] = useState(editRule?.target_field || '');
  const [value, setValue] = useState(initialAdjustmentValue);
  const [periodFrom, setPeriodFrom] = useState(editRule?.period_from || '');
  const [periodTo, setPeriodTo] = useState(editRule?.period_to || '');
  const [filters, setFilters] = useState(initialFilters);
  const addMut = useAddRule(scenarioId, modelId);
  const updateMut = useUpdateRule(scenarioId, modelId);
  const mut = isEdit ? updateMut : addMut;

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
      filter_expr: Object.keys(filter_expr).length > 0 ? filter_expr : null,
      period_from: periodFrom || null,
      period_to: periodTo || null,
    };

    if (isEdit) {
      updateMut.mutate({ ruleId: editRule.id, data: rule }, { onSuccess: onClose });
    } else {
      addMut.mutate(rule, { onSuccess: onClose });
    }
  };

  return (
    <div style={{ background: colors.bgMuted, borderRadius: radius.md, border: `1px solid ${colors.border}`, padding: spacing.md, marginBottom: spacing.md }}>
      <h4 style={{ margin: `0 0 ${spacing.sm}px`, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
        {isEdit ? 'Edit Rule' : 'Add Rule'}
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
        <Button variant="primary" size="sm" loading={mut.isPending} disabled={!targetField || !value} onClick={handleSubmit}>{isEdit ? 'Save Changes' : 'Add Rule'}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario Sidebar - Rule display card
// ---------------------------------------------------------------------------
function formatRuleAdjustment(rule) {
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
}

/** Visual styling per rule type — drives the colored "header" pill. */
const RULE_TYPE_STYLES = {
  multiplier: { bg: '#dcfce7', text: '#065f46', border: '#86efac', label: 'Adjustment' },
  offset:     { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd', label: 'Offset' },
  set_value:  { bg: '#fef3c7', text: '#92400e', border: '#fcd34d', label: 'Override' },
};

/** A single rule inside the dashboard's Scenario Assumptions sidebar.
 *  Its appearance is driven entirely by the parent sidebar's expanded
 *  state — no internal expand/collapse. When the sidebar is collapsed,
 *  the card shrinks to just a colored title pill. When the sidebar is
 *  expanded, the card renders the full reference-image layout (pill
 *  header + bold title + IMPACT/NOTE grid + Edit/Delete actions). */
function RuleCard({ rule, onDelete, onEdit, sidebarExpanded = true }) {
  const style = RULE_TYPE_STYLES[rule.rule_type] || RULE_TYPE_STYLES.multiplier;
  const filterEntries = Object.entries(rule.filter_expr || {});
  const hasFilters = filterEntries.length > 0;

  // Collapsed — tiny title pill, nothing else.
  if (!sidebarExpanded) {
    return (
      <div style={{
        padding: `${spacing.xs}px 0`,
        display: 'flex', alignItems: 'center',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '5px 12px', borderRadius: radius.full,
          background: style.bg, color: style.text,
          border: `1px solid ${style.border}`,
          fontFamily: typography.fontFamily, fontSize: typography.fontSizes.xs,
          fontWeight: typography.fontWeights.semibold,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: '100%',
        }}>
          {rule.name || style.label}
        </span>
      </div>
    );
  }

  // Derive a human-readable impact line: "+10.0% from 2026-01"
  const impactText = (() => {
    const adj = rule.adjustment || {};
    let core;
    if (rule.rule_type === 'multiplier') {
      const pct = ((adj.factor ?? 1) - 1) * 100;
      core = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    } else if (rule.rule_type === 'offset') {
      const v = adj.offset ?? 0;
      core = v >= 0 ? `+${v.toLocaleString()}` : v.toLocaleString();
    } else {
      core = `= ${adj.value?.toLocaleString?.() ?? adj.value ?? '?'}`;
    }
    return rule.period_from ? `${core} from ${rule.period_from}` : core;
  })();

  const noteText = hasFilters
    ? `Applied to ${filterEntries.map(([k, v]) =>
        `${k} ${Array.isArray(v) ? v.slice(0, 3).join(', ') : v}`
      ).join('; ')}.`
    : `Applied to ${rule.target_field}.`;

  return (
    <div style={{
      background: colors.bgCard,
      borderRadius: radius.lg,
      border: `1px solid ${colors.border}`,
      padding: `${spacing.md}px ${spacing.md}px`,
      marginBottom: spacing.sm,
      boxShadow: shadows.sm,
    }}>
      {/* Row 1 — bold rule title + Edit/Delete icons (top-right) */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.xs, marginBottom: spacing.sm }}>
        <h4 style={{
          margin: 0, flex: 1, minWidth: 0,
          fontSize: typography.fontSizes.md,
          fontWeight: typography.fontWeights.bold,
          color: colors.textPrimary,
          fontFamily: typography.fontFamily,
          lineHeight: 1.3,
        }}>
          {rule.name || `${style.label} on ${rule.target_field}`}
        </h4>
        <button
          onClick={() => onEdit(rule)}
          title="Edit rule"
          aria-label="Edit rule"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: colors.textSecondary, padding: 2,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
          </svg>
        </button>
        <button
          onClick={() => onDelete(rule.id)}
          title="Delete rule"
          aria-label="Delete rule"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: colors.danger, padding: 2,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Row 2 — IMPACT (full width) */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        paddingTop: spacing.sm,
        borderTop: `1px solid ${colors.border}`,
      }}>
        <span style={{
          fontSize: 10, color: colors.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.08em',
          fontFamily: typography.fontFamily, fontWeight: typography.fontWeights.medium,
        }}>
          Impact
        </span>
        <span style={{
          fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm,
          fontWeight: typography.fontWeights.semibold, color: colors.textPrimary,
        }}>
          {impactText}
        </span>
      </div>

      {/* Row 3 — NOTE (full width) */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        marginTop: spacing.sm,
      }}>
        <span style={{
          fontSize: 10, color: colors.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.08em',
          fontFamily: typography.fontFamily, fontWeight: typography.fontWeights.medium,
        }}>
          Note
        </span>
        <span style={{
          fontFamily: typography.fontFamily, fontSize: typography.fontSizes.xs,
          color: colors.textSecondary, lineHeight: 1.4,
        }}>
          {noteText}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenario Assumptions Sidebar
// ---------------------------------------------------------------------------
function ScenarioSidebar({ modelId, scenarioId, metadata, expanded = true, onFormOpenChange }) {
  const { data: scenario } = useScenario(scenarioId);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const deleteRuleMut = useDeleteRule(scenarioId, modelId);

  const rules = scenario?.rules || [];

  // Notify parent whenever a form becomes open/closed, so the parent aside
  // can lock its hover-collapse behaviour while the user is editing.
  useEffect(() => {
    onFormOpenChange?.(showRuleForm || !!editingRule);
  }, [showRuleForm, editingRule, onFormOpenChange]);

  const handleDeleteRule = useCallback((ruleId) => {
    deleteRuleMut.mutate(ruleId);
  }, [deleteRuleMut]);

  const handleEditRule = useCallback((rule) => {
    setEditingRule(rule);
    setShowRuleForm(false);
  }, []);

  const closeForms = useCallback(() => {
    setShowRuleForm(false);
    setEditingRule(null);
  }, []);

  const header = (
    <div style={{
      display: 'flex', alignItems: 'center', gap: spacing.sm,
      margin: `0 0 ${spacing.md}px`,
    }}>
      <h3 style={{
        margin: 0, flex: 1,
        fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold,
        color: colors.textPrimary, fontFamily: typography.fontFamily,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {expanded ? 'Scenario Assumptions' : 'Rules'}
      </h3>
    </div>
  );

  if (!scenarioId) {
    return (
      <div style={{ padding: spacing.md }}>
        {header}
        <p style={{ fontSize: typography.fontSizes.sm, color: colors.textMuted, fontFamily: typography.fontFamily, margin: 0 }}>
          Select a scenario from the toolbar to view and manage assumptions.
        </p>
      </div>
    );
  }

  return (
    <div style={{
      padding: expanded ? spacing.md : spacing.sm,
      height: '100%', overflowY: 'auto',
    }}>
      {header}

      {/* Add rule button — only when sidebar is expanded (no room to show
          the form in the collapsed state). */}
      {expanded && !showRuleForm && !editingRule && (
        <div style={{ marginBottom: spacing.md }}>
          <Button variant="primary" size="sm" onClick={() => setShowRuleForm(true)}>
            + Add to scenario
          </Button>
        </div>
      )}

      {/* Rule form — create or edit */}
      {expanded && (showRuleForm || editingRule) && (
        <RuleForm
          scenarioId={scenarioId}
          modelId={modelId}
          metadata={metadata}
          editRule={editingRule}
          onClose={closeForms}
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
            <RuleCard
              key={rule.id}
              rule={rule}
              onDelete={handleDeleteRule}
              onEdit={handleEditRule}
              sidebarExpanded={expanded}
            />
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
  const [yearFilter, setYearFilter] = useState('');
  const [localPositions, setLocalPositions] = useState({});
  const [sidebarHovered, setSidebarHovered] = useState(false);
  // When a rule form is open inside the sidebar we lock it expanded so the
  // user doesn't lose their in-progress edit by moving the mouse away.
  const [sidebarFormOpen, setSidebarFormOpen] = useState(false);
  const sidebarExpanded = sidebarHovered || sidebarFormOpen;

  // Collect year values from metadata. Looks for a dimension named "year" on any dataset.
  const availableYears = useMemo(() => {
    const seen = new Set();
    for (const ds of metadata?.datasets || []) {
      for (const d of ds.dimensions || []) {
        const field = (d.field || '').toLowerCase();
        if (field === 'year' && Array.isArray(d.values)) {
          for (const v of d.values) seen.add(String(v));
        }
      }
    }
    return Array.from(seen).sort();
  }, [metadata]);

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

          {/* Year filter (applies to all widgets) */}
          {availableYears.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
              <label style={{ fontSize: typography.fontSizes.sm, color: colors.textMuted, fontFamily: typography.fontFamily }}>Year:</label>
              <select
                style={{ ...inputStyle, marginBottom: 0, minWidth: 120, padding: '8px 12px', fontSize: typography.fontSizes.sm }}
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
              >
                <option value="">All years</option>
                {availableYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}

          {/* Scenario selector — always visible so users can pick/compare. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
            <label style={{ fontSize: typography.fontSizes.sm, color: colors.textMuted, fontFamily: typography.fontFamily }}>Scenario:</label>
            <select
              style={{ ...inputStyle, marginBottom: 0, minWidth: 220, padding: '8px 12px', fontSize: typography.fontSizes.sm }}
              value={scenarioId}
              onChange={(e) => setScenarioId(e.target.value)}
            >
              <option value="">Actuals only</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({(s.rules || []).length} rules)</option>
              ))}
              {scenarios.length === 0 && <option disabled value="__none__">No scenarios yet</option>}
            </select>
          </div>

          <Button variant="primary" size="sm" onClick={() => setEditingWidget('new')}>
            + Add Widget
          </Button>
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
                  yearFilter={yearFilter || null}
                  metadata={metadata}
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

      {/* Right sidebar - Scenario Assumptions. Collapsed by default (just
          shows rule title pills); expands on hover. Stays expanded while
          any rule form is open so the user can edit without the sidebar
          collapsing out from under them. */}
      <aside
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => setSidebarHovered(false)}
        style={{
          width: sidebarExpanded ? 340 : 180,
          flexShrink: 0,
          borderLeft: `1px solid ${colors.border}`,
          background: colors.bgCard,
          overflowY: 'auto',
          transition: 'width 0.2s ease',
        }}
      >
        <ScenarioSidebar
          modelId={modelId}
          scenarioId={scenarioId}
          metadata={metadata}
          expanded={sidebarExpanded}
          onFormOpenChange={setSidebarFormOpen}
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
