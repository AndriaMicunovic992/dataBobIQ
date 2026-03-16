import React from 'react';
import { colors, spacing, radius, typography } from '../../theme.js';

const variantMap = {
  default: { bg: colors.bgHover, color: colors.textSecondary },
  primary: { bg: colors.primaryLight, color: colors.primary },
  success: { bg: colors.successLight, color: '#059669' },
  danger: { bg: colors.dangerLight, color: '#dc2626' },
  warning: { bg: colors.warningLight, color: '#d97706' },
  info: { bg: colors.infoLight, color: '#0891b2' },
  muted: { bg: '#f1f5f9', color: colors.textMuted },
};

const sizeMap = {
  sm: { padding: `2px ${spacing.xs}px`, fontSize: typography.fontSizes.xs },
  md: { padding: `${spacing.xs}px ${spacing.sm}px`, fontSize: typography.fontSizes.sm },
  lg: { padding: `${spacing.xs}px ${spacing.md}px`, fontSize: typography.fontSizes.md },
};

export function Badge({ children, variant = 'default', size = 'sm', style = {}, dot = false }) {
  const v = variantMap[variant] || variantMap.default;
  const s = sizeMap[size] || sizeMap.sm;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: spacing.xs,
        background: v.bg,
        color: v.color,
        borderRadius: radius.full,
        fontFamily: typography.fontFamily,
        fontWeight: typography.fontWeights.medium,
        letterSpacing: '0.01em',
        ...s,
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: v.color,
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
}

const PROCESSING_STATUSES = new Set([
  'queued', 'parsing', 'parsed', 'mapping', 'materializing',
]);

// Convenience status badge
export function StatusBadge({ status }) {
  const statusVariants = {
    ready: 'success',
    processing: 'warning',
    pending: 'muted',
    error: 'danger',
    confirmed: 'success',
    suggested: 'warning',
    rejected: 'danger',
    active: 'success',
    inactive: 'muted',
    actuals: 'primary',
    budget: 'info',
    forecast: 'warning',
    queued: 'warning',
    parsing: 'warning',
    parsed: 'warning',
    mapping: 'warning',
    materializing: 'warning',
    mapped_pending_review: 'info',
  };
  const variant = statusVariants[status] || 'default';
  const isProcessing = PROCESSING_STATUSES.has(status);

  return (
    <Badge variant={variant} dot={!isProcessing}>
      {isProcessing && <Spinner size={10} />}
      {status}
    </Badge>
  );
}

function Spinner({ size = 12 }) {
  return (
    <>
      <span
        style={{
          display: 'inline-block',
          width: size, height: size,
          border: `2px solid currentColor`,
          borderTopColor: 'transparent',
          borderRadius: '50%',
          animation: 'badge-spin 0.7s linear infinite',
          flexShrink: 0,
        }}
      />
      <style>{`@keyframes badge-spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

export default Badge;
