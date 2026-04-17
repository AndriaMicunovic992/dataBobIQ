import { useCallback } from 'react';
import { colors, spacing, typography } from '../../theme.js';
import { useWorkspaceTabs } from '../../hooks/useWorkspaceTabs.js';
import ThreadTabs from './ThreadTabs.jsx';
import HomeView from './HomeView.jsx';
import ConversationPane from './ConversationPane.jsx';
import Canvas from './Canvas.jsx';
import PromptBar from './PromptBar.jsx';

export default function AgentWorkspace({ modelId, dashboards, onExit, onOpenDashboard }) {
  const {
    tabs, activeId, setActiveId,
    openThread, closeTab, updateTab, renameTab,
  } = useWorkspaceTabs(modelId);

  const activeTab = tabs.find((t) => t.id === activeId) || tabs[0];

  const recentQuestions = tabs
    .filter((t) => t.kind === 'thread')
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .flatMap((t) =>
      (t.messages || [])
        .filter((m) => m.role === 'user')
        .map((m) => m.content)
    )
    .filter(Boolean)
    .filter((q, i, arr) => arr.indexOf(q) === i)
    .slice(0, 6);

  const handleOpenThread = useCallback((init) => {
    openThread(init);
  }, [openThread]);

  const handleHomePrompt = useCallback((text) => {
    handleOpenThread({
      title: text.length > 40 ? `${text.slice(0, 40)}…` : text,
      scenarioIds: [],
      seedMessage: text,
    });
  }, [handleOpenThread]);

  const handleRemoveArtifact = useCallback((tabId, artifactId) => {
    updateTab(tabId, (t) => ({
      artifacts: (t.artifacts || []).filter((a) => a.id !== artifactId),
    }));
  }, [updateTab]);

  const handleUpdateArtifact = useCallback((tabId, artifactId, updates) => {
    updateTab(tabId, (t) => ({
      artifacts: (t.artifacts || []).map((a) =>
        a.id === artifactId ? { ...a, ...updates } : a
      ),
    }));
  }, [updateTab]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100vh', minHeight: 0,
      background: colors.bgMain,
      fontFamily: typography.fontFamily,
    }}>
      <ThreadTabs
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={closeTab}
        onRename={renameTab}
        onExit={onExit}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {activeTab?.kind === 'home' ? (
          <>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <HomeView
                modelId={modelId}
                dashboards={dashboards}
                onOpenThread={handleOpenThread}
                onOpenDashboard={onOpenDashboard}
                recentQuestions={recentQuestions}
              />
            </div>
            <PromptBar
              placeholder="Ask a question about your scenarios..."
              onSubmit={handleHomePrompt}
            />
          </>
        ) : (
          <ThreadLayout
            tab={activeTab}
            modelId={modelId}
            onUpdateTab={updateTab}
            onRemoveArtifact={(artifactId) => handleRemoveArtifact(activeTab.id, artifactId)}
            onUpdateArtifact={(artifactId, updates) => handleUpdateArtifact(activeTab.id, artifactId, updates)}
          />
        )}
      </div>
    </div>
  );
}

function ThreadLayout({ tab, modelId, onUpdateTab, onRemoveArtifact, onUpdateArtifact }) {
  return (
    <div style={{
      flex: 1, minHeight: 0,
      display: 'grid',
      gridTemplateColumns: '360px 1fr',
      overflow: 'hidden',
    }}>
      <ConversationPane
        tab={tab}
        modelId={modelId}
        onUpdateTab={onUpdateTab}
      />
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div style={{
          padding: `${spacing.sm}px ${spacing.xl}px`,
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgCard,
          fontSize: typography.fontSizes.sm,
          color: colors.textSecondary,
          fontFamily: typography.fontFamily,
          flexShrink: 0,
        }}>
          Canvas · {tab.title}
        </div>
        <Canvas
          tab={tab}
          onRemoveArtifact={onRemoveArtifact}
          onUpdateArtifact={onUpdateArtifact}
        />
      </div>
    </div>
  );
}
