import React from 'react';
import { colors, spacing, typography, radius } from '../../theme.js';

export function Table({ columns, data, loading, emptyMessage = 'No data', compact = false, style = {} }) {
  const cellPad = compact
    ? `${spacing.xs}px ${spacing.md}px`
    : `${spacing.sm}px ${spacing.md}px`;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: spacing.xl, color: colors.textMuted, fontFamily: typography.fontFamily }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', borderRadius: radius.lg, border: `1px solid ${colors.border}`, ...style }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: typography.fontFamily,
          fontSize: typography.fontSizes.md,
        }}
      >
        <thead>
          <tr style={{ background: colors.bgMuted, borderBottom: `1px solid ${colors.border}` }}>
            {columns.map((col, i) => (
              <th
                key={col.key || i}
                onClick={col.sortable && col.onSort ? col.onSort : undefined}
                style={{
                  padding: cellPad,
                  textAlign: col.align || 'left',
                  fontSize: typography.fontSizes.xs,
                  fontWeight: typography.fontWeights.semibold,
                  color: colors.textSecondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
                  cursor: col.sortable ? 'pointer' : 'default',
                  userSelect: 'none',
                  borderRight: i < columns.length - 1 ? `1px solid ${colors.border}` : 'none',
                }}
              >
                {col.label}
                {col.sortDir === 'asc' && ' ▲'}
                {col.sortDir === 'desc' && ' ▼'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: spacing.xl,
                  textAlign: 'center',
                  color: colors.textMuted,
                  fontSize: typography.fontSizes.md,
                }}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, ri) => (
              <TableRow key={ri} row={row} columns={columns} cellPad={cellPad} isLast={ri === data.length - 1} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function TableRow({ row, columns, cellPad, isLast }) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <tr
      style={{
        background: hovered ? colors.bgHover : colors.bgCard,
        borderBottom: isLast ? 'none' : `1px solid ${colors.border}`,
        transition: 'background 0.1s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {columns.map((col, ci) => (
        <td
          key={col.key || ci}
          style={{
            padding: cellPad,
            textAlign: col.align || 'left',
            color: col.color ? col.color(row) : colors.textPrimary,
            fontSize: typography.fontSizes.md,
            fontWeight: col.bold ? typography.fontWeights.semibold : typography.fontWeights.normal,
            borderRight: ci < columns.length - 1 ? `1px solid ${colors.border}` : 'none',
            whiteSpace: col.wrap ? 'normal' : 'nowrap',
            maxWidth: col.maxWidth || undefined,
            overflow: col.maxWidth ? 'hidden' : undefined,
            textOverflow: col.maxWidth ? 'ellipsis' : undefined,
          }}
        >
          {col.render ? col.render(row[col.key], row) : row[col.key] ?? '—'}
        </td>
      ))}
    </tr>
  );
}

export default Table;
