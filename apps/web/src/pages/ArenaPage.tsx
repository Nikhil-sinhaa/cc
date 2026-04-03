import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { io, Socket } from 'socket.io-client'
import { SupportedLanguage } from '@code-clash/shared-types'
import { useAuthStore } from '../store/authStore'
import { useBattleStore } from '../store/battleStore'
import HealthBar from '../components/HealthBar'
import PuzzlePanel from '../components/PuzzlePanel'
import CodeEditor from '../components/CodeEditor'
import SpellBar from '../components/SpellBar'
import OutputPanel from '../components/OutputPanel'
import toast from 'react-hot-toast'

const ArenaPage: React.FC = () => {
  const { user, isAuthenticated } = useAuthStore()
  const {
    roomId,
    state: battleState,
    timeRemaining,
    player1,
    player2,
    puzzle,
    damageLog,
    opponentProgress,
    setBattleState,
    updateHealth,
    addDamageLog,
    updateOpponentProgress,
    setTimeRemaining,
    resetBattle,
    setCurrentUserId
  } = useBattleStore()

  const [socket, setSocket] = useState<Socket | null>(null)
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState<SupportedLanguage>('python')
  const [isRunning, setIsRunning] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testResults, setTestResults] = useState<any[]>([])
  const [lastDamage, setLastDamage] = useState(0)
  const [currentMana, setCurrentMana] = useState(100)

  // Initialize socket and user ID
  useEffect(() => {
    if (isAuthenticated && user) {
      setCurrentUserId(user.id)
      
      const newSocket = io(process.env.REACT_APP_SOCKET_URL || 'http://localhost:3001', {
        auth: {
          token: localStorage.getItem('accessToken'),
          userId: user.id
        }
      })

      newSocket.on('connect', () => {
        console.log('Connected to battle server')
      })

      newSocket.on('match:found', (battleData) => {
        setBattleState(battleData)
        toast.success('Battle found! Get ready to code!')
      })

      newSocket.on('battle:start', (data) => {
        console.log('Battle starting:', data)
      })

      newSocket.on('battle:damage', (data) => {
        const { sourcePlayer, targetPlayer, damage, targetHP } = data
        // Update the correct player's HP bar using the targetPlayer userId
        updateHealth(targetPlayer, targetHP)
        
        if (sourcePlayer !== user.id) {
          // Opponent dealt damage to us
          setLastDamage(damage)
          toast.error(`Opponent dealt ${damage} damage!`)
        } else {
          // We dealt damage to opponent
          toast.success(`You dealt ${damage} damage!`)
        }

        addDamageLog({
          id: Date.now().toString(),
          sourcePlayer,
          targetPlayer,
          damage,
          type: 'puzzle',
          timestamp: new Date()
        })
      })

      newSocket.on('battle:opponent_progress', (data) => {
        updateOpponentProgress(data)
      })

      newSocket.on('battle:spell_used', (data) => {
        const { caster, spellType, effect } = data
        toast(`${caster === user.id ? 'You' : 'Opponent'} used ${spellType}!`)
      })

      newSocket.on('battle:time_warning', (data) => {
        const { secondsLeft } = data
        if (secondsLeft <= 60) {
          toast.error(`Only ${secondsLeft} seconds remaining!`)
        }
      })

      newSocket.on('battle:end', (data) => {
        const { winner, loser, eloChange, rewards } = data
        if (winner === user.id) {
          toast.success(`Victory! +${rewards.winner.xp} XP, +${rewards.winner.tokens} tokens`)
        } else {
          toast.error(`Defeat. +${rewards.loser.xp} XP, +${rewards.loser.tokens} tokens`)
        }
        resetBattle()
      })

      newSocket.on('error', (error) => {
        toast.error(error.message || 'Battle error occurred')
      })

      newSocket.on('battle:submission_result', (data) => {
        const { passed, total } = data
        if (passed === 0) {
          toast.error('All tests failed! No damage dealt.')
        } else {
          toast(`${passed}/${total} tests passed`)
        }
      })

      setSocket(newSocket)

      return () => {
        newSocket.close()
      }
    }
  }, [isAuthenticated, user])

  // Timer countdown
  useEffect(() => {
    if (battleState === 'ACTIVE' && timeRemaining > 0) {
      const timer = setTimeout(() => {
        setTimeRemaining(timeRemaining - 1)
      }, 1000)
      return () => clearTimeout(timer)
    } else if (timeRemaining === 0) {
      // Time's up - auto forfeit
      handleForfeit()
    }
  }, [battleState, timeRemaining])

  // Mana regeneration
  useEffect(() => {
    if (battleState === 'ACTIVE' && currentMana < 100) {
      const manaTimer = setTimeout(() => {
        setCurrentMana(Math.min(100, currentMana + 1))
      }, 1000)
      return () => clearTimeout(manaTimer)
    }
  }, [battleState, currentMana])

  const handleRun = async () => {
    if (!puzzle || !code.trim()) return

    setIsRunning(true)
    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          language,
          problemId: puzzle.id
        })
      })

      const result = await response.json()
      setTestResults(result.testResults || [])
    } catch (error) {
      toast.error('Failed to run tests')
    } finally {
      setIsRunning(false)
    }
  }

  const handleSubmit = async () => {
    if (!puzzle || !code.trim() || !socket) return

    setIsSubmitting(true)
    try {
      socket.emit('battle:submit', {
        code,
        language,
        roomId
      })
    } catch (error) {
      toast.error('Failed to submit code')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCastSpell = (spellType: string) => {
    if (!socket) return

    socket.emit('battle:spell_cast', {
      spellType,
      roomId,
      targetUserId: player2?.userId
    })
  }

  const handleForfeit = () => {
    if (!socket) return
    socket.emit('battle:forfeit', { roomId })
  }

  const handleJoinQueue = () => {
    if (!socket || !user) return
    
    socket.emit('queue:join', {
      userId: user.id,
      elo: user.rank || 1000
    })
    toast.success('Joined matchmaking queue')
  }

  const handleLeaveQueue = () => {
    if (!socket) return
    socket.emit('queue:leave')
    toast('Left matchmaking queue')
  }

  const getCurrentPlayer = () => {
    if (!user || !player1 || !player2) return null
    return player1.userId === user.id ? player1 : player2
  }

  const getOpponentPlayer = () => {
    if (!user || !player1 || !player2) return null
    return player1.userId === user.id ? player2 : player1
  }

  const currentPlayer = getCurrentPlayer()
  const opponentPlayer = getOpponentPlayer()

  const spells = [
    {
      id: 'hint',
      type: 'HINT' as const,
      name: 'Hint',
      icon: '🔮',
      description: 'Reveals one hidden test case',
      cost: 50,
      usesRemaining: 3,
      isUnlocked: true
    },
    {
      id: 'freeze',
      type: 'TIME_FREEZE' as const,
      name: 'Freeze',
      icon: '⏩',
      description: 'Adds 30 seconds to timer',
      cost: 80,
      usesRemaining: 2,
      isUnlocked: true
    },
    {
      id: 'slow',
      type: 'SLOW' as const,
      name: 'Slow',
      icon: '🛡️',
      description: 'Slows opponent execution speed',
      cost: 100,
      usesRemaining: 1,
      isUnlocked: true
    }
  ]

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">Authentication Required</h1>
          <p className="text-dark-muted">Please log in to access the battle arena.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-dark-bg p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold neon-text mb-2">Battle Arena</h1>
          <div className="flex justify-between items-center">
            <p className="text-dark-muted">
              {battleState === 'WAITING' && 'Waiting for battle...'}
              {battleState === 'COUNTDOWN' && 'Get ready!'}
              {battleState === 'ACTIVE' && 'Battle in progress!'}
              {battleState === 'ENDED' && 'Battle completed!'}
            </p>
            
            {!roomId && (
              <div className="flex gap-2">
                <button onClick={handleJoinQueue} className="btn-primary">
                  Join Queue
                </button>
                <button onClick={handleLeaveQueue} className="btn-secondary">
                  Leave Queue
                </button>
              </div>
            )}
            
            {roomId && battleState === 'ACTIVE' && (
              <button onClick={handleForfeit} className="btn-danger">
                Forfeit
              </button>
            )}
          </div>
        </div>

        {/* Battle Arena */}
        {roomId && currentPlayer && opponentPlayer && puzzle ? (
          <div className="space-y-4">
            {/* Health Bars Header */}
            <div className="grid grid-cols-3 gap-4 items-center">
              <HealthBar
                currentHp={currentPlayer.hp}
                maxHp={currentPlayer.maxHp}
                playerName={currentPlayer.username}
                lastDamage={lastDamage}
              />
              
              <div className="text-center">
                <div className="text-2xl font-bold neon-text mb-2">VS</div>
                <div className="text-sm text-dark-muted">
                  Round {battleState === 'ACTIVE' ? '1' : '0'} • {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
                </div>
              </div>
              
              <HealthBar
                currentHp={opponentPlayer.hp}
                maxHp={opponentPlayer.maxHp}
                playerName={opponentPlayer.username}
                isOpponent={true}
              />
            </div>

            {/* Main Battle Area */}
            <div className="grid grid-cols-2 gap-4 h-[600px]">
              {/* Left Panel - Puzzle */}
              <PuzzlePanel
                puzzle={puzzle}
                timeRemaining={timeRemaining}
              />

              {/* Right Panel - Code Editor */}
              <CodeEditor
                code={code}
                language={language}
                onCodeChange={setCode}
                onLanguageChange={setLanguage}
                onRun={handleRun}
                onSubmit={handleSubmit}
                isRunning={isRunning}
                isSubmitting={isSubmitting}
                disabled={battleState !== 'ACTIVE'}
              />
            </div>

            {/* Bottom Section */}
            <div className="grid grid-cols-2 gap-4">
              {/* Spell Bar */}
              <SpellBar
                spells={spells}
                onCastSpell={handleCastSpell}
                disabled={battleState !== 'ACTIVE'}
                currentMana={currentMana}
              />

              {/* Output Panel */}
              <OutputPanel
                testResults={testResults}
                damageDealt={lastDamage}
                opponentActions={[
                  {
                    type: 'submission',
                    message: `Opponent submitted code (${opponentProgress.submissionCount} times)`,
                    timestamp: new Date()
                  }
                ]}
                isRunning={isRunning}
                isSubmitting={isSubmitting}
              />
            </div>
          </div>
        ) : (
          /* Waiting State */
          <div className="flex items-center justify-center h-[600px]">
            <div className="text-center">
              <div className="w-16 h-16 border-4 border-neon-green border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <h2 className="text-2xl font-bold mb-2">Ready to Battle?</h2>
              <p className="text-dark-muted mb-4">
                Join the queue to be matched with an opponent
              </p>
              <button onClick={handleJoinQueue} className="btn-primary">
                Find Match
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ArenaPage
