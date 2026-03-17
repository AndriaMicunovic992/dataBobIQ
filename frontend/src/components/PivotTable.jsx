import React, { useState } from 'react';
import { colors, spacing, radius, typography } from '../theme.js';

function formatValue(val, field = '') {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'number') {
    const isAmt = /amount|revenue|cost|expense|profit|total|sales|price|debit|credit/i.test(field);
    if (isAmt) {
      return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(val);
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

  // API returns columns as [{field, type}] and rows as [[val, val, ...]]
  const colDefs = (data.columns || []).map((c) =>
    typeof c === 'string' ? { field: c, type: 'dimension' } : c
  );
  const rows = data.rows || [];
  const totals = data.totals || null;

  // Detect pivot measure columns (multiple measure columns = pivoted view)
  const measureIndices = colDefs.reduce((acc, c, i) => {
    if (c.type === 'measure') acc.push(i);
    return acc;
  }, []);
  const hasPivotColumns = measureIndices.length > 1;

  // Append a "Total" column when pivoted (sums all measure cols per row)
  const colNames = hasPivotColumns
    ? [...colDefs.map((c) => c.field), 'Total']
    : colDefs.map((c) => c.field);
  const allColDefs = hasPivotColumns
    ? [...colDefs, { field: 'Total', type: 'measure' }]
    : colDefs;

  const appendRowTotal = (row) => {
    if (!hasPivotColumns) return row;
    const sum = measureIndices.reduce((s, i) => s + (typeof row[i] === 'number' ? row[i] : 0), 0);
    return [...row, sum];
  };

  const rowsWithTotals = rows.map(appendRowTotal);
  const totalsWithTotal = totals ? appendRowTotal(totals) : null;

  const handleSort = (colIdx) => {
    if (sortCol === colIdx) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(colIdx);
      setSortDir('desc');
    }
  };

  let sortedRows = [...rowsWithTotals];
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

  const isNumericCol = (idx) => {
    return allColDefs[idx]?.type === 'measure' || rowsWithTotals.some((r) => typeof r[idx] === 'number');
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
        <thead>
          <tr style={{ background: colors.bgMuted, borderBottom: `2px solid ${colors.border}` }}>
            {colNames.map((name, i) => {
              const numeric = isNumericCol(i);
              return (
                <th
                  key={i}
                  onClick={() => handleSort(i)}
                  style={{
                    padding: `${spacing.sm}px ${spacing.md}px`,
                    textAlign: numeric ? 'right' : 'left',
                    fontSize: typography.fontSizes.xs,
                    fontWeight: typography.fontWeights.semibold,
                    color: sortCol === i ? colors.primary : colors.textSecondary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    userSelect: 'none',
                    borderRight: i < colNames.length - 1 ? `1px solid ${colors.border}` : 'none',
                    transition: 'color 0.1s',
                  }}
                >
                  {name}
                  {sortCol === i && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td
                colSpan={colNames.length}
                style={{ padding: spacing.xl, textAlign: 'center', color: colors.textMuted }}
              >
                No data returned
              </td>
            </tr>
          ) : (
            sortedRows.map((row, ri) => (
              <DataRow key={ri} row={row} colNames={colNames} colDefs={allColDefs} isNumericCol={isNumericCol} isLast={ri === sortedRows.length - 1 && !totalsWithTotal} />
            ))
          )}
          {totalsWithTotal && (
            <tr style={{ background: '#f0f9ff', borderTop: `2px solid ${colors.border}` }}>
              {totalsWithTotal.map((val, ci) => {
                const numeric = typeof val === 'number';
                // Show "Total" in the first dimension column (where ROLLUP puts NULL)
                const displayVal = ci === 0 && (val === null || val === undefined) ? 'Total' : val;
                const isLabel = ci === 0 && displayVal === 'Total';
                return (
                  <td
                    key={ci}
                    style={{
                      padding: `${spacing.sm}px ${spacing.md}px`,
                      textAlign: isLabel ? 'left' : numeric ? 'right' : 'left',
                      fontWeight: typography.fontWeights.bold,
                      color: colors.primary,
                      borderRight: ci < colNames.length - 1 ? `1px solid ${colors.border}` : 'none',
                      fontFamily: isLabel ? typography.fontFamily : 'monospace',
                      fontSize: typography.fontSizes.sm,
                    }}
                  >
                    {isLabel ? 'Total' : formatValue(displayVal, colNames[ci])}
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
      {rowsWithTotals.length > 0 && (
        <div style={{ padding: `${spacing.xs}px ${spacing.md}px`, borderTop: `1px solid ${colors.border}`, color: colors.textMuted, fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily }}>
          {data.row_count || rowsWithTotals.length} rows{data.total_row_count > rowsWithTotals.length ? ` of ${data.total_row_count}` : ''}
        </div>
      )}
    </div>
  );
}

function DataRow({ row, colNames, colDefs, isNumericCol, isLast }) {
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
      {row.map((val, ci) => {
        const numeric = typeof val === 'number';
        return (
          <td
            key={ci}
            style={{
              padding: `${spacing.sm}px ${spacing.md}px`,
              textAlign: numeric ? 'right' : 'left',
              color: colors.textPrimary,
              fontFamily: numeric ? 'monospace' : typography.fontFamily,
              fontSize: typography.fontSizes.sm,
              borderRight: ci < colNames.length - 1 ? `1px solid ${colors.border}` : 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {formatValue(val, colNames[ci])}
          </td>
        );
      })}
    </tr>
  );
}
