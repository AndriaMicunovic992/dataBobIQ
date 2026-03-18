import { useState, useMemo } from 'react';
import {
  useScenarios,
  useScenario,
  useCreateScenario,
  useDeleteScenario,
  useAddRule,
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
    mut.mutate({ name: name.trim(), description: description.trim(), base_layer: baseLayer }, {
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

function RuleForm({ scenarioId, modelId, metadata, onClose }) {
  const [name, setName] = useState('');
  const [ruleType, setRuleType] = useState('multiplier');
  const [targetField, setTargetField] = useState('');
  const [value, setValue] = useState('');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [baseYear, setBaseYear] = useState(String(currentYear - 1));
  const [filters, setFilters] = useState([]);  // [{column, values: []}]
  const mut = useAddRule(scenarioId, modelId);

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

    mut.mutate(rule, { onSuccess: onClose });
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
        Add Rule
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
        <Button variant="primary" size="sm" loading={mut.isPending} disabled={!targetField || !value} onClick={handleSubmit}>Add Rule</Button>
      </div>
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

function ScenarioDetail({ scenarioId, modelId }) {
  const { data: scenario } = useScenario(scenarioId);
  const { data: metadata } = useMetadata(modelId);
  const deleteMut = useDeleteRule(scenarioId, modelId);
  const recomputeMut = useRecompute(scenarioId);
  const [showRuleForm, setShowRuleForm] = useState(false);

  // Determine a sensible default breakdown field for the waterfall
  const firstDimension = useMemo(() => {
    for (const ds of metadata?.datasets || []) {
      for (const d of ds.dimensions || []) {
        if (d.field && d.field !== 'row_id' && d.field !== 'source_key' && d.field !== 'data_layer') {
          return d.field;
        }
      }
    }
    return null;
  }, [metadata]);

  const firstMeasure = useMemo(() => {
    for (const ds of metadata?.datasets || []) {
      for (const m of ds.measures || []) {
        return m.canonical_name || m.field || m.name;
      }
    }
    return 'amount';
  }, [metadata]);

  const rules = scenario?.rules || [];
  const hasRules = rules.length > 0;

  const waterfallParams = useMemo(() => {
    if (!firstDimension || !firstMeasure) return null;
    return { breakdown_field: firstDimension, value_field: firstMeasure };
  }, [firstDimension, firstMeasure]);

  const { data: waterfall } = useWaterfall(
    hasRules ? scenarioId : null,
    waterfallParams,
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
        <Badge variant="info">{scenario.base_layer || 'actuals'}</Badge>
        <div style={{ flex: 1 }} />
        <Button variant="secondary" size="sm" loading={recomputeMut.isPending} onClick={() => recomputeMut.mutate()}>
          ↻ Recompute
        </Button>
        <Button variant="primary" size="sm" onClick={() => setShowRuleForm(true)}>
          + Add Rule
        </Button>
      </div>

      {scenario.description && (
        <p style={{ margin: `0 0 ${spacing.md}px`, color: colors.textSecondary, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.md }}>
          {scenario.description}
        </p>
      )}

      {/* Rule form */}
      {showRuleForm && (
        <RuleForm scenarioId={scenarioId} modelId={modelId} metadata={metadata} onClose={() => setShowRuleForm(false)} />
      )}

      {/* Rules list */}
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
              <div key={rule.id} style={{
                background: colors.bgCard, borderRadius: radius.md, border: `1px solid ${colors.border}`,
                padding: `${spacing.sm}px ${spacing.md}px`, display: 'flex', alignItems: 'center', gap: spacing.md,
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: typography.fontWeights.medium, color: colors.textPrimary, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
                      {rule.name || rule.rule_type}
                    </span>
                    <Badge variant="muted">{rule.rule_type}</Badge>
                    {rule.period_from && (
                      <span style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>
                        {rule.period_from}{rule.period_to ? ` → ${rule.period_to}` : '+'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily, marginTop: 2, display: 'flex', gap: spacing.sm, flexWrap: 'wrap' }}>
                    <span>
                      <span style={{ fontFamily: 'monospace' }}>{rule.target_field}</span>
                      {' → '}
                      <span style={{ color: colors.primary, fontFamily: 'monospace' }}>{formatAdjustment(rule)}</span>
                    </span>
                    {rule.filter_expr && Object.keys(rule.filter_expr).length > 0 && (
                      <span style={{ color: colors.textMuted }}>
                        | {Object.entries(rule.filter_expr).map(([k, v]) =>
                          `${k}: ${Array.isArray(v) ? v.join(', ') : v}`
                        ).join(' · ')}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={deleteMut.isPending}
                  onClick={() => deleteMut.mutate(rule.id)}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Waterfall chart */}
      {waterfall && waterfall.steps && (
        <Card title="Impact Waterfall" style={{ marginBottom: spacing.lg }}>
          <WaterfallChart data={waterfall} height={280} />
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
          {(scenario.rules || []).length} rules · {scenario.base_layer || 'actuals'}
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
