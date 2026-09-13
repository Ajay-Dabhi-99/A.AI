/**
 * Scripted data for the landing-page preview. It is illustrative, labelled as
 * such in the UI, and never presented as a real benchmark.
 */

export type LaneColor = 'lane-1' | 'lane-2' | 'lane-3' | 'lane-4';

export type RaceLane = {
  id: string;
  model: string;
  provider: string;
  color: LaneColor;
  response: string;
  /** Milliseconds until the first token appears. */
  firstTokenMs: number;
  /** Streaming speed in characters per second. */
  charsPerSecond: number;
  /** When set, the lane fails at this time instead of finishing. */
  failure?: { atMs: number; message: string };
};

export const RACE_PROMPT = 'Explain vector databases to a product manager in two sentences.';

export const RACE_LANES: RaceLane[] = [
  {
    id: 'llama',
    model: 'Llama 3.3 70B',
    provider: 'Groq',
    color: 'lane-1',
    firstTokenMs: 180,
    charsPerSecond: 420,
    response:
      'A vector database stores meaning instead of exact words, so it can find items that are similar even when they share no keywords. That is what lets search, recommendations and AI assistants answer "show me things like this" in milliseconds.',
  },
  {
    id: 'gemini',
    model: 'Gemini 2.5 Flash',
    provider: 'Google',
    color: 'lane-2',
    firstTokenMs: 420,
    charsPerSecond: 260,
    response:
      'Think of it as a search engine for ideas: every document becomes a list of numbers that captures what it means. Similar ideas land close together, so the database can return the most relevant content for a question instantly.',
  },
  {
    id: 'deepseek',
    model: 'DeepSeek V3',
    provider: 'OpenRouter',
    color: 'lane-3',
    firstTokenMs: 850,
    charsPerSecond: 150,
    response:
      'Vector databases index embeddings, numeric fingerprints of text or images, and retrieve the nearest matches by similarity. For a product, that means relevant results and grounded AI answers without hand-built keyword rules.',
  },
  {
    id: 'qwen',
    model: 'Qwen 2.5 72B',
    provider: 'OpenRouter',
    color: 'lane-4',
    firstTokenMs: 600,
    charsPerSecond: 200,
    response: 'A vector database helps software understand similarity by',
    failure: { atMs: 1500, message: 'Rate limited by provider. Other models keep running.' },
  },
];

export type LaneFrame = {
  status: 'waiting' | 'streaming' | 'done' | 'failed';
  text: string;
  /** Elapsed time shown for the lane: frozen when it finishes or fails. */
  elapsedMs: number;
  /** Rough token estimate (~4 characters per token), labelled as an estimate in the UI. */
  estimatedTokens: number;
};

export function laneFinishMs(lane: RaceLane): number {
  if (lane.failure) return lane.failure.atMs;
  return lane.firstTokenMs + Math.ceil((lane.response.length / lane.charsPerSecond) * 1000);
}

/** Pure: the state of one lane at time `t`. Deterministic, so it is easy to test. */
export function laneFrameAt(lane: RaceLane, t: number): LaneFrame {
  const finishMs = laneFinishMs(lane);
  const streamedChars = Math.max(
    0,
    Math.floor(((t - lane.firstTokenMs) / 1000) * lane.charsPerSecond),
  );
  const text = lane.response.slice(0, Math.min(streamedChars, lane.response.length));
  const estimatedTokens = Math.ceil(text.length / 4);

  if (lane.failure && t >= lane.failure.atMs) {
    return { status: 'failed', text, elapsedMs: lane.failure.atMs, estimatedTokens };
  }
  if (t < lane.firstTokenMs)
    return { status: 'waiting', text: '', elapsedMs: t, estimatedTokens: 0 };
  if (t >= finishMs)
    return { status: 'done', text: lane.response, elapsedMs: finishMs, estimatedTokens };
  return { status: 'streaming', text, elapsedMs: t, estimatedTokens };
}

/** Time at which every lane has settled. */
export const RACE_SETTLED_MS = Math.max(...RACE_LANES.map(laneFinishMs));

/** The fastest successful lane, used for the "Fastest" badge. */
export const FASTEST_LANE_ID = RACE_LANES.filter((lane) => !lane.failure).sort(
  (a, b) => laneFinishMs(a) - laneFinishMs(b),
)[0]?.id;
