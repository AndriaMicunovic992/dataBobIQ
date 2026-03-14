import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listDatasets, deleteDataset, confirmMapping } from '../api.js';
import { colors, spacing, radius, typography, shadows, cardStyle } from '../theme.js';
import { Button } from './common/Button.jsx';
import { Badge, StatusBadge } from './common/Badge.jsx';
import { Card } from './common/Card.jsx';
import { Table } from './common/Table.jsx';

const ROLE_COLORS = {
  dimension: { bg: colors.primaryLight, color: colors.primary },
  measure: { bg: colors.successLight, color: '#059669' },
  date: { bg: colors.warningLight, color: '#d97706' },
  identifier: { bg: '#ede9fe', color: '#7c3aed' },
};

const TIER_LABELS = {
  core: { label: 'Core', variant: 'primary' },
  expected: { label: 'Expected', variant: 'success' },
  extension: { label: 'Extension', variant: 'muted' },
  unmapped: { label: 'Unmapped', variant: 'warning' },
};

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

  const columns = dataset.column_mappings || [];
  const pendingCount = columns.filter((c) => c.status === 'suggested').length;

  const tableColumns = [
    {
      key: 'source_name', label: 'Source Column', maxWidth: 200,
      render: (v) => (
        <span style={{ fontFamily: 'monospace', fontSize: typography.fontSizes.sm, color: colors.textPrimary }}>{v}</span>
      ),
    },
    {
      key: 'canonical_name', label: 'Mapped As',
      render: (v, row) => v ? (
        <span style={{ fontFamily: 'monospace', fontSize: typography.fontSizes.sm, color: colors.primary }}>{v}</span>
      ) : (
        <span style={{ color: colors.textMuted, fontSize: typography.fontSizes.sm }}>— unmapped —</span>
      ),
    },
    {
      key: 'data_type', label: 'Type',
      render: (v) => <Badge variant="muted">{v || '?'}</Badge>,
    },
    {
      key: 'column_role', label: 'Role',
      render: (v) => {
        const style = ROLE_COLORS[v] || { bg: colors.bgHover, color: colors.textMuted };
        return (
          <span style={{
            display: 'inline-block', padding: `2px ${spacing.sm}px`,
            background: style.bg, color: style.color,
            borderRadius: radius.full, fontSize: typography.fontSizes.xs,
            fontWeight: typography.fontWeights.medium, fontFamily: typography.fontFamily,
          }}>
            {v || 'unknown'}
          </span>
        );
      },
    },
    {
      key: 'tier', label: 'Tier',
      render: (v) => {
        const t = TIER_LABELS[v] || { label: v || '?', variant: 'default' };
        return <Badge variant={t.variant}>{t.label}</Badge>;
      },
    },
    {
      key: 'status', label: 'Status',
      render: (v) => <StatusBadge status={v || 'pending'} />,
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
              {dataset.original_filename || dataset.name}
            </span>
            <StatusBadge status={dataset.status || 'pending'} />
            <Badge variant={dataset.data_layer === 'actuals' ? 'primary' : dataset.data_layer === 'budget' ? 'info' : 'warning'}>
              {dataset.data_layer}
            </Badge>
            {pendingCount > 0 && (
              <Badge variant="warning">{pendingCount} pending mappings</Badge>
            )}
          </div>
          <div style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily, marginTop: spacing.xs }}>
            {columns.length} columns · Uploaded {new Date(dataset.created_at).toLocaleDateString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: spacing.sm, flexShrink: 0, alignItems: 'center' }}>
          {pendingCount > 0 && (
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
              if (confirm(`Delete "${dataset.original_filename}"?`)) deleteMut.mutate();
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

export default function SchemaView({ modelId, datasets, onUpload }) {
  const [expandedId, setExpandedId] = useState(datasets[0]?.id || null);

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const readyDatasets = datasets.filter((d) => d.status === 'ready');
  const totalColumns = datasets.reduce((sum, d) => sum + (d.column_mappings?.length || 0), 0);
  const dimensions = datasets.reduce((sum, d) =>
    sum + (d.column_mappings?.filter((c) => c.column_role === 'dimension').length || 0), 0);
  const measures = datasets.reduce((sum, d) =>
    sum + (d.column_mappings?.filter((c) => c.column_role === 'measure').length || 0), 0);

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
          { label: 'Datasets', value: datasets.length, sub: `${readyDatasets.length} ready` },
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
