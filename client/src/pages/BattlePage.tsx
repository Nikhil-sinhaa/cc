import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import Editor from '@monaco-editor/react';
import { useAuthStore } from '../stores/authStore';
import { useBattleStore } from '../stores/battleStore';
import { HpBar } from '../components/HpBar';
import { SpellPanel } from '../components/SpellPanel';
import { SubmitButton, type SubmitState, type TestCaseStatus } from '../components/SubmitButton';

const SERVER_URL = 'http://localhost:3001';
const MAX_HP = 500;

const LANGUAGES = [
  { id: 63,  label: 'JavaScript', monacoLang: 'javascript' },
  { id: 71,  label: 'Python',     monacoLang: 'python'     },
  { id: 54,  label: 'C++',        monacoLang: 'cpp'        },
  { id: 62,  label: 'Java',       monacoLang: 'java'       },
];

interface DamageToast { id: string; text: string; color: string; }
interface AchievementToast { id: string; name: string; icon: string; }

export const BattlePage: React.FC = () => {
  const { roomId: paramRoomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { user, token } = useAuthStore();
  const {
    roomId, puzzle, myHp, opponentHp, status, timeRemaining, opponentName,
    winnerName, eloChange, setBattle, setHp, addDamage, setStatus,
    setTimeRemaining, setEnd, reset,
  } = useBattleStore();

  const [code, setCode] = useState('// Write your solution here\n');
  const [langId, setLangId] = useState(63); // JS default
  const [socket, setSocket] = useState<Socket | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [damageToasts, setDamageToasts] = useState<DamageToast[]>([]);
  const [achievementToasts, setAchievementToasts] = useState<AchievementToast[]>([]);
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [isSlowed, setIsSlowed] = useState(false);
  const [opponentActivity, setOpponentActivity] = useState(0);

  // ── Submit button state machine (8 states) ──
  const [submitState, setSubmitState] = useState<SubmitState>('disabled');
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [hasAllPassed, setHasAllPassed] = useState(false); // permanent for this battle
  const [judgingProgress, setJudgingProgress] = useState<string>(''); // "Running test 2/8..."
  const [testCases, setTestCases] = useState<TestCaseStatus[]>([]);  // live test case rows

  const timerRef = useRef<number | null>(null);
  const isPlayer1Ref = useRef<boolean | null>(null); // null = unknown until state_sync
  const editorRef = useRef<any>(null); // Bug #6: Monaco ref for fresh value
  const submitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown timer
  useEffect(() => {
    if (status === 'ACTIVE' && timeRemaining > 0) {
      timerRef.current = window.setInterval(() => {
        setTimeRemaining(Math.max(0, timeRemaining - 1));
      }, 1000);
    }
    return () => clearInterval(timerRef.current!);
  }, [status, timeRemaining]);

  // Socket setup
  useEffect(() => {
    if (!token) { navigate('/login'); return; }

    // Bug #4: Pass JWT token in socket handshake auth option
    const sock = io(SERVER_URL, { auth: { token: localStorage.getItem('jwt') || token } });
    setSocket(sock);
    sock.emit('authenticate', { token });

    sock.on('match:found', (data: any) => {
      setBattle(data.roomId, data.puzzle, data.opponentName);
      setTimeRemaining(data.timeLimitSeconds || 300);
      if (data.myHp !== undefined) setHp(data.myHp, data.opponentHp);
    });

    sock.on('battle:countdown', (data: any) => {
      setCountdown(data.secondsLeft);
      setStatus('COUNTDOWN');
    });

    sock.on('battle:start', (data: any) => {
      setCountdown(null);
      setStatus('ACTIVE');
      // Resync time from server if provided
      if (data?.timeLimitSeconds) setTimeRemaining(data.timeLimitSeconds);
    });

    // Server timer tick — keeps client in sync and recovers status if page was reloaded
    sock.on('battle:tick', (data: any) => {
      if (data.remainingSeconds !== undefined) setTimeRemaining(Math.round(data.remainingSeconds));
      // Force ACTIVE if stuck on WAITING/COUNTDOWN (handles page refresh during active battle)
      const currentStatus = useBattleStore.getState().status;
      if (currentStatus === 'WAITING' || currentStatus === 'COUNTDOWN') {
        setCountdown(null);
        setStatus('ACTIVE');
      }
    });

    sock.on('battle:damage', (data: any) => {
      // Map hp1/hp2 from server to myHp/opponentHp correctly
      if (isPlayer1Ref.current !== null) {
        const myHp = isPlayer1Ref.current ? data.hp1 : data.hp2;
        const oppHp = isPlayer1Ref.current ? data.hp2 : data.hp1;
        setHp(myHp, oppHp);
      } else {
        setHp(data.hp1, data.hp2);
      }
      addDamage(data.attackerName, data.damage);
      addToast(`💥 ${data.attackerName} dealt ${data.damage} DMG!`, data.damage > 60 ? 'var(--magenta)' : 'var(--red)');
    });

    sock.on('battle:no_damage', (data: any) => {
      addToast(`❌ ${data.attackerName} failed (${data.passedTests}/${data.totalTests})`, 'var(--text-secondary)');
    });

    sock.on('battle:opponent_activity', (data: any) => {
      setOpponentActivity(data.submissionCount);
    });

    sock.on('battle:time_warning', () => {
      addToast('⏰ 60 seconds remaining!', 'var(--gold)');
    });

    sock.on('battle:end', (data: any) => {
      setEnd(data.winnerName, data.winnerEloChange || data.eloChange);
      setStatus('ENDED');
      if (data.newAchievements?.length > 0) {
        data.newAchievements.forEach((a: any) => {
          setAchievementToasts(prev => [...prev, { id: Math.random().toString(36), name: a.name, icon: a.icon }]);
        });
      }
    });

    // ── Submit state machine transitions ──
    sock.on('submit:received', () => {
      setSubmitState('submitting');
    });

    sock.on('submit:judging', (data: any) => {
      setSubmitState('judging');
      const current = data?.currentTest ?? 0;
      const total = data?.totalTests ?? 0;

      if (current && total) {
        setJudgingProgress(`Running test ${current}/${total}...`);

        // Build test case rows with live status
        setTestCases(prev => {
          // Initialize rows on first event or if total changed
          const rows: TestCaseStatus[] = prev.length === total
            ? [...prev]
            : Array.from({ length: total }, (_, i) => ({ index: i, status: 'pending' as const }));

          // Mark previous tests as passed (server sends them sequentially)
          for (let i = 0; i < current - 1; i++) {
            if (rows[i]) rows[i] = { ...rows[i], status: 'passed' };
          }
          // Mark current test as running
          if (rows[current - 1]) rows[current - 1] = { ...rows[current - 1], status: 'running' };

          return rows;
        });
      } else {
        setJudgingProgress('Running tests...');
      }
    });

    sock.on('submit:result', (data: any) => {
      setStatus('ACTIVE');
      setSubmitResult(data);
      setTimeout(() => setSubmitResult(null), 5000);
      setJudgingProgress('');
      setTestCases([]);  // clear judging rows

      // Clear safety timeout
      if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);

      // Determine next submitState based on result
      const allPassed = data.passed || data.passedTests === data.totalTests;
      if (allPassed) {
        setHasAllPassed(true);
        setSubmitState('all_passed');
      } else if (data.passedTests > 0) {
        setSubmitState('partial');
      } else {
        setSubmitState('failed');
      }

      // After 3s, transition partial/failed back to idle (or all_passed if solved)
      setTimeout(() => {
        setSubmitState(prev => {
          if (prev === 'partial' || prev === 'failed') {
            return hasAllPassed ? 'all_passed' : 'idle';
          }
          return prev;
        });
      }, 3000);
    });

    // Error handling
    sock.on('submit:error', (msg: string) => {
      setSubmitState(hasAllPassed ? 'all_passed' : 'idle');
      setStatus('ACTIVE');
      setJudgingProgress('');
      setTestCases([]);  // clear judging rows
      addToast(`⚠️ ${msg}`, 'var(--red)');
      if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
    });

    // Server-authoritative cooldown
    sock.on('submit:cooldown', ({ retryIn }: { retryIn: number }) => {
      startCooldownTimer(retryIn);
    });

    sock.on('spell:incoming', (data: any) => {
      addToast(`🪄 ${data.casterName} cast ${data.spellType.replace('_', ' ')}!`, 'var(--magenta)');
      if (data.spellType === 'slow') {
        setIsSlowed(true);
        setTimeout(() => setIsSlowed(false), data.duration || 10000);
      }
    });

    // — Always rejoin the battle room after authenticating —
    // This handles: normal match flow, page refresh, direct URL navigation
    const targetRoomId = paramRoomId || roomId;
    sock.on('authenticated', () => {
      if (targetRoomId) {
        sock.emit('battle:rejoin', { roomId: targetRoomId });
      }
    });

    // Sync HP/status from server on rejoin
    sock.on('battle:state_sync', (data: any) => {
      const myId = user?.id;
      isPlayer1Ref.current = data.player1Id === myId;
      const myHp = isPlayer1Ref.current ? data.hp1 : data.hp2;
      const oppHp = isPlayer1Ref.current ? data.hp2 : data.hp1;
      setHp(myHp, oppHp);
      if (data.status === 'ACTIVE') {
        setCountdown(null);
        setStatus('ACTIVE');
      }
    });

    return () => {
      sock.close();
      clearInterval(timerRef.current!);
      if (submitTimeoutRef.current) clearTimeout(submitTimeoutRef.current);
      if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
    };
  }, [token]);

  // ── Derive submitState from battle status ──
  useEffect(() => {
    if (status === 'ACTIVE' && submitState === 'disabled') {
      setSubmitState(hasAllPassed ? 'all_passed' : 'idle');
    }
    if (status === 'ENDED') {
      setSubmitState('disabled');
    }
    if (status !== 'ACTIVE' && status !== 'ENDED' && submitState !== 'disabled') {
      // WAITING / COUNTDOWN → disabled
      if (!['submitting', 'judging', 'cooldown'].includes(submitState)) {
        setSubmitState('disabled');
      }
    }
  }, [status, submitState, hasAllPassed]);

  const addToast = (text: string, color: string) => {
    const id = Math.random().toString(36);
    setDamageToasts(prev => [...prev.slice(-4), { id, text, color }]);
    setTimeout(() => setDamageToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  // ── Cooldown timer with visible countdown ──
  const startCooldownTimer = useCallback((seconds: number) => {
    setSubmitState('cooldown');
    setCooldownLeft(seconds);

    // Clear any existing countdown
    if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);

    cooldownIntervalRef.current = setInterval(() => {
      setCooldownLeft(prev => {
        if (prev <= 1) {
          if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
          // Cooldown done → go back to idle or all_passed
          setSubmitState(hasAllPassed ? 'all_passed' : 'idle');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [hasAllPassed]);

  // ── Submit handler (state machine driven) ──
  const handleSubmit = useCallback(async () => {
    // Guard 1: socket connected
    if (!socket?.connected) {
      addToast('Reconnecting to server...', 'var(--gold)');
      return;
    }
    // Guard 2: battle is actually live
    if (status !== 'ACTIVE') {
      addToast("Battle hasn't started yet", 'var(--gold)');
      return;
    }
    // Guard 3: roomId exists
    const activeRoomId = roomId || paramRoomId;
    if (!activeRoomId) {
      addToast('Room not found — try refreshing', 'var(--red)');
      return;
    }
    // Guard 4: not in a non-clickable state
    if (['disabled', 'submitting', 'judging', 'cooldown'].includes(submitState)) return;
    // Guard 5: not slowed by spell
    if (isSlowed) return;

    // Bug #6: Read code from Monaco ref (not stale React state)
    const freshCode = editorRef.current?.getValue() ?? '';
    if (!freshCode.trim()) {
      addToast('Editor is empty', 'var(--red)');
      return;
    }

    // Transition to submitting state
    setSubmitState('submitting');

    socket.emit('battle:submit', {
      roomId: activeRoomId,
      userId: user?.id,
      code: freshCode,
      language: langId,
      submittedAt: Date.now(),
    });

    // Timeout safety: if no response in 12s → reset state
    submitTimeoutRef.current = setTimeout(() => {
      setSubmitState(hasAllPassed ? 'all_passed' : 'idle');
      addToast('Server took too long — try again', 'var(--red)');
    }, 12000);
  }, [socket, roomId, paramRoomId, langId, submitState, status, isSlowed, user, hasAllPassed]);

  const handleForfeit = () => {
    const activeRoomId = roomId || paramRoomId;
    if (!socket || !activeRoomId) return;
    if (confirm('Are you sure you want to forfeit?')) {
      socket.emit('battle:forfeit', { roomId: activeRoomId });
    }
  };

  const handlePlayAgain = () => { reset(); navigate('/lobby'); };

  const monacoLang = LANGUAGES.find(l => l.id === langId)?.monacoLang || 'javascript';
  const timerColor = timeRemaining < 30 ? 'var(--red)' : timeRemaining < 60 ? 'var(--gold)' : 'var(--cyan)';
  const isWinner = winnerName === user?.username;

  if (!roomId && !paramRoomId) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div className="spinner" />
        <p style={{ color: 'var(--text-muted)' }}>Connecting to battle...</p>
      </div>
    );
  }

  return (
    <div className="scanlines" style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <div className="bg-grid" style={{ opacity: 0.3 }} />

      {/* ── Header: HP + Timer ──────────────────────────────── */}
      <div style={{
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border-dim)',
        padding: '10px 20px',
        flexShrink: 0,
        position: 'relative',
        zIndex: 10,
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* My HP */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.8rem' }}>
              <span style={{ fontWeight: 700, color: 'var(--cyan)' }}>⚔️ {user?.username}</span>
              <span style={{ fontFamily: 'var(--font-code)', color: myHp > 100 ? 'var(--green)' : 'var(--red)' }}>{myHp}/{MAX_HP}</span>
            </div>
            <HpBar current={myHp} max={MAX_HP} />
          </div>

          {/* Timer */}
          <div style={{ textAlign: 'center', minWidth: 90 }}>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: '1.6rem', fontWeight: 800, color: timerColor,
              textShadow: `0 0 12px ${timerColor}`,
            }}>
              {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, '0')}
            </div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              {status === 'JUDGING' ? '⚡ JUDGING' : status === 'COUNTDOWN' ? '🕐 READY' : status}
            </div>
          </div>

          {/* Opponent HP */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.8rem' }}>
              <span style={{ fontFamily: 'var(--font-code)', color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                {opponentActivity > 0 ? `🔥 ${opponentActivity} submits` : ''}
              </span>
              <span style={{ fontWeight: 700, color: 'var(--magenta)' }}>💀 {opponentName}</span>
              <span style={{ fontFamily: 'var(--font-code)', color: opponentHp > 100 ? 'var(--green)' : 'var(--red)' }}>{opponentHp}/{MAX_HP}</span>
            </div>
            <HpBar current={opponentHp} max={MAX_HP} reversed />
          </div>
        </div>
      </div>

      {/* ── Main Area ─────────────────────────────────────────*/}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative', zIndex: 5 }}>

        {/* LEFT: Problem Panel */}
        <div style={{
          width: '38%',
          borderRight: '1px solid var(--border-dim)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-panel)',
          overflow: 'hidden',
        }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {puzzle ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--cyan)' }}>{puzzle.title}</h2>
                  <span className={`diff-${puzzle.difficulty}`}>{puzzle.difficulty}</span>
                </div>

                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.9rem', marginBottom: 20, whiteSpace: 'pre-wrap' }}>
                  {puzzle.description}
                </p>

                {puzzle.examples?.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
                      Examples
                    </div>
                    {puzzle.examples.slice(0, 3).map((ex: any, i: number) => (
                      <div key={i} style={{
                        background: 'var(--bg-deep)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--radius-md)',
                        padding: 12,
                        marginBottom: 8,
                        fontFamily: 'var(--font-code)',
                        fontSize: '0.8rem',
                      }}>
                        <div><span style={{ color: 'var(--text-muted)' }}>Input: </span><span style={{ color: 'var(--cyan)' }}>{ex.input}</span></div>
                        <div><span style={{ color: 'var(--text-muted)' }}>Output: </span><span style={{ color: 'var(--green)' }}>{ex.output}</span></div>
                      </div>
                    ))}
                  </div>
                )}

                {puzzle.tags?.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {puzzle.tags.map((tag: string) => (
                      <span key={tag} className="tag-chip">{tag}</span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                Loading puzzle...
              </div>
            )}
          </div>

          {/* Spell Panel at bottom */}
          <div style={{ padding: 16, borderTop: '1px solid var(--border-dim)' }}>
            <SpellPanel socket={socket} roomId={roomId} disabled={status !== 'ACTIVE'} />
          </div>
        </div>

        {/* RIGHT: Code Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#0d1117' }}>
          {/* Editor Toolbar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border-dim)',
          }}>
            <select
              value={langId}
              onChange={e => setLangId(Number(e.target.value))}
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border-dim)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                padding: '5px 10px',
                fontFamily: 'var(--font-ui)',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>

            {isSlowed && (
              <div style={{ color: 'var(--magenta)', fontWeight: 700, fontSize: '0.85rem', animation: 'blink 0.5s ease-in-out infinite' }}>
                🌀 SLOWED
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                id="forfeit-btn"
                onClick={handleForfeit}
                disabled={status === 'ENDED'}
                className="btn btn-sm btn-red"
              >
                Forfeit
              </button>
              <SubmitButton
                state={isSlowed ? 'disabled' : submitState}
                cooldownLeft={cooldownLeft}
                judgingProgress={judgingProgress}
                testCases={testCases}
                onClick={handleSubmit}
              />
            </div>
          </div>

          {/* Monaco Editor */}
          <div style={{ flex: 1, pointerEvents: isSlowed ? 'none' : 'auto', opacity: isSlowed ? 0.5 : 1 }}>
            <Editor
              height="100%"
              language={monacoLang}
              value={code}
              onChange={v => setCode(v || '')}
              onMount={(editor) => { editorRef.current = editor; }} // Bug #6: capture Monaco ref
              theme="vs-dark"
              options={{
                fontSize: 14,
                fontFamily: '"JetBrains Mono", monospace',
                minimap: { enabled: false },
                wordWrap: 'on',
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                readOnly: status === 'ENDED' || submitState === 'submitting' || submitState === 'judging',
                padding: { top: 12 },
              }}
            />
          </div>

          {/* Submit Result Banner */}
          {submitResult && (
            <div style={{
              padding: '10px 20px',
              background: submitResult.passed
                ? 'rgba(0,255,136,0.1)' : submitResult.passedTests > 0
                ? 'rgba(255,215,0,0.1)' : 'rgba(255,48,96,0.1)',
              borderTop: `1px solid ${submitResult.passed ? 'rgba(0,255,136,0.3)' : submitResult.passedTests > 0 ? 'rgba(255,215,0,0.3)' : 'rgba(255,48,96,0.3)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.85rem',
              animation: 'toast-in 0.3s ease',
            }}>
              <span style={{ color: submitResult.passed ? 'var(--green)' : submitResult.passedTests > 0 ? 'var(--gold)' : 'var(--red)', fontWeight: 700 }}>
                {submitResult.passed ? '✅ All tests passed!' : submitResult.passedTests > 0 ? `⚠️ ${submitResult.passedTests}/${submitResult.totalTests} tests passed` : '❌ No tests passed'}
              </span>
              {submitResult.damage > 0 && (
                <span style={{ color: 'var(--magenta)', fontWeight: 700, fontFamily: 'var(--font-code)' }}>
                  💥 -{submitResult.damage} HP dealt!
                </span>
              )}
              <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-code)' }}>
                ⚡ {Math.round(submitResult.avgRuntimeMs)}ms avg
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Countdown Overlay ──────────────────────────────────*/}
      {countdown !== null && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(4,8,16,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
        }}>
          <div key={countdown} className="countdown-number" style={{
            fontSize: countdown === 0 ? '5rem' : '12rem',
            fontWeight: 900,
            fontFamily: 'var(--font-code)',
            color: countdown > 1 ? 'var(--cyan)' : 'var(--green)',
            textShadow: `0 0 60px ${countdown > 1 ? 'rgba(0,245,255,0.7)' : 'rgba(0,255,136,0.7)'}`,
          }}>
            {countdown > 0 ? countdown : 'GO!'}
          </div>
        </div>
      )}

      {/* ── Battle End Overlay ────────────────────────────────*/}
      {status === 'ENDED' && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(4,8,16,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(8px)',
        }}>
          <div className="victory-card card-glow" style={{ padding: 48, textAlign: 'center', maxWidth: 450, width: '90%' }}>
            <div style={{ fontSize: '4rem', marginBottom: 12 }}>{isWinner ? '🏆' : '💀'}</div>
            <h2 style={{
              fontSize: '2.5rem', fontWeight: 900, marginBottom: 12,
              color: isWinner ? 'var(--gold)' : 'var(--red)',
              textShadow: isWinner ? 'var(--glow-gold)' : 'var(--glow-red)',
            }}>
              {isWinner ? 'VICTORY!' : 'DEFEAT'}
            </h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: '1.1rem' }}>
              Winner: <strong style={{ color: 'var(--text-primary)' }}>{winnerName}</strong>
            </p>
            <div style={{ fontFamily: 'var(--font-code)', fontSize: '1.4rem', fontWeight: 800, marginBottom: 32,
              color: isWinner ? 'var(--green)' : 'var(--red)',
            }}>
              ELO {isWinner ? '+' : ''}{eloChange}
            </div>
            <button id="play-again-btn" onClick={handlePlayAgain} className="btn btn-cyan btn-lg" style={{ width: '100%' }}>
              Play Again →
            </button>
          </div>
        </div>
      )}

      {/* ── Damage Toasts ────────────────────────────────────*/}
      <div style={{ position: 'fixed', top: 80, right: 16, zIndex: 40, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {damageToasts.map(t => (
          <div key={t.id} className="damage-toast" style={{
            padding: '8px 14px',
            background: 'var(--bg-card)',
            border: `1px solid ${t.color}`,
            borderRadius: 'var(--radius-md)',
            color: t.color,
            fontSize: '0.85rem',
            fontWeight: 700,
            maxWidth: 260,
            boxShadow: `0 0 12px ${t.color}40`,
          }}>
            {t.text}
          </div>
        ))}
      </div>

      {/* ── Achievement Toasts ───────────────────────────────*/}
      <div style={{ position: 'fixed', bottom: 24, right: 16, zIndex: 40, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {achievementToasts.map(a => (
          <div key={a.id} className="achievement-toast" style={{ padding: '12px 16px', maxWidth: 260 }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>
              🏅 Achievement Unlocked!
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.5rem' }}>{a.icon}</span>
              <span style={{ fontWeight: 700, color: 'var(--gold)' }}>{a.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
