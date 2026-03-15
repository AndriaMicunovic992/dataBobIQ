import React from 'react';
import { colors, spacing, radius, typography, shadows, transitions } from '../theme.js';
import { Badge } from './common/Badge.jsx';

function ModelCard({ model, onClick, onDelete }) {
  const [hovered, setHovered] = React.useState(false);
  const [deleteHovered, setDeleteHovered] = React.useState(false);
  const created = new Date(model.created_at).toLocaleDateString();

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: colors.bgCard,
        borderRadius: radius.lg,
        border: `1px solid ${hovered ? colors.primary : colors.border}`,
        boxShadow: hovered ? shadows.md : shadows.sm,
        padding: spacing.lg,
        cursor: 'pointer',
        transition: transitions.normal,
        transform: hovered ? 'translateY(-2px)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.sm,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div
          style={{
            width: 40, height: 40, borderRadius: radius.md,
            background: `linear-gradient(135deg, ${colors.primary}, #7c3aed)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, color: 'white', fontWeight: 700, flexShrink: 0,
          }}
        >
          {model.name.charAt(0).toUpperCase()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
          <Badge variant={model.status === 'ready' ? 'success' : 'muted'} dot>
            {model.status || 'active'}
          </Badge>
          {hovered && (
            <button
              onMouseEnter={() => setDeleteHovered(true)}
              onMouseLeave={() => setDeleteHovered(false)}
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Delete model "${model.name}" and ALL its datasets, scenarios, and KPIs? This cannot be undone.`)) {
                  onDelete(model.id);
                }
              }}
              title="Delete model"
              style={{
                width: 28, height: 28, borderRadius: radius.md,
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: deleteHovered ? colors.danger : colors.bgHover,
                color: deleteHovered ? 'white' : colors.textMuted,
                fontSize: 14, lineHeight: 1,
                transition: transitions.fast,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div>
        <h3 style={{
          margin: 0, fontSize: typography.fontSizes.lg,
          fontWeight: typography.fontWeights.semibold,
          color: colors.textPrimary, fontFamily: typography.fontFamily,
        }}>
          {model.name}
        </h3>
        {model.description && (
          <p style={{
            margin: `${spacing.xs}px 0 0`,
            fontSize: typography.fontSizes.sm,
            color: colors.textMuted,
            fontFamily: typography.fontFamily,
            lineHeight: 1.5,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}>
            {model.description}
          </p>
        )}
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: spacing.sm,
        paddingTop: spacing.sm, borderTop: `1px solid ${colors.border}`,
      }}>
        <span style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>
          Created {created}
        </span>
      </div>
    </div>
  );
}

function CreateCard({ onClick }) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? colors.primaryLight : colors.bgCard,
        borderRadius: radius.lg,
        border: `2px dashed ${hovered ? colors.primary : colors.border}`,
        padding: spacing.lg,
        cursor: 'pointer',
        transition: transitions.normal,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        minHeight: 160,
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: radius.full,
        background: hovered ? colors.primary : colors.bgHover,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 24, color: hovered ? 'white' : colors.textMuted,
        transition: transitions.fast,
      }}>
        +
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontSize: typography.fontSizes.md,
          fontWeight: typography.fontWeights.semibold,
          color: hovered ? colors.primary : colors.textSecondary,
          fontFamily: typography.fontFamily,
        }}>
          Create New Model
        </div>
        <div style={{
          fontSize: typography.fontSizes.sm,
          color: colors.textMuted,
          fontFamily: typography.fontFamily,
          marginTop: spacing.xs,
        }}>
          Start with a new financial model
        </div>
      </div>
    </div>
  );
}

export default function ModelLanding({ models, onSelect, onCreate, onDelete }) {
  return (
    <div style={{ padding: spacing.xl, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: spacing.xl }}>
        <h1 style={{
          margin: 0, fontSize: typography.fontSizes.xxxl,
          fontWeight: typography.fontWeights.bold,
          color: colors.textPrimary, fontFamily: typography.fontFamily,
        }}>
          Financial Models
        </h1>
        <p style={{
          margin: `${spacing.sm}px 0 0`,
          fontSize: typography.fontSizes.lg,
          color: colors.textSecondary,
          fontFamily: typography.fontFamily,
        }}>
          Select a model to explore, or create a new one.
        </p>
      </div>

      {/* Hero banner if no models */}
      {models.length === 0 && (
        <div style={{
          background: `linear-gradient(135deg, #1e3a8a 0%, #3730a3 100%)`,
          borderRadius: radius.xl,
          padding: spacing.xxl,
          marginBottom: spacing.xl,
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: spacing.lg,
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: typography.fontSizes.xxl, fontWeight: typography.fontWeights.bold, fontFamily: typography.fontFamily }}>
              Welcome to dataBobIQ
            </h2>
            <p style={{ margin: `${spacing.sm}px 0 ${spacing.lg}px`, fontSize: typography.fontSizes.md, opacity: 0.85, fontFamily: typography.fontFamily, maxWidth: 480 }}>
              Upload your ERP exports, let AI map your data, then explore KPIs, build scenarios, and chat with your financials.
            </p>
            <button
              onClick={onCreate}
              style={{
                padding: `${spacing.md}px ${spacing.xl}px`,
                background: 'white', color: '#1e3a8a',
                border: 'none', borderRadius: radius.md,
                fontSize: typography.fontSizes.md,
                fontWeight: typography.fontWeights.semibold,
                fontFamily: typography.fontFamily,
                cursor: 'pointer',
              }}
            >
              Create Your First Model
            </button>
          </div>
          <div style={{ fontSize: 80, opacity: 0.2 }}>◈</div>
        </div>
      )}

      {/* Model grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: spacing.lg,
      }}>
        {models.map((model) => (
          <ModelCard key={model.id} model={model} onClick={() => onSelect(model.id)} onDelete={onDelete} />
        ))}
        <CreateCard onClick={onCreate} />
      </div>
    </div>
  );
}
