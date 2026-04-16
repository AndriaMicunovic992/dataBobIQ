import { useRef, useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { streamChat } from '../../api.js';
import { colors, spacing, radius, typography, shadows } from '../../theme.js';
import PromptBar from './PromptBar.jsx';

/**
 * Narrow chat column inside a thread tab. Reuses the same SSE plumbing as
 * ChatPanel but keeps rendering local so this pane can live inside the
 * workspace layout (no floating window chrome).
 *
 * State shape for messages lives on the tab itself and is edited via the
 * `onUpdateTab` callback from the workspace shell.
 */

function UserBubble({ message }) {
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
}

function AssistantBubble({ message }) {
  const parts = message.parts || [{ type: 'text', content: message.content || '' }];
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
            return (
              <div key={i} style={{
                fontSize: typography.fontSizes.xs,
                color: '#065f46', fontFamily: typography.fontFamily,
                background: '#f0fdf4', border: `1px solid #bbf7d0`,
                borderRadius: radius.md, padding: `${spacing.xs}px ${spacing.sm}px`,
              }}>
                ✓ {part.name || 'result'}
              </div>
            );
          }
          return (
            <div key={i} style={{
              background: colors.bgCard,
              borderRadius: `${radius.sm}px ${radius.lg}px ${radius.lg}px ${radius.lg}px`,
              border: `1px solid ${colors.border}`,
              padding: `${spacing.sm}px ${spacing.md}px`,
              fontFamily: typography.fontFamily,
              fontSize: typography.fontSizes.sm,
              color: colors.textPrimary, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              boxShadow: shadows.sm, wordBreak: 'break-word',
            }}>
              {part.content || ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

export default function ConversationPane({ tab, modelId, onUpdateTab }) {
  const qc = useQueryClient();
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef(null);
  const stopRef = useRef(null);
  const messages = tab.messages || [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback((text) => {
    if (!text || streaming || !modelId) return;

    const userMsg = { id: `u-${Date.now()}`, role: 'user', content: text };
    const assistantId = `a-${Date.now()}`;
    const assistantMsg = { id: assistantId, role: 'assistant', parts: [], streaming: true };

    // Snapshot history before we mutate — chat-engine expects role+content only.
    const history = messages.map((m) => ({
      role: m.role,
      content: m.content || m.parts?.map((p) => p.content || '').join('') || '',
    }));

    onUpdateTab(tab.id, (t) => ({
      messages: [...(t.messages || []), userMsg, assistantMsg],
      pendingSeed: null,
    }));
    setStreaming(true);

    const stop = streamChat(
      modelId,
      { message: text, history, mode: 'scenario' },
      (event) => {
        if (event.type === 'text' || event.type === 'delta') {
          const chunk = event.text || event.delta || '';
          onUpdateTab(tab.id, (t) => ({
            messages: (t.messages || []).map((m) => {
              if (m.id !== assistantId) return m;
              const parts = [...(m.parts || [])];
              const last = parts[parts.length - 1];
              if (last && last.type === 'text') {
                parts[parts.length - 1] = { ...last, content: last.content + chunk };
              } else {
                parts.push({ type: 'text', content: chunk });
              }
              return { ...m, parts };
            }),
          }));
        } else if (event.type === 'tool_use') {
          onUpdateTab(tab.id, (t) => ({
            messages: (t.messages || []).map((m) =>
              m.id !== assistantId ? m : { ...m, parts: [...(m.parts || []), { type: 'tool_use', name: event.name, input: event.input }] }
            ),
          }));
        } else if (event.type === 'tool_result') {
          onUpdateTab(tab.id, (t) => ({
            messages: (t.messages || []).map((m) =>
              m.id !== assistantId ? m : { ...m, parts: [...(m.parts || []), { type: 'tool_result', name: event.name, content: event.content }] }
            ),
          }));
        } else if (event.type === 'scenario_created') {
          qc.invalidateQueries({ queryKey: ['scenarios', modelId] });
          qc.invalidateQueries({ queryKey: ['scenario-summaries', modelId] });
        } else if (event.type === 'done' || event.type === 'error') {
          setStreaming(false);
          if (event.type === 'error') {
            onUpdateTab(tab.id, (t) => ({
              messages: (t.messages || []).map((m) => {
                if (m.id !== assistantId) return m;
                const parts = [...(m.parts || []), { type: 'text', content: `\n\nError: ${event.data}` }];
                return { ...m, parts, streaming: false };
              }),
            }));
          } else {
            onUpdateTab(tab.id, (t) => ({
              messages: (t.messages || []).map((m) => m.id === assistantId ? { ...m, streaming: false } : m),
            }));
          }
        }
      }
    );
    stopRef.current = stop;
  }, [streaming, modelId, messages, onUpdateTab, tab.id, qc]);

  // Auto-fire a pending seed message on mount (when a thread is opened with
  // a pre-filled user question like "Why is Base Case tracking below actuals?").
  const seedFiredRef = useRef(false);
  useEffect(() => {
    if (seedFiredRef.current) return;
    if (!tab.pendingSeed) return;
    seedFiredRef.current = true;
    // The seed message is already in `messages` as the first user message —
    // we just need to kick off the streaming response. Re-run sendMessage
    // without re-adding the user message: easier to inline the send logic.
    const seedText = tab.pendingSeed;
    const assistantId = `a-${Date.now()}`;
    const assistantMsg = { id: assistantId, role: 'assistant', parts: [], streaming: true };
    onUpdateTab(tab.id, (t) => ({
      messages: [...(t.messages || []), assistantMsg],
      pendingSeed: null,
    }));
    setStreaming(true);
    const history = (tab.messages || [])
      .filter((m) => m.id !== assistantId)
      .map((m) => ({
        role: m.role,
        content: m.content || m.parts?.map((p) => p.content || '').join('') || '',
      }));
    // Drop the last (most recent) user message from history — chat engine
    // expects the current message separately.
    const trimmedHistory = history.slice(0, -1);

    const stop = streamChat(
      modelId,
      { message: seedText, history: trimmedHistory, mode: 'scenario' },
      (event) => {
        if (event.type === 'text' || event.type === 'delta') {
          const chunk = event.text || event.delta || '';
          onUpdateTab(tab.id, (t) => ({
            messages: (t.messages || []).map((m) => {
              if (m.id !== assistantId) return m;
              const parts = [...(m.parts || [])];
              const last = parts[parts.length - 1];
              if (last && last.type === 'text') {
                parts[parts.length - 1] = { ...last, content: last.content + chunk };
              } else {
                parts.push({ type: 'text', content: chunk });
              }
              return { ...m, parts };
            }),
          }));
        } else if (event.type === 'tool_use') {
          onUpdateTab(tab.id, (t) => ({
            messages: (t.messages || []).map((m) =>
              m.id !== assistantId ? m : { ...m, parts: [...(m.parts || []), { type: 'tool_use', name: event.name, input: event.input }] }
            ),
          }));
        } else if (event.type === 'tool_result') {
          onUpdateTab(tab.id, (t) => ({
            messages: (t.messages || []).map((m) =>
              m.id !== assistantId ? m : { ...m, parts: [...(m.parts || []), { type: 'tool_result', name: event.name, content: event.content }] }
            ),
          }));
        } else if (event.type === 'scenario_created') {
          qc.invalidateQueries({ queryKey: ['scenarios', modelId] });
          qc.invalidateQueries({ queryKey: ['scenario-summaries', modelId] });
        } else if (event.type === 'done' || event.type === 'error') {
          setStreaming(false);
          if (event.type === 'error') {
            onUpdateTab(tab.id, (t) => ({
              messages: (t.messages || []).map((m) => {
                if (m.id !== assistantId) return m;
                const parts = [...(m.parts || []), { type: 'text', content: `\n\nError: ${event.data}` }];
                return { ...m, parts, streaming: false };
              }),
            }));
          } else {
            onUpdateTab(tab.id, (t) => ({
              messages: (t.messages || []).map((m) => m.id === assistantId ? { ...m, streaming: false } : m),
            }));
          }
        }
      }
    );
    stopRef.current = stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  const lastMsg = messages[messages.length - 1];
  const isThinking = streaming && lastMsg?.role === 'assistant' && (lastMsg?.parts?.length || 0) === 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100%', minHeight: 0,
      borderRight: `1px solid ${colors.border}`,
      background: colors.bgMuted,
    }}>
      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: `${spacing.md}px ${spacing.md}px`,
      }}>
        {messages.length === 0 && (
          <div style={{
            color: colors.textMuted,
            fontSize: typography.fontSizes.sm,
            fontFamily: typography.fontFamily,
            textAlign: 'center', marginTop: spacing.xl,
          }}>
            Ask Bob anything about this scenario.
          </div>
        )}
        {messages.map((msg) => (
          msg.role === 'user'
            ? <UserBubble key={msg.id} message={msg} />
            : <AssistantBubble key={msg.id} message={msg} />
        ))}
        {isThinking && <ThinkingIndicator />}
      </div>

      {/* Inline prompt at the bottom of the pane (full-width prompt bar
          lives at the workspace level on Home; inside a thread the input
          is scoped to the conversation). */}
      <PromptBar
        placeholder="Reply to Bob..."
        onSubmit={sendMessage}
        disabled={streaming}
      />
    </div>
  );
}
