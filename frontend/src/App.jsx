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
import AgentWorkspace from './components/AgentWorkspace/index.jsx';

const AGENT_WORKSPACE_TAB = 'agent-workspace';

const SCHEMA_TAB = { id: 'schema', label: 'Data Model', icon: '\u2B21' };
const KNOWLEDGE_TAB = { id: 'knowledge', label: 'Knowledge', icon: '\u25C7' };

// Tabs that live under the MODELLING section — used to decide which chat
// agent ChatPanel should render when the user opens it.
const MODELLING_TABS = new Set([SCHEMA_TAB.id, KNOWLEDGE_TAB.id]);

function SectionHeader({ label }) {
  return (
    <div style={{ margin: `${spacing.md}px 0 ${spacing.xs}px`, padding: `${spacing.xs}px ${spacing.sm}px` }}>
      <span style={{
        color: colors.sidebarText, fontSize: typography.fontSizes.xs,
        fontWeight: typography.fontWeights.medium, textTransform: 'uppercase',
        letterSpacing: '0.08em', fontFamily: typography.fontFamily,
      }}>
        {label}
      </span>
    </div>
  );
}

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

const SIDEBAR_COLLAPSED_W = 60;
const SIDEBAR_EXPANDED_W = 240;

function CollapsedSidebar() {
  // Minimal collapsed rail — only the brand "B". No icons, no active-state
  // hints. The rail expands on hover (handled by the parent Sidebar) to
  // reveal the full navigation tree.
  return (
    <div style={{
      width: SIDEBAR_COLLAPSED_W, minWidth: SIDEBAR_COLLAPSED_W,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      minHeight: '100vh', padding: `${spacing.md}px 0`,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: radius.md,
        background: `linear-gradient(135deg, ${colors.primary}, #7c3aed)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, color: 'white', fontWeight: 700,
      }}>B</div>
    </div>
  );
}

function Sidebar({ models, selectedModelId, onSelectModel, activeTab, onTabChange, onCreateModel, onUpload, dashboards, onCreateDashboard, onDeleteDashboard, expanded, onExpandedChange }) {
  const selectedModel = models?.find((m) => m.id === selectedModelId);

  return (
    <aside
      onMouseEnter={() => onExpandedChange(true)}
      onMouseLeave={() => onExpandedChange(false)}
      style={{
        width: expanded ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W,
        minHeight: '100vh',
        background: colors.sidebar,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        position: 'fixed',
        top: 0, left: 0, bottom: 0,
        zIndex: 100,
        overflowY: expanded ? 'auto' : 'hidden',
        overflowX: 'hidden',
        transition: 'width 0.2s ease',
        boxShadow: expanded ? '4px 0 20px rgba(0,0,0,0.18)' : 'none',
      }}
    >
      {/* When collapsed, render a purpose-built icon column. When expanded,
          render the full 240px layout. Switching between two trees (instead
          of clipping one) keeps both states visually clean. */}
      {!expanded ? (
        <CollapsedSidebar />
      ) : (
      <div style={{
        width: SIDEBAR_EXPANDED_W, minWidth: SIDEBAR_EXPANDED_W,
        display: 'flex', flexDirection: 'column', minHeight: '100vh',
      }}>
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
          {/* Decision Intelligence — the landing page, always at the top */}
          <NavItem
            icon={'\u25C9'}
            label="Decision Intelligence"
            active={activeTab === AGENT_WORKSPACE_TAB}
            onClick={() => onTabChange(AGENT_WORKSPACE_TAB)}
          />

          {/* Divider under DI */}
          <div style={{ margin: `${spacing.sm}px 0`, borderTop: `1px solid rgba(255,255,255,0.06)` }} />

          {/* Dashboards section */}
          <SectionHeader label="Dashboards" />
          {(dashboards || []).map((dash) => {
            const dashTabId = `dashboard-${dash.id}`;
            const isActive = activeTab === dashTabId;
            return (
              <div key={dash.id} style={{ display: 'flex', alignItems: 'center', position: 'relative' }}
                onMouseEnter={(e) => { const btn = e.currentTarget.querySelector('.dash-del'); if (btn) btn.style.opacity = '1'; }}
                onMouseLeave={(e) => { const btn = e.currentTarget.querySelector('.dash-del'); if (btn) btn.style.opacity = '0'; }}
              >
                <div style={{ flex: 1 }}>
                  <NavItem
                    icon={'\u25A6'}
                    label={dash.name}
                    active={isActive}
                    onClick={() => onTabChange(dashTabId)}
                  />
                </div>
                <button
                  className="dash-del"
                  onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete dashboard "${dash.name}"?`)) onDeleteDashboard(dash.id); }}
                  style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'rgba(255,255,255,0.4)', fontSize: 12, padding: '2px 4px',
                    opacity: 0, transition: 'opacity 0.15s',
                  }}
                  title="Delete dashboard"
                >
                  ✕
                </button>
              </div>
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

          {/* MODELLING section — data model + knowledge live here.
              Opening the AI chat from this section surfaces the data agent. */}
          <SectionHeader label="Modelling" />
          <NavItem
            icon={SCHEMA_TAB.icon}
            label={SCHEMA_TAB.label}
            active={activeTab === SCHEMA_TAB.id}
            onClick={() => onTabChange(SCHEMA_TAB.id)}
          />
          <NavItem
            icon={KNOWLEDGE_TAB.icon}
            label={KNOWLEDGE_TAB.label}
            active={activeTab === KNOWLEDGE_TAB.id}
            onClick={() => onTabChange(KNOWLEDGE_TAB.id)}
          />

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
        </nav>
      )}

      {/* Footer */}
      <div style={{ padding: spacing.md, borderTop: `1px solid rgba(255,255,255,0.06)` }}>
        <div style={{ color: colors.sidebarText, fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily }}>
          Powered by Claude AI
        </div>
      </div>
      </div>
      )}
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
  const [activeTab, setActiveTab] = useState(AGENT_WORKSPACE_TAB);
  // One-shot handoff when DI navigates to a dashboard with a scenario
  // preselected. Consumed by the DashboardView as initialScenarioId on mount,
  // then cleared so subsequent tab switches don't re-apply it.
  const [pendingScenarioForDashboard, setPendingScenarioForDashboard] = useState(null); // { dashboardId, scenarioId }
  const [chatOpen, setChatOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showCreateDashboardModal, setShowCreateDashboardModal] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

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

  // Clear the pending scenario handoff once the dashboard has mounted and
  // consumed it — otherwise switching tabs later would re-apply the stale id.
  useEffect(() => {
    if (!pendingScenarioForDashboard) return;
    if (activeTab !== `dashboard-${pendingScenarioForDashboard.dashboardId}`) return;
    const handle = setTimeout(() => setPendingScenarioForDashboard(null), 0);
    return () => clearTimeout(handle);
  }, [activeTab, pendingScenarioForDashboard]);

  const handleSelectModel = useCallback((id) => {
    setSelectedModelId(id);
    if (id) setActiveTab(AGENT_WORKSPACE_TAB);
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

  const deleteDashMut = useDeleteDashboard(selectedModelId);

  const handleDeleteDashboard = useCallback((dashId) => {
    deleteDashMut.mutate(dashId);
    if (activeTab === `dashboard-${dashId}`) {
      setActiveTab('schema');
    }
  }, [deleteDashMut, activeTab]);

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

    // Agent Workspace — full-screen takeover. Rendered inside main so the
    // sidebar rail (and the rest of the app chrome) stays put.
    if (activeTab === AGENT_WORKSPACE_TAB) {
      return (
        <AgentWorkspace
          modelId={selectedModelId}
          dashboards={dashboards}
          onExit={() => setActiveTab(dashboards?.[0] ? `dashboard-${dashboards[0].id}` : 'schema')}
          onOpenDashboard={(dashboardId, scenarioId) => {
            if (!dashboardId) return;
            if (scenarioId) {
              setPendingScenarioForDashboard({ dashboardId, scenarioId });
            }
            setActiveTab(`dashboard-${dashboardId}`);
          }}
        />
      );
    }

    // Dashboard tab
    if (activeTab.startsWith('dashboard-')) {
      const dashboardId = activeTab.replace('dashboard-', '');
      const initialScenarioId =
        pendingScenarioForDashboard?.dashboardId === dashboardId
          ? pendingScenarioForDashboard.scenarioId
          : undefined;
      return (
        <DashboardView
          key={dashboardId}
          dashboardId={dashboardId}
          modelId={selectedModelId}
          initialScenarioId={initialScenarioId}
        />
      );
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
        dashboards={dashboards}
        onCreateDashboard={() => setShowCreateDashboardModal(true)}
        onDeleteDashboard={handleDeleteDashboard}
        expanded={sidebarExpanded}
        onExpandedChange={setSidebarExpanded}
      />

      {/* Main content — chat floats on top, so no right margin push. Sidebar
          is collapsed by default; we reserve the collapsed width (60px) so
          the main content doesn't reflow when hovering expands the sidebar
          (it overlays). */}
      <main
        style={{
          flex: 1,
          marginLeft: SIDEBAR_COLLAPSED_W,
          minHeight: '100vh',
          overflowX: 'hidden',
        }}
      >
        {renderContent()}
      </main>

      {/* Chat panel — hidden in Agent Workspace (it IS the chat). */}
      {chatOpen && selectedModelId && activeTab !== AGENT_WORKSPACE_TAB && (
        <ChatPanel
          modelId={selectedModelId}
          onClose={() => setChatOpen(false)}
          mode={MODELLING_TABS.has(activeTab) ? 'data' : 'scenario'}
          onExpand={
            MODELLING_TABS.has(activeTab)
              ? undefined
              : () => {
                  setChatOpen(false);
                  setActiveTab(AGENT_WORKSPACE_TAB);
                }
          }
        />
      )}

      {/* Floating chat FAB — hidden in Agent Workspace */}
      {selectedModelId && !chatOpen && activeTab !== AGENT_WORKSPACE_TAB && (
        <button
          onClick={() => setChatOpen(true)}
          title="Open AI Chat"
          style={{
            position: 'fixed',
            bottom: spacing.xl,
            right: spacing.xl,
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${colors.primary}, #7c3aed)`,
            border: 'none',
            boxShadow: shadows.xl,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: 24,
            fontFamily: typography.fontFamily,
            zIndex: 500,
            transition: transitions.fast,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
        >
          {'\u{1F4AC}'}
        </button>
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
