import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { streamChat } from '../api.js';
import { colors, spacing, radius, typography, shadows, transitions, inputStyle } from '../theme.js';
import { Button } from './common/Button.jsx';
import { Badge } from './common/Badge.jsx';

function UserBubble({ message }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: spacing.md }}>
      <div style={{
        maxWidth: '80%', background: colors.primary, color: 'white',
        borderRadius: `${radius.lg}px ${radius.lg}px ${radius.sm}px ${radius.lg}px`,
        padding: `${spacing.sm}px ${spacing.md}px`,
        fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm, lineHeight: 1.6,
      }}>
        {message.content}
      </div>
    </div>
  );
}

function AssistantBubble({ message }) {
  const parts = message.parts || [{ type: 'text', content: message.content }];

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: spacing.md, gap: spacing.sm }}>
      {/* Avatar */}
      <div style={{
        width: 28, height: 28, borderRadius: radius.full,
        background: `linear-gradient(135deg, ${colors.primary}, #7c3aed)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, color: 'white', fontWeight: 700, flexShrink: 0, marginTop: 2,
      }}>
        B
      </div>
      <div style={{ maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
        {parts.map((part, i) => {
          if (part.type === 'tool_use') {
            return <ToolCallIndicator key={i} tool={part} />;
          }
          if (part.type === 'tool_result') {
            return <ToolResultIndicator key={i} result={part} />;
          }
          return (
            <div
              key={i}
              style={{
                background: colors.bgCard, borderRadius: `${radius.sm}px ${radius.lg}px ${radius.lg}px ${radius.lg}px`,
                border: `1px solid ${colors.border}`,
                padding: `${spacing.sm}px ${spacing.md}px`,
                fontFamily: typography.fontFamily, fontSize: typography.fontSizes.sm,
                color: colors.textPrimary, lineHeight: 1.7, whiteSpace: 'pre-wrap',
                boxShadow: shadows.sm,
              }}
            >
              {part.content || (typeof part === 'string' ? part : '')}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolCallIndicator({ tool }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        background: '#f5f3ff', border: `1px solid #ddd6fe`, borderRadius: radius.md,
        padding: `${spacing.xs}px ${spacing.sm}px`, cursor: 'pointer',
      }}
      onClick={() => setExpanded((v) => !v)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
        <span style={{ fontSize: 12, color: '#7c3aed' }}>⚙</span>
        <span style={{ fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium, color: '#7c3aed', fontFamily: typography.fontFamily }}>
          Tool: {tool.name}
        </span>
        <span style={{ fontSize: 10, color: '#a78bfa', marginLeft: 'auto' }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && tool.input && (
        <pre style={{
          margin: `${spacing.xs}px 0 0`, fontSize: 11, color: '#6d28d9',
          fontFamily: 'monospace', overflowX: 'auto',
          background: '#ede9fe', borderRadius: radius.sm,
          padding: spacing.xs,
        }}>
          {JSON.stringify(tool.input, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ToolResultIndicator({ result }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = result.content && result.content !== '';
  return (
    <div
      style={{
        background: '#f0fdf4', border: `1px solid #bbf7d0`, borderRadius: radius.md,
        padding: `${spacing.xs}px ${spacing.sm}px`, cursor: hasData ? 'pointer' : 'default',
      }}
      onClick={() => hasData && setExpanded((v) => !v)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
        <span style={{ fontSize: 12, color: colors.success }}>✓</span>
        <span style={{ fontSize: typography.fontSizes.xs, fontWeight: typography.fontWeights.medium, color: '#065f46', fontFamily: typography.fontFamily }}>
          {result.name || 'Tool result'}
        </span>
        {hasData && <span style={{ fontSize: 10, color: '#6ee7b7', marginLeft: 'auto' }}>{expanded ? '▲' : '▼'}</span>}
      </div>
      {expanded && result.content && (
        <pre style={{
          margin: `${spacing.xs}px 0 0`, fontSize: 11, color: '#065f46',
          fontFamily: 'monospace', overflowX: 'auto',
          background: '#dcfce7', borderRadius: radius.sm, padding: spacing.xs,
          maxHeight: 200, overflowY: 'auto',
        }}>
          {typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: spacing.md, gap: spacing.sm, alignItems: 'center' }}>
      <div style={{
        width: 28, height: 28, borderRadius: radius.full,
        background: `linear-gradient(135deg, ${colors.primary}, #7c3aed)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, color: 'white', fontWeight: 700, flexShrink: 0,
      }}>
        B
      </div>
      <div style={{
        background: colors.bgCard, borderRadius: `${radius.sm}px ${radius.lg}px ${radius.lg}px ${radius.lg}px`,
        border: `1px solid ${colors.border}`, padding: `${spacing.sm}px ${spacing.md}px`,
        display: 'flex', alignItems: 'center', gap: spacing.xs,
      }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 6, height: 6, borderRadius: radius.full, background: colors.textMuted,
              animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      <style>{`@keyframes bounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }`}</style>
    </div>
  );
}

export default function ChatPanel({ modelId, onClose, mode = 'data', onExpand }) {
  // Mode is driven by the parent (App) based on the active tab:
  //   - MODELLING tabs (schema / knowledge) → 'data' (data agent)
  //   - Dashboard tabs                      → 'scenario' (scenario agent)
  // We re-key the welcome message whenever the mode changes so users see the
  // right persona without a manual toggle.
  const qc = useQueryClient();
  const welcomeByMode = {
    data: "Hi! I'm Bob, your data agent. Ask me to map columns, build KPIs, define knowledge, or explore your model.\n\nTry: \"What are the top 5 expense categories?\" or \"Classify the uploaded GL file\"",
    scenario: "Hi! I'm Bob, your scenario agent. Ask me to build what-if scenarios, tweak rules, or compare forecasts to actuals.\n\nTry: \"Create a scenario with revenue up 10% for 2026\" or \"Compare scenario Q4 to actuals\"",
  };
  const [messages, setMessages] = useState([
    { id: 'welcome', role: 'assistant', parts: [{ type: 'text', content: welcomeByMode[mode] }] },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef(null);
  const stopRef = useRef(null);

  // Swap the welcome message when the mode flips (e.g. user switches tabs
  // while the chat is open) — but only if the chat is still untouched.
  useEffect(() => {
    setMessages((prev) => {
      if (prev.length !== 1 || prev[0].id !== 'welcome') return prev;
      return [{ id: 'welcome', role: 'assistant', parts: [{ type: 'text', content: welcomeByMode[mode] }] }];
    });
    // welcomeByMode is a local constant — eslint-safe to exclude
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Floating window position (bottom-right by default) and drag state.
  const panelWidth = 400;
  const panelHeight = 560;
  const [pos, setPos] = useState(() => ({
    x: Math.max(16, (typeof window !== 'undefined' ? window.innerWidth : 1200) - panelWidth - 32),
    y: Math.max(16, (typeof window !== 'undefined' ? window.innerHeight : 800) - panelHeight - 32),
  }));
  const dragRef = useRef(null); // { startX, startY, origX, origY }

  const handleDragStart = (e) => {
    // Ignore if the user clicked a button/textarea inside the header.
    if (e.target.closest('button') || e.target.closest('textarea')) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      origX: pos.x, origY: pos.y,
    };
  };

  useEffect(() => {
    const handleMove = (e) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const maxX = window.innerWidth - panelWidth;
      const maxY = window.innerHeight - 60;
      setPos({
        x: Math.max(0, Math.min(maxX, dragRef.current.origX + dx)),
        y: Math.max(0, Math.min(maxY, dragRef.current.origY + dy)),
      });
    };
    const handleUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');

    const userMsg = { id: Date.now(), role: 'user', content: text };
    const assistantId = Date.now() + 1;
    const assistantMsg = { id: assistantId, role: 'assistant', parts: [], streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    const history = messages.map((m) => ({
      role: m.role,
      content: m.content || m.parts?.map((p) => p.content || '').join('') || '',
    }));

    const stop = streamChat(
      modelId,
      { message: text, history, mode },
      (event) => {
        if (event.type === 'text' || event.type === 'delta') {
          setMessages((prev) => prev.map((m) => {
            if (m.id !== assistantId) return m;
            const parts = [...(m.parts || [])];
            const lastPart = parts[parts.length - 1];
            if (lastPart && lastPart.type === 'text') {
              parts[parts.length - 1] = { ...lastPart, content: lastPart.content + (event.text || event.delta || '') };
            } else {
              parts.push({ type: 'text', content: event.text || event.delta || '' });
            }
            return { ...m, parts };
          }));
        } else if (event.type === 'tool_use') {
          setMessages((prev) => prev.map((m) => {
            if (m.id !== assistantId) return m;
            return { ...m, parts: [...(m.parts || []), { type: 'tool_use', name: event.name, input: event.input }] };
          }));
        } else if (event.type === 'tool_result') {
          setMessages((prev) => prev.map((m) => {
            if (m.id !== assistantId) return m;
            return { ...m, parts: [...(m.parts || []), { type: 'tool_result', name: event.name, content: event.content }] };
          }));
        } else if (event.type === 'scenario_created') {
          // Make the new scenario appear in lists / selectors without forcing
          // the user to leave the current tab. We invalidate the scenario
          // queries so React Query refetches them in the background — the
          // user's current view and state stay put.
          qc.invalidateQueries({ queryKey: ['scenarios', modelId] });
          qc.invalidateQueries({ queryKey: ['scenario'] });
          setMessages((prev) => prev.map((m) => {
            if (m.id !== assistantId) return m;
            return { ...m, parts: [...(m.parts || []), { type: 'tool_result', name: 'scenario_created', content: `Scenario created: ${event.name}` }] };
          }));
        } else if (event.type === 'done' || event.type === 'error') {
          setStreaming(false);
          if (event.type === 'error') {
            setMessages((prev) => prev.map((m) => {
              if (m.id !== assistantId) return m;
              const parts = [...(m.parts || [])];
              parts.push({ type: 'text', content: `\n\nError: ${event.data}` });
              return { ...m, parts, streaming: false };
            }));
          } else {
            setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, streaming: false } : m));
          }
        }
      }
    );

    stopRef.current = stop;
  }, [input, streaming, messages, modelId, mode, qc]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleStop = () => {
    if (stopRef.current) stopRef.current();
    setStreaming(false);
  };

  const clearChat = () => {
    setMessages([{ id: 'welcome', role: 'assistant', parts: [{ type: 'text', content: welcomeByMode[mode] }] }]);
  };

  const isThinking = streaming && messages[messages.length - 1]?.parts?.length === 0;

  return (
    <div style={{
      position: 'fixed',
      left: pos.x, top: pos.y,
      width: panelWidth, height: panelHeight,
      background: colors.bgCard,
      border: `1px solid ${colors.border}`,
      borderRadius: radius.lg,
      boxShadow: shadows.xl, zIndex: 1000,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header — draggable handle */}
      <div
        onMouseDown={handleDragStart}
        style={{
          padding: `${spacing.md}px ${spacing.md}px`,
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', gap: spacing.sm,
          background: colors.sidebar,
          cursor: 'grab', userSelect: 'none',
        }}>
        <div style={{
          width: 32, height: 32, borderRadius: radius.full,
          background: `linear-gradient(135deg, ${colors.primary}, #7c3aed)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: 'white', fontWeight: 700, flexShrink: 0,
        }}>
          B
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'white', fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.md, fontFamily: typography.fontFamily }}>
            Bob AI · {mode === 'scenario' ? 'Scenario Agent' : 'Data Agent'}
          </div>
          <div style={{ color: colors.sidebarText, fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily }}>
            {streaming ? 'Thinking...' : 'Ready'}
          </div>
        </div>
        {onExpand && (
          <button
            onClick={onExpand}
            title="Expand to Agent Workspace"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.sidebarText, fontSize: 16, fontFamily: typography.fontFamily, padding: `0 ${spacing.xs}px`, lineHeight: 1 }}
          >
            ⤢
          </button>
        )}
        <button
          onClick={clearChat}
          title="Clear chat"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.sidebarText, fontSize: 12, fontFamily: typography.fontFamily }}
        >
          Clear
        </button>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.sidebarText, fontSize: 20, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: `${spacing.md}px` }}>
        {messages.map((msg) => (
          msg.role === 'user'
            ? <UserBubble key={msg.id} message={msg} />
            : <AssistantBubble key={msg.id} message={msg} />
        ))}
        {isThinking && <ThinkingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={{ padding: spacing.md, borderTop: `1px solid ${colors.border}`, background: colors.bgCard }}>
        <div style={{ position: 'relative' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your data..."
            disabled={streaming}
            style={{
              ...inputStyle,
              height: 80, resize: 'none', paddingRight: 48,
              lineHeight: 1.5, borderRadius: radius.lg,
            }}
          />
          <div style={{ position: 'absolute', bottom: spacing.sm, right: spacing.sm }}>
            {streaming ? (
              <Button variant="danger" size="sm" onClick={handleStop}>■ Stop</Button>
            ) : (
              <Button variant="primary" size="sm" disabled={!input.trim()} onClick={sendMessage}>
                ↑
              </Button>
            )}
          </div>
        </div>
        <p style={{ margin: `${spacing.xs}px 0 0`, fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
