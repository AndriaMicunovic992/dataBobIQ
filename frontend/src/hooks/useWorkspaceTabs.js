import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Per-model tab state for the Agent Workspace.
 *
 * Tabs are either the always-present "home" tab or a thread tab that owns
 * its own conversation and canvas state. Tabs persist in sessionStorage for
 * 24h so reloading the page doesn't wipe an in-progress question — but no
 * backend round-trip is involved yet (that's a Phase 2 upgrade).
 *
 * Tab shape:
 *   { id, kind: 'home' | 'thread', title, scenarioIds?, messages?, createdAt }
 */

const HOME_TAB = Object.freeze({
  id: 'home',
  kind: 'home',
  title: 'Home',
  createdAt: 0,
});

const STORAGE_PREFIX = 'databobiq:agent-workspace:';
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function storageKey(modelId) {
  return `${STORAGE_PREFIX}${modelId}`;
}

function loadState(modelId) {
  if (!modelId || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(modelId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveState(modelId, tabs, activeId) {
  if (!modelId || typeof window === 'undefined') return;
  try {
    const payload = {
      savedAt: Date.now(),
      tabs: tabs.filter((t) => t.kind !== 'home'), // home is always rebuilt
      activeId,
    };
    window.sessionStorage.setItem(storageKey(modelId), JSON.stringify(payload));
  } catch {
    // Quota exceeded or private mode — silently drop.
  }
}

export function useWorkspaceTabs(modelId) {
  const [tabs, setTabs] = useState([HOME_TAB]);
  const [activeId, setActiveId] = useState('home');
  const hydratedFor = useRef(null);

  // Hydrate from sessionStorage when the model changes.
  useEffect(() => {
    if (!modelId) return;
    if (hydratedFor.current === modelId) return;
    hydratedFor.current = modelId;
    const saved = loadState(modelId);
    if (saved?.tabs?.length) {
      setTabs([HOME_TAB, ...saved.tabs]);
      setActiveId(saved.activeId || 'home');
    } else {
      setTabs([HOME_TAB]);
      setActiveId('home');
    }
  }, [modelId]);

  // Persist whenever tabs change.
  useEffect(() => {
    if (!modelId) return;
    if (hydratedFor.current !== modelId) return;
    saveState(modelId, tabs, activeId);
  }, [modelId, tabs, activeId]);

  const openThread = useCallback((init) => {
    // init: { title, scenarioIds, seedMessage? }
    const id = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tab = {
      id,
      kind: 'thread',
      title: init.title || 'New conversation',
      scenarioIds: init.scenarioIds || [],
      messages: init.seedMessage
        ? [{ id: `user-${Date.now()}`, role: 'user', content: init.seedMessage }]
        : [],
      pendingSeed: init.seedMessage || null,
      createdAt: Date.now(),
    };
    setTabs((prev) => [...prev, tab]);
    setActiveId(id);
    return id;
  }, []);

  const closeTab = useCallback((id) => {
    if (id === 'home') return;
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      return next.length ? next : [HOME_TAB];
    });
    setActiveId((prev) => (prev === id ? 'home' : prev));
  }, []);

  const updateTab = useCallback((id, updater) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...(typeof updater === 'function' ? updater(t) : updater) } : t))
    );
  }, []);

  const renameTab = useCallback((id, title) => {
    updateTab(id, { title });
  }, [updateTab]);

  return {
    tabs,
    activeId,
    setActiveId,
    openThread,
    closeTab,
    updateTab,
    renameTab,
  };
}
