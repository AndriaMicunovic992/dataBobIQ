import { useScenarioSummaries } from '../../hooks/useScenarios.js';
import { colors, spacing, radius, typography, shadows } from '../../theme.js';
import ScenarioCard from './ScenarioCard.jsx';

/**
 * The landing view inside the Agent Workspace. Greeting strip, a grid of
 * scenario cockpit cards, and a short row of suggested prompts to prime the
 * conversation. Clicking "Ask" on any card or a suggestion chip opens a new
 * thread tab via the parent-supplied `onOpenThread` callback.
 */

const TRY_ASKING = [
  'Which scenario assumes the most aggressive revenue growth?',
  'Why is Base Case tracking below actuals in Q4?',
  'Draft a CFO commentary comparing my top two scenarios.',
  'What would happen if COGS increased 5% across the board?',
];

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
        Your scenarios at a glance — ask a question, open a thread, or jump back to the dashboard.
      </p>
    </div>
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

export default function HomeView({ modelId, onOpenThread, onOpenDashboard }) {
  const { data, isLoading, isError, error } = useScenarioSummaries(modelId);
  const scenarios = data?.scenarios || [];

  const handleAsk = (summary) => {
    onOpenThread?.({
      title: summary.name,
      scenarioIds: [summary.id],
      seedMessage: `Tell me what's driving the headline delta in ${summary.name}.`,
    });
  };

  const handleOpen = (summary) => {
    onOpenDashboard?.(summary);
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

      {/* Scenario cockpit grid */}
      <section style={{ marginBottom: spacing.xl }}>
        <div style={{
          display: 'flex', alignItems: 'baseline',
          justifyContent: 'space-between', marginBottom: spacing.md,
        }}>
          <h2 style={{
            margin: 0, fontSize: typography.fontSizes.lg,
            fontWeight: typography.fontWeights.semibold,
            color: colors.textPrimary,
          }}>
            Your scenarios
          </h2>
          {data?.measure && (
            <span style={{
              fontSize: typography.fontSizes.xs,
              color: colors.textMuted,
            }}>
              Headline measure: {data.measure}
            </span>
          )}
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
            No scenarios yet. Create one from a dashboard, then come back here to
            interrogate it.
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
                summary={s}
                onAsk={handleAsk}
                onOpen={handleOpen}
              />
            ))}
          </div>
        )}
      </section>

      {/* Suggestion chips */}
      <section>
        <h2 style={{
          margin: `0 0 ${spacing.sm}px`,
          fontSize: typography.fontSizes.sm,
          fontWeight: typography.fontWeights.medium,
          color: colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          Try asking
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing.sm }}>
          {TRY_ASKING.map((text) => (
            <SuggestionChip key={text} text={text} onClick={() => handleChipClick(text)} />
          ))}
        </div>
      </section>
    </div>
  );
}
