import React, { useCallback, useState } from 'react';
import { colors, spacing, radius, typography, shadows, transitions } from '../theme.js';
import { uploadDataset } from '../api.js';
import { Button } from './common/Button.jsx';

const ACCEPTED = '.xlsx,.xls,.csv';

export default function UploadScreen({ modelId, onUploaded }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [dataLayer, setDataLayer] = useState('actuals');

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await uploadDataset(modelId, file, dataLayer);
      onUploaded();
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [modelId, dataLayer, onUploaded]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const onInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const features = [
    { icon: '⬡', title: 'AI Column Mapping', desc: 'Claude automatically maps your columns to a canonical financial schema' },
    { icon: '◈', title: 'Server-side Analytics', desc: 'DuckDB powers all pivots, aggregations, and KPI computations' },
    { icon: '◑', title: 'Scenario Modeling', desc: 'Build what-if scenarios with delta overlay rules' },
    { icon: '◎', title: 'Chat with Data', desc: 'Ask questions and get insights from your financial data' },
  ];

  return (
    <div style={{ padding: spacing.xl, maxWidth: 800, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: spacing.xl }}>
        <h1 style={{
          margin: 0, fontSize: typography.fontSizes.xxxl,
          fontWeight: typography.fontWeights.bold,
          color: colors.textPrimary, fontFamily: typography.fontFamily,
        }}>
          Upload Your Data
        </h1>
        <p style={{
          margin: `${spacing.sm}px 0 0`,
          fontSize: typography.fontSizes.lg,
          color: colors.textSecondary,
          fontFamily: typography.fontFamily,
        }}>
          Start by uploading an ERP export, accounting spreadsheet, or CSV file.
        </p>
      </div>

      {/* Data layer selector */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.lg }}>
        {['actuals', 'budget', 'forecast'].map((layer) => (
          <button
            key={layer}
            onClick={() => setDataLayer(layer)}
            style={{
              padding: `${spacing.xs}px ${spacing.md}px`,
              borderRadius: radius.full,
              border: `1px solid ${dataLayer === layer ? colors.primary : colors.border}`,
              background: dataLayer === layer ? colors.primaryLight : colors.bgCard,
              color: dataLayer === layer ? colors.primary : colors.textSecondary,
              fontFamily: typography.fontFamily,
              fontSize: typography.fontSizes.sm,
              fontWeight: typography.fontWeights.medium,
              cursor: 'pointer',
              textTransform: 'capitalize',
              transition: transitions.fast,
            }}
          >
            {layer}
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <label
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        style={{
          display: 'block',
          border: `2px dashed ${dragging ? colors.primary : colors.border}`,
          borderRadius: radius.xl,
          background: dragging ? colors.primaryLight : colors.bgCard,
          padding: spacing.xxl,
          textAlign: 'center',
          cursor: uploading ? 'not-allowed' : 'pointer',
          transition: transitions.normal,
          boxShadow: dragging ? `0 0 0 4px ${colors.primaryLight}` : shadows.sm,
          marginBottom: spacing.lg,
        }}
      >
        <input
          type="file"
          accept={ACCEPTED}
          onChange={onInputChange}
          style={{ display: 'none' }}
          disabled={uploading}
        />

        {uploading ? (
          <div>
            <div style={{
              width: 48, height: 48, border: `3px solid ${colors.primary}`,
              borderTopColor: 'transparent', borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
              margin: '0 auto',
            }} />
            <p style={{ margin: `${spacing.md}px 0 0`, fontSize: typography.fontSizes.lg, color: colors.textSecondary, fontFamily: typography.fontFamily }}>
              Uploading and processing...
            </p>
            <p style={{ margin: `${spacing.xs}px 0 0`, fontSize: typography.fontSizes.sm, color: colors.textMuted, fontFamily: typography.fontFamily }}>
              AI is mapping your columns to the financial schema
            </p>
          </div>
        ) : (
          <div>
            <div style={{
              width: 72, height: 72, borderRadius: radius.full,
              background: dragging ? colors.primary : colors.bgHover,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto', fontSize: 32,
              transition: transitions.fast,
              color: dragging ? 'white' : colors.textMuted,
            }}>
              ↑
            </div>
            <p style={{
              margin: `${spacing.md}px 0 ${spacing.xs}px`,
              fontSize: typography.fontSizes.xl,
              fontWeight: typography.fontWeights.semibold,
              color: dragging ? colors.primary : colors.textPrimary,
              fontFamily: typography.fontFamily,
            }}>
              {dragging ? 'Drop to upload' : 'Drag & drop your file'}
            </p>
            <p style={{ margin: 0, fontSize: typography.fontSizes.md, color: colors.textMuted, fontFamily: typography.fontFamily }}>
              or click to browse — XLSX, XLS, CSV supported
            </p>
            <p style={{ margin: `${spacing.xs}px 0 0`, fontSize: typography.fontSizes.sm, color: colors.textMuted, fontFamily: typography.fontFamily }}>
              Uploading as: <strong style={{ color: colors.primary }}>{dataLayer}</strong>
            </p>
          </div>
        )}
      </label>

      {error && (
        <div style={{
          padding: spacing.md, background: colors.dangerLight, borderRadius: radius.md,
          border: `1px solid #fca5a5`, marginBottom: spacing.lg,
        }}>
          <p style={{ margin: 0, color: '#dc2626', fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>
            {error}
          </p>
        </div>
      )}

      {/* Feature grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
        gap: spacing.md, marginTop: spacing.xl,
      }}>
        {features.map((f) => (
          <div key={f.title} style={{
            background: colors.bgCard, borderRadius: radius.lg,
            border: `1px solid ${colors.border}`, padding: spacing.md,
            display: 'flex', gap: spacing.md, alignItems: 'flex-start',
          }}>
            <div style={{
              fontSize: 20, color: colors.primary, flexShrink: 0,
              width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: colors.primaryLight, borderRadius: radius.md,
            }}>
              {f.icon}
            </div>
            <div>
              <div style={{ fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.md }}>
                {f.title}
              </div>
              <div style={{ color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm, marginTop: 2, lineHeight: 1.5 }}>
                {f.desc}
              </div>
            </div>
          </div>
        ))}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
