import { create } from 'zustand';
import { Puzzle } from '@code-clash/shared-types/mvp-types';

interface BattleStore {
  roomId: string | null;
  puzzle: Puzzle | null;
  myHp: number;
  opponentHp: number;
  status: 'WAITING' | 'COUNTDOWN' | 'ACTIVE' | 'JUDGING' | 'ENDED';
  damageLog: DamageLogEntry[];
  timeRemaining: number;
  opponentName: string;
  winnerName: string | null;
  eloChange: number;
  
  setBattle: (roomId: string, puzzle: Puzzle, opponentName: string) => void;
  setHp: (myHp: number, opponentHp: number) => void;
  addDamage: (attackerName: string, damage: number) => void;
  setStatus: (status: BattleStore['status']) => void;
  setTimeRemaining: (seconds: number) => void;
  setEnd: (winnerName: string, eloChange: number) => void;
  reset: () => void;
}

interface DamageLogEntry {
  id: string;
  attackerName: string;
  damage: number;
  timestamp: number;
}

export const useBattleStore = create<BattleStore>((set, get) => ({
  roomId: null,
  puzzle: null,
  myHp: 500,
  opponentHp: 500,
  status: 'WAITING',
  damageLog: [],
  timeRemaining: 0,
  opponentName: '',
  winnerName: null,
  eloChange: 0,

  setBattle: (roomId: string, puzzle: Puzzle, opponentName: string) => {
    set({
      roomId,
      puzzle,
      opponentName,
      myHp: 500,
      opponentHp: 500,
      status: 'WAITING',
      damageLog: [],
      winnerName: null,
      eloChange: 0,
    });
  },

  setHp: (myHp: number, opponentHp: number) => {
    set({ myHp, opponentHp });
  },

  addDamage: (attackerName: string, damage: number) => {
    const newEntry: DamageLogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      attackerName,
      damage,
      timestamp: Date.now(),
    };

    set(state => ({
      damageLog: [...state.damageLog, newEntry],
    }));
  },

  setStatus: (status) => {
    set({ status });
  },

  setTimeRemaining: (seconds) => {
    set({ timeRemaining: seconds });
  },

  setEnd: (winnerName: string, eloChange: number) => {
    set({
      status: 'ENDED',
      winnerName,
      eloChange,
    });
  },

  reset: () => {
    set({
      roomId: null,
      puzzle: null,
      myHp: 500,
      opponentHp: 500,
      status: 'WAITING',
      damageLog: [],
      timeRemaining: 0,
      opponentName: '',
      winnerName: null,
      eloChange: 0,
    });
  },
}));
