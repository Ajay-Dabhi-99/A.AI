/** GET /health: process liveness only. Never touches dependencies. */
export type HealthResponse = {
  status: 'ok';
  service: 'a-ai-api';
  version: string;
  /** The deployed commit (Render sets it); null when unknown, e.g. locally. */
  commit: string | null;
  uptimeSeconds: number;
};

export type DependencyName = 'database' | 'redis';

export type DependencyCheck = {
  status: 'up' | 'down';
  latencyMs: number;
  /** Sanitized, human-readable reason. Never contains connection strings. */
  error?: string;
};

export type ProvidersCheck = {
  status: 'up' | 'down';
  /** Provider ids with credentials present. Never includes key values. */
  configured: string[];
};

/**
 * GET /ready: 200 only when Supabase PostgreSQL and Upstash Redis respond and
 * at least one AI provider is configured; 503 otherwise (blueprint v4 §14).
 */
export type ReadinessResponse = {
  status: 'ready' | 'not_ready';
  checks: Record<DependencyName, DependencyCheck> & { providers: ProvidersCheck };
};
