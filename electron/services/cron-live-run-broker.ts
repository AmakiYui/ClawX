import { createHash, type Hash } from 'node:crypto';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';
import type { GatewayManager } from '../gateway/manager';
import type {
  CronLiveRunItem,
  CronLiveRunOverlayChange,
  CronLiveRunOverlaySnapshot,
  CronLiveRunOverlaySnapshotSet,
} from '../../shared/chat/cron-live-run';
import {
  getCronSessionBaseKey,
  parseCronSessionKey,
} from '../../shared/chat/cron-session';

interface ActiveCronLiveRun {
  snapshot: CronLiveRunOverlaySnapshot;
  fingerprintOrder: string[];
  fingerprints: Set<string>;
}

export const MAX_CRON_LIVE_EVENT_FINGERPRINTS = 256;
export const MAX_ACTIVE_CRON_LIVE_RUNS = 32;
export const MAX_CRON_LIVE_ITEMS_PER_RUN = 128;
export const MAX_CRON_LIVE_ASSISTANT_CHARS = 500_000;
export const MAX_CRON_LIVE_ITEM_DETAIL_CHARS = 100_000;
export const MAX_CRON_LIVE_TERMINAL_TOMBSTONES = 128;
export const MAX_CRON_LIVE_TRAVERSAL_DEPTH = 64;
export const MAX_CRON_LIVE_TRAVERSAL_NODES = 2_048;
export const MAX_CRON_LIVE_TRAVERSAL_KEYS = 1_024;
export const MAX_CRON_LIVE_TRAVERSAL_STRING_CHARS = 16_384;

const DEPTH_MARKER = '[Truncated:Depth]';
const NODE_MARKER = '[Truncated:Nodes]';
const KEY_MARKER = '[Truncated:Keys]';
const PROPERTY_MARKER = '[Unserializable:Property]';
const INVALID_DATE_MARKER = '[Invalid:Date]';
const OUTPUT_MARKER = '[Truncated:Output]';

interface TraversalState {
  nodes: number;
  keys: number;
}

type BoundedKeys = { keys: string[] } | { marker: string };

function stringMarker(length: number): string {
  return `[Truncated:String:${length}]`;
}

function truncateTraversalString(value: string): string {
  if (value.length <= MAX_CRON_LIVE_TRAVERSAL_STRING_CHARS) return value;
  const marker = stringMarker(value.length);
  return `${value.slice(0, MAX_CRON_LIVE_TRAVERSAL_STRING_CHARS - marker.length)}${marker}`;
}

function enterTraversalNode(state: TraversalState, depth: number): string | undefined {
  if (depth > MAX_CRON_LIVE_TRAVERSAL_DEPTH) return DEPTH_MARKER;
  state.nodes += 1;
  return state.nodes > MAX_CRON_LIVE_TRAVERSAL_NODES ? NODE_MARKER : undefined;
}

function collectBoundedKeys(value: object, state: TraversalState): BoundedKeys {
  const keys: string[] = [];
  let scanned = 0;
  try {
    for (const key in value) {
      scanned += 1;
      if (scanned > MAX_CRON_LIVE_TRAVERSAL_KEYS || state.keys >= MAX_CRON_LIVE_TRAVERSAL_KEYS) {
        return { marker: KEY_MARKER };
      }
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (key.length > MAX_CRON_LIVE_TRAVERSAL_STRING_CHARS) {
        return { marker: stringMarker(key.length) };
      }
      state.keys += 1;
      keys.push(key);
    }
  } catch {
    return { marker: PROPERTY_MARKER };
  }
  keys.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return { keys };
}

function readProperty(value: object, key: string): { value: unknown } | { marker: string } {
  try {
    return { value: (value as Record<string, unknown>)[key] };
  } catch {
    return { marker: PROPERTY_MARKER };
  }
}

function hashToken(hash: Hash, value: string): void {
  hash.update(String(value.length));
  hash.update(':');
  hash.update(value);
  hash.update(';');
}

function hashUnknown(
  hash: Hash,
  value: unknown,
  state: TraversalState,
  seen: Map<object, number>,
  depth = 0,
): void {
  const valueType = typeof value;
  if (value === null || valueType !== 'object') {
    const marker = enterTraversalNode(state, depth);
    if (marker) {
      hashToken(hash, marker);
      return;
    }
    if (valueType === 'string') {
      hashToken(hash, `string:${truncateTraversalString(value as string)}`);
    } else if (valueType === 'bigint') {
      hashToken(hash, '[Unsupported:bigint]');
    } else if (valueType === 'number' || valueType === 'boolean' || valueType === 'undefined') {
      hashToken(hash, `${valueType}:${String(value)}`);
    } else {
      hashToken(hash, `[Unsupported:${valueType}]`);
    }
    return;
  }

  const objectValue = value as object;
  const seenId = seen.get(objectValue);
  if (seenId !== undefined) {
    hashToken(hash, `ref:${seenId}`);
    return;
  }
  const marker = enterTraversalNode(state, depth);
  if (marker) {
    hashToken(hash, marker);
    return;
  }
  seen.set(objectValue, seen.size);

  if (value instanceof Date) {
    const time = value.getTime();
    hashToken(hash, Number.isFinite(time) ? `date:${value.toISOString()}` : INVALID_DATE_MARKER);
    return;
  }

  if (Array.isArray(value)) {
    hashToken(hash, `array:${value.length}`);
    if (value.length > MAX_CRON_LIVE_TRAVERSAL_NODES - state.nodes) {
      hashToken(hash, NODE_MARKER);
      return;
    }
    for (let index = 0; index < value.length; index += 1) {
      const property = readProperty(value, String(index));
      if ('marker' in property) {
        hashToken(hash, property.marker);
      } else {
        hashUnknown(hash, property.value, state, seen, depth + 1);
      }
    }
    return;
  }

  const boundedKeys = collectBoundedKeys(objectValue, state);
  if ('marker' in boundedKeys) {
    hashToken(hash, boundedKeys.marker);
    return;
  }
  hashToken(hash, `object:${boundedKeys.keys.length}`);
  for (const key of boundedKeys.keys) {
    hashToken(hash, key);
    const property = readProperty(objectValue, key);
    if ('marker' in property) {
      hashToken(hash, property.marker);
    } else {
      hashUnknown(hash, property.value, state, seen, depth + 1);
    }
  }
}

function runtimeEventFingerprint(event: ChatRuntimeEvent): string {
  try {
    const hash = createHash('sha256');
    hash.update(`${event.type}|`);
    const state: TraversalState = { nodes: 0, keys: 0 };
    const seen = new Map<object, number>();
    let fingerprintValue: unknown;

    switch (event.type) {
      case 'run.started':
        fingerprintValue = event.startedAt;
        break;
      case 'run.ended':
        fingerprintValue = [event.status, event.endedAt, event.error, event.livenessState, event.replayInvalid, event.stopReason];
        break;
      case 'assistant.delta':
        fingerprintValue = [event.text, event.delta, event.replace, event.phase, event.mediaUrls];
        break;
      case 'thinking.delta':
        fingerprintValue = [event.text, event.delta];
        break;
      case 'tool.started':
        fingerprintValue = [event.toolCallId, event.name, event.args];
        break;
      case 'tool.updated':
        fingerprintValue = [event.toolCallId, event.name, event.partialResult];
        break;
      case 'tool.completed':
        fingerprintValue = [event.toolCallId, event.name, event.result, event.meta, event.isError];
        break;
      case 'command.output':
        fingerprintValue = [
          event.itemId,
          event.toolCallId,
          event.name,
          event.title,
          event.output,
          event.status,
          event.phase,
          event.exitCode,
          event.durationMs,
          event.cwd,
        ];
        break;
      case 'patch.completed':
        fingerprintValue = [
          event.itemId,
          event.toolCallId,
          event.name,
          event.title,
          event.summary,
          event.added,
          event.modified,
          event.deleted,
        ];
        break;
      case 'approval.updated':
        fingerprintValue = [
          event.itemId,
          event.toolCallId,
          event.title,
          event.kind,
          event.phase,
          event.status,
          event.message,
        ];
        break;
    }

    hashUnknown(hash, fingerprintValue, state, seen);
    return hash.digest('hex');
  } catch {
    return createHash('sha256').update(`${event.type}|[FingerprintError]`).digest('hex');
  }
}

class LimitedStringWriter {
  private readonly chunks: string[] = [];
  private length = 0;
  private truncated = false;

  constructor(private readonly limit: number) {}

  get full(): boolean {
    return this.length >= this.limit;
  }

  append(value: string): void {
    if (this.full) {
      this.truncated = true;
      return;
    }
    const available = this.limit - this.length;
    const chunk = value.slice(0, available);
    this.chunks.push(chunk);
    this.length += chunk.length;
    if (chunk.length < value.length) this.truncated = true;
  }

  toString(): string {
    const rendered = this.chunks.join('');
    return this.truncated
      ? `${rendered.slice(0, this.limit - OUTPUT_MARKER.length)}${OUTPUT_MARKER}`
      : rendered;
  }
}

function writeJsonString(writer: LimitedStringWriter, value: string): void {
  writer.append('"');
  for (const character of value) {
    if (writer.full) return;
    writer.append(JSON.stringify(character).slice(1, -1));
  }
  writer.append('"');
}

function writeStableJson(
  writer: LimitedStringWriter,
  value: unknown,
  depth: number,
  state: TraversalState,
  ancestors: WeakSet<object>,
): void {
  if (writer.full) {
    writer.append('');
    return;
  }
  const marker = enterTraversalNode(state, depth);
  if (marker) {
    writeJsonString(writer, marker);
    return;
  }
  if (typeof value === 'string') {
    writeJsonString(writer, truncateTraversalString(value));
    return;
  }
  if (typeof value === 'bigint') {
    writeJsonString(writer, '[Unsupported:bigint]');
    return;
  }
  if (value === undefined) {
    writer.append('null');
    return;
  }
  if (value === null || typeof value !== 'object') {
    writer.append(JSON.stringify(value) ?? 'null');
    return;
  }
  if (ancestors.has(value)) {
    writeJsonString(writer, '[Circular]');
    return;
  }

  ancestors.add(value);
  if (value instanceof Date) {
    const time = value.getTime();
    writeJsonString(writer, Number.isFinite(time) ? value.toISOString() : INVALID_DATE_MARKER);
    ancestors.delete(value);
    return;
  }
  const indent = '  '.repeat(depth + 1);
  const closingIndent = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.length > MAX_CRON_LIVE_TRAVERSAL_NODES - state.nodes) {
      writeJsonString(writer, NODE_MARKER);
      ancestors.delete(value);
      return;
    }
    writer.append('[');
    for (let index = 0; index < value.length && !writer.full; index += 1) {
      writer.append(`${index === 0 ? '\n' : ',\n'}${indent}`);
      const property = readProperty(value, String(index));
      if ('marker' in property) {
        writeJsonString(writer, property.marker);
      } else {
        writeStableJson(writer, property.value, depth + 1, state, ancestors);
      }
    }
    if (value.length > 0) writer.append(`\n${closingIndent}`);
    writer.append(']');
  } else {
    const boundedKeys = collectBoundedKeys(value, state);
    if ('marker' in boundedKeys) {
      writeJsonString(writer, boundedKeys.marker);
      ancestors.delete(value);
      return;
    }
    writer.append('{');
    let written = 0;
    for (const key of boundedKeys.keys) {
      if (writer.full) break;
      const property = readProperty(value, key);
      const child = 'marker' in property ? property.marker : property.value;
      if (child === undefined) continue;
      const index = written;
      written += 1;
      writer.append(`${index === 0 ? '\n' : ',\n'}${indent}`);
      writeJsonString(writer, key);
      writer.append(': ');
      if ('marker' in property) {
        writeJsonString(writer, property.marker);
      } else {
        writeStableJson(writer, child, depth + 1, state, ancestors);
      }
    }
    if (written > 0) writer.append(`\n${closingIndent}`);
    writer.append('}');
  }
  ancestors.delete(value);
}

function truncateStart(value: string, limit = MAX_CRON_LIVE_ITEM_DETAIL_CHARS): string {
  return value.length <= limit ? value : value.slice(0, limit);
}

function truncateEnd(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(-limit);
}

function encodeTuple(parts: readonly string[]): string {
  return `${parts.length}|${parts.map((part) => `${part.length}:${part}`).join('')}`;
}

function isBoundedIdentityComponent(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_CRON_LIVE_ITEM_DETAIL_CHARS;
}

function processIdentityComponent(event: ChatRuntimeEvent): string | undefined {
  if (event.type === 'tool.started' || event.type === 'tool.updated' || event.type === 'tool.completed') {
    return event.toolCallId;
  }
  if (event.type === 'command.output') {
    return event.itemId ?? event.toolCallId ?? event.name ?? 'command';
  }
  if (event.type === 'patch.completed') {
    return event.itemId ?? event.toolCallId ?? event.name ?? 'patch';
  }
  if (event.type === 'approval.updated') {
    return event.itemId ?? event.toolCallId ?? event.kind ?? 'approval';
  }
  return undefined;
}

function hasBoundedEventIdentity(event: ChatRuntimeEvent): event is ChatRuntimeEvent & { sessionKey: string } {
  if (!isBoundedIdentityComponent(event.sessionKey) || !isBoundedIdentityComponent(event.runId)) return false;
  const itemIdentity = processIdentityComponent(event);
  return itemIdentity === undefined || isBoundedIdentityComponent(itemIdentity);
}

function stableDetail(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return truncateTraversalString(value);

  try {
    const writer = new LimitedStringWriter(MAX_CRON_LIVE_ITEM_DETAIL_CHARS);
    writeStableJson(writer, value, 0, { nodes: 0, keys: 0 }, new WeakSet<object>());
    return writer.toString();
  } catch {
    return '[Unserializable]';
  }
}

function upsertItem(
  items: CronLiveRunItem[],
  item: CronLiveRunItem,
): void {
  const existingIndex = items.findIndex(({ id }) => id === item.id);
  if (existingIndex === -1) {
    items.push(item);
    if (items.length > MAX_CRON_LIVE_ITEMS_PER_RUN) items.splice(0, items.length - MAX_CRON_LIVE_ITEMS_PER_RUN);
  } else {
    items[existingIndex] = item;
  }
}

function commandStatus(event: Extract<ChatRuntimeEvent, { type: 'command.output' }>): 'running' | 'completed' | 'failed' {
  if (event.status === 'failed' || event.status === 'error' || (event.exitCode != null && event.exitCode !== 0)) {
    return 'failed';
  }
  if (
    event.phase === 'end'
    || event.phase === 'completed'
    || event.status === 'completed'
    || event.status === 'success'
    || event.exitCode === 0
  ) {
    return 'completed';
  }
  return 'running';
}

function approvalStatus(event: Extract<ChatRuntimeEvent, { type: 'approval.updated' }>): 'running' | 'completed' | 'failed' {
  if (event.status === 'denied' || event.status === 'rejected' || event.status === 'failed' || event.status === 'error') {
    return 'failed';
  }
  if (
    event.phase === 'resolved'
    || event.phase === 'completed'
    || event.status === 'approved'
    || event.status === 'granted'
    || event.status === 'completed'
  ) {
    return 'completed';
  }
  return 'running';
}

function cloneSnapshot(snapshot: CronLiveRunOverlaySnapshot): CronLiveRunOverlaySnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map((item) => ({ ...item })),
  };
}

function compareSnapshots(left: CronLiveRunOverlaySnapshot, right: CronLiveRunOverlaySnapshot): number {
  return left.updatedAt - right.updatedAt
    || left.runId.localeCompare(right.runId)
    || left.sourceSessionKey.localeCompare(right.sourceSessionKey);
}

export function reduceCronLiveRunEvent(
  snapshot: CronLiveRunOverlaySnapshot,
  event: ChatRuntimeEvent,
): CronLiveRunOverlaySnapshot {
  const next = cloneSnapshot(snapshot);
  next.updatedAt = event.ts ?? snapshot.updatedAt;

  if (event.type === 'run.started') {
    next.startedAt = event.startedAt ?? next.startedAt;
    return next;
  }

  if (event.type === 'assistant.delta') {
    if (event.text !== undefined) {
      next.assistantText = event.text;
    } else if (event.replace) {
      next.assistantText = event.delta ?? '';
    } else if (event.delta) {
      next.assistantText += event.delta;
    }
    next.assistantText = truncateEnd(next.assistantText, MAX_CRON_LIVE_ASSISTANT_CHARS);
    next.thinking = false;
    return next;
  }

  if (event.type === 'thinking.delta') {
    next.thinking = true;
    return next;
  }

  if (event.type === 'tool.started' || event.type === 'tool.updated' || event.type === 'tool.completed') {
    const id = encodeTuple([snapshot.runId, 'tool', event.toolCallId]);
    const existingItem = next.items.find((item) => item.id === id);
    const existing = existingItem?.kind === 'tool' ? existingItem : undefined;
    const inputText = event.type === 'tool.started' ? stableDetail(event.args) : existing?.inputText;
    const outputValue = event.type === 'tool.updated' ? event.partialResult : event.type === 'tool.completed' ? event.result : undefined;
    const outputText = outputValue === undefined ? existing?.outputText : stableDetail(outputValue);
    const error = event.type === 'tool.completed' && event.isError ? outputText : undefined;
    upsertItem(next.items, {
      kind: 'tool',
      id,
      toolCallId: event.toolCallId,
      title: truncateStart(event.name),
      status: event.type === 'tool.completed' ? (event.isError ? 'failed' : 'completed') : 'running',
      ...(inputText === undefined ? {} : { inputText }),
      ...(outputText === undefined ? {} : { outputText }),
      ...(error === undefined ? {} : { error }),
    });
    return next;
  }

  if (event.type === 'command.output') {
    const sourceId = event.itemId ?? event.toolCallId ?? event.name ?? 'command';
    const id = encodeTuple([snapshot.runId, 'command', sourceId]);
    const existingItem = next.items.find((item) => item.id === id);
    const existing = existingItem?.kind === 'command' ? existingItem : undefined;
    upsertItem(next.items, {
      kind: 'command',
      id,
      title: truncateStart(event.title ?? existing?.title ?? `${event.name ?? 'Command'} output`),
      status: commandStatus(event),
      output: truncateEnd(`${existing?.output ?? ''}${event.output ?? ''}`, MAX_CRON_LIVE_ITEM_DETAIL_CHARS),
      ...(event.exitCode === undefined && existing?.exitCode === undefined
        ? {}
        : { exitCode: event.exitCode ?? existing?.exitCode }),
    });
    return next;
  }

  if (event.type === 'patch.completed') {
    const sourceId = event.itemId ?? event.toolCallId ?? event.name ?? 'patch';
    const id = encodeTuple([snapshot.runId, 'patch', sourceId]);
    upsertItem(next.items, {
      kind: 'patch',
      id,
      title: truncateStart(event.title ?? event.name ?? 'Patch'),
      ...(event.summary === undefined ? {} : { summary: truncateStart(event.summary) }),
      ...(event.added === undefined ? {} : { added: event.added }),
      ...(event.modified === undefined ? {} : { modified: event.modified }),
      ...(event.deleted === undefined ? {} : { deleted: event.deleted }),
    });
    return next;
  }

  if (event.type === 'approval.updated') {
    const sourceId = event.itemId ?? event.toolCallId ?? event.kind ?? 'approval';
    const id = encodeTuple([snapshot.runId, 'approval', sourceId]);
    const existingItem = next.items.find((item) => item.id === id);
    const existing = existingItem?.kind === 'approval' ? existingItem : undefined;
    upsertItem(next.items, {
      kind: 'approval',
      id,
      title: truncateStart(event.title ?? existing?.title ?? 'Approval'),
      status: approvalStatus(event),
      ...(event.message === undefined && existing?.message === undefined
        ? {}
        : { message: truncateStart(event.message ?? existing?.message ?? '') }),
    });
  }

  return next;
}

export class CronLiveRunBroker {
  private readonly activeRuns = new Map<string, ActiveCronLiveRun>();
  private readonly terminalTombstones = new Set<string>();
  private readonly terminalTombstoneOrder: string[] = [];
  private revision = 0;

  constructor(private readonly now: () => number = Date.now) {}

  ingestRuntimeEvent(event: ChatRuntimeEvent): CronLiveRunOverlayChange[] {
    if (!hasBoundedEventIdentity(event)) return [];
    const parts = parseCronSessionKey(event.sessionKey);
    if (!parts?.runSessionId) return [];

    const identity = encodeTuple([event.sessionKey, event.runId]);
    if (this.terminalTombstones.has(identity)) return [];

    const active = this.activeRuns.get(identity);

    if (active && Number.isFinite(event.seq) && event.seq! <= (active.snapshot.lastSeq ?? -Infinity)) {
      return [];
    }

    if (event.type === 'run.ended') {
      const changes: CronLiveRunOverlayChange[] = [];
      if (active) {
        this.revision += 1;
        changes.push({
          kind: 'remove',
          revision: this.revision,
          canonicalSessionKey: active.snapshot.canonicalSessionKey,
          sourceSessionKey: active.snapshot.sourceSessionKey,
          runId: active.snapshot.runId,
          reason: 'ended',
          terminalStatus: event.status,
          ...(event.error === undefined ? {} : { terminalError: truncateStart(event.error) }),
        });
        this.activeRuns.delete(identity);
      }
      this.addTerminalTombstone(identity);
      return changes;
    }

    let fingerprint: string | undefined;
    if (!Number.isFinite(event.seq)) {
      fingerprint = runtimeEventFingerprint(event);
      if (active?.fingerprints.has(fingerprint)) return [];
    }

    const changes: CronLiveRunOverlayChange[] = [];
    if (!active && this.activeRuns.size >= MAX_ACTIVE_CRON_LIVE_RUNS) {
      const [evictedIdentity, evicted] = [...this.activeRuns.entries()]
        .sort(([, left], [, right]) => compareSnapshots(left.snapshot, right.snapshot))[0];
      this.revision += 1;
      changes.push({
        kind: 'remove',
        revision: this.revision,
        canonicalSessionKey: evicted.snapshot.canonicalSessionKey,
        sourceSessionKey: evicted.snapshot.sourceSessionKey,
        runId: evicted.snapshot.runId,
        reason: 'evicted',
      });
      this.activeRuns.delete(evictedIdentity);
    }

    const current = active?.snapshot ?? {
      canonicalSessionKey: getCronSessionBaseKey(event.sessionKey),
      sourceSessionKey: event.sessionKey,
      runSessionId: parts.runSessionId,
      runId: event.runId,
      revision: this.revision,
      status: 'running',
      updatedAt: event.ts ?? this.now(),
      assistantText: '',
      thinking: false,
      items: [],
    } satisfies CronLiveRunOverlaySnapshot;

    const next = reduceCronLiveRunEvent(current, event);
    next.updatedAt = event.ts ?? this.now();
    if (Number.isFinite(event.seq)) next.lastSeq = event.seq;
    this.revision += 1;
    next.revision = this.revision;
    const fingerprintOrder = active?.fingerprintOrder ?? [];
    const fingerprints = active?.fingerprints ?? new Set<string>();
    if (fingerprint) {
      fingerprintOrder.push(fingerprint);
      fingerprints.add(fingerprint);
      if (fingerprintOrder.length > MAX_CRON_LIVE_EVENT_FINGERPRINTS) {
        const removed = fingerprintOrder.shift();
        if (removed) fingerprints.delete(removed);
      }
    }
    this.activeRuns.set(identity, { snapshot: next, fingerprintOrder, fingerprints });

    changes.push({
      kind: 'upsert',
      revision: this.revision,
      snapshot: cloneSnapshot(next),
    });
    return changes;
  }

  getSnapshotSet(): CronLiveRunOverlaySnapshotSet {
    return {
      revision: this.revision,
      snapshots: [...this.activeRuns.values()]
        .map(({ snapshot }) => cloneSnapshot(snapshot))
        .sort(compareSnapshots),
    };
  }

  clear(): CronLiveRunOverlayChange[] {
    const changes: CronLiveRunOverlayChange[] = [];
    const entries = [...this.activeRuns.entries()]
      .sort(([, left], [, right]) => compareSnapshots(left.snapshot, right.snapshot));
    for (const [identity, active] of entries) {
      this.revision += 1;
      changes.push({
        kind: 'remove',
        revision: this.revision,
        canonicalSessionKey: active.snapshot.canonicalSessionKey,
        sourceSessionKey: active.snapshot.sourceSessionKey,
        runId: active.snapshot.runId,
        reason: 'gateway-reset',
      });
      this.activeRuns.delete(identity);
    }
    return changes;
  }

  private addTerminalTombstone(identity: string): void {
    this.terminalTombstones.add(identity);
    this.terminalTombstoneOrder.push(identity);
    if (this.terminalTombstoneOrder.length > MAX_CRON_LIVE_TERMINAL_TOMBSTONES) {
      const removed = this.terminalTombstoneOrder.shift();
      if (removed) this.terminalTombstones.delete(removed);
    }
  }
}

export function bindCronLiveRunBroker({
  gatewayManager,
  broker,
  publishChange,
}: {
  gatewayManager: GatewayManager;
  broker: CronLiveRunBroker;
  publishChange: (change: CronLiveRunOverlayChange) => void;
}): void {
  let ingestionEnabled = true;
  const publishChanges = (changes: CronLiveRunOverlayChange[]) => {
    changes.forEach((change) => publishChange(change));
  };

  gatewayManager.on('chat:runtime-event', (runtimeEvent) => {
    if (!ingestionEnabled) return;
    publishChanges(broker.ingestRuntimeEvent(runtimeEvent));
  });
  gatewayManager.on('status', (status) => {
    if (status.state === 'running') {
      ingestionEnabled = true;
      return;
    }
    ingestionEnabled = false;
    publishChanges(broker.clear());
  });
  gatewayManager.on('exit', () => {
    ingestionEnabled = false;
    publishChanges(broker.clear());
  });
}
