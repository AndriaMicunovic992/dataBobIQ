import React, { useState, useMemo } from 'react';
import { colors, spacing, radius, typography, transitions, shadows } from '../theme.js';
import { Button } from './common/Button.jsx';

function FilterChip({ filter, onRemove, onClick }) {
  const [hovered, setHovered] = useState(false);
  const valueDisplay = Array.isArray(filter.values) ? filter.values.join(', ') : String(filter.value ?? '');
  const truncated = valueDisplay.length > 30 ? valueDisplay.slice(0, 30) + '...' : valueDisplay;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: spacing.xs,
        background: hovered ? '#fef3c7' : colors.warningLight,
        border: `1px solid ${hovered ? '#f59e0b' : '#fcd34d'}`,
        borderRadius: radius.full, padding: `3px ${spacing.sm}px`,
        cursor: 'pointer', transition: transitions.fast,
      }}
      onClick={onClick}
    >
      <span style={{ fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium, color: '#92400e', fontFamily: typography.fontFamily }}>
        <span style={{ fontFamily: 'monospace' }}>{filter.field}</span>
        <span style={{ margin: `0 ${spacing.xs}px`, color: '#b45309' }}>
          {filter.operator === 'in' ? '∈' : filter.operator === 'not_in' ? '∉' : filter.operator || '='}
        </span>
        {truncated}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#92400e', fontSize: 14, lineHeight: 1, padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

function FilterEditor({ filter, metadata, onSave, onCancel }) {
  const [field, setField] = useState(filter?.field || '');
  const [operator, setOperator] = useState(filter?.operator || 'in');
  const [selected, setSelected] = useState(filter?.values || []);
  const [search, setSearch] = useState('');
  const dimensions = metadata?.dimensions || [];

  // Get values from the metadata dimensions (already loaded)
  const values = useMemo(() => {
    const dim = dimensions.find((d) => d.field === field);
    return dim?.values || [];
  }, [dimensions, field]);

  const filteredValues = useMemo(() => {
    if (!search) return values;
    const lower = search.toLowerCase();
    return values.filter((v) => String(v).toLowerCase().includes(lower));
  }, [values, search]);

  const toggleValue = (v) => {
    setSelected((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  };

  const handleSave = () => {
    if (!field || selected.length === 0) return;
    onSave({ field, operator, values: selected });
  };

  return (
    <div style={{
      background: colors.bgCard, borderRadius: radius.lg,
      border: `1px solid ${colors.border}`, boxShadow: shadows.lg,
      padding: spacing.md, width: 300, zIndex: 100,
    }}>
      <div style={{ marginBottom: spacing.sm }}>
        <label style={{ display: 'block', fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium, color: colors.textSecondary, marginBottom: spacing.xs, fontFamily: typography.fontFamily }}>
          Field
        </label>
        <select
          value={field}
          onChange={(e) => { setField(e.target.value); setSelected([]); setSearch(''); }}
          style={{
            width: '100%', padding: `${spacing.xs}px ${spacing.sm}px`,
            border: `1px solid ${colors.border}`, borderRadius: radius.md,
            fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm,
            color: colors.textPrimary, background: colors.bgCard, outline: 'none',
            boxSizing: 'border-box',
          }}
        >
          <option value="">Select field...</option>
          {dimensions.map((d) => (
            <option key={d.field} value={d.field}>{d.label || d.field}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: spacing.sm }}>
        <label style={{ display: 'block', fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium, color: colors.textSecondary, marginBottom: spacing.xs, fontFamily: typography.fontFamily }}>
          Operator
        </label>
        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          style={{
            width: '100%', padding: `${spacing.xs}px ${spacing.sm}px`,
            border: `1px solid ${colors.border}`, borderRadius: radius.md,
            fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm,
            color: colors.textPrimary, background: colors.bgCard, outline: 'none',
            boxSizing: 'border-box',
          }}
        >
          <option value="in">is one of (∈)</option>
          <option value="not_in">is not one of (∉)</option>
          <option value="eq">equals (=)</option>
          <option value="ne">not equals (≠)</option>
        </select>
      </div>

      {field && (
        <div style={{ marginBottom: spacing.sm }}>
          <label style={{ display: 'block', fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium, color: colors.textSecondary, marginBottom: spacing.xs, fontFamily: typography.fontFamily }}>
            Values {selected.length > 0 && `(${selected.length} selected)`}
          </label>
          {values.length > 10 && (
            <input
              type="text"
              placeholder="Search values..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: '100%', padding: `${spacing.xs}px ${spacing.sm}px`,
                border: `1px solid ${colors.border}`, borderRadius: radius.md,
                fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm,
                color: colors.textPrimary, background: colors.bgCard, outline: 'none',
                boxSizing: 'border-box', marginBottom: spacing.xs,
              }}
            />
          )}
          <div style={{
            maxHeight: 160, overflowY: 'auto',
            border: `1px solid ${colors.border}`, borderRadius: radius.md,
          }}>
            {values.length === 0 ? (
              <div style={{ padding: spacing.sm, color: colors.textMuted, fontSize: typography.fontSizes.sm, fontFamily: typography.fontFamily }}>
                No values available
              </div>
            ) : filteredValues.length === 0 ? (
              <div style={{ padding: spacing.sm, color: colors.textMuted, fontSize: typography.fontSizes.sm, fontFamily: typography.fontFamily }}>
                No matching values
              </div>
            ) : (
              filteredValues.map((v) => {
                const str = String(v);
                return (
                  <label
                    key={str}
                    style={{
                      display: 'flex', alignItems: 'center', gap: spacing.sm,
                      padding: `${spacing.xs}px ${spacing.sm}px`, cursor: 'pointer',
                      background: selected.includes(str) ? colors.primaryLight : 'transparent',
                      fontSize: typography.fontSizes.sm, fontFamily: typography.fontFamily,
                      color: colors.textPrimary,
                    }}
                    onMouseEnter={(e) => { if (!selected.includes(str)) e.currentTarget.style.background = colors.bgHover; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = selected.includes(str) ? colors.primaryLight : 'transparent'; }}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(str)}
                      onChange={() => toggleValue(str)}
                      style={{ cursor: 'pointer' }}
                    />
                    {str}
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
        <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={!field || selected.length === 0} onClick={handleSave}>
          Apply
        </Button>
      </div>
    </div>
  );
}

export default function FilterManager({ metadata, filters, onFiltersChange }) {
  const [showEditor, setShowEditor] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);

  const addFilter = (filter) => {
    const updated = [...filters, filter];
    onFiltersChange(updated);
    setShowEditor(false);
  };

  const updateFilter = (index, filter) => {
    const updated = filters.map((f, i) => (i === index ? filter : f));
    onFiltersChange(updated);
    setShowEditor(false);
    setEditingIndex(null);
  };

  const removeFilter = (index) => {
    onFiltersChange(filters.filter((_, i) => i !== index));
  };

  const editingFilter = editingIndex !== null ? filters[editingIndex] : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
      <span style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontWeight: typography.fontWeights.medium, fontFamily: typography.fontFamily, flexShrink: 0 }}>
        Filters:
      </span>

      {filters.map((f, i) => (
        <FilterChip
          key={i}
          filter={f}
          onRemove={() => removeFilter(i)}
          onClick={() => { setEditingIndex(i); setShowEditor(true); }}
        />
      ))}

      <div style={{ position: 'relative' }}>
        <button
          onClick={() => { setEditingIndex(null); setShowEditor((v) => !v); }}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: spacing.xs,
            padding: `3px ${spacing.sm}px`, borderRadius: radius.full,
            border: `1px dashed ${colors.border}`, background: 'transparent',
            color: colors.textMuted, fontSize: typography.fontSizes.xs,
            fontFamily: typography.fontFamily, cursor: 'pointer', transition: transitions.fast,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = colors.primary; e.currentTarget.style.color = colors.primary; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.textMuted; }}
        >
          + Add Filter
        </button>

        {showEditor && (
          <div style={{ position: 'absolute', top: 32, left: 0, zIndex: 200 }}>
            <FilterEditor
              filter={editingFilter}
              metadata={metadata}
              onSave={editingIndex !== null ? (f) => updateFilter(editingIndex, f) : addFilter}
              onCancel={() => { setShowEditor(false); setEditingIndex(null); }}
            />
          </div>
        )}
      </div>

      {filters.length > 0 && (
        <button
          onClick={() => onFiltersChange([])}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: colors.textMuted, fontSize: typography.fontSizes.xs,
            fontFamily: typography.fontFamily, padding: `3px ${spacing.xs}px`,
          }}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
