import Redis from 'ioredis';
import { QueueEntry, BattleRoom, BattleParticipant, BattleStateData, REDIS_KEYS, MATCHMAKING_CONFIG } from '@code-clash/shared-types';

export class RedisService {
  private client: Redis;
  private subscriber: Redis;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
    });

    this.subscriber = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    this.subscriber.on('error', (err) => {
      console.error('Redis Subscriber Error:', err);
    });
  }

  // Queue Management
  async addToQueue(entry: QueueEntry): Promise<void> {
    const score = entry.elo;
    const value = JSON.stringify(entry);
    
    await this.client.zadd(REDIS_KEYS.QUEUE, score, value);
    await this.client.expire(REDIS_KEYS.QUEUE, MATCHMAKING_CONFIG.QUEUE_TIMEOUT / 1000);
  }

  async removeFromQueue(userId: string): Promise<void> {
    const queueEntries = await this.client.zrange(REDIS_KEYS.QUEUE, 0, -1);
    
    for (const entry of queueEntries) {
      const parsed: QueueEntry = JSON.parse(entry);
      if (parsed.userId === userId) {
        await this.client.zrem(REDIS_KEYS.QUEUE, entry);
        break;
      }
    }
  }

  async getQueueEntries(): Promise<QueueEntry[]> {
    const entries = await this.client.zrange(REDIS_KEYS.QUEUE, 0, -1);
    return entries.map(entry => JSON.parse(entry));
  }

  async getQueueSize(): Promise<number> {
    return this.client.zcard(REDIS_KEYS.QUEUE);
  }

  async findMatch(elo: number, maxEloDiff: number): Promise<QueueEntry | null> {
    const minElo = Math.max(0, elo - maxEloDiff);
    const maxElo = elo + maxEloDiff;

    const entries = await this.client.zrangebyscore(
      REDIS_KEYS.QUEUE,
      minElo,
      maxElo,
      'LIMIT',
      0,
      10
    );

    if (entries.length === 0) return null;

    // Find the closest ELO match
    let bestMatch: QueueEntry | null = null;
    let minDiff = maxEloDiff;

    for (const entry of entries) {
      const parsed: QueueEntry = JSON.parse(entry);
      const diff = Math.abs(parsed.elo - elo);
      
      if (diff < minDiff) {
        minDiff = diff;
        bestMatch = parsed;
      }
    }

    return bestMatch;
  }

  // Battle Room Management
  async createBattleRoom(room: BattleRoom, participants: BattleParticipant[]): Promise<void> {
    const roomKey = REDIS_KEYS.BATTLE_ROOM + room.id;
    const stateKey = REDIS_KEYS.BATTLE_STATE + room.id;
    const participantsKey = REDIS_KEYS.BATTLE_PARTICIPANTS + room.id;

    // Store room data
    await this.client.hset(roomKey, {
      id: room.id,
      player1Id: room.player1Id,
      player2Id: room.player2Id,
      puzzleId: room.puzzleId,
      state: room.state,
      startedAt: room.startedAt?.toISOString() || '',
      endedAt: room.endedAt?.toISOString() || '',
      timeLimit: room.timeLimit.toString(),
      currentRound: room.currentRound.toString(),
    });

    // Store participant data
    const participantData = {
      player1: JSON.stringify(participants[0]),
      player2: JSON.stringify(participants[1]),
    };
    await this.client.hset(participantsKey, participantData);

    // Store initial battle state
    const battleState: BattleStateData = {
      room,
      player1: participants[0],
      player2: participants[1],
      puzzle: null as any, // Will be set separately
      timeRemaining: room.timeLimit,
      currentTurn: participants[0].userId,
    };
    await this.client.hset(stateKey, {
      data: JSON.stringify(battleState),
      lastUpdate: new Date().toISOString(),
    });

    // Set TTL for battle keys
    const ttlSeconds = MATCHMAKING_CONFIG.BATTLE_TIMEOUT / 1000;
    await this.client.expire(roomKey, ttlSeconds);
    await this.client.expire(stateKey, ttlSeconds);
    await this.client.expire(participantsKey, ttlSeconds);

    // Map users to battle room
    await this.client.set(REDIS_KEYS.USER_BATTLE + participants[0].userId, room.id, 'EX', ttlSeconds);
    await this.client.set(REDIS_KEYS.USER_BATTLE + participants[1].userId, room.id, 'EX', ttlSeconds);
  }

  async getBattleRoom(roomId: string): Promise<BattleRoom | null> {
    const roomKey = REDIS_KEYS.BATTLE_ROOM + roomId;
    const roomData = await this.client.hgetall(roomKey);

    if (!roomData.id) return null;

    return {
      id: roomData.id,
      player1Id: roomData.player1Id,
      player2Id: roomData.player2Id,
      puzzleId: roomData.puzzleId,
      state: roomData.state as BattleState,
      startedAt: roomData.startedAt ? new Date(roomData.startedAt) : undefined,
      endedAt: roomData.endedAt ? new Date(roomData.endedAt) : undefined,
      timeLimit: parseInt(roomData.timeLimit),
      currentRound: parseInt(roomData.currentRound),
    };
  }

  async getBattleParticipants(roomId: string): Promise<BattleParticipant[]> {
    const participantsKey = REDIS_KEYS.BATTLE_PARTICIPANTS + roomId;
    const participantsData = await this.client.hgetall(participantsKey);

    if (!participantsData.player1 || !participantsData.player2) return [];

    return [
      JSON.parse(participantsData.player1),
      JSON.parse(participantsData.player2),
    ];
  }

  async getBattleState(roomId: string): Promise<BattleStateData | null> {
    const stateKey = REDIS_KEYS.BATTLE_STATE + roomId;
    const stateData = await this.client.hgetall(stateKey);

    if (!stateData.data) return null;

    return JSON.parse(stateData.data);
  }

  async updateBattleState(roomId: string, state: Partial<BattleStateData>): Promise<void> {
    const stateKey = REDIS_KEYS.BATTLE_STATE + roomId;
    const currentState = await this.getBattleState(roomId);
    
    if (!currentState) throw new Error('Battle state not found');

    const updatedState = { ...currentState, ...state };
    
    await this.client.hset(stateKey, {
      data: JSON.stringify(updatedState),
      lastUpdate: new Date().toISOString(),
    });
  }

  async updateParticipant(roomId: string, userId: string, updates: Partial<BattleParticipant>): Promise<void> {
    const participantsKey = REDIS_KEYS.BATTLE_PARTICIPANTS + roomId;
    const participants = await this.getBattleParticipants(roomId);
    
    const participantIndex = participants.findIndex(p => p.userId === userId);
    if (participantIndex === -1) throw new Error('Participant not found');

    participants[participantIndex] = { ...participants[participantIndex], ...updates };
    
    const participantData = {
      player1: JSON.stringify(participants[0]),
      player2: JSON.stringify(participants[1]),
    };
    
    await this.client.hset(participantsKey, participantData);
  }

  async updateBattleRoom(roomId: string, updates: Partial<BattleRoom>): Promise<void> {
    const roomKey = REDIS_KEYS.BATTLE_ROOM + roomId;
    const currentRoom = await this.getBattleRoom(roomId);
    
    if (!currentRoom) throw new Error('Battle room not found');

    const updatedRoom = { ...currentRoom, ...updates };
    
    await this.client.hset(roomKey, {
      id: updatedRoom.id,
      player1Id: updatedRoom.player1Id,
      player2Id: updatedRoom.player2Id,
      puzzleId: updatedRoom.puzzleId,
      state: updatedRoom.state,
      startedAt: updatedRoom.startedAt?.toISOString() || '',
      endedAt: updatedRoom.endedAt?.toISOString() || '',
      timeLimit: updatedRoom.timeLimit.toString(),
      currentRound: updatedRoom.currentRound.toString(),
    });
  }

  async setParticipantDisconnected(roomId: string, userId: string, isDisconnected: boolean): Promise<void> {
    await this.updateParticipant(roomId, userId, { 
      isDisconnected,
      lastActivity: new Date(),
    });
  }

  async isParticipantDisconnected(roomId: string, userId: string): Promise<boolean> {
    const participants = await this.getBattleParticipants(roomId);
    const participant = participants.find(p => p.userId === userId);
    return participant?.isDisconnected || false;
  }

  async getUserBattleRoom(userId: string): Promise<string | null> {
    return this.client.get(REDIS_KEYS.USER_BATTLE + userId);
  }

  async removeUserFromBattle(userId: string): Promise<void> {
    await this.client.del(REDIS_KEYS.USER_BATTLE + userId);
  }

  async deleteBattleRoom(roomId: string): Promise<void> {
    const roomKey = REDIS_KEYS.BATTLE_ROOM + roomId;
    const stateKey = REDIS_KEYS.BATTLE_STATE + roomId;
    const participantsKey = REDIS_KEYS.BATTLE_PARTICIPANTS + roomId;

    // Get participants to remove their battle mappings
    const participants = await this.getBattleParticipants(roomId);
    for (const participant of participants) {
      await this.removeUserFromBattle(participant.userId);
    }

    // Delete all battle-related keys
    await this.client.del(roomKey, stateKey, participantsKey);
  }

  // Pub/Sub for real-time events
  async publish(channel: string, message: any): Promise<void> {
    await this.client.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, callback: (message: any) => void): Promise<void> {
    await this.subscriber.subscribe(channel);
    
    this.subscriber.on('message', (receivedChannel, message) => {
      if (receivedChannel === channel) {
        try {
          callback(JSON.parse(message));
        } catch (error) {
          console.error('Error parsing pub/sub message:', error);
        }
      }
    });
  }

  // Pattern-based subscribe for wildcard channels (e.g. 'battle:*:start')
  async psubscribe(pattern: string, callback: (channel: string, message: any) => void): Promise<void> {
    await this.subscriber.psubscribe(pattern);

    this.subscriber.on('pmessage', (_pattern, receivedChannel, message) => {
      if (_pattern === pattern) {
        try {
          callback(receivedChannel, JSON.parse(message));
        } catch (error) {
          console.error('Error parsing psubscribe message:', error);
        }
      }
    });
  }

  // Utility methods
  async ping(): Promise<string> {
    return this.client.ping();
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
    await this.subscriber.disconnect();
  }

  // Health check
  async isHealthy(): Promise<boolean> {
    try {
      await this.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Additional Redis operations for spells
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async setex(key: string, seconds: number, value: string): Promise<void> {
    await this.client.setex(key, seconds, value);
  }

  async lpush(key: string, value: string): Promise<number> {
    return this.client.lpush(key, value);
  }

  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.lrange(key, start, stop);
  }

  async lrem(key: string, count: number, value: string): Promise<number> {
    return this.client.lrem(key, count, value);
  }

  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, mode?: string, duration?: number): Promise<string | null> {
    if (mode === 'EX' && duration) {
      return this.client.set(key, value, 'EX', duration);
    }
    return this.client.set(key, value);
  }

  async del(key: string): Promise<number> {
    return this.client.del(key);
  }

  // Redis sorted set operations for leaderboards
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  async zrevrange(key: string, start: number, stop: number, withScores?: string): Promise<string[]> {
    if (withScores === 'WITHSCORES') {
      return this.client.zrevrange(key, start, stop, 'WITHSCORES');
    }
    return this.client.zrevrange(key, start, stop);
  }

  async zrange(key: string, start: number, stop: number, withScores?: string): Promise<string[]> {
    if (withScores === 'WITHSCORES') {
      return this.client.zrange(key, start, stop, 'WITHSCORES');
    }
    return this.client.zrange(key, start, stop);
  }

  async zrevrank(key: string, member: string): Promise<number | null> {
    return this.client.zrevrank(key, member);
  }

  async zscore(key: string, member: string): Promise<number | null> {
    return this.client.zscore(key, member);
  }

  // Additional Redis operations for rate limiting
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  // Additional sorted set operations for rate limiting
  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.client.zremrangebyscore(key, min, max);
  }

  async zrange(key: string, start: number, stop: string, options?: 'WITHSCORES'): Promise<string[]> {
    return this.client.zrange(key, start, stop, options);
  }
}

export const redisService = new RedisService();
