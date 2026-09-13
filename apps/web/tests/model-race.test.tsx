import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModelRace } from '../src/features/landing/model-race';
import {
  FASTEST_LANE_ID,
  laneFinishMs,
  laneFrameAt,
  RACE_LANES,
  RACE_SETTLED_MS,
} from '../src/features/landing/race-data';
import { mockMatchMedia } from '../vitest.setup';

const [fast, , , failing] = RACE_LANES;

describe('laneFrameAt', () => {
  it('waits before the first token, then streams, then settles', () => {
    if (!fast) throw new Error('fixture missing');
    expect(laneFrameAt(fast, 0)).toMatchObject({ status: 'waiting', text: '', estimatedTokens: 0 });

    const mid = laneFrameAt(fast, fast.firstTokenMs + 200);
    expect(mid.status).toBe('streaming');
    expect(mid.text.length).toBeGreaterThan(0);
    expect(fast.response.startsWith(mid.text)).toBe(true);

    const end = laneFrameAt(fast, laneFinishMs(fast) + 1000);
    expect(end).toMatchObject({
      status: 'done',
      text: fast.response,
      elapsedMs: laneFinishMs(fast),
    });
  });

  it('fails the scripted lane at its failure time and freezes its clock', () => {
    if (!failing?.failure) throw new Error('fixture missing');
    expect(laneFrameAt(failing, failing.failure.atMs - 1).status).toBe('streaming');
    expect(laneFrameAt(failing, failing.failure.atMs + 5000)).toMatchObject({
      status: 'failed',
      elapsedMs: failing.failure.atMs,
    });
  });

  it('never marks a failing lane as fastest', () => {
    expect(FASTEST_LANE_ID).toBe(fast?.id);
    expect(RACE_SETTLED_MS).toBe(Math.max(...RACE_LANES.map(laneFinishMs)));
  });
});

describe('<ModelRace />', () => {
  it('shows the settled result immediately for reduced-motion users', () => {
    mockMatchMedia((query) => query.includes('prefers-reduced-motion'));
    render(<ModelRace />);

    const fastLane = screen.getByRole('article', { name: /llama 3\.3 70b/i });
    expect(within(fastLane).getByText('Fastest')).toBeInTheDocument();
    const failedLane = screen.getByRole('article', { name: /qwen 2\.5 72b/i });
    expect(within(failedLane).getByText('Failed')).toBeInTheDocument();
    expect(within(failedLane).getByText(/other models keep running/i)).toBeInTheDocument();
    mockMatchMedia();
  });
});
