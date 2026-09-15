import { randomUUID } from 'node:crypto';
import type {
  ModelRegistryRecord,
  ModelRegistryRepository,
} from '../../src/repositories/model-registry.repository.js';

export type MemoryModelRegistry = ModelRegistryRepository & {
  rows: ModelRegistryRecord[];
  insertCalls: number;
};

/** In-memory model registry; the Prisma version runs in the live suite. */
export function createMemoryModelRegistry(): MemoryModelRegistry {
  const rows: ModelRegistryRecord[] = [];
  const copy = (row: ModelRegistryRecord): ModelRegistryRecord => ({ ...row });

  const registry: MemoryModelRegistry = {
    rows,
    insertCalls: 0,

    list: async () =>
      [...rows]
        .sort(
          (a, b) =>
            a.sortOrder - b.sortOrder ||
            a.provider.localeCompare(b.provider) ||
            a.name.localeCompare(b.name),
        )
        .map(copy),

    update: async (id, patch) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: new Date(row.updatedAt.getTime() + 1) });
      return copy(row);
    },

    insertMissing: async (defaults) => {
      registry.insertCalls += 1;
      let inserted = 0;
      for (const entry of defaults) {
        if (rows.some((row) => row.provider === entry.provider && row.modelId === entry.modelId))
          continue;
        const now = new Date('2026-09-14T08:00:00.000Z');
        rows.push({ ...entry, id: randomUUID(), createdAt: now, updatedAt: now });
        inserted += 1;
      }
      return inserted;
    },
  };
  return registry;
}
