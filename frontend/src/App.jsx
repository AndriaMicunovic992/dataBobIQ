import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listModels, createModel, deleteModel, listDatasets } from './api.js';
import { useDashboards, useCreateDashboard, useDeleteDashboard } from './hooks/useDashboard.js';
import { colors, spacing, radius, typography, shadows, transitions, inputStyle, labelStyle } from './theme.js';
import { Button } from './components/common/Button.jsx';
import ModelLanding from './components/ModelLanding.jsx';
import UploadScreen from './components/UploadScreen.jsx';
import UploadModal from './components/UploadModal.jsx';
import SchemaView from './components/SchemaView.jsx';
import DashboardView from './components/DashboardView.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import KnowledgePanel from './components/KnowledgePanel.jsx';

const TABS = [
  { id: 'schema', label: 'Data Model', icon: '\u2B21' },
  { id: 'knowledge', label: 'Knowledge', icon: '\u25C7' },
];

function CreateModelModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => createModel({ name: name.trim(), description: description.trim() }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['models'] });
      onCreated(data.id);
      onClose();
    },
  });

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: colors.bgOverlay,
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: colors.bgCard, borderRadius: radius.lg, boxShadow: shadows.xl,
          padding: spacing.xl, width: 480, maxWidth: '90vw',
        }}
      >
        <h2 style={{ margin: `0 0 ${spacing.lg}px`, fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
          Create New Model
        </h2>
        <div style={{ marginBottom: spacing.md }}>
          <label style={labelStyle}>Model Name *</label>
          <input
            style={inputStyle}
            placeholder="e.g., Q1 2026 Financials"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div style={{ marginBottom: spacing.xl }}>
          <label style={labelStyle}>Description</label>
          <textarea
            style={{ ...inputStyle, height: 80, resize: 'vertical' }}
            placeholder="Optional description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {mutation.isError && (
          <p style={{ color: colors.danger, fontSize: typography.fontSizes.sm, marginBottom: spacing.md, fontFamily: typography.fontFamily }}>
            {mutation.error?.message || 'Failed to create model'}
          </p>
        )}
        <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!name.trim()}
            onClick={() => mutation.mutate()}
          >
            Create Model
          </Button>
        </div>
      </div>
    </div>
  );
}

function CreateDashboardModal({ modelId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const createMut = useCreateDashboard(modelId);

  const handleCreate = () => {
    if (!name.trim()) return;
    createMut.mutate({ name: name.trim(), description: description.trim() || undefined }, {
      onSuccess: (data) => {
        onCreated(data.id);
        onClose();
      },
    });
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: colors.bgOverlay,
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: colors.bgCard, borderRadius: radius.lg, boxShadow: shadows.xl,
          padding: spacing.xl, width: 420, maxWidth: '90vw',
        }}
      >
        <h2 style={{ margin: `0 0 ${spacing.lg}px`, fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.bold, color: colors.textPrimary, fontFamily: typography.fontFamily }}>
          New Dashboard
        </h2>
        <div style={{ marginBottom: spacing.md }}>
          <label style={labelStyle}>Dashboard Name *</label>
          <input
            style={inputStyle}
            placeholder="e.g., P&L Overview"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div style={{ marginBottom: spacing.xl }}>
          <label style={labelStyle}>Description</label>
          <textarea
            style={{ ...inputStyle, height: 60, resize: 'vertical' }}
            placeholder="Optional description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {createMut.isError && (
          <p style={{ color: colors.danger, fontSize: typography.fontSizes.sm, marginBottom: spacing.md, fontFamily: typography.fontFamily }}>
            {createMut.error?.message || 'Failed to create dashboard'}
          </p>
        )}
        <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={createMut.isPending}
            disabled={!name.trim()}
            onClick={handleCreate}
          >
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ models, selectedModelId, onSelectModel, activeTab, onTabChange, onCreateModel, onUpload, chatOpen, onToggleChat, dashboards, onCreateDashboard }) {
  const selectedModel = models?.find((m) => m.id === selectedModelId);

  return (
    <aside
      style={{
        width: 240,
        minHeight: '100vh',
        background: colors.sidebar,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'fixed',
        top: 0, left: 0, bottom: 0,
        zIndex: 100,
        overflowY: 'auto',
      }}
    >
      {/* Brand */}
      <div style={{ padding: `${spacing.lg}px ${spacing.md}px`, borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
          <div style={{
            width: 32, height: 32, borderRadius: radius.md,
            background: `linear-gradient(135deg, ${colors.primary}, #7c3aed)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, color: 'white', fontWeight: 700,
          }}>B</div>
          <div>
            <div style={{ color: colors.textInverse, fontWeight: typography.fontWeights.bold, fontSize: typography.fontSizes.md, fontFamily: typography.fontFamily }}>dataBobIQ</div>
            <div style={{ color: colors.sidebarText, fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily }}>CFO Companion</div>
          </div>
        </div>
      </div>

      {/* Model selector */}
      <div style={{ padding: `${spacing.md}px`, borderBottom: `1px solid rgba(255,255,255,0.06)` }}>
        <div style={{ marginBottom: spacing.xs }}>
          <span style={{ color: colors.sidebarText, fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: typography.fontFamily }}>
            Model
          </span>
        </div>
        {selectedModel ? (
          <div
            style={{
              background: 'rgba(255,255,255,0.06)', borderRadius: radius.md,
              padding: `${spacing.sm}px ${spacing.md}px`,
              color: colors.sidebarTextActive, fontSize: typography.fontSizes.sm,
              fontFamily: typography.fontFamily, fontWeight: typography.fontWeights.medium,
              cursor: 'pointer',
            }}
            title="Click to switch model"
            onClick={() => onSelectModel(null)}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedModel.name}
              </span>
              <span style={{ color: colors.sidebarText, fontSize: 10 }}>{'\u2195'}</span>
            </div>
          </div>
        ) : (
          <div
            style={{
              color: colors.sidebarText, fontSize: typography.fontSizes.sm,
              fontFamily: typography.fontFamily, fontStyle: 'italic',
            }}
          >
            No model selected
          </div>
        )}
        <button
          onClick={onCreateModel}
          style={{
            marginTop: spacing.sm, width: '100%', padding: `${spacing.xs}px ${spacing.sm}px`,
            background: 'transparent', border: `1px dashed rgba(255,255,255,0.2)`,
            borderRadius: radius.md, color: colors.sidebarText,
            fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily,
            cursor: 'pointer', transition: transitions.fast,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
          }}
        >
          + New Model
        </button>
      </div>

      {/* Navigation tabs */}
      {selectedModelId && (
        <nav style={{ padding: `${spacing.sm}px ${spacing.sm}px`, flex: 1 }}>
          {/* Views section */}
          <div style={{ marginBottom: spacing.xs, padding: `${spacing.xs}px ${spacing.sm}px` }}>
            <span style={{ color: colors.sidebarText, fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: typography.fontFamily }}>
              Views
            </span>
          </div>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <NavItem
                key={tab.id}
                icon={tab.icon}
                label={tab.label}
                active={isActive}
                onClick={() => onTabChange(tab.id)}
              />
            );
          })}

          {/* Dashboards section */}
          <div style={{ margin: `${spacing.md}px 0 ${spacing.xs}px`, padding: `${spacing.xs}px ${spacing.sm}px` }}>
            <span style={{ color: colors.sidebarText, fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: typography.fontFamily }}>
              Dashboards
            </span>
          </div>
          {(dashboards || []).map((dash) => {
            const dashTabId = `dashboard-${dash.id}`;
            const isActive = activeTab === dashTabId;
            return (
              <NavItem
                key={dash.id}
                icon={'\u25A6'}
                label={dash.name}
                active={isActive}
                onClick={() => onTabChange(dashTabId)}
              />
            );
          })}
          <button
            onClick={onCreateDashboard}
            style={{
              width: '100%', padding: `${spacing.sm}px ${spacing.md}px`,
              background: 'transparent', border: 'none', borderRadius: radius.md,
              color: colors.sidebarText, fontSize: typography.fontSizes.sm,
              fontFamily: typography.fontFamily, cursor: 'pointer',
              transition: transitions.fast, display: 'flex', alignItems: 'center',
              gap: spacing.sm, textAlign: 'left', marginBottom: 2,
            }}
          >
            <span style={{ fontSize: 14, opacity: 0.8 }}>+</span>
            New Dashboard
          </button>

          {/* Divider */}
          <div style={{ margin: `${spacing.md}px 0`, borderTop: `1px solid rgba(255,255,255,0.06)` }} />

          {/* Upload button */}
          <button
            onClick={onUpload}
            style={{
              width: '100%', padding: `${spacing.sm}px ${spacing.md}px`,
              background: colors.primary, border: 'none',
              borderRadius: radius.md, color: colors.textInverse,
              fontSize: typography.fontSizes.sm, fontFamily: typography.fontFamily,
              fontWeight: typography.fontWeights.medium,
              cursor: 'pointer', transition: transitions.fast,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
              marginBottom: spacing.sm,
            }}
          >
            {'\u2191'} Upload Dataset
          </button>

          {/* Chat toggle */}
          <NavItem
            icon={'\u25CE'}
            label={chatOpen ? 'Close Chat' : 'AI Chat'}
            active={chatOpen}
            onClick={onToggleChat}
          />
        </nav>
      )}

      {/* Footer */}
      <div style={{ padding: spacing.md, borderTop: `1px solid rgba(255,255,255,0.06)` }}>
        <div style={{ color: colors.sidebarText, fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily }}>
          Powered by Claude AI
        </div>
      </div>
    </aside>
  );
}

function NavItem({ icon, label, active, onClick }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', padding: `${spacing.sm}px ${spacing.md}px`,
        background: active ? colors.sidebarActive : hovered ? colors.sidebarHover : 'transparent',
        border: 'none', borderRadius: radius.md,
        color: active ? colors.sidebarTextActive : hovered ? '#cbd5e1' : colors.sidebarText,
        fontSize: typography.fontSizes.sm, fontFamily: typography.fontFamily,
        fontWeight: active ? typography.fontWeights.semibold : typography.fontWeights.normal,
        cursor: 'pointer', transition: transitions.fast,
        display: 'flex', alignItems: 'center', gap: spacing.sm,
        textAlign: 'left', marginBottom: 2,
        overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      }}
    >
      <span style={{ fontSize: 14, opacity: 0.8, flexShrink: 0 }}>{icon}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </button>
  );
}

export default function App() {
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [activeTab, setActiveTab] = useState('schema');
  const [chatOpen, setChatOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCreateDashboardModal, setShowCreateDashboardModal] = useState(false);

  const qc = useQueryClient();
  const { data: models = [] } = useQuery({
    queryKey: ['models'],
    queryFn: listModels,
  });

  const { data: datasets = [] } = useQuery({
    queryKey: ['datasets', selectedModelId],
    queryFn: () => listDatasets(selectedModelId),
    enabled: !!selectedModelId,
    refetchInterval: (query) => {
      const ds = query.state.data || [];
      const processing = ds.some((d) =>
        ['queued', 'parsing', 'parsed', 'mapping', 'mapped_pending_review', 'materializing'].includes(d.status)
      );
      return processing ? 3000 : false;
    },
  });

  const { data: dashboards = [] } = useDashboards(selectedModelId);

  // Invalidate metadata when a dataset becomes active
  const prevActiveCountRef = useRef(0);
  useEffect(() => {
    const activeCount = datasets.filter((d) => d.status === 'active').length;
    if (activeCount > prevActiveCountRef.current && prevActiveCountRef.current > 0) {
      qc.invalidateQueries({ queryKey: ['metadata', selectedModelId] });
    }
    prevActiveCountRef.current = activeCount;
  }, [datasets, selectedModelId, qc]);

  const hasDatasets = datasets.length > 0;

  const handleSelectModel = useCallback((id) => {
    setSelectedModelId(id);
    if (id) setActiveTab('schema');
  }, []);

  const handleUploadSuccess = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['datasets', selectedModelId] });
    qc.invalidateQueries({ queryKey: ['metadata', selectedModelId] });
    setShowUploadModal(false);
    setActiveTab('schema');
  }, [selectedModelId, qc]);

  const deleteModelMut = useMutation({
    mutationFn: (id) => deleteModel(id),
    onSuccess: (_, deletedId) => {
      qc.invalidateQueries({ queryKey: ['models'] });
      if (selectedModelId === deletedId) {
        setSelectedModelId(null);
      }
    },
  });

  const handleDeleteModel = useCallback((id) => {
    deleteModelMut.mutate(id);
  }, [deleteModelMut]);

  const handleDashboardCreated = useCallback((dashId) => {
    setActiveTab(`dashboard-${dashId}`);
    setShowCreateDashboardModal(false);
  }, []);

  const renderContent = () => {
    if (!selectedModelId) {
      return (
        <ModelLanding
          models={models}
          onSelect={handleSelectModel}
          onCreate={() => setShowCreateModal(true)}
          onDelete={handleDeleteModel}
        />
      );
    }

    if (!hasDatasets) {
      return (
        <UploadScreen
          modelId={selectedModelId}
          onUploaded={handleUploadSuccess}
        />
      );
    }

    // Dashboard tab
    if (activeTab.startsWith('dashboard-')) {
      const dashboardId = activeTab.replace('dashboard-', '');
      return <DashboardView dashboardId={dashboardId} modelId={selectedModelId} />;
    }

    switch (activeTab) {
      case 'schema':
        return <SchemaView modelId={selectedModelId} datasets={datasets} onUpload={() => setShowUploadModal(true)} />;
      case 'knowledge':
        return <KnowledgePanel modelId={selectedModelId} />;
      default:
        return null;
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: colors.bgMain, fontFamily: typography.fontFamily }}>
      <Sidebar
        models={models}
        selectedModelId={selectedModelId}
        onSelectModel={handleSelectModel}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onCreateModel={() => setShowCreateModal(true)}
        onUpload={() => setShowUploadModal(true)}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((v) => !v)}
        dashboards={dashboards}
        onCreateDashboard={() => setShowCreateDashboardModal(true)}
      />

      {/* Main content */}
      <main
        style={{
          flex: 1,
          marginLeft: 240,
          marginRight: chatOpen ? 380 : 0,
          transition: 'margin-right 0.3s ease',
          minHeight: '100vh',
          overflowX: 'hidden',
        }}
      >
        {renderContent()}
      </main>

      {/* Chat panel */}
      {chatOpen && selectedModelId && (
        <ChatPanel modelId={selectedModelId} onClose={() => setChatOpen(false)} />
      )}

      {/* Modals */}
      {showCreateModal && (
        <CreateModelModal
          onClose={() => setShowCreateModal(false)}
          onCreated={handleSelectModel}
        />
      )}
      {showUploadModal && selectedModelId && (
        <UploadModal
          modelId={selectedModelId}
          onClose={() => setShowUploadModal(false)}
          onSuccess={handleUploadSuccess}
        />
      )}
      {showCreateDashboardModal && selectedModelId && (
        <CreateDashboardModal
          modelId={selectedModelId}
          onClose={() => setShowCreateDashboardModal(false)}
          onCreated={handleDashboardCreated}
        />
      )}
    </div>
  );
}
