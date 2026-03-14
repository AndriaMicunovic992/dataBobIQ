import React from 'react';
import { colors, spacing, radius, typography, transitions, shadows } from '../../theme.js';

const variantStyles = {
  primary: {
    background: colors.primary,
    color: colors.textInverse,
    border: `1px solid ${colors.primary}`,
    hoverBackground: colors.primaryHover,
    hoverBorder: colors.primaryHover,
  },
  secondary: {
    background: colors.bgCard,
    color: colors.textPrimary,
    border: `1px solid ${colors.border}`,
    hoverBackground: colors.bgHover,
    hoverBorder: colors.border,
  },
  danger: {
    background: colors.danger,
    color: colors.textInverse,
    border: `1px solid ${colors.danger}`,
    hoverBackground: '#dc2626',
    hoverBorder: '#dc2626',
  },
  ghost: {
    background: 'transparent',
    color: colors.textSecondary,
    border: '1px solid transparent',
    hoverBackground: colors.bgHover,
    hoverBorder: colors.border,
  },
  success: {
    background: colors.success,
    color: colors.textInverse,
    border: `1px solid ${colors.success}`,
    hoverBackground: '#059669',
    hoverBorder: '#059669',
  },
};

const sizeStyles = {
  sm: {
    padding: `${spacing.xs}px ${spacing.sm}px`,
    fontSize: typography.fontSizes.sm,
    height: 28,
  },
  md: {
    padding: `${spacing.sm}px ${spacing.md}px`,
    fontSize: typography.fontSizes.md,
    height: 36,
  },
  lg: {
    padding: `${spacing.md}px ${spacing.xl}px`,
    fontSize: typography.fontSizes.lg,
    height: 44,
  },
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  style = {},
  fullWidth = false,
  icon = null,
}) {
  const [hovered, setHovered] = React.useState(false);
  const v = variantStyles[variant] || variantStyles.primary;
  const s = sizeStyles[size] || sizeStyles.md;
  const isDisabled = disabled || loading;

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeights.medium,
    borderRadius: radius.md,
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    transition: transitions.fast,
    outline: 'none',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    width: fullWidth ? '100%' : undefined,
    opacity: isDisabled ? 0.6 : 1,
    boxSizing: 'border-box',
    ...s,
    background: hovered && !isDisabled ? v.hoverBackground : v.background,
    color: v.color,
    border: hovered && !isDisabled ? `1px solid ${v.hoverBorder}` : v.border,
    ...style,
  };

  return (
    <button
      type={type}
      style={baseStyle}
      onClick={isDisabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={isDisabled}
    >
      {loading ? (
        <span
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            border: `2px solid ${v.color}`,
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 0.7s linear infinite',
          }}
        />
      ) : icon ? (
        <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
      ) : null}
      {children}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </button>
  );
}

export default Button;
