// In-memory database replaces PostgreSQL/Prisma (no Docker needed)
import { db } from './inMemoryDb';

// Export as `prisma` so all existing imports work without changing any consumers
export const prisma = db as any;

// Initialize the in-memory DB (seeds demo users + problems)
db.init().catch(console.error);
