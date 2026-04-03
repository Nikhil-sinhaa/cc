import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DbUser {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  elo: number;
  wins: number;
  losses: number;
  winStreak: number;
  spellsCast: number;
  hp: number;
  maxHp: number;
  avatar: string | null;
  createdAt: Date;
}

export interface DbProblem {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  p50RuntimeMs: number;
  tags: string;
  examples: string;
  testCases: string;
  createdAt: Date;
}

export interface DbMatch {
  id: string;
  player1Id: string;
  player2Id: string;
  problemId: string;
  status: string;
  createdAt: Date;
}

export interface DbSubmission {
  id: string;
  matchId: string;
  userId: string;
  problemId: string;
  code: string;
  language: string;
  passedTests: number;
  totalTests: number;
  execTimeMs: number;
  damageDealt: number;
  createdAt: Date;
}

export interface DbUserAchievement {
  id: string;
  userId: string;
  achievementId: string;
  achievementName: string;
  achievementIcon: string;
  earnedAt: Date;
}

// ─── Seed Data ────────────────────────────────────────────────────────────────

const SEED_PROBLEMS: Omit<DbProblem, 'createdAt'>[] = [
  {
    id: 'prob_two_sum',
    title: 'Two Sum',
    difficulty: 'easy',
    timeLimitMs: 300000,
    memoryLimitMb: 256,
    p50RuntimeMs: 80,
    description: `Given an array of integers \`nums\` and an integer \`target\`, return **indices** of the two numbers such that they add up to \`target\`.

You may assume that each input would have **exactly one solution**, and you may not use the same element twice.

**Example:**
\`\`\`
Input: nums = [2, 7, 11, 15], target = 9
Output: [0, 1]
\`\`\``,
    tags: JSON.stringify(['array', 'hash-table']),
    examples: JSON.stringify([
      { input: '[2,7,11,15], 9', output: '[0,1]', explanation: '2 + 7 = 9' },
      { input: '[3,2,4], 6', output: '[1,2]', explanation: '2 + 4 = 6' },
    ]),
    testCases: JSON.stringify([
      { input: '[2,7,11,15], 9', expectedOutput: '[0,1]', isHidden: false },
      { input: '[3,2,4], 6', expectedOutput: '[1,2]', isHidden: false },
      { input: '[3,3], 6', expectedOutput: '[0,1]', isHidden: true },
      { input: '[1,2,3,4,5], 9', expectedOutput: '[3,4]', isHidden: true },
    ]),
  },
  {
    id: 'prob_palindrome',
    title: 'Valid Palindrome',
    difficulty: 'easy',
    timeLimitMs: 300000,
    memoryLimitMb: 256,
    p50RuntimeMs: 60,
    description: `A phrase is a **palindrome** if, after converting all uppercase letters into lowercase letters and removing all non-alphanumeric characters, it reads the same forward and backward.

Given a string \`s\`, return \`true\` if it is a palindrome, or \`false\` otherwise.

**Example:**
\`\`\`
Input: s = "A man, a plan, a canal: Panama"
Output: true
\`\`\``,
    tags: JSON.stringify(['string', 'two-pointers']),
    examples: JSON.stringify([
      { input: '"A man, a plan, a canal: Panama"', output: 'true' },
      { input: '"race a car"', output: 'false' },
    ]),
    testCases: JSON.stringify([
      { input: '"A man, a plan, a canal: Panama"', expectedOutput: 'true', isHidden: false },
      { input: '"race a car"', expectedOutput: 'false', isHidden: false },
      { input: '" "', expectedOutput: 'true', isHidden: true },
      { input: '"abcba"', expectedOutput: 'true', isHidden: true },
    ]),
  },
  {
    id: 'prob_fizzbuzz',
    title: 'FizzBuzz',
    difficulty: 'easy',
    timeLimitMs: 300000,
    memoryLimitMb: 256,
    p50RuntimeMs: 50,
    description: `Given an integer \`n\`, return an array of strings where for each integer \`i\` from 1 to n:
- \`"FizzBuzz"\` if \`i\` is divisible by both 3 and 5
- \`"Fizz"\` if \`i\` is divisible by 3
- \`"Buzz"\` if \`i\` is divisible by 5
- \`i.toString()\` otherwise

**Example:**
\`\`\`
Input: n = 5
Output: ["1","2","Fizz","4","Buzz"]
\`\`\``,
    tags: JSON.stringify(['math', 'string', 'simulation']),
    examples: JSON.stringify([
      { input: '5', output: '["1","2","Fizz","4","Buzz"]' },
      { input: '15', output: '["1","2","Fizz","4","Buzz","Fizz","7","8","Fizz","Buzz","11","Fizz","13","14","FizzBuzz"]' },
    ]),
    testCases: JSON.stringify([
      { input: '5', expectedOutput: '["1","2","Fizz","4","Buzz"]', isHidden: false },
      { input: '3', expectedOutput: '["1","2","Fizz"]', isHidden: false },
      { input: '15', expectedOutput: '["1","2","Fizz","4","Buzz","Fizz","7","8","Fizz","Buzz","11","Fizz","13","14","FizzBuzz"]', isHidden: true },
    ]),
  },
  {
    id: 'prob_fibonacci',
    title: 'Fibonacci Number',
    difficulty: 'medium',
    timeLimitMs: 300000,
    memoryLimitMb: 256,
    p50RuntimeMs: 100,
    description: `The **Fibonacci numbers** are defined as:
- \`F(0) = 0\`
- \`F(1) = 1\`
- \`F(n) = F(n-1) + F(n-2)\` for \`n > 1\`

Given \`n\`, calculate \`F(n)\`.

**Example:**
\`\`\`
Input: n = 4
Output: 3
Explanation: F(4) = F(3) + F(2) = 2 + 1 = 3
\`\`\``,
    tags: JSON.stringify(['math', 'dynamic-programming', 'recursion']),
    examples: JSON.stringify([
      { input: '4', output: '3' },
      { input: '10', output: '55' },
    ]),
    testCases: JSON.stringify([
      { input: '4', expectedOutput: '3', isHidden: false },
      { input: '0', expectedOutput: '0', isHidden: false },
      { input: '1', expectedOutput: '1', isHidden: true },
      { input: '10', expectedOutput: '55', isHidden: true },
      { input: '20', expectedOutput: '6765', isHidden: true },
    ]),
  },
  {
    id: 'prob_valid_parens',
    title: 'Valid Parentheses',
    difficulty: 'medium',
    timeLimitMs: 300000,
    memoryLimitMb: 256,
    p50RuntimeMs: 70,
    description: `Given a string \`s\` containing just the characters \`'('\`, \`')'\`, \`'{'\`, \`'}'\`, \`'['\` and \`']'\`, determine if the input string is **valid**.

An input string is valid if:
1. Open brackets must be closed by the same type of brackets.
2. Open brackets must be closed in the correct order.
3. Every close bracket has a corresponding open bracket.

**Example:**
\`\`\`
Input: s = "()[]{}"
Output: true
\`\`\``,
    tags: JSON.stringify(['string', 'stack']),
    examples: JSON.stringify([
      { input: '"()[]{}"', output: 'true' },
      { input: '"(]"', output: 'false' },
    ]),
    testCases: JSON.stringify([
      { input: '"()[]{}"', expectedOutput: 'true', isHidden: false },
      { input: '"(]"', expectedOutput: 'false', isHidden: false },
      { input: '"()"', expectedOutput: 'true', isHidden: true },
      { input: '"([)]"', expectedOutput: 'false', isHidden: true },
      { input: '"{[]}"', expectedOutput: 'true', isHidden: true },
    ]),
  },
];

// ─── In-Memory Database ───────────────────────────────────────────────────────

class InMemoryDatabase {
  users: Map<string, DbUser> = new Map();
  problems: Map<string, DbProblem> = new Map();
  matches: Map<string, DbMatch> = new Map();
  submissions: Map<string, DbSubmission> = new Map();
  userAchievements: Map<string, DbUserAchievement> = new Map();

  private initialized = false;

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    // Seed problems
    for (const p of SEED_PROBLEMS) {
      this.problems.set(p.id, { ...p, createdAt: new Date() });
    }

    // Seed demo users
    const hash1 = await bcrypt.hash('password', 10);
    const hash2 = await bcrypt.hash('password', 10);

    const u1: DbUser = {
      id: 'user_dev',
      username: 'DevWarrior',
      email: 'dev@test.com',
      passwordHash: hash1,
      elo: 1250,
      wins: 12,
      losses: 5,
      winStreak: 3,
      spellsCast: 8,
      hp: 500,
      maxHp: 500,
      avatar: null,
      createdAt: new Date(),
    };

    const u2: DbUser = {
      id: 'user_p2',
      username: 'CodeNinja',
      email: 'player2@test.com',
      passwordHash: hash2,
      elo: 1100,
      wins: 6,
      losses: 8,
      winStreak: 0,
      spellsCast: 2,
      hp: 500,
      maxHp: 500,
      avatar: null,
      createdAt: new Date(),
    };

    this.users.set(u1.id, u1);
    this.users.set(u2.id, u2);

    console.log('✅ In-memory database initialized with demo data');
    console.log('   Demo users: dev@test.com / password, player2@test.com / password');
    console.log(`   Problems loaded: ${this.problems.size}`);
  }

  // ─── User Methods ─────────────────────────────────────────────────────────

  user = {
    findUnique: async ({ where, select }: any) => {
      let found: DbUser | undefined;
      if (where.id) found = this.users.get(where.id);
      else if (where.email) found = Array.from(this.users.values()).find(u => u.email === where.email);
      else if (where.username) found = Array.from(this.users.values()).find(u => u.username === where.username);
      if (!found) return null;
      return this._selectFields(found, select);
    },

    findFirst: async ({ where }: any) => {
      for (const user of this.users.values()) {
        if (where.OR) {
          for (const cond of where.OR) {
            if (cond.email && user.email === cond.email) return user;
            if (cond.username && user.username === cond.username) return user;
          }
        }
      }
      return null;
    },

    findMany: async ({ take, orderBy, select }: any = {}) => {
      let users = Array.from(this.users.values());
      if (orderBy?.elo === 'desc') users.sort((a, b) => b.elo - a.elo);
      if (take) users = users.slice(0, take);
      if (select) return users.map(u => this._selectFields(u, select));
      return users;
    },

    create: async ({ data, select }: any) => {
      const id = `user_${nanoid(8)}`;
      const user: DbUser = {
        id,
        username: data.username,
        email: data.email,
        passwordHash: data.passwordHash,
        elo: data.elo ?? 1000,
        wins: data.wins ?? 0,
        losses: data.losses ?? 0,
        winStreak: 0,
        spellsCast: 0,
        hp: 500,
        maxHp: 500,
        avatar: null,
        createdAt: new Date(),
      };
      this.users.set(id, user);
      if (select) return this._selectFields(user, select);
      return user;
    },

    update: async ({ where, data, select }: any) => {
      const user = this.users.get(where.id);
      if (!user) throw new Error(`User not found: ${where.id}`);

      if (data.elo !== undefined) user.elo = data.elo;
      if (data.elo?.increment !== undefined) user.elo += data.elo.increment;
      if (data.wins?.increment !== undefined) user.wins += data.wins.increment;
      if (data.losses?.increment !== undefined) user.losses += data.losses.increment;
      if (data.winStreak !== undefined) user.winStreak = data.winStreak;
      if (data.winStreak?.increment !== undefined) user.winStreak += data.winStreak.increment;
      if (data.spellsCast?.increment !== undefined) user.spellsCast += data.spellsCast.increment;

      this.users.set(user.id, user);
      if (select) return this._selectFields(user, select);
      return user;
    },
  };

  // ─── Problem Methods ──────────────────────────────────────────────────────

  problem = {
    findUnique: async ({ where, select }: any) => {
      const p = this.problems.get(where.id);
      if (!p) return null;
      return this._selectFields(p, select);
    },

    findMany: async ({ where, select, orderBy }: any = {}) => {
      let ps = Array.from(this.problems.values());
      if (where?.difficulty) ps = ps.filter(p => p.difficulty === where.difficulty);
      if (select) return ps.map(p => this._selectFields(p, select));
      return ps;
    },

    create: async ({ data, select }: any) => {
      const id = `prob_${nanoid(8)}`;
      const problem: DbProblem = {
        id,
        title: data.title,
        description: data.description,
        difficulty: data.difficulty,
        timeLimitMs: data.timeLimitMs,
        memoryLimitMb: data.memoryLimitMb,
        p50RuntimeMs: data.p50RuntimeMs ?? 1000,
        tags: typeof data.tags === 'string' ? data.tags : JSON.stringify(data.tags),
        examples: typeof data.examples === 'string' ? data.examples : JSON.stringify(data.examples),
        testCases: typeof data.testCases === 'string' ? data.testCases : JSON.stringify(data.testCases),
        createdAt: new Date(),
      };
      this.problems.set(id, problem);
      if (select) return this._selectFields(problem, select);
      return problem;
    },
  };

  // ─── Match Methods ────────────────────────────────────────────────────────

  match = {
    create: async ({ data }: any) => {
      const id = `match_${nanoid(8)}`;
      const match: DbMatch = {
        id,
        player1Id: data.player1Id,
        player2Id: data.player2Id,
        problemId: data.problemId,
        status: data.status ?? 'waiting',
        createdAt: new Date(),
      };
      this.matches.set(id, match);
      return match;
    },

    update: async ({ where, data }: any) => {
      const match = this.matches.get(where.id);
      if (!match) throw new Error(`Match not found: ${where.id}`);
      if (data.status) match.status = data.status;
      this.matches.set(match.id, match);
      return match;
    },
  };

  // ─── Submission Methods ───────────────────────────────────────────────────

  submission = {
    create: async ({ data }: any) => {
      const id = `sub_${nanoid(8)}`;
      const sub: DbSubmission = {
        id,
        matchId: data.matchId ?? '',
        userId: data.userId,
        problemId: data.problemId,
        code: data.code,
        language: data.language,
        passedTests: data.passedTests,
        totalTests: data.totalTests,
        execTimeMs: data.execTimeMs,
        damageDealt: data.damageDealt,
        createdAt: new Date(),
      };
      this.submissions.set(id, sub);
      return sub;
    },
  };

  // ─── UserAchievement Methods ──────────────────────────────────────────────

  userAchievement = {
    findMany: async ({ where, orderBy }: any = {}) => {
      let items = Array.from(this.userAchievements.values());
      if (where?.userId) items = items.filter(a => a.userId === where.userId);
      if (orderBy?.earnedAt === 'desc') items.sort((a, b) => b.earnedAt.getTime() - a.earnedAt.getTime());
      return items;
    },

    create: async ({ data }: any) => {
      // Check for duplicate
      const exists = Array.from(this.userAchievements.values()).find(
        a => a.userId === data.userId && a.achievementId === data.achievementId
      );
      if (exists) throw new Error('Unique constraint failed');

      const id = `ua_${nanoid(8)}`;
      const ua: DbUserAchievement = {
        id,
        userId: data.userId,
        achievementId: data.achievementId,
        achievementName: data.achievementName,
        achievementIcon: data.achievementIcon,
        earnedAt: new Date(),
      };
      this.userAchievements.set(id, ua);
      return ua;
    },
  };

  // ─── Helper ───────────────────────────────────────────────────────────────

  private _selectFields(obj: any, select: any): any {
    if (!select) return obj;
    const result: any = {};
    for (const key of Object.keys(select)) {
      if (select[key]) result[key] = obj[key];
    }
    return result;
  }
}

export const db = new InMemoryDatabase();
