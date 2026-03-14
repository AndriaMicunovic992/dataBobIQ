import React, { useState, useCallback } from 'react';
import { colors, spacing, radius, typography, shadows, transitions } from '../theme.js';
import { uploadDataset } from '../api.js';
import { Button } from './common/Button.jsx';

const ACCEPTED = '.xlsx,.xls,.csv';

export default function UploadModal({ modelId, onClose, onSuccess }) {
  const [files, setFiles] = useState([]);
  const [dataLayer, setDataLayer] = useState('actuals');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  const handleNewFiles = (newFiles) => {
    const valid = [];
    for (const f of newFiles) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!['xlsx', 'xls', 'csv'].includes(ext)) {
        setError('Only .xlsx, .xls, and .csv files are supported.');
        return;
      }
      valid.push(f);
    }
    setFiles((prev) => [...prev, ...valid]);
    setError(null);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files;
    if (dropped?.length) handleNewFiles(Array.from(dropped));
  }, []);

  const onInputChange = (e) => {
    const selected = e.target.files;
    if (selected?.length) handleNewFiles(Array.from(selected));
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    setProgress(10);

    const progressTimer = setInterval(() => {
      setProgress((p) => {
        if (p >= 80) { clearInterval(progressTimer); return 80; }
        return p + 15;
      });
    }, 800);

    try {
      for (const f of files) {
        await uploadDataset(modelId, f, dataLayer);
      }
      clearInterval(progressTimer);
      setProgress(100);
      setTimeout(onSuccess, 300);
    } catch (e) {
      clearInterval(progressTimer);
      setProgress(0);
      setError(e.message || 'Upload failed. Please try again.');
      setUploading(false);
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: colors.bgOverlay,
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && !uploading && onClose()}
    >
      <div
        style={{
          background: colors.bgCard, borderRadius: radius.lg,
          boxShadow: shadows.xl, width: 520, maxWidth: '92vw',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: `${spacing.md}px ${spacing.lg}px`,
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.semibold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
            Upload Dataset
          </h2>
          {!uploading && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: colors.textMuted, lineHeight: 1 }}>
              ×
            </button>
          )}
        </div>

        <div style={{ padding: spacing.lg }}>
          {/* Data layer selector */}
          <div style={{ marginBottom: spacing.md }}>
            <label style={{ display: 'block', fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.medium, color: colors.textSecondary, marginBottom: spacing.xs, fontFamily: typography.fontFamily }}>
              Data Layer
            </label>
            <div style={{ display: 'flex', gap: spacing.sm }}>
              {['actuals', 'budget', 'forecast'].map((layer) => (
                <button
                  key={layer}
                  onClick={() => !uploading && setDataLayer(layer)}
                  style={{
                    flex: 1, padding: `${spacing.sm}px ${spacing.xs}px`,
                    borderRadius: radius.md,
                    border: `1px solid ${dataLayer === layer ? colors.primary : colors.border}`,
                    background: dataLayer === layer ? colors.primaryLight : colors.bgCard,
                    color: dataLayer === layer ? colors.primary : colors.textSecondary,
                    fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm,
                    fontWeight: typography.fontWeights.medium, cursor: uploading ? 'not-allowed' : 'pointer',
                    textTransform: 'capitalize', transition: transitions.fast,
                  }}
                >
                  {layer}
                </button>
              ))}
            </div>
          </div>

          {/* Drop zone / file selected */}
          {files.length === 0 ? (
            <label
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              style={{
                display: 'block', cursor: uploading ? 'not-allowed' : 'pointer',
                border: `2px dashed ${dragging ? colors.primary : colors.border}`,
                borderRadius: radius.lg,
                background: dragging ? colors.primaryLight : colors.bgMuted,
                padding: `${spacing.xl}px ${spacing.lg}px`,
                textAlign: 'center', transition: transitions.fast,
                marginBottom: spacing.md,
              }}
            >
              <input type="file" accept={ACCEPTED} onChange={onInputChange} style={{ display: 'none' }} disabled={uploading} multiple />
              <div style={{ fontSize: 32, marginBottom: spacing.sm }}>📂</div>
              <p style={{ margin: 0, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.medium, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
                {dragging ? 'Drop to select' : 'Click or drag files here'}
              </p>
              <p style={{ margin: `${spacing.xs}px 0 0`, fontSize: typography.fontSizes.sm, color: colors.textMuted, fontFamily: typography.fontFamily }}>
                Supports XLSX, XLS, CSV — select multiple files
              </p>
            </label>
          ) : (
            <div style={{ marginBottom: spacing.md, display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
              {files.map((f, i) => (
                <div key={i} style={{
                  border: `1px solid ${colors.border}`, borderRadius: radius.lg,
                  padding: spacing.md,
                  display: 'flex', alignItems: 'center', gap: spacing.md,
                  background: colors.bgMuted,
                }}>
                  <div style={{ fontSize: 28, flexShrink: 0 }}>
                    {f.name.endsWith('.csv') ? '📄' : '📊'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: typography.fontWeights.medium, color: colors.textPrimary, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.md, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </div>
                    <div style={{ color: colors.textMuted, fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm, marginTop: 2 }}>
                      {formatSize(f.size)}
                    </div>
                  </div>
                  {!uploading && (
                    <button onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, fontSize: 18, lineHeight: 1 }}>
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Progress bar */}
          {uploading && (
            <div style={{ marginBottom: spacing.md }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: spacing.xs }}>
                <span style={{ fontSize: typography.fontSizes.sm, color: colors.textSecondary, fontFamily: typography.fontFamily }}>
                  {progress < 100 ? 'Processing with AI...' : 'Complete!'}
                </span>
                <span style={{ fontSize: typography.fontSizes.sm, color: colors.textSecondary, fontFamily: typography.fontFamily }}>
                  {progress}%
                </span>
              </div>
              <div style={{ height: 6, background: colors.bgHover, borderRadius: radius.full, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: radius.full,
                  background: progress === 100 ? colors.success : colors.primary,
                  width: `${progress}%`, transition: 'width 0.4s ease',
                }} />
              </div>
              <p style={{ margin: `${spacing.xs}px 0 0`, fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>
                Claude AI is mapping your columns to the financial schema...
              </p>
            </div>
          )}

          {error && (
            <div style={{ padding: spacing.sm, background: colors.dangerLight, borderRadius: radius.md, marginBottom: spacing.md, border: `1px solid #fca5a5` }}>
              <p style={{ margin: 0, color: '#dc2626', fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm }}>{error}</p>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
            {!uploading && <Button variant="secondary" onClick={onClose}>Cancel</Button>}
            <Button
              variant="primary"
              disabled={files.length === 0}
              loading={uploading}
              onClick={handleUpload}
            >
              {uploading ? 'Uploading...' : 'Upload & Analyze'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
