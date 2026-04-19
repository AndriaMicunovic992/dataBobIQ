import React, { useState, useMemo } from 'react';
import { colors, spacing, radius, typography, transitions, shadows } from '../theme.js';
import { Badge } from './common/Badge.jsx';

const AGG_OPTIONS = ['sum', 'avg', 'count', 'min', 'max', 'count_distinct'];

function FieldChip({ field, onRemove, extra, style = {} }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: spacing.xs,
        background: hovered ? colors.primaryLight : '#eff6ff',
        border: `1px solid ${hovered ? colors.primary : '#bfdbfe'}`,
        borderRadius: radius.full, padding: `2px ${spacing.sm}px 2px ${spacing.sm}px`,
        cursor: 'default', transition: transitions.fast,
        ...style,
      }}
    >
      <span style={{ fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium, color: colors.primary, fontFamily: typography.fontFamily }}>
        {field.label || field.field || field.name}
      </span>
      {extra}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(field); }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: colors.primary, fontSize: 14, lineHeight: 1,
          padding: 0, display: 'flex', alignItems: 'center',
        }}
      >
        ×
      </button>
    </div>
  );
}

function FieldPicker({ available, onSelect, onClose, grouped = {} }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return grouped;
    const lower = search.toLowerCase();
    const result = {};
    for (const [table, fields] of Object.entries(grouped)) {
      const match = fields.filter((f) => {
        const name = f.field || f.label || '';
        return name.toLowerCase().includes(lower);
      });
      if (match.length > 0) result[table] = match;
    }
    return result;
  }, [grouped, search]);

  const entries = Object.entries(filtered);
  const totalCount = entries.reduce((s, [, fs]) => s + fs.length, 0);

  return (
    <div style={{
      position: 'absolute', top: 28, left: 0, zIndex: 50,
      background: colors.bgCard, borderRadius: radius.md, border: `1px solid ${colors.border}`,
      boxShadow: shadows.lg, minWidth: 220, maxHeight: 300, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: `${spacing.xs}px ${spacing.sm}px`, borderBottom: `1px solid ${colors.border}` }}>
        <input
          type="text"
          placeholder="Search fields..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          style={{
            width: '100%', border: 'none', outline: 'none',
            fontSize: typography.fontSizes.sm, fontFamily: typography.fontFamily,
            color: colors.textPrimary, background: 'transparent',
            padding: `${spacing.xs}px 0`, boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {totalCount === 0 && (
          <div style={{ padding: spacing.sm, color: colors.textMuted, fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily }}>
            No matching fields
          </div>
        )}
        {entries.map(([tableName, fields]) => (
          <div key={tableName}>
            {entries.length > 1 && (
              <div style={{
                padding: `${spacing.xs}px ${spacing.sm}px`,
                fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.semibold,
                color: colors.textMuted, fontFamily: typography.fontFamily,
                textTransform: 'uppercase', letterSpacing: '0.04em',
                background: colors.bgMuted, borderBottom: `1px solid ${colors.border}`,
              }}>
                {tableName}
              </div>
            )}
            {fields.map((f) => {
              const name = f.field || f.label;
              return (
                <button
                  key={name}
                  onClick={() => { onSelect(name); onClose(); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: spacing.xs, width: '100%',
                    padding: `${spacing.xs}px ${spacing.sm}px`,
                    background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer',
                    fontSize: typography.fontSizes.sm, fontFamily: typography.fontFamily,
                    color: colors.textPrimary,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = colors.bgHover}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                >
                  <span style={{ fontFamily: 'monospace', fontSize: typography.fontSizes.xs, color: colors.textMuted }}>
                    {f.column_role === 'measure' ? '∑' : '⬡'}
                  </span>
                  <span>{f.label || name}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function DropZone({ label, icon, fields, onAdd, onRemove, onAggChange, allowMultiple = true, aggMap = {}, dimensions = [], measures = [], datasets = [] }) {
  const [open, setOpen] = useState(false);
  const all = [...dimensions, ...measures].filter(
    (f, i, arr) => arr.findIndex((x) => (x.field || x.name) === (f.field || f.name)) === i,
  );
  const pool = label === 'Values' ? all : dimensions;
  const available = pool.filter(
    (f) => !fields.some((sel) => sel === (f.field || f.name))
  );

  // Group available fields by dataset name
  const grouped = useMemo(() => {
    const groups = {};
    for (const f of available) {
      const dsName = f._dataset_name || 'Fields';
      if (!groups[dsName]) groups[dsName] = [];
      groups[dsName].push(f);
    }
    return groups;
  }, [available]);

  return (
    <div style={{ marginBottom: spacing.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs }}>
        <span style={{ fontSize: 12, color: colors.textMuted }}>{icon}</span>
        <span style={{ fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.semibold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: typography.fontFamily }}>
          {label}
        </span>
        {!allowMultiple && fields.length > 0 && (
          <span style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>(single)</span>
        )}
      </div>

      <div style={{
        minHeight: 44, background: colors.bgMuted, borderRadius: radius.md,
        border: `1px dashed ${colors.border}`, padding: spacing.sm,
        display: 'flex', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'flex-start',
        position: 'relative',
      }}>
        {fields.length === 0 && (
          <span style={{ color: colors.textMuted, fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily, alignSelf: 'center' }}>
            Click + to add
          </span>
        )}
        {fields.map((fieldName) => {
          const allFields = [...dimensions, ...measures];
          const field = allFields.find((f) => (f.field || f.name) === fieldName) || { name: fieldName };
          const agg = aggMap[fieldName] || 'sum';
          return (
            <FieldChip
              key={fieldName}
              field={field}
              onRemove={() => onRemove(fieldName)}
              extra={
                label === 'Values' ? (
                  <select
                    value={agg}
                    onChange={(e) => onAggChange && onAggChange(fieldName, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      border: 'none', background: 'none', fontSize: typography.fontSizes.xs,
                      color: '#1d4ed8', fontFamily: typography.fontFamily, cursor: 'pointer',
                      outline: 'none', padding: 0,
                    }}
                  >
                    {AGG_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                ) : null
              }
            />
          );
        })}

        {/* Add button */}
        {(allowMultiple || fields.length === 0) && available.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setOpen((v) => !v)}
              style={{
                width: 24, height: 24, borderRadius: radius.full,
                background: colors.primary, border: 'none',
                color: 'white', fontSize: 16, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
              }}
            >
              +
            </button>
            {open && (
              <FieldPicker
                available={available}
                grouped={grouped}
                onSelect={onAdd}
                onClose={() => setOpen(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FieldManager({ metadata, pivotConfig, onConfigChange }) {
  if (!metadata) {
    return (
      <div style={{ padding: spacing.md, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
        Loading fields...
      </div>
    );
  }

  const allDimensions = metadata.dimensions || [];
  const allMeasures = metadata.measures || [];
  const datasets = metadata.datasets || [];
  const rows = pivotConfig.rows || [];
  const columns = pivotConfig.columns || [];
  const values = pivotConfig.values || [];
  const aggMap = pivotConfig.aggregations || {};

  const dimensions = allDimensions;
  const measures = allMeasures;

  const update = (patch) => onConfigChange({ ...pivotConfig, ...patch });

  const addRow = (name) => {
    if (!rows.includes(name)) update({ rows: [...rows, name] });
  };
  const removeRow = (name) => update({ rows: rows.filter((r) => r !== name) });

  const addCol = (name) => update({ columns: [name] });
  const removeCol = (name) => update({ columns: columns.filter((c) => c !== name) });

  const addValue = (name) => {
    if (!values.includes(name)) update({ values: [...values, name] });
  };
  const removeValue = (name) => update({ values: values.filter((v) => v !== name) });

  const setAgg = (name, agg) => {
    update({ aggregations: { ...aggMap, [name]: agg } });
  };

  return (
    <div style={{ padding: `${spacing.md}px`, display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ marginBottom: spacing.md }}>
        <p style={{ margin: 0, fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily, lineHeight: 1.5 }}>
          Configure the pivot by selecting fields for rows, columns, and values.
        </p>
      </div>

      <DropZone
        label="Rows"
        icon="↔"
        fields={rows}
        onAdd={addRow}
        onRemove={removeRow}
        allowMultiple
        dimensions={dimensions}
        measures={measures}
        datasets={datasets}
      />

      <DropZone
        label="Columns"
        icon="↕"
        fields={columns}
        onAdd={addCol}
        onRemove={removeCol}
        allowMultiple={false}
        dimensions={dimensions}
        measures={measures}
        datasets={datasets}
      />

      <DropZone
        label="Values"
        icon="∑"
        fields={values}
        onAdd={addValue}
        onRemove={removeValue}
        onAggChange={setAgg}
        allowMultiple
        aggMap={aggMap}
        dimensions={dimensions}
        measures={measures}
        datasets={datasets}
      />
    </div>
  );
}
