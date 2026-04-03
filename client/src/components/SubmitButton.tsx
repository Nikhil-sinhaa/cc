import React from 'react';

// ── Submit Button State Machine ──────────────────────────────
// 8 possible visual states for the submit button
export type SubmitState =
  | 'disabled'    // before battle starts / roomId missing / socket disconnected / battle ended
  | 'idle'        // ready to submit
  | 'submitting'  // waiting for server ack
  | 'judging'     // Judge0 running tests
  | 'cooldown'    // 8s cooldown between submits
  | 'all_passed'  // solved! glowing green state (can still resubmit for efficiency)
  | 'partial'     // some tests passed
  | 'failed';     // 0 tests passed

// Individual test case status for judging animation
export interface TestCaseStatus {
  index: number;
  status: 'pending' | 'running' | 'passed' | 'failed';
}

interface SubmitButtonProps {
  state: SubmitState;
  cooldownLeft: number;       // seconds remaining in cooldown
  judgingProgress?: string;   // e.g. "Running test 2/8..."
  testCases?: TestCaseStatus[];  // live test case results for judging animation
  onClick: () => void;
}

// Config for each state: label text + CSS class
const STATE_CONFIG: Record<SubmitState, { label: string | ((props: SubmitButtonProps) => string); className: string }> = {
  disabled: {
    label: 'Submit',
    className: 'submit-disabled',
  },
  idle: {
    label: 'Submit ⚡',
    className: 'submit-idle',
  },
  submitting: {
    label: 'Sending...',
    className: 'submit-submitting',
  },
  judging: {
    label: (props) => props.judgingProgress || 'Running tests...',
    className: 'submit-judging',
  },
  cooldown: {
    label: (props) => `Wait ${props.cooldownLeft}s`,
    className: 'submit-cooldown',
  },
  all_passed: {
    label: 'Improve score ↑',
    className: 'submit-all-passed',
  },
  partial: {
    label: 'Submit again ↻',
    className: 'submit-partial',
  },
  failed: {
    label: 'Try again ↻',
    className: 'submit-failed',
  },
};

// States where the button should be disabled (not clickable)
const DISABLED_STATES: SubmitState[] = ['disabled', 'submitting', 'judging', 'cooldown'];

export const SubmitButton: React.FC<SubmitButtonProps> = (props) => {
  const { state, cooldownLeft, testCases, onClick } = props;
  const config = STATE_CONFIG[state];
  const isDisabled = DISABLED_STATES.includes(state);

  // Resolve label (can be string or function)
  const label = typeof config.label === 'function' ? config.label(props) : config.label;

  return (
    <div className="submit-btn-wrapper">
      <button
        id="submit-btn"
        disabled={isDisabled}
        onClick={onClick}
        className={`submit-btn ${config.className}`}
      >
        {/* Cooldown depleting ring */}
        {state === 'cooldown' && cooldownLeft > 0 && (
          <span
            className="submit-cooldown-ring"
            style={{ '--cooldown-duration': `${cooldownLeft}s` } as React.CSSProperties}
          />
        )}

        {/* Submitting spinner */}
        {state === 'submitting' && <span className="submit-spinner" />}

        {/* Judging spinner */}
        {state === 'judging' && <span className="submit-spinner submit-spinner-amber" />}

        {label}
      </button>

      {/* ── Judging Panel: test case rows with 80ms stagger ── */}
      {state === 'judging' && testCases && testCases.length > 0 && (
        <div className="judging-panel">
          <div className="judging-panel-header">
            <span className="judging-panel-dot" />
            Test Results
          </div>
          {testCases.map((tc, i) => (
            <div
              key={tc.index}
              className={`judging-row judging-row-${tc.status}`}
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <span className="judging-row-icon">
                {tc.status === 'passed' ? '✅' :
                 tc.status === 'failed' ? '❌' :
                 tc.status === 'running' ? '⏳' : '⬜'}
              </span>
              <span className="judging-row-label">Test {tc.index + 1}</span>
              <span className={`judging-row-status judging-status-${tc.status}`}>
                {tc.status === 'passed' ? 'PASS' :
                 tc.status === 'failed' ? 'FAIL' :
                 tc.status === 'running' ? 'RUN' : '···'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
