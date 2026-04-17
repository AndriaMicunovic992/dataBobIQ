import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listKnowledge, createKnowledge, updateKnowledge, deleteKnowledge } from '../api.js';
import { colors, spacing, radius, typography, shadows, cardStyle, inputStyle, labelStyle, transitions } from '../theme.js';
import { Button } from './common/Button.jsx';
import { Badge } from './common/Badge.jsx';
import { Card } from './common/Card.jsx';
import MentionEditor from './common/MentionEditor.jsx';
import { splitWithMentions } from '../utils/mentions.js';

const KNOWLEDGE_TYPES = [
  { value: 'business_rule', label: 'Business Rule', icon: '⚙', color: colors.primary },
  { value: 'metric_definition', label: 'Metric Definition', icon: '∑', color: colors.success },
  { value: 'data_note', label: 'Data Note', icon: '◇', color: colors.warning },
  { value: 'context', label: 'Context', icon: '○', color: colors.info },
  { value: 'assumption', label: 'Assumption', icon: '?', color: '#8b5cf6' },
];

const CONFIDENCE_LEVELS = [
  { value: 'confirmed', label: 'Confirmed', variant: 'success' },
  { value: 'suggested', label: 'Suggested', variant: 'warning' },
  { value: 'rejected', label: 'Rejected', variant: 'danger' },
];

function MentionChip({ title, id, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Jump to "${title}"`}
      style={{
        display: 'inline-flex', alignItems: 'center',
        padding: `0 ${spacing.xs}px`,
        background: colors.primary + '18',
        color: colors.primary,
        border: `1px solid ${colors.primary}30`,
        borderRadius: radius.sm,
        fontSize: typography.fontSizes.xs,
        fontWeight: typography.fontWeights.medium,
        fontFamily: typography.fontFamily,
        cursor: onClick ? 'pointer' : 'default',
        margin: '0 2px',
        lineHeight: 1.5,
        verticalAlign: 'baseline',
      }}
    >
      @{title}
    </button>
  );
}

function MentionText({ text, onMentionClick }) {
  const parts = splitWithMentions(text || '');
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string'
          ? <span key={i}>{p}</span>
          : <MentionChip
              key={i}
              title={p.title}
              id={p.id}
              onClick={onMentionClick ? () => onMentionClick(p.id) : undefined}
            />
      )}
    </>
  );
}

function KnowledgeTypeIcon({ type }) {
  const t = KNOWLEDGE_TYPES.find((k) => k.value === type) || KNOWLEDGE_TYPES[3];
  return (
    <div style={{
      width: 32, height: 32, borderRadius: radius.md,
      background: t.color + '18', color: t.color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, flexShrink: 0,
    }}>
      {t.icon}
    </div>
  );
}

function EditKnowledgeForm({ entry, onCancel, onSaved, entries }) {
  const [title, setTitle] = useState(entry.title || '');
  const [content, setContent] = useState(entry.content || '');
  const [type, setType] = useState(entry.knowledge_type || 'business_rule');
  const [confidence, setConfidence] = useState(entry.confidence || 'confirmed');
  const [tags, setTags] = useState((entry.tags || []).join(', '));

  const mut = useMutation({
    mutationFn: () => updateKnowledge(entry.id, {
      title: title.trim(),
      content: content.trim(),
      knowledge_type: type,
      confidence,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    }),
    onSuccess: () => onSaved?.(),
  });

  return (
    <div style={{
      background: colors.bgCard, borderRadius: radius.lg,
      border: `1px solid ${colors.primary}60`,
      padding: spacing.md, boxShadow: shadows.md,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md, marginBottom: spacing.md }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Title *</label>
          <input
            style={inputStyle}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label style={labelStyle}>Type</label>
          <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
            {KNOWLEDGE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Confidence</label>
          <select style={inputStyle} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
            {CONFIDENCE_LEVELS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Content * <span style={{ color: colors.textMuted, fontWeight: typography.fontWeights.regular }}>(type @ to link another entry)</span></label>
          <MentionEditor
            value={content}
            onChange={setContent}
            entries={entries}
            excludeId={entry.id}
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Tags (comma-separated)</label>
          <input
            style={inputStyle}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>
      </div>

      {mut.isError && (
        <p style={{ color: colors.danger, fontSize: typography.fontSizes.sm, margin: `0 0 ${spacing.sm}px`, fontFamily: typography.fontFamily }}>
          {mut.error?.message || 'Failed to save'}
        </p>
      )}

      <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          loading={mut.isPending}
          disabled={!title.trim() || !content.trim()}
          onClick={() => mut.mutate()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function KnowledgeCard({ entry, onDelete, onUpdated, entries, onMentionClick }) {
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const deleteMut = useMutation({
    mutationFn: () => deleteKnowledge(entry.id),
    onSuccess: onDelete,
  });

  if (editing) {
    return (
      <EditKnowledgeForm
        entry={entry}
        entries={entries}
        onCancel={() => setEditing(false)}
        onSaved={() => { setEditing(false); onUpdated?.(); }}
      />
    );
  }

  const typeInfo = KNOWLEDGE_TYPES.find((t) => t.value === entry.knowledge_type) || KNOWLEDGE_TYPES[3];
  const confInfo = CONFIDENCE_LEVELS.find((c) => c.value === entry.confidence) || { variant: 'muted', label: entry.confidence };
  const created = new Date(entry.created_at).toLocaleDateString();
  const rawContent = entry.content || '';
  const hasLongContent = rawContent.length > 160;
  const displayContent = hasLongContent && !expanded ? rawContent.slice(0, 160) + '...' : rawContent;

  return (
    <div
      id={`knowledge-${entry.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: colors.bgCard, borderRadius: radius.lg,
        border: `1px solid ${hovered ? typeInfo.color + '60' : colors.border}`,
        padding: spacing.md, transition: transitions.fast,
        boxShadow: hovered ? shadows.md : shadows.sm,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: spacing.sm }}>
        <KnowledgeTypeIcon type={entry.knowledge_type} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap', marginBottom: spacing.xs }}>
            <span style={{
              fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.md,
              color: colors.textPrimary, fontFamily: typography.fontFamily,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {entry.title || entry.key || 'Untitled'}
            </span>
            <Badge variant={confInfo.variant} dot>{confInfo.label}</Badge>
            <Badge variant="muted">{typeInfo.label}</Badge>
          </div>
          <p style={{
            margin: 0, fontSize: typography.fontSizes.sm,
            color: colors.textSecondary, fontFamily: typography.fontFamily, lineHeight: 1.6,
          }}>
            <MentionText text={displayContent} onMentionClick={onMentionClick} />
            {hasLongContent && (
              <button
                onClick={() => setExpanded((v) => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.primary, fontSize: typography.fontSizes.xs, marginLeft: spacing.xs, padding: 0, fontFamily: typography.fontFamily }}
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </p>
          {entry.tags && entry.tags.length > 0 && (
            <div style={{ display: 'flex', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.xs }}>
              {entry.tags.map((tag) => (
                <span key={tag} style={{
                  padding: `1px ${spacing.xs}px`, background: colors.bgHover,
                  borderRadius: radius.full, fontSize: typography.fontSizes.xs,
                  color: colors.textMuted, fontFamily: typography.fontFamily,
                }}>
                  #{tag}
                </span>
              ))}
            </div>
          )}
          <div style={{ marginTop: spacing.xs, fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>
            Added {created}
          </div>
        </div>
        {hovered && (
          <div style={{ display: 'flex', gap: spacing.xs, flexShrink: 0 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              style={{ color: colors.primary }}
              title="Edit entry"
            >
              ✎
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={deleteMut.isPending}
              onClick={() => { if (confirm('Delete this entry?')) deleteMut.mutate(); }}
              style={{ color: colors.danger }}
              title="Delete entry"
            >
              ×
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function AddKnowledgeForm({ modelId, onClose, onSuccess, entries }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [type, setType] = useState('business_rule');
  const [confidence, setConfidence] = useState('confirmed');
  const [tags, setTags] = useState('');
  const qc = useQueryClient();

  const mut = useMutation({
    mutationFn: () => createKnowledge(modelId, {
      title: title.trim(),
      content: content.trim(),
      knowledge_type: type,
      confidence,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', modelId] });
      onSuccess?.();
      onClose();
    },
  });

  return (
    <div style={{ ...cardStyle, marginBottom: spacing.lg }}>
      <h3 style={{ margin: `0 0 ${spacing.md}px`, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
        Add Knowledge Entry
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: spacing.md, marginBottom: spacing.md }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Title *</label>
          <input
            style={inputStyle}
            placeholder="e.g. Revenue Recognition Policy"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label style={labelStyle}>Type</label>
          <select style={inputStyle} value={type} onChange={(e) => setType(e.target.value)}>
            {KNOWLEDGE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Confidence</label>
          <select style={inputStyle} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
            {CONFIDENCE_LEVELS.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Content * <span style={{ color: colors.textMuted, fontWeight: typography.fontWeights.regular }}>(type @ to link another entry)</span></label>
          <MentionEditor
            value={content}
            onChange={setContent}
            entries={entries}
            placeholder="Describe the rule, metric definition, or context..."
          />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Tags (comma-separated)</label>
          <input
            style={inputStyle}
            placeholder="e.g. revenue, Q1, policy"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>
      </div>

      {mut.isError && (
        <p style={{ color: colors.danger, fontSize: typography.fontSizes.sm, margin: `0 0 ${spacing.sm}px`, fontFamily: typography.fontFamily }}>
          {mut.error?.message || 'Failed to save'}
        </p>
      )}

      <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          loading={mut.isPending}
          disabled={!title.trim() || !content.trim()}
          onClick={() => mut.mutate()}
        >
          Save Entry
        </Button>
      </div>
    </div>
  );
}

export default function KnowledgePanel({ modelId }) {
  const qc = useQueryClient();
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['knowledge', modelId],
    queryFn: () => listKnowledge(modelId),
    enabled: !!modelId,
  });

  const [showForm, setShowForm] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [filterConfidence, setFilterConfidence] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = entries.filter((e) => {
    if (filterType !== 'all' && e.knowledge_type !== filterType) return false;
    if (filterConfidence !== 'all' && e.confidence !== filterConfidence) return false;
    if (search) {
      const q = search.toLowerCase();
      return (e.title || '').toLowerCase().includes(q) ||
        (e.content || '').toLowerCase().includes(q) ||
        (e.tags || []).some((t) => t.toLowerCase().includes(q));
    }
    return true;
  });

  const grouped = KNOWLEDGE_TYPES.reduce((acc, t) => {
    const items = filtered.filter((e) => e.knowledge_type === t.value);
    if (items.length > 0) acc[t.value] = { ...t, items };
    return acc;
  }, {});

  return (
    <div style={{ padding: spacing.xl, maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg }}>
        <div>
          <h1 style={{ margin: 0, fontSize: typography.fontSizes.xxl, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
            Knowledge Base
          </h1>
          <p style={{ margin: `${spacing.xs}px 0 0`, color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.md }}>
            Business rules, metric definitions, and context that guide AI analysis
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowForm(true)} icon="+">
          Add Entry
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <AddKnowledgeForm
          modelId={modelId}
          entries={entries}
          onClose={() => setShowForm(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['knowledge', modelId] })}
        />
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: spacing.sm, marginBottom: spacing.lg, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          style={{ ...inputStyle, width: 220, height: 34, fontSize: typography.fontSizes.sm }}
          placeholder="Search entries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          style={{ ...inputStyle, width: 'auto', height: 34, fontSize: typography.fontSizes.sm }}
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="all">All Types</option>
          {KNOWLEDGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select
          style={{ ...inputStyle, width: 'auto', height: 34, fontSize: typography.fontSizes.sm }}
          value={filterConfidence}
          onChange={(e) => setFilterConfidence(e.target.value)}
        >
          <option value="all">All Confidence</option>
          {CONFIDENCE_LEVELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <span style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>
          {filtered.length} entries
        </span>
      </div>

      {/* Content */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: spacing.xxl, color: colors.textMuted, fontFamily: typography.fontFamily }}>
          Loading knowledge base...
        </div>
      ) : entries.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: spacing.xxl,
          background: colors.bgCard, borderRadius: radius.xl,
          border: `2px dashed ${colors.border}`,
        }}>
          <div style={{ fontSize: 48, marginBottom: spacing.md }}>◇</div>
          <h3 style={{ margin: `0 0 ${spacing.sm}px`, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold, color: colors.textSecondary, fontFamily: typography.fontFamily }}>
            No knowledge entries yet
          </h3>
          <p style={{ margin: `0 0 ${spacing.lg}px`, fontSize: typography.fontSizes.md, color: colors.textMuted, fontFamily: typography.fontFamily }}>
            Add business rules, metric definitions, and context to help AI understand your data better.
          </p>
          <Button variant="primary" onClick={() => setShowForm(true)}>Add First Entry</Button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: spacing.xl, color: colors.textMuted, fontFamily: typography.fontFamily }}>
          No entries match your filters.
        </div>
      ) : (
        Object.values(grouped).map((group) => (
          <div key={group.value} style={{ marginBottom: spacing.xl }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
              <div style={{
                width: 24, height: 24, borderRadius: radius.sm,
                background: group.color + '18', color: group.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
              }}>
                {group.icon}
              </div>
              <h2 style={{ margin: 0, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
                {group.label}
              </h2>
              <span style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>
                {group.items.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
              {group.items.map((entry) => (
                <KnowledgeCard
                  key={entry.id}
                  entry={entry}
                  entries={entries}
                  onDelete={() => qc.invalidateQueries({ queryKey: ['knowledge', modelId] })}
                  onUpdated={() => qc.invalidateQueries({ queryKey: ['knowledge', modelId] })}
                  onMentionClick={(id) => {
                    const el = document.getElementById(`knowledge-${id}`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el.style.transition = 'box-shadow 0.3s';
                      el.style.boxShadow = `0 0 0 3px ${colors.primary}40`;
                      setTimeout(() => { el.style.boxShadow = ''; }, 1200);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
