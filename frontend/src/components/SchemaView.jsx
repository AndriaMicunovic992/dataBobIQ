import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listDatasets, deleteDataset, confirmMapping, updateColumn, listRelationships, createRelationship, updateRelationship, deleteRelationship } from '../api.js';
import { colors, spacing, radius, typography, shadows, cardStyle } from '../theme.js';
import { Button } from './common/Button.jsx';
import { Badge, StatusBadge } from './common/Badge.jsx';
import { Card } from './common/Card.jsx';
import { Table } from './common/Table.jsx';

const ROLE_OPTIONS = ['attribute', 'measure', 'time', 'key'];

const ROLE_COLORS = {
  attribute: { bg: colors.primaryLight, color: colors.primary },
  measure: { bg: colors.successLight, color: '#059669' },
  time: { bg: colors.warningLight, color: '#d97706' },
  key: { bg: '#ede9fe', color: '#7c3aed' },
};

function RoleSelect({ value, onChange }) {
  const style = ROLE_COLORS[value] || { bg: colors.bgHover, color: colors.textMuted };
  return (
    <select
      value={value || 'attribute'}
      onChange={(e) => onChange(e.target.value)}
      style={{
        display: 'inline-block',
        padding: `2px ${spacing.sm}px 2px ${spacing.sm}px`,
        background: style.bg,
        color: style.color,
        borderRadius: radius.full,
        fontSize: typography.fontSizes.xs,
        fontWeight: typography.fontWeights.medium,
        fontFamily: typography.fontFamily,
        border: `1px solid transparent`,
        cursor: 'pointer',
        outline: 'none',
      }}
    >
      {ROLE_OPTIONS.map((r) => (
        <option key={r} value={r}>{r}</option>
      ))}
    </select>
  );
}

function DatasetCard({ dataset, onDelete, expanded, onToggle }) {
  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: () => deleteDataset(dataset.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['datasets'] }),
  });

  const confirmMut = useMutation({
    mutationFn: (config) => confirmMapping(dataset.id, config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['datasets'] }),
  });

  const updateColMut = useMutation({
    mutationFn: ({ columnId, data }) => updateColumn(dataset.id, columnId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['datasets'] }),
  });

  const columns = dataset.columns || [];
  const needsConfirm = dataset.status === 'mapped_pending_review';

  const tableColumns = [
    {
      key: 'source_name', label: 'Source Column', maxWidth: 200,
      render: (v) => (
        <span style={{ fontFamily: 'monospace', fontSize: typography.fontSizes.sm, color: colors.textPrimary }}>{v}</span>
      ),
    },
    {
      key: 'canonical_name', label: 'Mapped As',
      render: (v) => v ? (
        <span style={{ fontFamily: 'monospace', fontSize: typography.fontSizes.sm, color: colors.primary }}>{v}</span>
      ) : (
        <span style={{ color: colors.textMuted, fontSize: typography.fontSizes.sm, fontStyle: 'italic' }}>same as source</span>
      ),
    },
    {
      key: 'data_type', label: 'Type',
      render: (v) => <Badge variant="muted">{v || '?'}</Badge>,
    },
    {
      key: 'column_role', label: 'Role',
      render: (v, row) => (
        <RoleSelect
          value={v}
          onChange={(newRole) => updateColMut.mutate({ columnId: row.id, data: { column_role: newRole } })}
        />
      ),
    },
  ];

  return (
    <div style={{ ...cardStyle, marginBottom: spacing.md, overflow: 'hidden', padding: 0 }}>
      {/* Dataset header */}
      <div
        style={{
          padding: `${spacing.md}px ${spacing.lg}px`,
          display: 'flex', alignItems: 'center', gap: spacing.md,
          cursor: 'pointer', borderBottom: expanded ? `1px solid ${colors.border}` : 'none',
        }}
        onClick={onToggle}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.md }}>
              {dataset.name || dataset.source_filename}
            </span>
            <StatusBadge status={dataset.status || 'pending'} />
            <Badge variant={dataset.data_layer === 'actuals' ? 'primary' : dataset.data_layer === 'budget' ? 'info' : 'warning'}>
              {dataset.data_layer}
            </Badge>
            {needsConfirm && (
              <Badge variant="warning">Awaiting confirmation</Badge>
            )}
          </div>
          <div style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily, marginTop: spacing.xs }}>
            {columns.length} columns · Uploaded {new Date(dataset.created_at).toLocaleDateString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: spacing.sm, flexShrink: 0, alignItems: 'center' }}>
          {needsConfirm && (
            <Button
              variant="success"
              size="sm"
              loading={confirmMut.isPending}
              onClick={(e) => {
                e.stopPropagation();
                confirmMut.mutate({ confirm_all: true });
              }}
            >
              Confirm All
            </Button>
          )}
          <Button
            variant="danger"
            size="sm"
            loading={deleteMut.isPending}
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete "${dataset.name || dataset.source_filename}"?`)) deleteMut.mutate();
            }}
          >
            Delete
          </Button>
          <span style={{ color: colors.textMuted, fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Column table */}
      {expanded && columns.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <Table
            columns={tableColumns}
            data={columns}
            compact
            style={{ borderRadius: 0, border: 'none' }}
          />
        </div>
      )}

      {expanded && columns.length === 0 && (
        <div style={{ padding: spacing.lg, textAlign: 'center', color: colors.textMuted, fontFamily: typography.fontFamily }}>
          No column mappings available yet. Processing may still be in progress.
        </div>
      )}
    </div>
  );
}

const REL_TYPE_LABELS = {
  many_to_one: 'N:1',
  one_to_many: '1:N',
  one_to_one: '1:1',
  many_to_many: 'N:N',
};

const REL_TYPES = ['many_to_one', 'one_to_many', 'one_to_one', 'many_to_many'];

const selectStyle = {
  padding: `2px ${spacing.sm}px`,
  borderRadius: radius.sm,
  border: `1px solid ${colors.border}`,
  fontSize: typography.fontSizes.xs,
  fontFamily: typography.fontFamily,
  color: colors.textPrimary,
  background: colors.bgCard,
  cursor: 'pointer',
  outline: 'none',
};

function RelationshipForm({ datasets, initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || {
    source_dataset_id: datasets[0]?.id || '',
    target_dataset_id: datasets[1]?.id || datasets[0]?.id || '',
    source_column: '',
    target_column: '',
    relationship_type: 'many_to_one',
  });

  const dsColMap = {};
  for (const ds of datasets) {
    // Use the name that exists in the DuckDB view: canonical_name if mapped,
    // else source_name. Never offer source_name as a separate option when the
    // column was renamed during materialization — the view only has one name.
    const seen = new Set();
    const cols = [];
    for (const c of (ds.columns || [])) {
      const name = c.canonical_name || c.source_name;
      if (!seen.has(name)) {
        seen.add(name);
        cols.push({ name, type: c.data_type, role: c.column_role, source: c.source_name });
      }
    }
    dsColMap[ds.id] = cols;
  }

  const srcCols = dsColMap[form.source_dataset_id] || [];
  const tgtCols = dsColMap[form.target_dataset_id] || [];

  const valid = form.source_dataset_id && form.target_dataset_id && form.source_column && form.target_column;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap',
      padding: `${spacing.sm}px ${spacing.md}px`,
      background: '#fefce8', borderRadius: radius.md, border: `1px solid #fde68a`,
      fontSize: typography.fontSizes.sm, fontFamily: typography.fontFamily,
    }}>
      <select style={selectStyle} value={form.source_dataset_id}
        onChange={(e) => setForm((f) => ({ ...f, source_dataset_id: e.target.value, source_column: '' }))}>
        {datasets.map((ds) => <option key={ds.id} value={ds.id}>{ds.name || ds.source_filename}</option>)}
      </select>
      <select style={selectStyle} value={form.source_column}
        onChange={(e) => setForm((f) => ({ ...f, source_column: e.target.value }))}>
        <option value="">column...</option>
        {srcCols.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
      </select>
      <select style={{ ...selectStyle, background: '#ede9fe', color: '#7c3aed', fontWeight: typography.fontWeights.medium, border: 'none' }}
        value={form.relationship_type}
        onChange={(e) => setForm((f) => ({ ...f, relationship_type: e.target.value }))}>
        {REL_TYPES.map((t) => <option key={t} value={t}>{REL_TYPE_LABELS[t]}</option>)}
      </select>
      <select style={selectStyle} value={form.target_dataset_id}
        onChange={(e) => setForm((f) => ({ ...f, target_dataset_id: e.target.value, target_column: '' }))}>
        {datasets.map((ds) => <option key={ds.id} value={ds.id}>{ds.name || ds.source_filename}</option>)}
      </select>
      <select style={selectStyle} value={form.target_column}
        onChange={(e) => setForm((f) => ({ ...f, target_column: e.target.value }))}>
        <option value="">column...</option>
        {tgtCols.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.type})</option>)}
      </select>
      <Button variant="success" size="sm" disabled={!valid || saving} loading={saving}
        onClick={() => onSave(form)}>
        {initial ? 'Save' : 'Add'}
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

const PROCESSING_STATUSES = new Set([
  'queued', 'parsing', 'parsed', 'mapping', 'materializing', 'mapped_pending_review',
]);

function RelationshipsPanel({ modelId, datasets }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const anyProcessing = datasets.some((d) => PROCESSING_STATUSES.has(d.status));

  // Track active count so we can refetch relationships when a dataset becomes active
  const prevActiveCountRef = useRef(datasets.filter((d) => d.status === 'active').length);
  useEffect(() => {
    const activeCount = datasets.filter((d) => d.status === 'active').length;
    if (activeCount > prevActiveCountRef.current) {
      // A dataset just became active — relationships may have been auto-detected
      qc.invalidateQueries({ queryKey: ['relationships', modelId] });
    }
    prevActiveCountRef.current = activeCount;
  }, [datasets, modelId, qc]);

  const { data: relationships = [], isLoading: relsLoading } = useQuery({
    queryKey: ['relationships', modelId],
    queryFn: () => listRelationships(modelId),
    enabled: !!modelId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['relationships'] });

  const deleteMut = useMutation({ mutationFn: (id) => deleteRelationship(id), onSuccess: invalidate });
  const createMut = useMutation({ mutationFn: (data) => createRelationship(modelId, data), onSuccess: () => { invalidate(); setShowForm(false); } });
  const updateMut = useMutation({ mutationFn: ({ id, data }) => updateRelationship(id, data), onSuccess: () => { invalidate(); setEditingId(null); } });

  const dsNameMap = {};
  for (const ds of datasets) {
    dsNameMap[ds.id] = ds.name || ds.source_filename;
  }

  return (
    <div style={{ ...cardStyle, marginBottom: spacing.xl, padding: spacing.md }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <h3 style={{
            margin: 0, fontSize: typography.fontSizes.md,
            fontWeight: typography.fontWeights.semibold, color: colors.textPrimary,
            fontFamily: typography.fontFamily,
          }}>
            Relationships
          </h3>
          {(relsLoading || anyProcessing) && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.xs, fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>
              <span style={{
                display: 'inline-block', width: 12, height: 12,
                border: `2px solid ${colors.primary}`, borderTopColor: 'transparent',
                borderRadius: '50%', animation: 'rel-spin 0.7s linear infinite',
              }} />
              {anyProcessing ? 'Detecting...' : 'Loading...'}
              <style>{`@keyframes rel-spin { to { transform: rotate(360deg); } }`}</style>
            </span>
          )}
        </div>
        {datasets.length >= 2 && !showForm && (
          <Button variant="ghost" size="sm" onClick={() => setShowForm(true)}>+ Add</Button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
        {showForm && (
          <RelationshipForm
            datasets={datasets}
            onSave={(data) => createMut.mutate(data)}
            onCancel={() => setShowForm(false)}
            saving={createMut.isPending}
          />
        )}
        {relationships.map((rel) => (
          editingId === rel.id ? (
            <RelationshipForm
              key={rel.id}
              datasets={datasets}
              initial={{
                source_dataset_id: rel.source_dataset_id,
                target_dataset_id: rel.target_dataset_id,
                source_column: rel.source_column,
                target_column: rel.target_column,
                relationship_type: rel.relationship_type,
              }}
              onSave={(data) => updateMut.mutate({ id: rel.id, data })}
              onCancel={() => setEditingId(null)}
              saving={updateMut.isPending}
            />
          ) : (
            <div
              key={rel.id}
              style={{
                display: 'flex', alignItems: 'center', gap: spacing.md,
                padding: `${spacing.sm}px ${spacing.md}px`,
                background: colors.bgMuted, borderRadius: radius.md,
                fontSize: typography.fontSizes.sm, fontFamily: typography.fontFamily,
              }}
            >
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: typography.fontWeights.medium, color: colors.textPrimary }}>
                  {dsNameMap[rel.source_dataset_id] || rel.source_dataset_id.slice(0, 8)}
                </span>
                <span style={{ fontFamily: 'monospace', color: colors.primary, fontSize: typography.fontSizes.xs }}>
                  .{rel.source_column}
                </span>
                <span style={{
                  display: 'inline-block', padding: `1px ${spacing.sm}px`,
                  background: '#ede9fe', color: '#7c3aed', borderRadius: radius.full,
                  fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium,
                }}>
                  {REL_TYPE_LABELS[rel.relationship_type] || rel.relationship_type}
                </span>
                <span style={{ fontWeight: typography.fontWeights.medium, color: colors.textPrimary }}>
                  {dsNameMap[rel.target_dataset_id] || rel.target_dataset_id.slice(0, 8)}
                </span>
                <span style={{ fontFamily: 'monospace', color: colors.primary, fontSize: typography.fontSizes.xs }}>
                  .{rel.target_column}
                </span>
                {rel.coverage_pct != null && (
                  <span style={{ color: colors.textMuted, fontSize: typography.fontSizes.xs }}>
                    ({Math.round(rel.coverage_pct * 100)}% match)
                  </span>
                )}
              </div>
              <button
                onClick={() => setEditingId(rel.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: colors.textMuted, fontSize: 12, padding: spacing.xs,
                }}
                title="Edit relationship"
              >
                ✎
              </button>
              <button
                onClick={() => deleteMut.mutate(rel.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: colors.textMuted, fontSize: 14, padding: spacing.xs,
                }}
                title="Remove relationship"
              >
                ×
              </button>
            </div>
          )
        ))}
        {relationships.length === 0 && !showForm && (
          <div style={{ color: colors.textMuted, fontSize: typography.fontSizes.sm, fontFamily: typography.fontFamily }}>
            No relationships detected. {datasets.length >= 2 ? 'Click "+ Add" to create one manually.' : 'Upload at least two datasets to define relationships.'}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SchemaView({ modelId, datasets, onUpload }) {
  const [expandedId, setExpandedId] = useState(datasets[0]?.id || null);

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const activeDatasets = datasets.filter((d) => d.status === 'active');
  const totalColumns = datasets.reduce((sum, d) => sum + (d.columns?.length || 0), 0);
  const dimensions = datasets.reduce((sum, d) =>
    sum + (d.columns?.filter((c) => ['attribute', 'time', 'key'].includes(c.column_role)).length || 0), 0);
  const measures = datasets.reduce((sum, d) =>
    sum + (d.columns?.filter((c) => c.column_role === 'measure').length || 0), 0);

  return (
    <div style={{ padding: spacing.xl }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg }}>
        <div>
          <h1 style={{ margin: 0, fontSize: typography.fontSizes.xxl, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
            Data Model
          </h1>
          <p style={{ margin: `${spacing.xs}px 0 0`, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.md }}>
            Manage datasets and AI column mappings
          </p>
        </div>
        <Button variant="primary" onClick={onUpload} icon="↑">
          Upload Dataset
        </Button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: spacing.md, marginBottom: spacing.xl, flexWrap: 'wrap' }}>
        {[
          { label: 'Datasets', value: datasets.length, sub: `${activeDatasets.length} active` },
          { label: 'Total Columns', value: totalColumns },
          { label: 'Dimensions', value: dimensions, color: colors.primary },
          { label: 'Measures', value: measures, color: colors.success },
        ].map((stat) => (
          <div key={stat.label} style={{
            background: colors.bgCard, borderRadius: radius.lg,
            border: `1px solid ${colors.border}`, padding: spacing.md,
            minWidth: 120, boxShadow: shadows.sm,
          }}>
            <div style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {stat.label}
            </div>
            <div style={{ fontSize: typography.fontSizes.xxl, fontWeight: typography.fontWeights.bold, color: stat.color || colors.textPrimary, fontFamily: typography.fontFamily, marginTop: spacing.xs }}>
              {stat.value}
            </div>
            {stat.sub && (
              <div style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>{stat.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* Relationships */}
      <RelationshipsPanel modelId={modelId} datasets={datasets} />

      {/* Dataset cards */}
      {datasets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: spacing.xxl, color: colors.textMuted, fontFamily: typography.fontFamily }}>
          No datasets yet. Upload a file to get started.
        </div>
      ) : (
        datasets.map((ds) => (
          <DatasetCard
            key={ds.id}
            dataset={ds}
            expanded={expandedId === ds.id}
            onToggle={() => toggleExpand(ds.id)}
          />
        ))
      )}
    </div>
  );
}
