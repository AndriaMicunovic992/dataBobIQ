import { useCallback } from 'react';
import { colors, spacing, typography } from '../../theme.js';
import { useWorkspaceTabs } from '../../hooks/useWorkspaceTabs.js';
import ThreadTabs from './ThreadTabs.jsx';
import HomeView from './HomeView.jsx';
import ConversationPane from './ConversationPane.jsx';
import Canvas from './Canvas.jsx';
import PromptBar from './PromptBar.jsx';

/**
 * Full-screen Agent Workspace route. Owns tab state via `useWorkspaceTabs`
 * (persisted in sessionStorage for 24h), and routes rendering between the
 * Home cockpit and thread-specific Conversation+Canvas layouts.
 */
export default function AgentWorkspace({ modelId, onExit, onOpenDashboard }) {
  const {
    tabs, activeId, setActiveId,
    openThread, closeTab, updateTab,
  } = useWorkspaceTabs(modelId);

  const activeTab = tabs.find((t) => t.id === activeId) || tabs[0];

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
        onExit={onExit}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {activeTab?.kind === 'home' ? (
          <>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <HomeView
                modelId={modelId}
                onOpenThread={handleOpenThread}
                onOpenDashboard={onOpenDashboard}
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
          />
        )}
      </div>
    </div>
  );
}

function ThreadLayout({ tab, modelId, onUpdateTab, onRemoveArtifact }) {
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
        <Canvas tab={tab} onRemoveArtifact={onRemoveArtifact} />
      </div>
    </div>
  );
}
