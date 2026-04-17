import { useRef, useEffect, useState, useCallback, memo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { streamChat } from '../../api.js';
import { colors, spacing, radius, typography, shadows } from '../../theme.js';
import PromptBar from './PromptBar.jsx';
import StructuredMessage, { parseStructured } from './StructuredMessage.jsx';

const ARTIFACT_TOOLS = new Set([
  'query_data',
  'compare_scenarios',
  'get_kpi_values',
  'create_scenario',
]);

const ARTIFACT_TITLES = {
  query_data: 'Query Result',
  compare_scenarios: 'Scenario Comparison',
  get_kpi_values: 'KPI Values',
  create_scenario: 'Scenario Created',
};

function tryParseContent(content) {
  if (typeof content !== 'string') return content;
  try { return JSON.parse(content); } catch { return content; }
}

function makeArtifact(toolName, content) {
  const parsed = tryParseContent(content);
  return {
    id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: ARTIFACT_TITLES[toolName] || toolName,
    subtitle: toolName,
    content: parsed,
  };
}

const UserBubble = memo(function UserBubble({ message }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: spacing.sm }}>
      <div style={{
        maxWidth: '90%', background: colors.primary, color: 'white',
        borderRadius: `${radius.lg}px ${radius.lg}px ${radius.sm}px ${radius.lg}px`,
        padding: `${spacing.sm}px ${spacing.md}px`,
        fontFamily: typography.fontFamily,
        fontSize: typography.fontSizes.sm, lineHeight: 1.6,
        wordBreak: 'break-word',
      }}>
        {message.content}
      </div>
    </div>
  );
});

function ExpandableToolResult({ part }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = part.content && part.content !== '' && part.content !== '""';
  return (
    <div
      style={{
        fontSize: typography.fontSizes.xs,
        color: '#065f46', fontFamily: typography.fontFamily,
        background: '#f0fdf4', border: `1px solid #bbf7d0`,
        borderRadius: radius.md, padding: `${spacing.xs}px ${spacing.sm}px`,
        cursor: hasContent ? 'pointer' : 'default',
      }}
      onClick={() => hasContent && setExpanded((v) => !v)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
        <span>✓ {part.name || 'result'}</span>
        {hasContent && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#6ee7b7' }}>{expanded ? '▲' : '▼'}</span>}
      </div>
      {expanded && hasContent && (
        <pre style={{
          margin: `${spacing.xs}px 0 0`, fontSize: 10, color: '#065f46',
          fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          background: '#dcfce7', borderRadius: radius.sm, padding: spacing.xs,
          maxHeight: 200, overflowY: 'auto',
        }}>
          {typeof part.content === 'string' ? part.content : JSON.stringify(part.content, null, 2)}
        </pre>
      )}
    </div>
  );
}

function PinToCanvasButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      title="Pin to canvas"
      style={{
        position: 'absolute', top: 4, right: 4,
        background: 'none', border: `1px solid transparent`,
        borderRadius: radius.sm, padding: '2px 5px',
        fontSize: 11, cursor: 'pointer',
        color: colors.textMuted, opacity: 0,
        transition: 'opacity 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.color = colors.primary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'transparent';
        e.currentTarget.style.color = colors.textMuted;
      }}
    >
      ⧉
    </button>
  );
}

const AssistantBubble = memo(function AssistantBubble({ message, onPinToCanvas }) {
  const parts = message.parts || [{ type: 'text', content: message.content || '' }];
  const textParts = parts.filter((p) => p.type === 'text' && p.content?.trim());

  const handlePin = () => {
    if (!onPinToCanvas || textParts.length === 0) return;
    const fullText = textParts.map((p) => p.content).join('\n\n');
    const title = fullText.slice(0, 50).replace(/[#*_\n]/g, '').trim();
    onPinToCanvas({
      id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title.length < fullText.length ? `${title}…` : title,
      subtitle: 'Analysis',
      type: 'markdown',
      content: fullText,
    });
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: spacing.sm, gap: spacing.xs }}>
      <div style={{
        width: 24, height: 24, borderRadius: radius.full,
        background: `linear-gradient(135deg, ${colors.primary}, #7c3aed)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: 'white', fontWeight: 700, flexShrink: 0, marginTop: 2,
      }}>
        B
      </div>
      <div style={{ maxWidth: '88%', display: 'flex', flexDirection: 'column', gap: spacing.xs }}>
        {parts.map((part, i) => {
          if (part.type === 'tool_use') {
            return (
              <div key={i} style={{
                fontSize: typography.fontSizes.xs,
                color: '#7c3aed', fontFamily: typography.fontFamily,
                background: '#f5f3ff', border: `1px solid #ddd6fe`,
                borderRadius: radius.md, padding: `${spacing.xs}px ${spacing.sm}px`,
              }}>
                ⚙ {part.name}
              </div>
            );
          }
          if (part.type === 'tool_result') {
            return <ExpandableToolResult key={i} part={part} />;
          }
          return (
            <div key={i} className="assistant-text-bubble" style={{
              position: 'relative',
              background: colors.bgCard,
              borderRadius: `${radius.sm}px ${radius.lg}px ${radius.lg}px ${radius.lg}px`,
              border: `1px solid ${colors.border}`,
              padding: `${spacing.sm}px ${spacing.md}px`,
              fontFamily: typography.fontFamily,
              fontSize: typography.fontSizes.sm,
              color: colors.textPrimary, lineHeight: 1.6,
              boxShadow: shadows.sm, wordBreak: 'break-word',
            }}
            onMouseEnter={(e) => {
              const btn = e.currentTarget.querySelector('button');
              if (btn) btn.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget.querySelector('button');
              if (btn) btn.style.opacity = '0';
            }}
            >
              <StructuredMessage text={part.content || ''} variant="chat" />
              {!message.streaming && textParts.length > 0 && (
                <PinToCanvasButton onClick={handlePin} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function ThinkingIndicator() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: spacing.xs,
      marginBottom: spacing.sm, marginLeft: 32,
      color: colors.textMuted, fontSize: typography.fontSizes.xs,
      fontFamily: typography.fontFamily,
    }}>
      Bob is thinking…
    </div>
  );
}

/**
 * Streaming architecture: during an active stream the assistant message lives
 * in a local ref (streamingMsgRef) — NOT in tab.messages. A throttled render
 * tick (~10 fps) drives UI updates. Only ConversationPane re-renders during
 * streaming; Canvas, ThreadTabs, and the rest of the workspace stay frozen.
 * On stream completion the final message is committed to tab.messages in a
 * single onUpdateTab call.
 */
export default function ConversationPane({ tab, modelId, onUpdateTab }) {
  const qc = useQueryClient();
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef(null);
  const stopRef = useRef(null);
  const pendingArtifactRef = useRef(null);
  const turnTextRef = useRef('');
  const hadToolRef = useRef(false);

  const streamingMsgRef = useRef(null);
  const [renderTick, setRenderTick] = useState(0);
  const tickTimerRef = useRef(null);

  const messages = tab.messages || [];

  const scheduleRender = useCallback(() => {
    if (tickTimerRef.current) return;
    tickTimerRef.current = setTimeout(() => {
      tickTimerRef.current = null;
      setRenderTick((t) => t + 1);
    }, 100);
  }, []);

  const displayMessages = (() => {
    if (!streamingMsgRef.current) return messages;
    const s = streamingMsgRef.current;
    return [...messages, { ...s, parts: [...s.parts] }];
  })();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, renderTick]);

  useEffect(() => {
    return () => {
      if (tickTimerRef.current) clearTimeout(tickTimerRef.current);
    };
  }, []);

  const makeHandler = (assistantId) => {
    return (event) => {
      if (event.type === 'text' || event.type === 'delta') {
        const chunk = event.text || event.delta || '';
        turnTextRef.current += chunk;
        const msg = streamingMsgRef.current;
        if (!msg) return;
        const last = msg.parts[msg.parts.length - 1];
        if (last && last.type === 'text') {
          last.content += chunk;
        } else {
          msg.parts.push({ type: 'text', content: chunk });
        }
        scheduleRender();

      } else if (event.type === 'tool_use') {
        hadToolRef.current = true;
        turnTextRef.current = '';
        const msg = streamingMsgRef.current;
        if (msg) msg.parts.push({ type: 'tool_use', name: event.name, input: event.input });
        scheduleRender();

      } else if (event.type === 'tool_result') {
        let displayContent = event.content;
        if (typeof displayContent === 'string' && displayContent.length > 500) {
          displayContent = displayContent.slice(0, 500) + '\n… (truncated for display)';
        }
        const msg = streamingMsgRef.current;
        if (msg) msg.parts.push({ type: 'tool_result', name: event.name, content: displayContent });
        if (ARTIFACT_TOOLS.has(event.name) && event.content) {
          pendingArtifactRef.current = makeArtifact(event.name, event.content);
        }
        scheduleRender();

      } else if (event.type === 'scenario_created') {
        qc.invalidateQueries({ queryKey: ['scenarios', modelId] });
        qc.invalidateQueries({ queryKey: ['scenario-summaries', modelId] });

      } else if (event.type === 'done' || event.type === 'error') {
        if (tickTimerRef.current) {
          clearTimeout(tickTimerRef.current);
          tickTimerRef.current = null;
        }

        setStreaming(false);
        const finalMsg = streamingMsgRef.current;
        streamingMsgRef.current = null;

        const toolArtifact = pendingArtifactRef.current;
        pendingArtifactRef.current = null;
        const finalText = turnTextRef.current.trim();
        const hadTool = hadToolRef.current;
        turnTextRef.current = '';
        hadToolRef.current = false;

        let artifact = null;
        if (hadTool && finalText.length > 80) {
          const parsed = parseStructured(finalText);
          let title = 'Analysis';
          if (parsed.output) {
            const firstLine = parsed.output.split('\n').find(
              (l) => l.trim() && !l.trim().startsWith('|') && !l.trim().startsWith('-')
            );
            if (firstLine) title = firstLine.replace(/[#*_]/g, '').trim().slice(0, 50);
          } else if (parsed.plain) {
            title = parsed.plain.slice(0, 50).replace(/[#*_\n]/g, '').trim();
          }
          artifact = {
            id: `art-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: title || 'Analysis',
            subtitle: 'Analysis',
            type: 'markdown',
            content: finalText,
          };
        } else if (toolArtifact) {
          artifact = toolArtifact;
        }

        if (finalMsg) {
          const committedParts = event.type === 'error'
            ? [...finalMsg.parts, { type: 'text', content: `\n\nError: ${event.data}` }]
            : [...finalMsg.parts];
          const committedMsg = { ...finalMsg, parts: committedParts, streaming: false };

          onUpdateTab(tab.id, (t) => {
            const updated = { messages: [...(t.messages || []), committedMsg] };
            if (artifact) updated.artifacts = [...(t.artifacts || []), artifact];
            return updated;
          });
        }

        setRenderTick((t) => t + 1);
      }
    };
  };

  const sendMessage = useCallback((text) => {
    if (!text || streaming || !modelId) return;

    turnTextRef.current = '';
    hadToolRef.current = false;
    pendingArtifactRef.current = null;
    streamingMsgRef.current = null;
    if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null; }

    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: text };
    const assistantId = `a-${Date.now()}`;
    streamingMsgRef.current = { id: assistantId, role: 'assistant', parts: [], streaming: true };

    const history = messages.map((m) => ({
      role: m.role,
      content: m.content || (m.parts || [])
        .filter((p) => p.type === 'text')
        .map((p) => p.content || '')
        .join('\n') || '',
    }));

    onUpdateTab(tab.id, (t) => ({
      messages: [...(t.messages || []), userMsg],
      pendingSeed: null,
    }));
    setStreaming(true);

    const stop = streamChat(
      modelId,
      { message: text, history, mode: 'scenario' },
      makeHandler(assistantId),
    );
    stopRef.current = stop;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, modelId, messages, onUpdateTab, tab.id, qc]);

  const seedFiredRef = useRef(false);
  useEffect(() => {
    if (seedFiredRef.current) return;
    if (!tab.pendingSeed) return;
    seedFiredRef.current = true;
    turnTextRef.current = '';
    hadToolRef.current = false;
    pendingArtifactRef.current = null;
    streamingMsgRef.current = null;
    if (tickTimerRef.current) { clearTimeout(tickTimerRef.current); tickTimerRef.current = null; }

    const seedText = tab.pendingSeed;
    const assistantId = `a-${Date.now()}`;
    streamingMsgRef.current = { id: assistantId, role: 'assistant', parts: [], streaming: true };

    onUpdateTab(tab.id, (t) => ({ pendingSeed: null }));
    setStreaming(true);

    const history = (tab.messages || []).map((m) => ({
      role: m.role,
      content: m.content || (m.parts || [])
        .filter((p) => p.type === 'text')
        .map((p) => p.content || '')
        .join('\n') || '',
    }));
    const trimmedHistory = history.slice(0, -1);

    const stop = streamChat(
      modelId,
      { message: seedText, history: trimmedHistory, mode: 'scenario' },
      makeHandler(assistantId),
    );
    stopRef.current = stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  const pinToCanvas = useCallback((artifact) => {
    onUpdateTab(tab.id, (t) => ({
      artifacts: [...(t.artifacts || []), artifact],
    }));
  }, [onUpdateTab, tab.id]);

  const lastDisplayMsg = displayMessages[displayMessages.length - 1];
  const isThinking = streaming && lastDisplayMsg?.role === 'assistant' && (lastDisplayMsg?.parts?.length || 0) === 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', minHeight: 0,
      borderRight: `1px solid ${colors.border}`,
      background: colors.bgMuted,
    }}>
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: `${spacing.md}px ${spacing.md}px`,
      }}>
        {displayMessages.length === 0 && (
          <div style={{
            color: colors.textMuted,
            fontSize: typography.fontSizes.sm,
            fontFamily: typography.fontFamily,
            textAlign: 'center', marginTop: spacing.xl,
          }}>
            Ask anything about this scenario.
          </div>
        )}
        {displayMessages.map((msg) => (
          msg.role === 'user'
            ? <UserBubble key={msg.id} message={msg} />
            : <AssistantBubble key={msg.id} message={msg} onPinToCanvas={pinToCanvas} />
        ))}
        {isThinking && <ThinkingIndicator />}
      </div>

      <PromptBar
        placeholder="Reply to Bob..."
        onSubmit={sendMessage}
        disabled={streaming}
      />
    </div>
  );
}
