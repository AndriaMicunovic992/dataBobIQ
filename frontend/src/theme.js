export const colors = {
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primaryLight: '#dbeafe',
  success: '#10b981',
  successLight: '#d1fae5',
  danger: '#ef4444',
  dangerLight: '#fee2e2',
  warning: '#f59e0b',
  warningLight: '#fef3c7',
  info: '#06b6d4',
  infoLight: '#cffafe',

  // Sidebar
  sidebar: '#0f172a',
  sidebarHover: '#1e293b',
  sidebarActive: '#1e40af',
  sidebarText: '#94a3b8',
  sidebarTextActive: '#ffffff',

  // Backgrounds
  bgMain: '#f8fafc',
  bgCard: '#ffffff',
  bgHover: '#f1f5f9',
  bgMuted: '#f8fafc',
  bgOverlay: 'rgba(15, 23, 42, 0.5)',

  // Text
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  textInverse: '#ffffff',

  // Borders
  border: '#e2e8f0',
  borderFocus: '#2563eb',

  // Chart palette
  chart: ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#f97316'],
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

export const shadows = {
  sm: '0 1px 2px rgba(0,0,0,0.05)',
  md: '0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)',
  lg: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
  xl: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
};

export const typography = {
  fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  fontSizes: {
    xs: 11,
    sm: 12,
    md: 14,
    lg: 16,
    xl: 18,
    xxl: 24,
    xxxl: 32,
  },
  fontWeights: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeights: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
};

export const transitions = {
  fast: 'all 0.1s ease',
  normal: 'all 0.2s ease',
  slow: 'all 0.3s ease',
};

// Convenience style blocks
export const cardStyle = {
  background: colors.bgCard,
  borderRadius: radius.lg,
  border: `1px solid ${colors.border}`,
  boxShadow: shadows.sm,
  padding: spacing.lg,
};

export const inputStyle = {
  width: '100%',
  padding: `${spacing.sm}px ${spacing.md}px`,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  fontSize: typography.fontSizes.md,
  fontFamily: typography.fontFamily,
  color: colors.textPrimary,
  background: colors.bgCard,
  outline: 'none',
  transition: transitions.fast,
  boxSizing: 'border-box',
};

export const labelStyle = {
  display: 'block',
  fontSize: typography.fontSizes.sm,
  fontWeight: typography.fontWeights.medium,
  color: colors.textSecondary,
  marginBottom: spacing.xs,
};

export default {
  colors,
  spacing,
  radius,
  shadows,
  typography,
  transitions,
  cardStyle,
  inputStyle,
  labelStyle,
};
