import React from 'react';
import { colors, spacing, radius, shadows, typography } from '../../theme.js';

export function Card({
  children,
  title,
  subtitle,
  actions,
  style = {},
  bodyStyle = {},
  noPadding = false,
  hoverable = false,
}) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      style={{
        background: colors.bgCard,
        borderRadius: radius.lg,
        border: `1px solid ${colors.border}`,
        boxShadow: hovered && hoverable ? shadows.md : shadows.sm,
        transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        transform: hovered && hoverable ? 'translateY(-1px)' : 'none',
        overflow: 'hidden',
        ...style,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {(title || subtitle || actions) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `${spacing.md}px ${spacing.lg}px`,
            borderBottom: `1px solid ${colors.border}`,
            gap: spacing.md,
          }}
        >
          <div>
            {title && (
              <h3
                style={{
                  margin: 0,
                  fontSize: typography.fontSizes.lg,
                  fontWeight: typography.fontWeights.semibold,
                  color: colors.textPrimary,
                  fontFamily: typography.fontFamily,
                }}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p
                style={{
                  margin: `${spacing.xs}px 0 0`,
                  fontSize: typography.fontSizes.sm,
                  color: colors.textMuted,
                  fontFamily: typography.fontFamily,
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          {actions && <div style={{ display: 'flex', gap: spacing.sm, flexShrink: 0 }}>{actions}</div>}
        </div>
      )}
      <div style={noPadding ? bodyStyle : { padding: spacing.lg, ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
}

export function KPICard({ label, value, subValue, trend, color }) {
  const trendUp = trend > 0;
  const trendColor = trendUp ? colors.success : colors.danger;

  return (
    <div
      style={{
        background: colors.bgCard,
        borderRadius: radius.lg,
        border: `1px solid ${colors.border}`,
        boxShadow: shadows.sm,
        padding: spacing.lg,
        minWidth: 160,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: typography.fontSizes.xs,
          fontWeight: typography.fontWeights.medium,
          color: colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontFamily: typography.fontFamily,
        }}
      >
        {label}
      </p>
      <p
        style={{
          margin: `${spacing.xs}px 0 0`,
          fontSize: typography.fontSizes.xxl,
          fontWeight: typography.fontWeights.bold,
          color: color || colors.textPrimary,
          fontFamily: typography.fontFamily,
          lineHeight: 1.2,
        }}
      >
        {value}
      </p>
      {(subValue || trend !== undefined) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs }}>
          {trend !== undefined && (
            <span style={{ color: trendColor, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.medium }}>
              {trendUp ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
            </span>
          )}
          {subValue && (
            <span style={{ color: colors.textMuted, fontSize: typography.fontSizes.sm }}>
              {subValue}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default Card;
