// In-memory Redis compatible client
// Implements the exact methods used by this codebase

interface RedisEntry {
  value: string;
  expiresAt: number | null; // null = no expiry
}

export class InMemoryRedis {
  private store: Map<string, RedisEntry> = new Map();

  private isExpired(entry: RedisEntry): boolean {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  private getEntry(key: string): RedisEntry | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  // Simulate async connect (no-op)
  async connect(): Promise<void> {
    console.log('✅ In-memory Redis ready (no external process needed)');
  }

  async get(key: string): Promise<string | null> {
    const entry = this.getEntry(key);
    return entry ? entry.value : null;
  }

  async set(
    key: string,
    value: string,
    options?: { NX?: boolean; EX?: number; PX?: number }
  ): Promise<string | null> {
    if (options?.NX) {
      const existing = this.getEntry(key);
      if (existing) return null; // Key already exists — NX fails
    }
    const expiresAt = options?.EX
      ? Date.now() + options.EX * 1000
      : options?.PX
      ? Date.now() + options.PX
      : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async setEx(key: string, seconds: number, value: string): Promise<string> {
    this.store.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.store.has(key);
    this.store.delete(key);
    return existed ? 1 : 0;
  }

  async keys(pattern: string): Promise<string[]> {
    // Support simple glob patterns like 'battle:*', 'grace:*', 'queue:*'
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // escape regex special chars
      .replace(/\*/g, '.*'); // glob * → regex .*
    const regex = new RegExp(`^${regexPattern}$`);

    const result: string[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (!this.isExpired(entry) && regex.test(key)) {
        result.push(key);
      }
    }
    return result;
  }

  // Get remaining TTL in seconds (-2 = key doesn't exist, -1 = no expiry)
  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return -2;
    }
    if (entry.expiresAt === null) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }

  // Atomic increment (creates key with value "1" if it doesn't exist)
  async incr(key: string): Promise<number> {
    const entry = this.getEntry(key);
    const current = entry ? parseInt(entry.value, 10) || 0 : 0;
    const next = current + 1;
    const expiresAt = entry?.expiresAt ?? null;
    this.store.set(key, { value: String(next), expiresAt });
    return next;
  }

  // Atomic decrement by N
  async decrby(key: string, amount: number): Promise<number> {
    const entry = this.getEntry(key);
    const current = entry ? parseInt(entry.value, 10) || 0 : 0;
    const next = current - amount;
    const expiresAt = entry?.expiresAt ?? null;
    this.store.set(key, { value: String(next), expiresAt });
    return next;
  }

  // Lua eval — used for atomic lock release
  // We implement the specific pattern used in battle.ts
  async eval(script: string, ...rest: any[]): Promise<any> {
    // The only eval call in the codebase is the lock release Lua script.
    // Pattern: get a value and delete a key if it matches.
    // We parse the keys from the script inline.
    const delMatch = script.match(/del.*?"([^"]+)"/);
    const getMatch = script.match(/get.*?"([^"]+)"/);
    if (getMatch && delMatch) {
      const getKey = getMatch[1];
      const delKey = delMatch[1];
      const currentVal = await this.get(getKey);
      const expectedMatch = script.match(/==\s*"([^"]+)"/);
      if (expectedMatch && currentVal === expectedMatch[1]) {
        await this.del(delKey);
        return 1;
      }
      return 0;
    }
    return 0;
  }

  // Cleanup helper (not in Redis API but useful for testing)
  flushAll(): void {
    this.store.clear();
  }
}

export const inMemoryRedis = new InMemoryRedis();
