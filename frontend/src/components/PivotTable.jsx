import React, { useState } from 'react';
import { colors, spacing, radius, typography } from '../theme.js';

function formatValue(val, field = '') {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') {
    const isAmt = /amount|revenue|cost|expense|profit|total|sales|price/i.test(field);
    if (isAmt) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(val);
    }
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(val);
  }
  return String(val);
}

export default function PivotTable({ data, loading, error }) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('desc');

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md }}>
        <div style={{
          width: 24, height: 24, border: `2px solid ${colors.primary}`,
          borderTopColor: 'transparent', borderRadius: '50%',
          animation: 'spin 0.7s linear infinite',
        }} />
        <span style={{ color: colors.textSecondary, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.md }}>
          Running query...
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: spacing.lg, background: colors.dangerLight, borderRadius: radius.md, border: `1px solid #fca5a5` }}>
        <p style={{ margin: 0, color: '#dc2626', fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
          Query error: {error.message || String(error)}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: spacing.xxl, textAlign: 'center', color: colors.textMuted, fontFamily: typography.fontFamily }}>
        Configure rows and values to run a query.
      </div>
    );
  }

  const columns = data.columns || [];
  const rows = data.rows || [];
  const totalRow = data.total_row;

  const handleSort = (col) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  let sortedRows = [...rows];
  if (sortCol !== null) {
    sortedRows.sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  // Detect which columns are numeric for alignment
  const isNumeric = (col) => {
    return rows.some((r) => typeof r[col] === 'number');
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
        <thead>
          <tr style={{ background: colors.bgMuted, borderBottom: `2px solid ${colors.border}` }}>
            {columns.map((col, i) => {
              const numeric = isNumeric(col);
              return (
                <th
                  key={i}
                  onClick={() => handleSort(col)}
                  style={{
                    padding: `${spacing.sm}px ${spacing.md}px`,
                    textAlign: numeric ? 'right' : 'left',
                    fontSize: typography.fontSizes.xs,
                    fontWeight: typography.fontWeights.semibold,
                    color: sortCol === col ? colors.primary : colors.textSecondary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    userSelect: 'none',
                    borderRight: i < columns.length - 1 ? `1px solid ${colors.border}` : 'none',
                    transition: 'color 0.1s',
                  }}
                >
                  {col}
                  {sortCol === col && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{ padding: spacing.xl, textAlign: 'center', color: colors.textMuted }}
              >
                No data returned
              </td>
            </tr>
          ) : (
            sortedRows.map((row, ri) => (
              <DataRow key={ri} row={row} columns={columns} isLast={ri === sortedRows.length - 1 && !totalRow} />
            ))
          )}
          {totalRow && (
            <tr style={{ background: '#f0f9ff', borderTop: `2px solid ${colors.border}` }}>
              {columns.map((col, ci) => {
                const val = totalRow[col];
                const numeric = typeof val === 'number';
                return (
                  <td
                    key={ci}
                    style={{
                      padding: `${spacing.sm}px ${spacing.md}px`,
                      textAlign: numeric ? 'right' : 'left',
                      fontWeight: typography.fontWeights.bold,
                      color: colors.primary,
                      borderRight: ci < columns.length - 1 ? `1px solid ${colors.border}` : 'none',
                      fontFamily: 'monospace',
                      fontSize: typography.fontSizes.sm,
                    }}
                  >
                    {formatValue(val, col)}
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
      {rows.length > 0 && (
        <div style={{ padding: `${spacing.xs}px ${spacing.md}px`, borderTop: `1px solid ${colors.border}`, color: colors.textMuted, fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily }}>
          {rows.length} rows
        </div>
      )}
    </div>
  );
}

function DataRow({ row, columns, isLast }) {
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
      {columns.map((col, ci) => {
        const val = row[col];
        const numeric = typeof val === 'number';
        return (
          <td
            key={ci}
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              textAlign: numeric ? 'right' : 'left',
              color: numeric ? colors.textPrimary : colors.textPrimary,
              fontFamily: numeric ? 'monospace' : typography.fontFamily,
              fontSize: typography.fontSizes.sm,
              borderRight: ci < columns.length - 1 ? `1px solid ${colors.border}` : 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {formatValue(val, col)}
          </td>
        );
      })}
    </tr>
  );
}
