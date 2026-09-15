import type { PrismaClient } from '../generated/prisma/client.js';

/** Persistence for the model registry (Phase 3, ADR-010). */

export type ModelRegistryRecord = {
  id: string;
  provider: string;
  modelId: string;
  name: string;
  category: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  availability: string;
  enabled: boolean;
  sortOrder: number;
  inputPricePerMillionUsd: number | null;
  outputPricePerMillionUsd: number | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ModelRegistryPatch = Partial<
  Pick<
    ModelRegistryRecord,
    | 'name'
    | 'enabled'
    | 'sortOrder'
    | 'contextWindow'
    | 'maxOutputTokens'
    | 'availability'
    | 'inputPricePerMillionUsd'
    | 'outputPricePerMillionUsd'
    | 'verifiedAt'
  >
>;

/** A default row from the code catalog. */
export type ModelRegistryDefault = Omit<ModelRegistryRecord, 'id' | 'createdAt' | 'updatedAt'>;

export interface ModelRegistryRepository {
  /** Display order: sortOrder, then provider, then name. */
  list(): Promise<ModelRegistryRecord[]>;
  /** Null when the row does not exist. */
  update(id: string, patch: ModelRegistryPatch): Promise<ModelRegistryRecord | null>;
  /** Inserts defaults whose (provider, modelId) is not in the table yet; never overwrites. */
  insertMissing(defaults: readonly ModelRegistryDefault[]): Promise<number>;
}

type DecimalLike = { toNumber(): number } | null;

const toNumber = (value: DecimalLike): number | null => (value === null ? null : value.toNumber());

function isNotFound(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2025';
}

export function createPrismaModelRegistryRepository(prisma: PrismaClient): ModelRegistryRepository {
  const map = <
    T extends { inputPricePerMillionUsd: DecimalLike; outputPricePerMillionUsd: DecimalLike },
  >(
    row: T,
  ) => ({
    ...row,
    inputPricePerMillionUsd: toNumber(row.inputPricePerMillionUsd),
    outputPricePerMillionUsd: toNumber(row.outputPricePerMillionUsd),
  });

  return {
    list: async () =>
      (
        await prisma.modelRegistryEntry.findMany({
          orderBy: [{ sortOrder: 'asc' }, { provider: 'asc' }, { name: 'asc' }],
        })
      ).map(map),

    update: async (id, patch) => {
      try {
        return map(await prisma.modelRegistryEntry.update({ where: { id }, data: patch }));
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    insertMissing: async (defaults) => {
      const { count } = await prisma.modelRegistryEntry.createMany({
        data: [...defaults],
        skipDuplicates: true,
      });
      return count;
    },
  };
}
