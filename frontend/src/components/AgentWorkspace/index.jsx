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
 *
 * Props:
 *   - modelId: required, selected model
 *   - onExit: called when the user clicks the workspace's exit chip
 *   - onOpenDashboard: bubble-up to the app shell when the user jumps
 *     from a scenario card to its dashboard (parent decides how to route).
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

  // Home-level prompt: any freeform question seeds a new thread.
  const handleHomePrompt = useCallback((text) => {
    handleOpenThread({
      title: text.length > 40 ? `${text.slice(0, 40)}…` : text,
      scenarioIds: [],
      seedMessage: text,
    });
  }, [handleOpenThread]);

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
              placeholder="Ask Bob about your scenarios..."
              onSubmit={handleHomePrompt}
            />
          </>
        ) : (
          <ThreadLayout
            tab={activeTab}
            modelId={modelId}
            onUpdateTab={updateTab}
          />
        )}
      </div>
    </div>
  );
}

function ThreadLayout({ tab, modelId, onUpdateTab }) {
  // 360px narrow chat column + flex canvas.
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
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{
          padding: `${spacing.sm}px ${spacing.xl}px`,
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgCard,
          fontSize: typography.fontSizes.sm,
          color: colors.textSecondary,
          fontFamily: typography.fontFamily,
        }}>
          Canvas · {tab.title}
        </div>
        <Canvas tab={tab} />
      </div>
    </div>
  );
}
