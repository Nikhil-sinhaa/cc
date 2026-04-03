import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { InMemoryRedis, inMemoryRedis } from './lib/inMemoryRedis';

import { AuthMiddleware } from './middleware/auth';
import { MatchmakingService } from './services/matchmaking';
import { BattleService } from './services/battle';
import { SpellService } from './services/spellService';
import { UserService } from './services/userService';
import { AchievementService } from './services/achievementService';
import { ProblemService } from './services/problemService';

dotenv.config();

const app = express();
const server = createServer(app);

// Allow any localhost origin (handles Vite auto-assigning ports like 5174)
const isAllowedOrigin = (origin: string | undefined) =>
  !origin ||
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
  origin === (process.env.CLIENT_URL || 'http://localhost:3000');

// Middleware
app.use(cors({
  origin: (origin, cb) => cb(null, isAllowedOrigin(origin) ? origin : false),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));
app.use(express.json());
app.use(express.static('public'));

// In-memory Redis (no external process needed)
const redis: InMemoryRedis = inMemoryRedis;

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin) ? origin : false),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ─── Socket Registry (THE FIX) ──────────────────────────────────────────────
// Maps userId → Socket. This was the critical missing piece — matchmaking
// couldn't notify players because getUserSocket always returned null.
const socketRegistry = new Map<string, Socket>();

// Services (cast redis to any — InMemoryRedis matches the duck type)
const matchmakingService = new MatchmakingService(io, redis as any, socketRegistry);
const battleService = new BattleService(io, redis as any, socketRegistry);
const spellService = new SpellService(redis as any);

// ─── REST Routes ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    message: '⚔️ CodeClash Arena API',
    version: '2.0.0',
    status: 'operational',
    endpoints: {
      auth: { register: 'POST /auth/register', login: 'POST /auth/login' },
      profile: { me: 'GET /profile/me', achievements: 'GET /profile/achievements' },
      game: { leaderboard: 'GET /leaderboard', problems: 'GET /api/problems' },
      spells: 'GET /api/spells',
    },
  });
});

// Auth
app.post('/auth/register', AuthMiddleware.rateLimiter, AuthMiddleware.register);
app.post('/auth/login', AuthMiddleware.rateLimiter, AuthMiddleware.login);

// Profile
app.get('/profile/me', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const user = await UserService.getUserById((req as any).user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.get('/profile/achievements', AuthMiddleware.authenticate, async (req, res) => {
  try {
    const userId = (req as any).user.id;
    const [earned, definitions] = await Promise.all([
      AchievementService.getUserAchievements(userId),
      Promise.resolve(AchievementService.getAllDefinitions()),
    ]);
    res.json({ earned, definitions });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

// Leaderboard
app.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const leaderboard = await UserService.getLeaderboard(limit);
    const ranked = leaderboard.map((user: any, index: number) => ({
      rank: index + 1,
      ...user,
      winRate: user.wins + user.losses > 0
        ? ((user.wins / (user.wins + user.losses)) * 100).toFixed(1)
        : '0.0',
      tier: getEloTier(user.elo),
    }));
    res.json(ranked);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Problems
app.get('/api/problems', async (req, res) => {
  try {
    const problems = await ProblemService.getAllProblems();
    res.json(problems);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch problems' });
  }
});

app.get('/api/problems/random', async (req, res) => {
  try {
    const problem = await ProblemService.getRandomProblem();
    if (!problem) return res.status(404).json({ error: 'No problems available' });
    res.json(problem);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch problem' });
  }
});

// Spell info
app.get('/api/spells', (_req, res) => {
  res.json(SpellService.getSpellInfo());
});

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── Authentication ──────────────────────────────────────────────────────────
  socket.on('authenticate', async (data: { token: string }) => {
    try {
      const payload = AuthMiddleware.verifyToken(data.token);
      (socket as any).userId = payload.userId;
      (socket as any).username = payload.username;
      (socket as any).elo = payload.elo || 1000;

      // Update socket registry to the latest socket for this user
      socketRegistry.set(payload.userId, socket);
      await redis.setEx(`session:${payload.userId}`, 3600, socket.id);

      console.log(`[Auth] ${payload.username} authenticated (ELO: ${(socket as any).elo})`);
      socket.emit('authenticated', { userId: payload.userId, username: payload.username });
    } catch {
      socket.emit('auth:error', 'Invalid token');
    }
  });

  // ── Queue ───────────────────────────────────────────────────────────────────
  socket.on('queue:join', async (data?: { userId?: string; elo?: number }) => {
    const userId = (socket as any).userId || data?.userId;
    if (!userId) {
      socket.emit('queue:error', 'Authenticate first');
      return;
    }

    // Check for session conflict (multiple tabs)
    const existingSocketId = await redis.get(`session:${userId}`);
    if (existingSocketId && existingSocketId !== socket.id) {
      socket.emit('session:conflict', {
        message: 'You have another active session. Please close other tabs first.',
        existingSocketId
      });
      
      // Disconnect the new socket to prevent conflicts
      socket.disconnect();
      return;
    }

    // Register this socket as the active session
    await redis.setEx(`session:${userId}`, 3600, socket.id); // 1 hour TTL

    const elo = (socket as any).elo || data?.elo || 1000;
    await matchmakingService.addToQueue(userId, elo);
    socket.emit('queue:joined', { message: 'Entered matchmaking queue' });
  });

  socket.on('queue:leave', async () => {
    const userId = (socket as any).userId;
    if (userId) await matchmakingService.removeFromQueue(userId);
  });

  // ── Battle ──────────────────────────────────────────────────────────────────
  socket.on('battle:submit', async (data: { code: string; languageId: number; roomId: string }) => {
    const userId = (socket as any).userId;
    if (!userId) { socket.emit('error', 'Not authenticated'); return; }
    await battleService.handleSubmit(socket, { ...data, userId });
  });

  socket.on('battle:forfeit', async (data: { roomId: string }) => {
    const userId = (socket as any).userId;
    if (!userId) { socket.emit('error', 'Not authenticated'); return; }
    await battleService.handleForfeit(socket, { ...data, userId });
  });

  socket.on('battle:ready', async (data: { roomId: string }) => {
    await battleService.startCountdown(data.roomId);
  });

  // ── Battle Rejoin (battle page mounts fresh socket, needs to rejoin room) ────
  socket.on('battle:rejoin', async (data: { roomId: string }) => {
    const userId = (socket as any).userId;
    if (!userId) { socket.emit('error', 'Not authenticated'); return; }

    const { roomId } = data;
    const battleState = await battleService.getBattleStatePublic(roomId);
    if (!battleState) {
      socket.emit('battle:rejoin_failed', { reason: 'battle_not_found' });
      return;
    }

    // Verify this user is in this battle
    if (battleState.player1Id !== userId && battleState.player2Id !== userId) {
      socket.emit('battle:rejoin_failed', { reason: 'not_in_battle' });
      return;
    }

    // Join the socket.io room
    socket.join(roomId);
    console.log(`[Rejoin] ${(socket as any).username} rejoined battle room ${roomId} (status: ${battleState.status})`);

    // If battle is active, immediately tell the client to start
    if (battleState.status === 'ACTIVE') {
      socket.emit('battle:start', {});
    } else if (battleState.status === 'COUNTDOWN') {
      socket.emit('battle:countdown', { secondsLeft: 1 });
    } else if (battleState.status === 'ENDED') {
      socket.emit('battle:end_state', battleState);
    }

    // Send current HP state
    socket.emit('battle:state_sync', {
      hp1: battleState.hp1,
      hp2: battleState.hp2,
      status: battleState.status,
      player1Id: battleState.player1Id,
      player2Id: battleState.player2Id,
    });
  });

  // ── Spells ──────────────────────────────────────────────────────────────────
  socket.on('spell:cast', async (data: {
    roomId: string;
    spellType: 'hint' | 'time_freeze' | 'slow';
  }) => {
    const casterId = (socket as any).userId;
    if (!casterId) { socket.emit('error', 'Not authenticated'); return; }

    try {
      const battleState = await battleService.getBattleStatePublic(data.roomId);
      if (!battleState) { socket.emit('spell:error', 'Battle not found'); return; }

      const targetId = battleState.player1Id === casterId
        ? battleState.player2Id
        : battleState.player1Id;

      const testCases = await battleService.getPuzzleTestCases(data.roomId);
      const result = await spellService.castSpell(
        data.roomId, casterId, targetId, data.spellType, testCases
      );

      if (!result.success) {
        socket.emit('spell:error', result.error);
        return;
      }

      // Notify caster of mana update
      const mana = await spellService.getMana(data.roomId, casterId);
      socket.emit('spell:cast_success', {
        spellType: data.spellType,
        mana: mana.current,
        hintText: result.hintText,
      });

      // Notify caster of hint (private)
      if (data.spellType === 'hint' && result.hintText) {
        socket.emit('spell:hint', { text: result.hintText });
      }

      // Notify opponent of incoming spell effect
      const targetSocket = socketRegistry.get(targetId);
      if (targetSocket) {
        targetSocket.emit('spell:incoming', {
          spellType: data.spellType,
          casterName: (socket as any).username,
          duration: data.spellType === 'time_freeze' ? 15000 : data.spellType === 'slow' ? 10000 : 0,
        });
      }

      // Broadcast spell animation to room
      io.to(data.roomId).emit('spell:animation', {
        spellType: data.spellType,
        casterName: (socket as any).username,
      });

      // Track spell cast for achievements
      await UserService.incrementSpellsCast(casterId);

    } catch (e) {
      console.error('[Spell] Error:', e);
      socket.emit('spell:error', 'Spell failed');
    }
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    const userId = (socket as any).userId;
    if (userId) {
      socketRegistry.delete(userId);
      
      // Clear session if this was the active socket
      const activeSocketId = await redis.get(`session:${userId}`);
      if (activeSocketId === socket.id) {
        await redis.del(`session:${userId}`);
      }
      
      // Check if user was in an active battle and start grace timer
      const userBattles = await redis.keys('battle:*');
      for (const battleKey of userBattles) {
        const battleState = await redis.get(battleKey);
        if (battleState) {
          const battle = JSON.parse(battleState);
          if ((battle.player1Id === userId || battle.player2Id === userId) && 
              battle.status === 'ACTIVE') {
            // Start 30-second grace timer for reconnection
            await redis.setEx(`grace:${userId}`, 30, JSON.stringify({
              battleId: battleKey.replace('battle:', ''),
              disconnectedAt: Date.now(),
              wasPlayer1: battle.player1Id === userId
            }));
            console.log(`[Grace] Started 30s timer for disconnected user: ${userId}`);
            break;
          }
        }
      }
      
      matchmakingService.removeFromQueue(userId);
    }
    console.log(`[Socket] Disconnected: ${socket.id}`);
  });

  // ── Reconnection Check ───────────────────────────────────────────────────────
  socket.on('check:reconnection', async (data: { userId: string }) => {
    const { userId } = data;
    const graceData = await redis.get(`grace:${userId}`);
    
    if (graceData) {
      const grace = JSON.parse(graceData);
      const timeSinceDisconnect = Date.now() - grace.disconnectedAt;
      
      if (timeSinceDisconnect < 30000) { // Within 30 seconds
        // Restore user session
        (socket as any).userId = userId;
        socketRegistry.set(userId, socket);
        
        // Clear grace timer
        await redis.del(`grace:${userId}`);
        
        socket.emit('reconnection:success', {
          battleId: grace.battleId,
          wasPlayer1: grace.wasPlayer1
        });
        
        console.log(`[Reconnection] User ${userId} reconnected successfully`);
      } else {
        // Grace period expired - forfeit the battle
        await handleGraceTimeout(userId, grace.battleId);
        socket.emit('reconnection:failed', { reason: 'grace_period_expired' });
      }
    } else {
      socket.emit('reconnection:failed', { reason: 'no_grace_period' });
    }
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getEloTier(elo: number): string {
  if (elo >= 2000) return 'Diamond';
  if (elo >= 1700) return 'Platinum';
  if (elo >= 1400) return 'Gold';
  if (elo >= 1200) return 'Silver';
  return 'Bronze';
}

// ─── Grace Timeout Handler ─────────────────────────────────────────────────────
async function handleGraceTimeout(userId: string, battleId: string) {
  try {
    const battleState = await redis.get(`battle:${battleId}`);
    if (battleState) {
      const battle = JSON.parse(battleState);
      if (battle.status === 'ACTIVE') {
        // Forfeit the battle for the disconnected player
        if (battle.player1Id === userId) {
          battle.hp1 = 0;
        } else {
          battle.hp2 = 0;
        }
        
        // Use battle service to end the battle properly
        const winnerId = battle.player1Id === userId ? battle.player2Id : battle.player1Id;
        await battleService.endBattle(battleId, battle, winnerId);
        
        console.log(`[Grace] Auto-forfeited battle ${battleId} for disconnected user ${userId}`);
      }
    }
    
    // Clean up grace timer
    await redis.del(`grace:${userId}`);
  } catch (error) {
    console.error('[Grace] Error handling timeout:', error);
  }
}

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // In-memory Redis — no connection needed
    console.log('✅ In-memory Redis ready');

    server.listen(PORT, () => {
      console.log(`🚀 CodeClash server running on port ${PORT}`);
      console.log(`   Socket.io: ws://localhost:${PORT}`);
      console.log(`   Demo: dev@test.com / password`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// ─── Cleanup Orphaned Grace Timers ─────────────────────────────────────────────
async function cleanupOrphanedGraceTimers() {
  try {
    const graceKeys = await redis.keys('grace:*');
    const now = Date.now();
    
    for (const key of graceKeys) {
      const graceData = await redis.get(key);
      if (graceData) {
        const grace = JSON.parse(graceData);
        const timeSinceDisconnect = now - grace.disconnectedAt;
        
        if (timeSinceDisconnect >= 30000) {
          await handleGraceTimeout(key.replace('grace:', ''), grace.battleId);
        }
      }
    }
    
    console.log(`[Cleanup] Processed ${graceKeys.length} grace timers`);
  } catch (error) {
    console.error('[Cleanup] Error:', error);
  }
}

startServer();
