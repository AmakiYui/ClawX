import { create } from 'zustand';
import type {
  CronLiveRunOverlayChange,
  CronLiveRunOverlaySnapshot,
  CronLiveRunOverlaySnapshotSet,
} from '@shared/chat/cron-live-run';
import { hostApi } from '@/lib/host-api';
import { hostEvents } from '@/lib/host-events';

const MAX_PENDING_REMOVALS = 128;
const MAX_PROCESSED_CHANGE_REVISIONS = 128;
const processedChangeRevisions = new Set<number>();
const processedChangeRevisionOrder: number[] = [];

export type CronLiveRunOverlayRemoval = Extract<
  CronLiveRunOverlayChange,
  { kind: 'remove' }
>;

export interface CronLiveRunOverlayState {
  revision: number;
  snapshots: CronLiveRunOverlaySnapshot[];
  pendingRemovals: CronLiveRunOverlayRemoval[];
  acknowledgeRemoval: (revision: number) => void;
}

function snapshotKey(snapshot: Pick<CronLiveRunOverlaySnapshot, 'canonicalSessionKey' | 'runId'>): string {
  return JSON.stringify([snapshot.canonicalSessionKey, snapshot.runId]);
}

function removalKey(removal: CronLiveRunOverlayRemoval): string {
  return JSON.stringify([removal.canonicalSessionKey, removal.runId, removal.revision]);
}

function compareSnapshots(
  left: CronLiveRunOverlaySnapshot,
  right: CronLiveRunOverlaySnapshot,
): number {
  return left.updatedAt - right.updatedAt
    || left.runId.localeCompare(right.runId)
    || left.canonicalSessionKey.localeCompare(right.canonicalSessionKey);
}

function normalizeSnapshots(snapshots: CronLiveRunOverlaySnapshot[]): CronLiveRunOverlaySnapshot[] {
  const byKey = new Map<string, CronLiveRunOverlaySnapshot>();
  for (const snapshot of snapshots) byKey.set(snapshotKey(snapshot), snapshot);
  return [...byKey.values()].sort(compareSnapshots);
}

export const useCronLiveRunOverlayStore = create<CronLiveRunOverlayState>((set) => ({
  revision: 0,
  snapshots: [],
  pendingRemovals: [],

  acknowledgeRemoval(revision) {
    set((state) => {
      const index = state.pendingRemovals.findIndex((removal) => removal.revision === revision);
      if (index < 0) return {};
      return {
        pendingRemovals: [
          ...state.pendingRemovals.slice(0, index),
          ...state.pendingRemovals.slice(index + 1),
        ],
      };
    });
  },
}));

function applySnapshotSet(snapshotSet: CronLiveRunOverlaySnapshotSet): void {
  useCronLiveRunOverlayStore.setState((state) => {
    if (snapshotSet.revision < state.revision) return {};
    return {
      revision: snapshotSet.revision,
      snapshots: normalizeSnapshots(snapshotSet.snapshots),
    };
  });
}

function applyChange(change: CronLiveRunOverlayChange): void {
  useCronLiveRunOverlayStore.setState((state) => {
    if (
      change.revision < state.revision
      || processedChangeRevisions.has(change.revision)
    ) return {};

    processedChangeRevisions.add(change.revision);
    processedChangeRevisionOrder.push(change.revision);
    if (processedChangeRevisionOrder.length > MAX_PROCESSED_CHANGE_REVISIONS) {
      const oldestRevision = processedChangeRevisionOrder.shift();
      if (oldestRevision !== undefined) processedChangeRevisions.delete(oldestRevision);
    }

    if (change.kind === 'upsert') {
      const key = snapshotKey(change.snapshot);
      return {
        revision: change.revision,
        snapshots: normalizeSnapshots([
          ...state.snapshots.filter((snapshot) => snapshotKey(snapshot) !== key),
          change.snapshot,
        ]),
      };
    }

    const key = snapshotKey(change);
    const pendingKey = removalKey(change);
    const pendingRemovals = state.pendingRemovals.some(
      (removal) => removalKey(removal) === pendingKey,
    )
      ? state.pendingRemovals
      : [...state.pendingRemovals, change]
          .sort((left, right) => left.revision - right.revision)
          .slice(-MAX_PENDING_REMOVALS);
    return {
      revision: change.revision,
      snapshots: state.snapshots.filter((snapshot) => snapshotKey(snapshot) !== key),
      pendingRemovals,
    };
  });
}

let subscribed = false;
let hydrationComplete = false;
let hydrationInFlight: Promise<void> | null = null;

export function ensureCronLiveRunOverlaySubscriptions(): void {
  if (!subscribed) {
    subscribed = true;
    hostEvents.onCronLiveRunOverlayChanged(applyChange);
  }
  if (hydrationComplete || hydrationInFlight) return;

  let request: Promise<CronLiveRunOverlaySnapshotSet>;
  try {
    request = hostApi.cron.liveRunOverlays();
  } catch {
    return;
  }
  const hydration = request.then(
    (snapshotSet) => {
      applySnapshotSet(snapshotSet);
      hydrationComplete = true;
    },
    () => undefined,
  );
  hydrationInFlight = hydration;
  void hydration.then(() => {
    if (hydrationInFlight === hydration) hydrationInFlight = null;
  });
}

export function selectCronLiveRunsForSession(
  state: Pick<CronLiveRunOverlayState, 'snapshots'>,
  sessionKey: string | null | undefined,
): CronLiveRunOverlaySnapshot[] {
  if (!sessionKey) return [];
  return state.snapshots.filter((snapshot) => snapshot.canonicalSessionKey === sessionKey);
}
