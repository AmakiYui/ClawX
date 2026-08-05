import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CronLiveRunOverlayChange,
  CronLiveRunOverlaySnapshot,
  CronLiveRunOverlaySnapshotSet,
} from '@shared/chat/cron-live-run';

const boundaryMock = vi.hoisted(() => ({
  liveRunOverlays: vi.fn<() => Promise<CronLiveRunOverlaySnapshotSet>>(),
  listener: null as ((change: CronLiveRunOverlayChange) => void) | null,
  onChanged: vi.fn((listener: (change: CronLiveRunOverlayChange) => void) => {
    boundaryMock.listener = listener;
    return () => { boundaryMock.listener = null; };
  }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    cron: {
      liveRunOverlays: boundaryMock.liveRunOverlays,
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  hostEvents: {
    onCronLiveRunOverlayChanged: boundaryMock.onChanged,
  },
}));

const BASE_KEY = 'agent:main:cron:daily-report';
const OTHER_BASE_KEY = 'agent:main:cron:weekly-report';

function snapshot(
  runId: string,
  revision: number,
  overrides: Partial<CronLiveRunOverlaySnapshot> = {},
): CronLiveRunOverlaySnapshot {
  return {
    canonicalSessionKey: BASE_KEY,
    sourceSessionKey: `${BASE_KEY}:run:session-${runId}`,
    runSessionId: `session-${runId}`,
    runId,
    revision,
    status: 'running',
    updatedAt: revision,
    assistantText: `content-${runId}-${revision}`,
    thinking: false,
    items: [],
    ...overrides,
  };
}

function upsert(value: CronLiveRunOverlaySnapshot): CronLiveRunOverlayChange {
  return { kind: 'upsert', revision: value.revision, snapshot: value };
}

function remove(
  runId: string,
  revision: number,
  overrides: Partial<Extract<CronLiveRunOverlayChange, { kind: 'remove' }>> = {},
): Extract<CronLiveRunOverlayChange, { kind: 'remove' }> {
  return {
    kind: 'remove',
    revision,
    canonicalSessionKey: BASE_KEY,
    sourceSessionKey: `${BASE_KEY}:run:session-${runId}`,
    runId,
    reason: 'ended',
    terminalStatus: 'completed',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function importStore() {
  vi.resetModules();
  return import('@/stores/cron-live-run-overlay');
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('cron live-run overlay store', () => {
  beforeEach(() => {
    boundaryMock.liveRunOverlays.mockReset();
    boundaryMock.onChanged.mockClear();
    boundaryMock.listener = null;
    boundaryMock.liveRunOverlays.mockResolvedValue({ revision: 0, snapshots: [] });
  });

  it('subscribes before hydrating and prevents concurrent hydration requests', async () => {
    const order: string[] = [];
    const hydration = deferred<CronLiveRunOverlaySnapshotSet>();
    boundaryMock.onChanged.mockImplementationOnce((listener) => {
      order.push('subscribe');
      boundaryMock.listener = listener;
      return () => { boundaryMock.listener = null; };
    });
    boundaryMock.liveRunOverlays.mockImplementationOnce(() => {
      order.push('snapshot');
      return hydration.promise;
    });
    const { ensureCronLiveRunOverlaySubscriptions } = await importStore();

    ensureCronLiveRunOverlaySubscriptions();
    ensureCronLiveRunOverlaySubscriptions();

    expect(order).toEqual(['subscribe', 'snapshot']);
    expect(boundaryMock.onChanged).toHaveBeenCalledTimes(1);
    expect(boundaryMock.liveRunOverlays).toHaveBeenCalledTimes(1);

    hydration.resolve({ revision: 0, snapshots: [] });
    await flushPromises();
  });

  it('retries hydration after rejection without adding another listener', async () => {
    boundaryMock.liveRunOverlays
      .mockRejectedValueOnce(new Error('snapshot unavailable'))
      .mockResolvedValueOnce({ revision: 2, snapshots: [snapshot('retry', 2)] });
    const {
      ensureCronLiveRunOverlaySubscriptions,
      useCronLiveRunOverlayStore,
    } = await importStore();

    ensureCronLiveRunOverlaySubscriptions();
    await flushPromises();
    ensureCronLiveRunOverlaySubscriptions();
    await flushPromises();

    expect(boundaryMock.onChanged).toHaveBeenCalledTimes(1);
    expect(boundaryMock.liveRunOverlays).toHaveBeenCalledTimes(2);
    expect(useCronLiveRunOverlayStore.getState()).toEqual(expect.objectContaining({
      revision: 2,
      snapshots: [snapshot('retry', 2)],
    }));
  });

  it('does not hydrate again after the first successful snapshot', async () => {
    boundaryMock.liveRunOverlays.mockResolvedValueOnce({
      revision: 1,
      snapshots: [snapshot('hydrated', 1)],
    });
    const { ensureCronLiveRunOverlaySubscriptions } = await importStore();

    ensureCronLiveRunOverlaySubscriptions();
    await flushPromises();
    ensureCronLiveRunOverlaySubscriptions();
    await flushPromises();

    expect(boundaryMock.onChanged).toHaveBeenCalledTimes(1);
    expect(boundaryMock.liveRunOverlays).toHaveBeenCalledTimes(1);
  });

  it('ignores older snapshots and changes after a newer change', async () => {
    const hydration = deferred<CronLiveRunOverlaySnapshotSet>();
    boundaryMock.liveRunOverlays.mockReturnValueOnce(hydration.promise);
    const {
      ensureCronLiveRunOverlaySubscriptions,
      useCronLiveRunOverlayStore,
    } = await importStore();

    ensureCronLiveRunOverlaySubscriptions();
    boundaryMock.listener?.(upsert(snapshot('newer', 2)));
    hydration.resolve({ revision: 1, snapshots: [snapshot('stale', 1)] });
    await flushPromises();

    expect(useCronLiveRunOverlayStore.getState()).toEqual(expect.objectContaining({
      revision: 2,
      snapshots: [snapshot('newer', 2)],
    }));

    boundaryMock.listener?.(remove('newer', 1));
    expect(useCronLiveRunOverlayStore.getState()).toEqual(expect.objectContaining({
      revision: 2,
      snapshots: [snapshot('newer', 2)],
      pendingRemovals: [],
    }));
  });

  it('upserts by canonical session and run ID without cross-session collisions', async () => {
    const { ensureCronLiveRunOverlaySubscriptions, useCronLiveRunOverlayStore } = await importStore();
    ensureCronLiveRunOverlaySubscriptions();

    boundaryMock.listener?.(upsert(snapshot('shared', 1)));
    boundaryMock.listener?.(upsert(snapshot('shared', 2, { assistantText: 'replacement' })));
    boundaryMock.listener?.(upsert(snapshot('other-run', 3)));
    boundaryMock.listener?.(upsert(snapshot('shared', 4, {
      canonicalSessionKey: OTHER_BASE_KEY,
      sourceSessionKey: `${OTHER_BASE_KEY}:run:session-shared`,
    })));

    const state = useCronLiveRunOverlayStore.getState();
    expect(state.snapshots).toHaveLength(3);
    expect(state.snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalSessionKey: BASE_KEY, runId: 'shared', assistantText: 'replacement' }),
      expect.objectContaining({ canonicalSessionKey: BASE_KEY, runId: 'other-run' }),
      expect.objectContaining({ canonicalSessionKey: OTHER_BASE_KEY, runId: 'shared' }),
    ]));
  });

  it('removes live content immediately without retaining it as history', async () => {
    const { ensureCronLiveRunOverlaySubscriptions, useCronLiveRunOverlayStore } = await importStore();
    ensureCronLiveRunOverlaySubscriptions();
    boundaryMock.listener?.(upsert(snapshot('run-1', 1, { assistantText: 'transient secret' })));

    boundaryMock.listener?.(remove('run-1', 2));

    const state = useCronLiveRunOverlayStore.getState();
    expect(state.snapshots).toEqual([]);
    expect(state.pendingRemovals).toEqual([
      expect.objectContaining({ revision: 2, runId: 'run-1', reason: 'ended' }),
    ]);
    expect(JSON.stringify(state.pendingRemovals)).not.toContain('transient secret');
  });

  it('retains at most 128 distinct pending removals in revision order', async () => {
    const { ensureCronLiveRunOverlaySubscriptions, useCronLiveRunOverlayStore } = await importStore();
    ensureCronLiveRunOverlaySubscriptions();

    for (let revision = 1; revision <= 130; revision += 1) {
      boundaryMock.listener?.(remove(`run-${revision % 3}`, revision));
    }
    boundaryMock.listener?.(remove('run-1', 130));

    const revisions = useCronLiveRunOverlayStore.getState().pendingRemovals.map((entry) => entry.revision);
    expect(revisions).toHaveLength(128);
    expect(revisions).toEqual(Array.from({ length: 128 }, (_, index) => index + 3));
  });

  it('acknowledges only the pending removal with the exact revision', async () => {
    const { ensureCronLiveRunOverlaySubscriptions, useCronLiveRunOverlayStore } = await importStore();
    ensureCronLiveRunOverlaySubscriptions();
    boundaryMock.listener?.(remove('run-a', 1));
    boundaryMock.listener?.(remove('run-b', 2));
    boundaryMock.listener?.(remove('run-a', 3));

    useCronLiveRunOverlayStore.getState().acknowledgeRemoval(2);

    expect(useCronLiveRunOverlayStore.getState().pendingRemovals.map((entry) => entry.revision))
      .toEqual([1, 3]);
  });

  it('does not restore an acknowledged removal when its host change is redelivered', async () => {
    boundaryMock.liveRunOverlays.mockResolvedValueOnce({
      revision: 5,
      snapshots: [snapshot('run-a', 5)],
    });
    const { ensureCronLiveRunOverlaySubscriptions, useCronLiveRunOverlayStore } = await importStore();
    ensureCronLiveRunOverlaySubscriptions();
    await flushPromises();
    const terminal = remove('run-a', 5);

    boundaryMock.listener?.(terminal);
    expect(useCronLiveRunOverlayStore.getState().pendingRemovals.map(({ revision }) => revision))
      .toEqual([5]);
    useCronLiveRunOverlayStore.getState().acknowledgeRemoval(5);
    boundaryMock.listener?.(terminal);

    expect(useCronLiveRunOverlayStore.getState()).toEqual(expect.objectContaining({
      revision: 5,
      snapshots: [],
      pendingRemovals: [],
    }));
  });

  it('preserves both terminal signals when visible and inactive runs end in one burst', async () => {
    const {
      ensureCronLiveRunOverlaySubscriptions,
      selectCronLiveRunsForSession,
      useCronLiveRunOverlayStore,
    } = await importStore();
    ensureCronLiveRunOverlaySubscriptions();
    boundaryMock.listener?.(upsert(snapshot('visible-a', 1)));
    boundaryMock.listener?.(upsert(snapshot('inactive-b', 2, {
      canonicalSessionKey: OTHER_BASE_KEY,
      sourceSessionKey: `${OTHER_BASE_KEY}:run:session-inactive-b`,
    })));
    expect(selectCronLiveRunsForSession(useCronLiveRunOverlayStore.getState(), BASE_KEY))
      .toHaveLength(1);

    boundaryMock.listener?.(remove('visible-a', 3));
    boundaryMock.listener?.(remove('inactive-b', 4, {
      canonicalSessionKey: OTHER_BASE_KEY,
      sourceSessionKey: `${OTHER_BASE_KEY}:run:session-inactive-b`,
    }));

    const state = useCronLiveRunOverlayStore.getState();
    expect(state.snapshots).toEqual([]);
    expect(state.pendingRemovals.map(({ canonicalSessionKey, runId, revision }) => ({
      canonicalSessionKey,
      runId,
      revision,
    }))).toEqual([
      { canonicalSessionKey: BASE_KEY, runId: 'visible-a', revision: 3 },
      { canonicalSessionKey: OTHER_BASE_KEY, runId: 'inactive-b', revision: 4 },
    ]);
  });

  it('selects overlays by exact base cron session key only', async () => {
    const {
      ensureCronLiveRunOverlaySubscriptions,
      selectCronLiveRunsForSession,
      useCronLiveRunOverlayStore,
    } = await importStore();
    ensureCronLiveRunOverlaySubscriptions();
    boundaryMock.listener?.(upsert(snapshot('run-1', 1)));
    const state = useCronLiveRunOverlayStore.getState();

    expect(selectCronLiveRunsForSession(state, BASE_KEY).map(({ runId }) => runId)).toEqual(['run-1']);
    expect(selectCronLiveRunsForSession(state, `${BASE_KEY}:run:session-run-1`)).toEqual([]);
    expect(selectCronLiveRunsForSession(state, `${BASE_KEY}:extra`)).toEqual([]);
    expect(selectCronLiveRunsForSession(state, null)).toEqual([]);
  });

  it('returns exact-session overlays in deterministic snapshot order', async () => {
    const {
      ensureCronLiveRunOverlaySubscriptions,
      selectCronLiveRunsForSession,
      useCronLiveRunOverlayStore,
    } = await importStore();
    ensureCronLiveRunOverlaySubscriptions();
    boundaryMock.listener?.(upsert(snapshot('later-id', 1, { updatedAt: 20 })));
    boundaryMock.listener?.(upsert(snapshot('z-run', 2, { updatedAt: 10 })));
    boundaryMock.listener?.(upsert(snapshot('a-run', 3, { updatedAt: 10 })));

    expect(selectCronLiveRunsForSession(useCronLiveRunOverlayStore.getState(), BASE_KEY)
      .map(({ runId }) => runId)).toEqual(['a-run', 'z-run', 'later-id']);
  });

  it('stores eviction and gateway reset reasons without terminal refresh markers', async () => {
    const { ensureCronLiveRunOverlaySubscriptions, useCronLiveRunOverlayStore } = await importStore();
    ensureCronLiveRunOverlaySubscriptions();
    boundaryMock.listener?.(remove('evicted', 1, {
      reason: 'evicted',
      terminalStatus: undefined,
    }));
    boundaryMock.listener?.(remove('reset', 2, {
      reason: 'gateway-reset',
      terminalStatus: undefined,
    }));

    const pending = useCronLiveRunOverlayStore.getState().pendingRemovals;
    expect(pending.map(({ reason }) => reason)).toEqual(['evicted', 'gateway-reset']);
    expect(pending.every((entry) => !('shouldRefresh' in entry) && !('terminal' in entry))).toBe(true);
  });
});
