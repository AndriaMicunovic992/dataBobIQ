import { useState } from 'react';
import { useScenarios, useCreateScenario } from '../../hooks/useScenarios.js';
import { colors, spacing, radius, typography, shadows, transitions, inputStyle, labelStyle } from '../../theme.js';
import { Button } from '../common/Button.jsx';

/**
 * Decision Intelligence landing page for a model.
 *
 * Layout:
 *   - Greeting
 *   - Scenarios grid: rules-first cards (top 3 rules + "+N more")
 *       clicking a card → opens the default dashboard with that scenario
 *       pre-selected and the rules drawer pinned open
 *   - Dashboards grid: clicking opens the dashboard
 *   - Recent questions strip (if any)
 *
 * The DI home is the landing page for every model, so we keep it information-
 * dense but low-noise: no carousels, no sparklines, no hard-coded prompts.
 */

function Greeting() {
  const hour = new Date().getHours();
  const greet =
    hour < 5 ? 'Still up' :
    hour < 12 ? 'Good morning' :
    hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <div style={{ marginBottom: spacing.xl }}>
      <h1 style={{
        margin: 0, fontSize: typography.fontSizes.xxxl,
        fontWeight: typography.fontWeights.bold,
        color: colors.textPrimary, fontFamily: typography.fontFamily,
        lineHeight: 1.2,
      }}>
        {greet}. What should Bob look into?
      </h1>
      <p style={{
        margin: `${spacing.xs}px 0 0`,
        fontSize: typography.fontSizes.md,
        color: colors.textSecondary,
        fontFamily: typography.fontFamily,
      }}>
        Scenarios and dashboards for this model — click a scenario to edit its
        rules on a dashboard, or ask a question below.
      </p>
    </div>
  );
}

function formatRule(rule) {
  if (rule.name && rule.name.trim()) return rule.name;
  // Fallback: derive from rule shape
  const field = rule.target_field || 'field';
  const adj = rule.adjustment || {};
  if (rule.rule_type === 'multiplier') {
    const factor = adj.factor;
    if (typeof factor === 'number') {
      const pct = ((factor - 1) * 100).toFixed(0);
      const sign = factor >= 1 ? '+' : '';
      return `${field} ${sign}${pct}%`;
    }
  }
  if (rule.rule_type === 'offset') {
    const offset = adj.offset;
    if (typeof offset === 'number') {
      const sign = offset >= 0 ? '+' : '';
      return `${field} ${sign}${offset.toLocaleString()}`;
    }
  }
  if (rule.rule_type === 'set_value') {
    return `${field} = ${adj.value ?? '?'}`;
  }
  return `${field} (${rule.rule_type})`;
}

function ScenarioCard({ scenario, dashboards, onOpen }) {
  const rules = scenario.rules || [];
  const color = scenario.color || colors.primary;
  const shown = rules.slice(0, 3);
  const extra = rules.length - shown.length;

  return (
    <div
      style={{
        background: colors.bgCard,
        borderRadius: radius.lg,
        border: `1px solid ${colors.border}`,
        boxShadow: shadows.sm,
        padding: spacing.md,
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.sm,
        transition: transitions.fast,
        minHeight: 180,
        fontFamily: typography.fontFamily,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = shadows.md;
        e.currentTarget.style.borderColor = color;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = shadows.sm;
        e.currentTarget.style.borderColor = colors.border;
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
        <div style={{
          width: 10, height: 10, borderRadius: radius.full,
          background: color, flexShrink: 0,
        }} />
        <h4 style={{
          margin: 0, flex: 1, minWidth: 0,
          fontSize: typography.fontSizes.md,
          fontWeight: typography.fontWeights.semibold,
          color: colors.textPrimary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {scenario.name}
        </h4>
        <span style={{
          fontSize: typography.fontSizes.xs,
          color: colors.textMuted,
          flexShrink: 0,
        }}>
          {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
        </span>
      </div>

      {rules.length === 0 ? (
        <div style={{
          fontSize: typography.fontSizes.xs,
          color: colors.textMuted,
          fontStyle: 'italic',
          flex: 1,
        }}>
          No rules yet — open a dashboard below to add some.
        </div>
      ) : (
        <ul style={{
          margin: 0, padding: 0, listStyle: 'none',
          display: 'flex', flexDirection: 'column', gap: 2,
          flex: 1,
        }}>
          {shown.map((rule) => (
            <li key={rule.id} style={{
              fontSize: typography.fontSizes.sm,
              color: colors.textSecondary,
              display: 'flex', alignItems: 'baseline', gap: spacing.xs,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              <span style={{ color: color, fontSize: 10 }}>●</span>
              <span style={{
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                minWidth: 0, flex: 1,
              }}>
                {formatRule(rule)}
              </span>
            </li>
          ))}
          {extra > 0 && (
            <li style={{
              fontSize: typography.fontSizes.xs,
              color: colors.textMuted,
              marginTop: 2,
            }}>
              +{extra} more
            </li>
          )}
        </ul>
      )}

      {/* Dashboard picker — click a dashboard to open it with this scenario
          preselected. First option is the default on whole-card click. */}
      {dashboards.length > 0 ? (
        <div style={{
          marginTop: 'auto',
          paddingTop: spacing.xs,
          borderTop: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4,
        }}>
          <span style={{
            fontSize: typography.fontSizes.xs,
            color: colors.textMuted,
            marginRight: spacing.xs,
          }}>
            Edit on:
          </span>
          {dashboards.map((d, i) => (
            <button
              key={d.id}
              onClick={(e) => { e.stopPropagation(); onOpen(scenario, d.id); }}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '2px 6px',
                borderRadius: radius.sm,
                fontSize: typography.fontSizes.xs,
                fontWeight: typography.fontWeights.medium,
                color: color,
                cursor: 'pointer',
                fontFamily: typography.fontFamily,
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = color + '18'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {d.name}
            </button>
          ))}
        </div>
      ) : (
        <div style={{
          marginTop: 'auto',
          fontSize: typography.fontSizes.xs,
          color: colors.textMuted,
          fontStyle: 'italic',
        }}>
          No dashboards yet — create one to edit rules here.
        </div>
      )}
    </div>
  );
}

function DashboardCard({ dashboard, onClick }) {
  const widgetCount = (dashboard.widgets || []).length;
  return (
    <button
      onClick={() => onClick(dashboard)}
      style={{
        textAlign: 'left',
        background: colors.bgCard,
        borderRadius: radius.lg,
        border: `1px solid ${colors.border}`,
        boxShadow: shadows.sm,
        padding: spacing.md,
        display: 'flex',
        flexDirection: 'column',
        gap: spacing.xs,
        transition: transitions.fast,
        cursor: 'pointer',
        minHeight: 110,
        fontFamily: typography.fontFamily,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = shadows.md;
        e.currentTarget.style.borderColor = colors.borderFocus;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = shadows.sm;
        e.currentTarget.style.borderColor = colors.border;
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
        <span style={{ fontSize: 14, color: colors.primary }}>▦</span>
        <h4 style={{
          margin: 0, flex: 1, minWidth: 0,
          fontSize: typography.fontSizes.md,
          fontWeight: typography.fontWeights.semibold,
          color: colors.textPrimary,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {dashboard.name}
        </h4>
      </div>
      {dashboard.description && (
        <p style={{
          margin: 0,
          fontSize: typography.fontSizes.sm,
          color: colors.textSecondary,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {dashboard.description}
        </p>
      )}
      <div style={{
        marginTop: 'auto',
        fontSize: typography.fontSizes.xs,
        color: colors.textMuted,
      }}>
        {widgetCount} {widgetCount === 1 ? 'widget' : 'widgets'}
      </div>
    </button>
  );
}

function SuggestionChip({ text, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: colors.bgCard,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.full,
        padding: `${spacing.xs}px ${spacing.md}px`,
        color: colors.textSecondary,
        fontSize: typography.fontSizes.sm,
        fontFamily: typography.fontFamily,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        whiteSpace: 'nowrap',
        maxWidth: 360,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        boxShadow: shadows.sm,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = colors.borderFocus;
        e.currentTarget.style.color = colors.primary;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.color = colors.textSecondary;
      }}
    >
      {text}
    </button>
  );
}

function NewScenarioModal({ modelId, dashboards, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [dashboardId, setDashboardId] = useState(dashboards[0]?.id || '');
  const createMut = useCreateScenario(modelId);

  const canSubmit = !!name.trim() && !!dashboardId && !createMut.isPending;

  const handleSubmit = () => {
    if (!canSubmit) return;
    createMut.mutate(
      { name: name.trim(), base_config: { source: 'actuals' } },
      {
        onSuccess: (data) => {
          onCreated(data.id, dashboardId);
          onClose();
        },
      }
    );
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: colors.bgCard, borderRadius: radius.lg, boxShadow: shadows.xl,
        padding: spacing.xl, width: 460, maxWidth: '90vw',
        fontFamily: typography.fontFamily,
      }}>
        <h2 style={{
          margin: `0 0 ${spacing.sm}px`,
          fontSize: typography.fontSizes.xl,
          fontWeight: typography.fontWeights.bold,
          color: colors.textPrimary,
        }}>
          New Scenario
        </h2>
        <p style={{
          margin: `0 0 ${spacing.lg}px`,
          fontSize: typography.fontSizes.sm,
          color: colors.textMuted,
        }}>
          Name your scenario and pick the dashboard where you'll shape its rules.
        </p>

        <div style={{ marginBottom: spacing.md }}>
          <label style={labelStyle}>Scenario Name *</label>
          <input
            style={inputStyle}
            placeholder="e.g. Revenue +10%"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
            autoFocus
          />
        </div>

        <div style={{ marginBottom: spacing.lg }}>
          <label style={labelStyle}>Edit rules on dashboard *</label>
          {dashboards.length === 0 ? (
            <p style={{
              margin: 0, fontSize: typography.fontSizes.sm,
              color: colors.danger, fontStyle: 'italic',
            }}>
              No dashboards yet — create one from the sidebar first.
            </p>
          ) : (
            <select
              style={inputStyle}
              value={dashboardId}
              onChange={(e) => setDashboardId(e.target.value)}
            >
              {dashboards.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
        </div>

        {createMut.isError && (
          <p style={{
            color: colors.danger, fontSize: typography.fontSizes.sm,
            margin: `0 0 ${spacing.sm}px`,
          }}>
            {createMut.error?.message || 'Failed to create scenario'}
          </p>
        )}

        <div style={{ display: 'flex', gap: spacing.sm, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={createMut.isPending}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Create & Open
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function HomeView({
  modelId,
  dashboards = [],
  onOpenThread,
  onOpenDashboard,
  recentQuestions = [],
}) {
  const { data: scenarios = [], isLoading, isError, error } = useScenarios(modelId);
  const [showNewScenario, setShowNewScenario] = useState(false);

  const handleScenarioOpen = (scenario, dashboardId) => {
    if (!dashboardId) return;
    onOpenDashboard?.(dashboardId, scenario.id);
  };

  const handleDashboardClick = (dashboard) => {
    onOpenDashboard?.(dashboard.id, null);
  };

  const handleChipClick = (text) => {
    onOpenThread?.({
      title: text.length > 40 ? `${text.slice(0, 40)}…` : text,
      scenarioIds: [],
      seedMessage: text,
    });
  };

  return (
    <div style={{
      maxWidth: 1100,
      margin: '0 auto',
      padding: `${spacing.xxl}px ${spacing.xl}px ${spacing.xl}px`,
      fontFamily: typography.fontFamily,
    }}>
      <Greeting />

      {/* Scenarios */}
      <section style={{ marginBottom: spacing.xxl }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: spacing.sm,
          margin: `0 0 ${spacing.md}px`,
        }}>
          <h2 style={{
            margin: 0,
            fontSize: typography.fontSizes.lg,
            fontWeight: typography.fontWeights.semibold,
            color: colors.textPrimary,
          }}>
            Scenarios
          </h2>
          <button
            onClick={() => setShowNewScenario(true)}
            title="New scenario"
            style={{
              width: 28, height: 28, borderRadius: radius.full,
              border: `1px solid ${colors.border}`,
              background: colors.bgCard,
              color: colors.textSecondary,
              fontSize: 16, lineHeight: 1,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: transitions.fast,
              fontFamily: typography.fontFamily,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = colors.primary;
              e.currentTarget.style.color = colors.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = colors.border;
              e.currentTarget.style.color = colors.textSecondary;
            }}
          >
            +
          </button>
        </div>

        {isLoading && (
          <div style={{ color: colors.textMuted, fontSize: typography.fontSizes.sm }}>
            Loading scenarios…
          </div>
        )}
        {isError && (
          <div style={{ color: colors.danger, fontSize: typography.fontSizes.sm }}>
            Couldn't load scenarios: {error?.message || 'unknown error'}
          </div>
        )}
        {!isLoading && !isError && scenarios.length === 0 && (
          <div style={{
            background: colors.bgCard,
            border: `1px dashed ${colors.border}`,
            borderRadius: radius.lg,
            padding: spacing.xl,
            textAlign: 'center',
            color: colors.textMuted,
            fontSize: typography.fontSizes.sm,
          }}>
            No scenarios yet. Open a dashboard and create one, or ask Bob below.
          </div>
        )}
        {!isLoading && scenarios.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: spacing.md,
          }}>
            {scenarios.map((s) => (
              <ScenarioCard
                key={s.id}
                scenario={s}
                dashboards={dashboards}
                onOpen={handleScenarioOpen}
              />
            ))}
          </div>
        )}
      </section>

      {/* Dashboards */}
      <section style={{ marginBottom: spacing.xxl }}>
        <h2 style={{
          margin: `0 0 ${spacing.md}px`,
          fontSize: typography.fontSizes.lg,
          fontWeight: typography.fontWeights.semibold,
          color: colors.textPrimary,
        }}>
          Dashboards
        </h2>

        {dashboards.length === 0 ? (
          <div style={{
            background: colors.bgCard,
            border: `1px dashed ${colors.border}`,
            borderRadius: radius.lg,
            padding: spacing.xl,
            textAlign: 'center',
            color: colors.textMuted,
            fontSize: typography.fontSizes.sm,
          }}>
            No dashboards yet. Create one from the sidebar.
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: spacing.md,
          }}>
            {dashboards.map((d) => (
              <DashboardCard key={d.id} dashboard={d} onClick={handleDashboardClick} />
            ))}
          </div>
        )}
      </section>

      {showNewScenario && (
        <NewScenarioModal
          modelId={modelId}
          dashboards={dashboards}
          onClose={() => setShowNewScenario(false)}
          onCreated={(scenarioId, dashboardId) => onOpenDashboard?.(dashboardId, scenarioId)}
        />
      )}

      {/* Recent questions */}
      {recentQuestions.length > 0 && (
        <section>
          <h2 style={{
            margin: `0 0 ${spacing.sm}px`,
            fontSize: typography.fontSizes.sm,
            fontWeight: typography.fontWeights.medium,
            color: colors.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}>
            Recent questions
          </h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
            {recentQuestions.map((text) => (
              <SuggestionChip key={text} text={text} onClick={() => handleChipClick(text)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
