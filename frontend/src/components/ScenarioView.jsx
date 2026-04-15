import { useState, useMemo } from 'react';
import {
  useScenarios,
  useScenario,
  useCreateScenario,
  useDeleteScenario,
  useAddRule,
  useUpdateRule,
  useDeleteRule,
  useRecompute,
  useVariance,
  useWaterfall,
} from '../hooks/useScenarios.js';
import { useMetadata } from '../hooks/useMetadata.js';
import { colors, spacing, radius, typography, shadows, cardStyle, inputStyle, labelStyle, transitions } from '../theme.js';
import { Button } from './common/Button.jsx';
import { Badge, StatusBadge } from './common/Badge.jsx';
import { Card } from './common/Card.jsx';
import WaterfallChart from './WaterfallChart.jsx';

const RULE_TYPES = [
  { value: 'multiplier', label: 'Multiplier (×)', desc: 'e.g. ×1.1 = +10%' },
  { value: 'offset', label: 'Offset (+/−)', desc: 'e.g. +50000' },
  { value: 'set_value', label: 'Set Value (=)', desc: 'Override to exact value' },
];

const currentYear = new Date().getFullYear();

function CreateScenarioForm({ modelId, onClose }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseLayer, setBaseLayer] = useState('actuals');
  const mut = useCreateScenario(modelId);

  const handleSubmit = () => {
    if (!name.trim()) return;
    mut.mutate({ name: name.trim(), description: description.trim(), base_config: { source: baseLayer } }, {
      onSuccess: onClose,
    });
  };

  return (
    <div style={{ ...cardStyle, marginBottom: spacing.lg }}>
      <h3 style={{ margin: `0 0 ${spacing.md}px`, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
        New Scenario
      </h3>
      <p style={{ margin: `0 0 ${spacing.md}px`, fontSize: typography.fontSizes.sm, color: colors.textMuted, fontFamily: typography.fontFamily }}>
        Scenarios apply across all datasets in this model. Add rules after creation to define what-if adjustments.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md, marginBottom: spacing.md }}>
        <div>
          <label style={labelStyle}>Scenario Name *</label>
          <input style={inputStyle} placeholder="e.g. Revenue +10%" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label style={labelStyle}>Base Layer</label>
          <select
            style={{ ...inputStyle }}
            value={baseLayer}
            onChange={(e) => setBaseLayer(e.target.value)}
          >
            <option value="actuals">Actuals</option>
            <option value="budget">Budget</option>
            <option value="forecast">Forecast</option>
          </select>
        </div>
      </div>
      <div style={{ marginBottom: spacing.md }}>
        <label style={labelStyle}>Description</label>
        <textarea style={{ ...inputStyle, height: 60, resize: 'vertical' }} placeholder="Optional description..." value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      {mut.isError && <p style={{ color: colors.danger, fontSize: typography.fontSizes.sm, margin: `0 0 ${spacing.sm}px`, fontFamily: typography.fontFamily }}>{mut.error?.message}</p>}
      <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={mut.isPending} disabled={!name.trim()} onClick={handleSubmit}>Create</Button>
      </div>
    </div>
  );
}

function RuleForm({ scenarioId, modelId, metadata, initialRule, onClose }) {
  const isEdit = !!initialRule;
  // Seed from an existing rule when we're editing. For the value field we
  // look at whichever adjustment key matches the rule type.
  const initAdj = initialRule?.adjustment || {};
  const initValue =
    initAdj.factor != null ? initAdj.factor
    : initAdj.offset != null ? initAdj.offset
    : initAdj.value != null ? initAdj.value
    : '';
  const initFilters = initialRule?.filter_expr
    ? Object.entries(initialRule.filter_expr).map(([column, vals]) => ({
        column,
        values: Array.isArray(vals) ? vals.map(String) : [String(vals)],
      }))
    : [];

  const [name, setName] = useState(initialRule?.name || '');
  const [ruleType, setRuleType] = useState(initialRule?.rule_type || 'multiplier');
  const [targetField, setTargetField] = useState(initialRule?.target_field || '');
  const [value, setValue] = useState(String(initValue ?? ''));
  const [periodFrom, setPeriodFrom] = useState(initialRule?.period_from || '');
  const [periodTo, setPeriodTo] = useState(initialRule?.period_to || '');
  const [baseYear, setBaseYear] = useState(String(currentYear - 1));
  const [filters, setFilters] = useState(initFilters);  // [{column, values: []}]
  const addMut = useAddRule(scenarioId, modelId);
  const updateMut = useUpdateRule(scenarioId, modelId);
  const mut = isEdit ? updateMut : addMut;

  // Collect measures from all datasets in the model, deduplicating by name
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

  // Collect dimensions from all datasets, deduplicating
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

  const addFilter = () => {
    setFilters([...filters, { column: '', values: [] }]);
  };

  const removeFilter = (idx) => {
    setFilters(filters.filter((_, i) => i !== idx));
  };

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

  const handleSubmit = () => {
    if (!targetField || !value) return;
    const numVal = parseFloat(value);
    const adjustment = ruleType === 'multiplier' ? { factor: numVal }
      : ruleType === 'offset' ? { offset: numVal }
      : { value: numVal };

    // Build filter_expr from filter rows
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

    if (isEdit) {
      updateMut.mutate({ ruleId: initialRule.id, data: rule }, { onSuccess: onClose });
    } else {
      addMut.mutate(rule, { onSuccess: onClose });
    }
  };

  // Get dimension values for a selected filter column
  const getDimValues = (colName) => {
    for (const ds of metadata?.datasets || []) {
      for (const d of ds.dimensions || []) {
        if (d.field === colName && d.values?.length > 0) return d.values;
      }
    }
    return [];
  };

  return (
    <div style={{ background: colors.bgMuted, borderRadius: radius.md, border: `1px solid ${colors.border}`, padding: spacing.md, marginBottom: spacing.md }}>
      <h4 style={{ margin: `0 0 ${spacing.md}px`, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
        {isEdit ? 'Edit Rule' : 'Add Rule'}
      </h4>

      {/* Row 1: Name, Type */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm, marginBottom: spacing.sm }}>
        <div>
          <label style={labelStyle}>Rule Name</label>
          <input style={inputStyle} placeholder="Optional name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Type *</label>
          <select style={inputStyle} value={ruleType} onChange={(e) => setRuleType(e.target.value)}>
            {RULE_TYPES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      </div>

      {/* Row 2: Target Field, Value, Base Year */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: spacing.sm, marginBottom: spacing.sm }}>
        <div>
          <label style={labelStyle}>Target Field *</label>
          <select style={inputStyle} value={targetField} onChange={(e) => setTargetField(e.target.value)}>
            <option value="">Select field...</option>
            {measures.map((m) => {
              const fieldName = m.canonical_name || m.field || m.name;
              const label = m.label || fieldName;
              return <option key={fieldName} value={fieldName}>{label}</option>;
            })}
          </select>
        </div>
        <div>
          <label style={labelStyle}>
            {ruleType === 'multiplier' ? 'Factor (e.g. 1.1 = +10%)' : ruleType === 'offset' ? 'Amount (+/−)' : 'Set to value'}
          </label>
          <input
            style={inputStyle}
            type="number"
            step={ruleType === 'multiplier' ? '0.01' : '1000'}
            placeholder={ruleType === 'multiplier' ? '1.10' : '50000'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Base Year</label>
          <input style={inputStyle} type="number" min="2000" max="2100" value={baseYear} onChange={(e) => setBaseYear(e.target.value)} />
        </div>
      </div>

      {/* Row 3: Period */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.sm, marginBottom: spacing.sm }}>
        <div>
          <label style={labelStyle}>Period From</label>
          <input style={inputStyle} type="month" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Period To</label>
          <input style={inputStyle} type="month" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} />
        </div>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: spacing.sm }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Filters</label>
          <button
            onClick={addFilter}
            style={{
              background: 'none', border: `1px solid ${colors.border}`, borderRadius: radius.sm,
              cursor: 'pointer', color: colors.primary, fontSize: typography.fontSizes.xs, padding: '2px 8px',
              fontFamily: typography.fontFamily,
            }}
          >
            + Add Filter
          </button>
        </div>

        {filters.length === 0 && (
          <p style={{ margin: 0, fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>
            No filters — rule applies to all rows. Add filters to target specific data.
          </p>
        )}

        {filters.map((f, idx) => {
          const dimValues = getDimValues(f.column);
          return (
            <div key={idx} style={{
              display: 'flex', gap: spacing.sm, alignItems: 'flex-start', marginBottom: spacing.xs,
              background: colors.bgCard, padding: spacing.sm, borderRadius: radius.sm, border: `1px solid ${colors.border}`,
            }}>
              <div style={{ width: 180, flexShrink: 0 }}>
                <select
                  style={{ ...inputStyle, marginBottom: 0 }}
                  value={f.column}
                  onChange={(e) => updateFilterColumn(idx, e.target.value)}
                >
                  <option value="">Select column...</option>
                  {dimensions.map((d) => (
                    <option key={d.field} value={d.field}>{d.label || d.field}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 100, overflowY: 'auto' }}>
                {f.column && dimValues.length > 0 ? dimValues.map((v) => {
                  const selected = f.values.includes(String(v));
                  return (
                    <button
                      key={v}
                      onClick={() => toggleFilterValue(idx, String(v))}
                      style={{
                        padding: '2px 8px', fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily,
                        border: `1px solid ${selected ? colors.primary : colors.border}`,
                        borderRadius: radius.sm, cursor: 'pointer',
                        background: selected ? colors.primaryLight : colors.bgCard,
                        color: selected ? colors.primary : colors.textSecondary,
                        fontWeight: selected ? typography.fontWeights.medium : typography.fontWeights.normal,
                      }}
                    >
                      {String(v)}
                    </button>
                  );
                }) : f.column ? (
                  <span style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily, padding: '2px 0' }}>
                    No values available
                  </span>
                ) : null}
              </div>
              <button
                onClick={() => removeFilter(idx)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.danger, fontSize: 14, padding: '2px 4px', flexShrink: 0 }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {mut.isError && <p style={{ color: colors.danger, fontSize: typography.fontSizes.sm, margin: `0 0 ${spacing.xs}px`, fontFamily: typography.fontFamily }}>{mut.error?.message}</p>}
      <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" loading={mut.isPending} disabled={!targetField || !value} onClick={handleSubmit}>
          {isEdit ? 'Save' : 'Add Rule'}
        </Button>
      </div>
    </div>
  );
}

/** Visual styling per rule type — drives the colored "header" pill. */
const RULE_TYPE_STYLES = {
  multiplier: { bg: '#dcfce7', text: '#065f46', border: '#86efac', label: 'Multiplier' },
  offset:     { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd', label: 'Offset' },
  set_value:  { bg: '#fef3c7', text: '#92400e', border: '#fcd34d', label: 'Set value' },
};

/** Collapsible rule card. Shows only the colored header by default; expands
 *  on hover to reveal details plus edit / delete actions. Matches the
 *  reference card design (pill header → title → details). */
function RuleCard({ rule, onEdit, onDelete, deleting }) {
  const [hovered, setHovered] = useState(false);
  const style = RULE_TYPE_STYLES[rule.rule_type] || RULE_TYPE_STYLES.multiplier;
  const hasFilters = rule.filter_expr && Object.keys(rule.filter_expr).length > 0;
  const filterChips = hasFilters
    ? Object.entries(rule.filter_expr).slice(0, 2).map(([k, v]) =>
        `${k}: ${Array.isArray(v) ? v.join(', ') : v}`
      )
    : [];

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: colors.bgCard,
        borderRadius: radius.md,
        border: `1px solid ${hovered ? style.border : colors.border}`,
        overflow: 'hidden',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hovered ? shadows.sm : 'none',
      }}
    >
      {/* Header — the colored pill row. Always visible. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: spacing.sm,
        padding: `${spacing.sm}px ${spacing.md}px`,
        flexWrap: 'wrap',
      }}>
        {/* Colored type pill */}
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '4px 12px', borderRadius: radius.full,
          background: style.bg, color: style.text,
          border: `1px solid ${style.border}`,
          fontFamily: typography.fontFamily, fontSize: typography.fontSizes.xs,
          fontWeight: typography.fontWeights.semibold,
          whiteSpace: 'nowrap',
        }}>
          {rule.name || style.label}
        </span>
        {/* Filter / scope chip(s) */}
        {filterChips.map((chip, i) => (
          <span key={i} style={{
            display: 'inline-flex', alignItems: 'center',
            padding: '4px 10px', borderRadius: radius.full,
            background: colors.bgMuted, color: colors.textSecondary,
            border: `1px solid ${colors.border}`,
            fontFamily: typography.fontFamily, fontSize: typography.fontSizes.xs,
            whiteSpace: 'nowrap',
          }}>
            {chip}
          </span>
        ))}
        <div style={{ flex: 1 }} />
        {hovered && (
          <div style={{ display: 'flex', gap: spacing.xs }}>
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(rule); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: colors.primary, fontSize: typography.fontSizes.xs,
                fontFamily: typography.fontFamily, fontWeight: typography.fontWeights.medium,
                padding: `2px ${spacing.xs}px`,
              }}
            >
              Edit
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(rule.id); }}
              disabled={deleting}
              style={{
                background: 'none', border: 'none', cursor: deleting ? 'default' : 'pointer',
                color: colors.danger, fontSize: typography.fontSizes.xs,
                fontFamily: typography.fontFamily, fontWeight: typography.fontWeights.medium,
                padding: `2px ${spacing.xs}px`, opacity: deleting ? 0.5 : 1,
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Expanded details — only shown on hover. Structured as IMPACT / NOTE
          columns (matching the reference card), plus period if present. */}
      {hovered && (
        <div style={{
          padding: `${spacing.sm}px ${spacing.md}px ${spacing.md}px`,
          borderTop: `1px solid ${colors.border}`,
          background: colors.bgMuted,
          display: 'flex', gap: spacing.xl, flexWrap: 'wrap',
        }}>
          <DetailBlock
            label="Impact"
            value={
              <span style={{ fontFamily: 'monospace' }}>
                <span style={{ color: colors.textPrimary }}>{rule.target_field}</span>
                {' → '}
                <span style={{ color: colors.primary, fontWeight: typography.fontWeights.semibold }}>
                  {formatAdjustment(rule)}
                </span>
              </span>
            }
          />
          {rule.period_from && (
            <DetailBlock
              label="Period"
              value={
                <span style={{ fontFamily: typography.fontFamily, color: colors.textPrimary }}>
                  {rule.period_from}{rule.period_to ? ` → ${rule.period_to}` : '+'}
                </span>
              }
            />
          )}
          {hasFilters && (
            <DetailBlock
              label="Filters"
              value={
                <span style={{ color: colors.textSecondary, fontFamily: typography.fontFamily }}>
                  {Object.entries(rule.filter_expr).map(([k, v]) =>
                    `${k}: ${Array.isArray(v) ? v.join(', ') : v}`
                  ).join(' · ')}
                </span>
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function DetailBlock({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{
        fontSize: 10, color: colors.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        fontFamily: typography.fontFamily, fontWeight: typography.fontWeights.medium,
      }}>
        {label}
      </span>
      <span style={{ fontSize: typography.fontSizes.sm, lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}

/** Format adjustment for display */
function formatAdjustment(rule) {
  const adj = rule.adjustment || {};
  if (rule.rule_type === 'multiplier') return `×${adj.factor ?? '?'}`;
  if (rule.rule_type === 'offset') {
    const v = adj.offset ?? 0;
    return v >= 0 ? `+${v.toLocaleString()}` : v.toLocaleString();
  }
  return `= ${adj.value ?? '?'}`;
}

function formatCompact(val) {
  if (val === null || val === undefined) return '—';
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function VarianceTable({ variance, breakdownField }) {
  const groups = variance.groups || [];

  const cellStyle = {
    padding: `${spacing.xs}px ${spacing.sm}px`,
    fontSize: typography.fontSizes.sm,
    fontFamily: 'monospace',
    borderBottom: `1px solid ${colors.border}`,
    textAlign: 'right',
    whiteSpace: 'nowrap',
  };
  const headerCell = {
    ...cellStyle,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.semibold,
    color: colors.textSecondary,
    fontSize: typography.fontSizes.xs,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    background: colors.bgMuted,
    position: 'sticky',
    top: 0,
  };

  return (
    <div style={{ overflowX: 'auto', borderRadius: radius.md, border: `1px solid ${colors.border}` }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...headerCell, textAlign: 'left' }}>{breakdownField}</th>
            <th style={headerCell}>Actuals</th>
            <th style={headerCell}>Scenario</th>
            <th style={headerCell}>Delta</th>
            <th style={headerCell}>%</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => {
            const label = Object.values(g.group).join(' / ') || `Row ${i + 1}`;
            const deltaColor = g.delta > 0 ? colors.success : g.delta < 0 ? colors.danger : colors.textMuted;
            return (
              <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : colors.bgMuted }}>
                <td style={{ ...cellStyle, textAlign: 'left', fontFamily: typography.fontFamily, color: colors.textPrimary, fontWeight: typography.fontWeights.medium }}>{label}</td>
                <td style={{ ...cellStyle, color: colors.textPrimary }}>{formatCompact(g.actual)}</td>
                <td style={{ ...cellStyle, color: colors.textPrimary }}>{formatCompact(g.scenario)}</td>
                <td style={{ ...cellStyle, color: deltaColor, fontWeight: typography.fontWeights.medium }}>
                  {g.delta > 0 ? '+' : ''}{formatCompact(g.delta)}
                </td>
                <td style={{ ...cellStyle, color: deltaColor, fontSize: typography.fontSizes.xs }}>
                  {g.delta_pct != null ? `${g.delta_pct > 0 ? '+' : ''}${g.delta_pct.toFixed(1)}%` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: colors.bgMuted }}>
            <td style={{ ...cellStyle, textAlign: 'left', fontFamily: typography.fontFamily, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, borderBottom: 'none' }}>Total</td>
            <td style={{ ...cellStyle, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, borderBottom: 'none' }}>{formatCompact(variance.total_actual)}</td>
            <td style={{ ...cellStyle, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, borderBottom: 'none' }}>{formatCompact(variance.total_scenario)}</td>
            <td style={{
              ...cellStyle, fontWeight: typography.fontWeights.bold, borderBottom: 'none',
              color: variance.total_delta > 0 ? colors.success : variance.total_delta < 0 ? colors.danger : colors.textMuted,
            }}>
              {variance.total_delta > 0 ? '+' : ''}{formatCompact(variance.total_delta)}
            </td>
            <td style={{
              ...cellStyle, fontWeight: typography.fontWeights.bold, borderBottom: 'none', fontSize: typography.fontSizes.xs,
              color: variance.total_delta > 0 ? colors.success : variance.total_delta < 0 ? colors.danger : colors.textMuted,
            }}>
              {variance.total_delta_pct != null ? `${variance.total_delta_pct > 0 ? '+' : ''}${variance.total_delta_pct.toFixed(1)}%` : '—'}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function ScenarioDetail({ scenarioId, modelId }) {
  const { data: scenario } = useScenario(scenarioId);
  const { data: metadata } = useMetadata(modelId);
  const deleteMut = useDeleteRule(scenarioId, modelId);
  const recomputeMut = useRecompute(scenarioId);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const closeRuleForm = () => { setShowRuleForm(false); setEditingRule(null); };
  const [waterfallBreakdown, setWaterfallBreakdown] = useState('');
  const [waterfallMeasure, setWaterfallMeasure] = useState('');

  // Available dimensions and measures for the waterfall selectors
  const waterfallDimensions = useMemo(() => {
    const result = [];
    const seen = new Set();
    for (const ds of metadata?.datasets || []) {
      for (const d of ds.dimensions || []) {
        if (d.field && !seen.has(d.field) && d.field !== 'row_id' && d.field !== 'source_key' && d.field !== 'data_layer') {
          seen.add(d.field);
          result.push(d);
        }
      }
    }
    return result;
  }, [metadata]);

  const waterfallMeasures = useMemo(() => {
    const result = [];
    const seen = new Set();
    for (const ds of metadata?.datasets || []) {
      for (const m of ds.measures || []) {
        const key = m.canonical_name || m.field || m.name;
        if (key && !seen.has(key)) {
          seen.add(key);
          result.push({ ...m, key });
        }
      }
    }
    return result;
  }, [metadata]);

  // Auto-select first available dimension/measure when metadata loads
  const effectiveBreakdown = waterfallBreakdown || (waterfallDimensions[0]?.field ?? null);
  const effectiveMeasure = waterfallMeasure || (waterfallMeasures[0]?.key ?? 'amount');

  const rules = scenario?.rules || [];
  const hasRules = rules.length > 0;

  // Resolve fact dataset (owns the measures) and build join_dimensions
  // when the breakdown field lives in a different (lookup) dataset.
  const waterfallParams = useMemo(() => {
    if (!effectiveBreakdown || !effectiveMeasure) return null;
    const fieldMap = metadata?.fieldDatasetMap || {};

    // The fact dataset is the one that owns the selected measure
    const factDatasetId = fieldMap[effectiveMeasure] || metadata?.datasets?.[0]?.id;
    const breakdownDatasetId = fieldMap[effectiveBreakdown];

    const params = { breakdown_field: effectiveBreakdown, value_field: effectiveMeasure };

    // If the breakdown dimension lives in a different dataset, pass join_dimensions
    if (breakdownDatasetId && factDatasetId && breakdownDatasetId !== factDatasetId) {
      params.join_dimensions = JSON.stringify({ [effectiveBreakdown]: breakdownDatasetId });
    }
    return params;
  }, [effectiveBreakdown, effectiveMeasure, metadata]);

  const { data: waterfall } = useWaterfall(
    hasRules ? scenarioId : null,
    waterfallParams,
  );

  // Build variance params for the comparison table (reuses same breakdown/measure/joins)
  const varianceParams = useMemo(() => {
    if (!effectiveBreakdown || !effectiveMeasure) return null;
    const fieldMap = metadata?.fieldDatasetMap || {};
    const factDatasetId = fieldMap[effectiveMeasure] || metadata?.datasets?.[0]?.id;
    const breakdownDatasetId = fieldMap[effectiveBreakdown];
    const params = { group_by: effectiveBreakdown, value_field: effectiveMeasure };
    if (breakdownDatasetId && factDatasetId && breakdownDatasetId !== factDatasetId) {
      params.join_dimensions = JSON.stringify({ [effectiveBreakdown]: breakdownDatasetId });
    }
    return params;
  }, [effectiveBreakdown, effectiveMeasure, metadata]);

  const { data: variance, isLoading: varianceLoading, error: varianceError } = useVariance(
    hasRules ? scenarioId : null,
    varianceParams,
  );

  if (!scenario) {
    return <div style={{ padding: spacing.lg, color: colors.textMuted, fontFamily: typography.fontFamily }}>Loading scenario...</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
          {scenario.name}
        </h3>
        <Badge variant="info">{scenario.base_config?.source || 'actuals'}</Badge>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" loading={recomputeMut.isPending} onClick={() => recomputeMut.mutate()}>
          ↻ Recompute
        </Button>
        <Button variant="primary" size="sm" onClick={() => { setEditingRule(null); setShowRuleForm(true); }}>
          + Add Rule
        </Button>
      </div>

      {scenario.description && (
        <p style={{ margin: `0 0 ${spacing.md}px`, color: colors.textSecondary, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.md }}>
          {scenario.description}
        </p>
      )}

      {/* Rule form — shared between create and edit. */}
      {(showRuleForm || editingRule) && (
        <RuleForm
          scenarioId={scenarioId}
          modelId={modelId}
          metadata={metadata}
          initialRule={editingRule}
          onClose={closeRuleForm}
        />
      )}

      {/* Rules list — each card is collapsed (header only) by default and
          expands on mouseover to reveal details + edit/delete actions. */}
      <div style={{ marginBottom: spacing.lg }}>
        <h4 style={{ margin: `0 0 ${spacing.sm}px`, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
          Rules ({rules.length})
        </h4>
        {rules.length === 0 ? (
          <div style={{ padding: spacing.lg, textAlign: 'center', color: colors.textMuted, fontFamily: typography.fontFamily, background: colors.bgMuted, borderRadius: radius.md, border: `1px dashed ${colors.border}` }}>
            No rules yet. Add a rule to modify this scenario.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
            {rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onEdit={(r) => { setShowRuleForm(false); setEditingRule(r); }}
                onDelete={(id) => deleteMut.mutate(id)}
                deleting={deleteMut.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Scenario impact analysis */}
      {hasRules && (
        <Card style={{ marginBottom: spacing.lg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md, flexWrap: 'wrap' }}>
            <h4 style={{ margin: 0, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
              Scenario Impact
            </h4>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <label style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily, whiteSpace: 'nowrap' }}>Breakdown</label>
              <select
                style={{ ...inputStyle, marginBottom: 0, minWidth: 140, padding: '4px 8px', fontSize: typography.fontSizes.xs }}
                value={effectiveBreakdown || ''}
                onChange={(e) => setWaterfallBreakdown(e.target.value)}
              >
                {waterfallDimensions.map((d) => (
                  <option key={d.field} value={d.field}>{d.label || d.field}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
              <label style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily, whiteSpace: 'nowrap' }}>Measure</label>
              <select
                style={{ ...inputStyle, marginBottom: 0, minWidth: 140, padding: '4px 8px', fontSize: typography.fontSizes.xs }}
                value={effectiveMeasure || ''}
                onChange={(e) => setWaterfallMeasure(e.target.value)}
              >
                {waterfallMeasures.map((m) => (
                  <option key={m.key} value={m.key}>{m.label || m.key}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Comparison table */}
          {varianceLoading ? (
            <div style={{ padding: spacing.lg, textAlign: 'center', color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
              Loading comparison...
            </div>
          ) : varianceError ? (
            <div style={{ padding: spacing.md, color: colors.danger, fontSize: typography.fontSizes.sm, fontFamily: typography.fontFamily, background: '#fef2f2', borderRadius: radius.md, border: '1px solid #fecaca' }}>
              {varianceError.message}
            </div>
          ) : variance && variance.groups?.length > 0 ? (
            <VarianceTable variance={variance} breakdownField={effectiveBreakdown} />
          ) : (
            <div style={{ padding: spacing.lg, textAlign: 'center', color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
              {effectiveBreakdown ? 'No variance data available.' : 'Select a breakdown field to compare.'}
            </div>
          )}

          {/* Waterfall chart (below table when data is available) */}
          {waterfall && waterfall.steps && waterfall.steps.length > 0 && (
            <div style={{ marginTop: spacing.lg }}>
              <WaterfallChart data={waterfall} height={280} />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

export default function ScenarioView({ modelId }) {
  const { data: scenarios = [], isLoading } = useScenarios(modelId);
  const deleteMut = useDeleteScenario(modelId);
  const [selectedId, setSelectedId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const selectedScenario = scenarios.find((s) => s.id === selectedId);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Left panel - scenario list */}
      <div style={{
        width: 260, flexShrink: 0,
        background: colors.bgCard, borderRight: `1px solid ${colors.border}`,
        overflowY: 'auto', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: `${spacing.md}px`, borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
            Scenarios
          </h3>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>+ New</Button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: spacing.sm }}>
          {isLoading ? (
            <div style={{ padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>Loading...</div>
          ) : scenarios.length === 0 ? (
            <div style={{ padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm, textAlign: 'center' }}>
              No scenarios yet
            </div>
          ) : (
            scenarios.map((s) => (
              <ScenarioListItem
                key={s.id}
                scenario={s}
                selected={selectedId === s.id}
                onClick={() => setSelectedId(s.id)}
                onDelete={() => { deleteMut.mutate(s.id); if (selectedId === s.id) setSelectedId(null); }}
              />
            ))
          )}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: spacing.xl }}>
        {showCreate && (
          <CreateScenarioForm modelId={modelId} onClose={() => setShowCreate(false)} />
        )}

        {selectedId ? (
          <ScenarioDetail scenarioId={selectedId} modelId={modelId} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', textAlign: 'center', color: colors.textMuted }}>
            <div style={{ fontSize: 48, marginBottom: spacing.md }}>◑</div>
            <h3 style={{ margin: `0 0 ${spacing.sm}px`, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold, color: colors.textSecondary, fontFamily: typography.fontFamily }}>
              Select a scenario
            </h3>
            <p style={{ margin: 0, fontSize: typography.fontSizes.md, fontFamily: typography.fontFamily }}>
              Choose a scenario from the left panel or create a new one.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ScenarioListItem({ scenario, selected, onClick, onDelete }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: `${spacing.sm}px ${spacing.md}px`,
        borderRadius: radius.md,
        background: selected ? colors.primaryLight : hovered ? colors.bgHover : 'transparent',
        border: `1px solid ${selected ? '#bfdbfe' : 'transparent'}`,
        cursor: 'pointer', transition: transitions.fast,
        marginBottom: 2,
        display: 'flex', alignItems: 'center', gap: spacing.sm,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: typography.fontSizes.sm, fontWeight: selected ? typography.fontWeights.semibold : typography.fontWeights.normal,
          color: selected ? colors.primary : colors.textPrimary,
          fontFamily: typography.fontFamily, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {scenario.name}
        </div>
        <div style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>
          {(scenario.rules || []).length} rules · {scenario.base_config?.source || 'actuals'}
        </div>
      </div>
      {(hovered || selected) && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.danger, fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}
        >
          ×
        </button>
      )}
    </div>
  );
}
