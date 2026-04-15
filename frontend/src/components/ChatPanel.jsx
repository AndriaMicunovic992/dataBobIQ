import React, { useState, useRef, useEffect, useCallback } from 'react';
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

export default function ChatPanel({ modelId, onClose }) {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      parts: [{ type: 'text', content: "Hi! I'm Bob, your CFO companion. Ask me to explore your data, explain trends, build KPIs, or create what-if scenarios.\n\nTry: \"What are the top 5 expense categories?\" or \"Create a scenario with revenue up 10%\"" }],
    },
  ]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [mode, setMode] = useState('data'); // 'data' | 'scenario'
  const messagesEndRef = useRef(null);
  const stopRef = useRef(null);

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
  }, [input, streaming, messages, modelId, mode]);

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
    setMessages([messages[0]]);
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
            Bob AI
          </div>
          <div style={{ color: colors.sidebarText, fontSize: typography.fontSizes.xs, fontFamily: typography.fontFamily }}>
            CFO Companion · {streaming ? 'Thinking...' : 'Ready'}
          </div>
        </div>
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

      {/* Mode selector */}
      <div style={{ padding: `${spacing.xs}px ${spacing.md}px`, background: colors.bgMuted, borderBottom: `1px solid ${colors.border}`, display: 'flex', gap: spacing.xs, alignItems: 'center' }}>
        <span style={{ fontSize: typography.fontSizes.xs, color: colors.textMuted, fontFamily: typography.fontFamily }}>Mode:</span>
        {['data', 'scenario'].map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{
              padding: `2px ${spacing.sm}px`, borderRadius: radius.full,
              border: `1px solid ${mode === m ? colors.primary : colors.border}`,
              background: mode === m ? colors.primaryLight : 'transparent',
              color: mode === m ? colors.primary : colors.textSecondary,
              fontFamily: typography.fontFamily, fontSize: typography.fontSizes.xs,
              fontWeight: typography.fontWeights.medium, cursor: 'pointer', textTransform: 'capitalize',
            }}
          >
            {m}
          </button>
        ))}
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
