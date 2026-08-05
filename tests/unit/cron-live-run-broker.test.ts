import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  bindCronLiveRunBroker,
  CronLiveRunBroker,
  MAX_ACTIVE_CRON_LIVE_RUNS,
  MAX_CRON_LIVE_ASSISTANT_CHARS,
  MAX_CRON_LIVE_EVENT_FINGERPRINTS,
  MAX_CRON_LIVE_ITEMS_PER_RUN,
  MAX_CRON_LIVE_ITEM_DETAIL_CHARS,
  MAX_CRON_LIVE_TERMINAL_TOMBSTONES,
  reduceCronLiveRunEvent,
} from '../../electron/services/cron-live-run-broker';
import type { GatewayManager } from '../../electron/gateway/manager';
import type {
  CronLiveRunOverlaySnapshot,
  CronLiveRunOverlaySnapshotSet,
} from '../../shared/chat/cron-live-run';
import type { ChatRuntimeEvent } from '../../shared/chat-runtime-events';

const RUN_KEY = 'agent:main:cron:daily-report:run:runtime-session-1';
const BASE_KEY = 'agent:main:cron:daily-report';

function event(
  value: Omit<ChatRuntimeEvent, 'runId' | 'sessionKey'> & Partial<Pick<ChatRuntimeEvent, 'runId' | 'sessionKey'>>,
): ChatRuntimeEvent {
  return {
    runId: 'run-1',
    sessionKey: RUN_KEY,
    ...value,
  } as ChatRuntimeEvent;
}

function snapshot(overrides: Partial<CronLiveRunOverlaySnapshot> = {}): CronLiveRunOverlaySnapshot {
  return {
    canonicalSessionKey: BASE_KEY,
    sourceSessionKey: RUN_KEY,
    runSessionId: 'runtime-session-1',
    runId: 'run-1',
    revision: 0,
    status: 'running',
    updatedAt: 10,
    assistantText: '',
    thinking: false,
    items: [],
    ...overrides,
  };
}

describe('reduceCronLiveRunEvent', () => {
  it('uses the exact live-run memory bounds', () => {
    expect({
      active: MAX_ACTIVE_CRON_LIVE_RUNS,
      items: MAX_CRON_LIVE_ITEMS_PER_RUN,
      assistant: MAX_CRON_LIVE_ASSISTANT_CHARS,
      detail: MAX_CRON_LIVE_ITEM_DETAIL_CHARS,
      fingerprints: MAX_CRON_LIVE_EVENT_FINGERPRINTS,
      tombstones: MAX_CRON_LIVE_TERMINAL_TOMBSTONES,
    }).toEqual({
      active: 32,
      items: 128,
      assistant: 500_000,
      detail: 100_000,
      fingerprints: 256,
      tombstones: 128,
    });
  });

  it('converges assistant snapshots, replacement chunks, and deltas without mutating input', () => {
    const initial = snapshot({ assistantText: 'old' });
    const full = reduceCronLiveRunEvent(initial, event({ type: 'assistant.delta', text: 'Hello', ts: 11 }));
    const appended = reduceCronLiveRunEvent(full, event({ type: 'assistant.delta', delta: ' world', ts: 12 }));
    const replaced = reduceCronLiveRunEvent(appended, event({
      type: 'assistant.delta',
      delta: 'Corrected',
      replace: true,
      ts: 13,
    }));

    expect(initial.assistantText).toBe('old');
    expect(full.assistantText).toBe('Hello');
    expect(appended.assistantText).toBe('Hello world');
    expect(replaced).toEqual(expect.objectContaining({
      assistantText: 'Corrected',
      thinking: false,
      updatedAt: 13,
    }));
  });

  it('tracks thinking as a boolean without retaining thought text', () => {
    const thought = 'private chain of thought';
    const next = reduceCronLiveRunEvent(snapshot(), event({
      type: 'thinking.delta',
      text: thought,
      delta: `${thought} continued`,
      ts: 14,
    }));

    expect(next.thinking).toBe(true);
    expect(JSON.stringify(next)).not.toContain(thought);
  });

  it('updates tools in place with stable, cycle-safe structured details', () => {
    const cyclic: Record<string, unknown> = { z: 2, a: 1 };
    cyclic.self = cyclic;

    const started = reduceCronLiveRunEvent(snapshot(), event({
      type: 'tool.started',
      toolCallId: 'shared-id',
      name: 'read',
      args: cyclic,
      ts: 20,
    }));
    const updated = reduceCronLiveRunEvent(started, event({
      type: 'tool.updated',
      toolCallId: 'shared-id',
      name: 'read file',
      partialResult: { current: 1 },
      ts: 21,
    }));
    const completed = reduceCronLiveRunEvent(updated, event({
      type: 'tool.completed',
      toolCallId: 'shared-id',
      name: 'read file',
      result: { error: 'permission denied' },
      isError: true,
      ts: 22,
    }));

    expect(started.items).toEqual([{
      kind: 'tool',
      id: expect.any(String),
      toolCallId: 'shared-id',
      title: 'read',
      status: 'running',
      inputText: '{\n  "a": 1,\n  "self": "[Circular]",\n  "z": 2\n}',
    }]);
    expect(completed.items).toHaveLength(1);
    expect(completed.items[0]).toEqual({
      kind: 'tool',
      id: started.items[0].id,
      toolCallId: 'shared-id',
      title: 'read file',
      status: 'failed',
      inputText: started.items[0].kind === 'tool' ? started.items[0].inputText : undefined,
      outputText: '{\n  "error": "permission denied"\n}',
      error: '{\n  "error": "permission denied"\n}',
    });
  });

  it('preserves first-occurrence ordering while updating command, patch, and approval rows', () => {
    const commandStarted = reduceCronLiveRunEvent(snapshot(), event({
      type: 'command.output',
      itemId: 'process',
      title: 'Build',
      output: 'line 1\n',
      status: 'running',
    }));
    const patch = reduceCronLiveRunEvent(commandStarted, event({
      type: 'patch.completed',
      itemId: 'change',
      title: 'Apply files',
      summary: 'Updated source',
      added: 1,
      modified: 2,
      deleted: 3,
    }));
    const approval = reduceCronLiveRunEvent(patch, event({
      type: 'approval.updated',
      itemId: 'permission',
      title: 'Allow command',
      status: 'pending',
      message: 'Read-only status',
    }));
    const commandEnded = reduceCronLiveRunEvent(approval, event({
      type: 'command.output',
      itemId: 'process',
      title: 'Build',
      output: 'line 2',
      phase: 'end',
      exitCode: 0,
    }));
    const approvalDenied = reduceCronLiveRunEvent(commandEnded, event({
      type: 'approval.updated',
      itemId: 'permission',
      title: 'Allow command',
      status: 'denied',
      message: 'Denied',
    }));

    expect(approvalDenied.items.map(({ kind }) => kind)).toEqual(['command', 'patch', 'approval']);
    expect(approvalDenied.items).toEqual([
      {
        kind: 'command',
        id: expect.any(String),
        title: 'Build',
        status: 'completed',
        output: 'line 1\nline 2',
        exitCode: 0,
      },
      {
        kind: 'patch',
        id: expect.any(String),
        title: 'Apply files',
        summary: 'Updated source',
        added: 1,
        modified: 2,
        deleted: 3,
      },
      {
        kind: 'approval',
        id: expect.any(String),
        title: 'Allow command',
        status: 'failed',
        message: 'Denied',
      },
    ]);
  });

  it('namespaces every item identity by run', () => {
    const sharedEvent = event({
      type: 'approval.updated',
      toolCallId: 'same',
      title: 'Approval',
    });
    const first = reduceCronLiveRunEvent(snapshot({ runId: 'run-1' }), sharedEvent);
    const second = reduceCronLiveRunEvent(
      snapshot({ runId: 'run-2' }),
      { ...sharedEvent, runId: 'run-2' },
    );

    expect(first.items[0].id).not.toBe(second.items[0].id);
  });

  it('bounds assistant text and every retained item detail', () => {
    const oversized = 'x'.repeat(MAX_CRON_LIVE_ASSISTANT_CHARS + 20);
    const oversizedDetail = 'd'.repeat(MAX_CRON_LIVE_ITEM_DETAIL_CHARS + 20);
    const assistant = reduceCronLiveRunEvent(snapshot(), event({
      type: 'assistant.delta',
      delta: oversized,
    }));
    const assistantTail = reduceCronLiveRunEvent(assistant, event({
      type: 'assistant.delta',
      delta: 'tail',
    }));
    const tool = reduceCronLiveRunEvent(assistantTail, event({
      type: 'tool.started',
      toolCallId: 'large',
      name: oversizedDetail,
      args: { payload: 'y'.repeat(MAX_CRON_LIVE_ITEM_DETAIL_CHARS + 20) },
    }));
    const command = reduceCronLiveRunEvent(tool, event({
      type: 'command.output',
      itemId: 'large-command',
      title: oversizedDetail,
      output: 'z'.repeat(MAX_CRON_LIVE_ITEM_DETAIL_CHARS + 20),
    }));
    const patch = reduceCronLiveRunEvent(command, event({
      type: 'patch.completed',
      itemId: 'large-patch',
      title: oversizedDetail,
      summary: 's'.repeat(MAX_CRON_LIVE_ITEM_DETAIL_CHARS + 20),
    }));
    const approval = reduceCronLiveRunEvent(patch, event({
      type: 'approval.updated',
      itemId: 'large-approval',
      title: oversizedDetail,
      message: 'm'.repeat(MAX_CRON_LIVE_ITEM_DETAIL_CHARS + 20),
    }));

    expect(assistantTail.assistantText).toHaveLength(MAX_CRON_LIVE_ASSISTANT_CHARS);
    expect(assistantTail.assistantText.endsWith('tail')).toBe(true);
    for (const item of approval.items) {
      expect(item.title.length).toBeLessThanOrEqual(MAX_CRON_LIVE_ITEM_DETAIL_CHARS);
      if (item.kind === 'tool') expect(item.inputText?.length).toBeLessThanOrEqual(MAX_CRON_LIVE_ITEM_DETAIL_CHARS);
      if (item.kind === 'command') expect(item.output.length).toBeLessThanOrEqual(MAX_CRON_LIVE_ITEM_DETAIL_CHARS);
      if (item.kind === 'patch') expect(item.summary?.length).toBeLessThanOrEqual(MAX_CRON_LIVE_ITEM_DETAIL_CHARS);
      if (item.kind === 'approval') expect(item.message?.length).toBeLessThanOrEqual(MAX_CRON_LIVE_ITEM_DETAIL_CHARS);
    }
  });

  it('keeps the newest bounded item set while preserving retained order', () => {
    let current = snapshot();
    for (let index = 0; index <= MAX_CRON_LIVE_ITEMS_PER_RUN; index += 1) {
      current = reduceCronLiveRunEvent(current, event({
        type: 'patch.completed',
        itemId: `patch-${index}`,
        title: `Patch ${index}`,
      }));
    }

    expect(current.items).toHaveLength(MAX_CRON_LIVE_ITEMS_PER_RUN);
    expect(current.items[0].title).toBe('Patch 1');
    expect(current.items.at(-1)?.title).toBe(`Patch ${MAX_CRON_LIVE_ITEMS_PER_RUN}`);
  });

  it('uses collision-free opaque tuple identities for process items', () => {
    const first = reduceCronLiveRunEvent(snapshot({ runId: 'a:tool:b' }), {
      type: 'tool.started',
      runId: 'a:tool:b',
      sessionKey: RUN_KEY,
      toolCallId: 'c',
      name: 'first',
    });
    const second = reduceCronLiveRunEvent(snapshot({ runId: 'a' }), {
      type: 'tool.started',
      runId: 'a',
      sessionKey: RUN_KEY,
      toolCallId: 'b:tool:c',
      name: 'second',
    });

    expect(first.items[0].id).not.toBe(second.items[0].id);
  });

  it('marks deep, node-heavy, wide, and oversized-string details deterministically', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 20_000; index += 1) {
      const child: Record<string, unknown> = {};
      cursor.next = child;
      cursor = child;
    }

    const nodeHeavy = Array.from({ length: 3_000 }, () => ({}));
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 2_000; index += 1) wide[`key-${index}`] = index;

    const cases: Array<[unknown, string]> = [
      [deep, '[Truncated:Depth]'],
      [nodeHeavy, '[Truncated:Nodes]'],
      [wide, '[Truncated:Keys]'],
      ['s'.repeat(MAX_CRON_LIVE_ITEM_DETAIL_CHARS + 20), '[Truncated:String:100020]'],
    ];

    for (const [args, marker] of cases) {
      const reduced = reduceCronLiveRunEvent(snapshot(), event({
        type: 'tool.started',
        toolCallId: marker,
        name: 'adversarial detail',
        args,
      }));
      const item = reduced.items[0];
      expect(item.kind).toBe('tool');
      if (item.kind === 'tool') {
        expect(item.inputText).toContain(marker);
        expect(item.inputText?.length).toBeLessThanOrEqual(MAX_CRON_LIVE_ITEM_DETAIL_CHARS);
      }
    }
  });

  it('handles invalid Dates and throwing getters with deterministic detail markers', () => {
    const throwing: Record<string, unknown> = {};
    Object.defineProperty(throwing, 'unsafe', {
      enumerable: true,
      get: () => {
        throw new Error('getter must not escape');
      },
    });

    const invalidDate = reduceCronLiveRunEvent(snapshot(), event({
      type: 'tool.started',
      toolCallId: 'invalid-date',
      name: 'date',
      args: new Date(Number.NaN),
    }));
    const throwingGetter = reduceCronLiveRunEvent(snapshot(), event({
      type: 'tool.started',
      toolCallId: 'throwing-getter',
      name: 'getter',
      args: throwing,
    }));

    expect(invalidDate.items[0]).toEqual(expect.objectContaining({ inputText: '"[Invalid:Date]"' }));
    expect(throwingGetter.items[0]).toEqual(expect.objectContaining({
      inputText: '{\n  "unsafe": "[Unserializable:Property]"\n}',
    }));
  });

  it('clears a stale tool error after a later non-failed state', () => {
    const failed = reduceCronLiveRunEvent(snapshot(), event({
      type: 'tool.completed',
      toolCallId: 'retrying-tool',
      name: 'Retrying tool',
      result: 'failed once',
      isError: true,
    }));
    const running = reduceCronLiveRunEvent(failed, event({
      type: 'tool.updated',
      toolCallId: 'retrying-tool',
      name: 'Retrying tool',
      partialResult: 'retrying',
    }));
    const completed = reduceCronLiveRunEvent(running, event({
      type: 'tool.completed',
      toolCallId: 'retrying-tool',
      name: 'Retrying tool',
      result: 'success',
      isError: false,
    }));

    expect(failed.items[0]).toEqual(expect.objectContaining({ status: 'failed', error: 'failed once' }));
    expect(running.items[0]).toEqual(expect.objectContaining({ status: 'running' }));
    expect(running.items[0]).not.toHaveProperty('error');
    expect(completed.items[0]).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(completed.items[0]).not.toHaveProperty('error');
  });
});

describe('CronLiveRunBroker', () => {
  it('strictly admits only run-scoped cron keys and adopts a run mid-flight', () => {
    const broker = new CronLiveRunBroker(() => 100);
    const rejectedKeys = [
      undefined,
      'agent:main:main',
      BASE_KEY,
      'agent:main:cron:daily-report:run:',
      'agent:main:cron:daily-report:run:runtime-session-1:extra',
      'agent:main:heartbeat:main',
    ];

    for (const sessionKey of rejectedKeys) {
      expect(broker.ingestRuntimeEvent(event({
        type: 'assistant.delta',
        delta: 'ignored',
        sessionKey,
      }))).toEqual([]);
    }

    const changes = broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      delta: 'adopted',
      ts: 50,
    }));

    expect(changes).toEqual([{
      kind: 'upsert',
      revision: 1,
      snapshot: expect.objectContaining({
        canonicalSessionKey: BASE_KEY,
        sourceSessionKey: RUN_KEY,
        runSessionId: 'runtime-session-1',
        runId: 'run-1',
        revision: 1,
        status: 'running',
        updatedAt: 50,
        assistantText: 'adopted',
      }),
    }]);
    expect(broker.getSnapshotSet()).toEqual({
      revision: 1,
      snapshots: [changes[0].kind === 'upsert' ? changes[0].snapshot : undefined],
    });
  });

  it('returns immutable snapshot clones and keeps the broker revision on hydration', () => {
    const broker = new CronLiveRunBroker(() => 100);
    broker.ingestRuntimeEvent(event({ type: 'run.started', startedAt: 20 }));

    const first = broker.getSnapshotSet() as CronLiveRunOverlaySnapshotSet;
    first.revision = 999;
    first.snapshots[0].assistantText = 'mutated';
    first.snapshots.push(snapshot());

    expect(broker.getSnapshotSet()).toEqual({
      revision: 1,
      snapshots: [expect.objectContaining({
        revision: 1,
        startedAt: 20,
        assistantText: '',
      })],
    });
  });

  it('uses ingestion time for timestamp-less updates and detaches emitted snapshots', () => {
    let now = 10;
    const broker = new CronLiveRunBroker(() => now);
    const [started] = broker.ingestRuntimeEvent(event({ type: 'run.started' }));
    if (started.kind !== 'upsert') throw new Error('Expected an upsert');
    started.snapshot.assistantText = 'external mutation';

    now = 20;
    broker.ingestRuntimeEvent(event({ type: 'assistant.delta', delta: 'internal' }));

    expect(broker.getSnapshotSet()).toEqual({
      revision: 2,
      snapshots: [expect.objectContaining({
        updatedAt: 20,
        assistantText: 'internal',
      })],
    });
  });

  it('rejects stale numeric sequences and records only an accepted lastSeq', () => {
    const broker = new CronLiveRunBroker(() => 100);

    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      delta: 'A',
      seq: 2,
    }))).toHaveLength(1);
    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      delta: 'duplicate',
      seq: 2,
    }))).toEqual([]);
    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      delta: 'stale',
      seq: 1,
    }))).toEqual([]);
    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      delta: 'B',
      seq: 3,
    }))).toHaveLength(1);

    expect(broker.getSnapshotSet()).toEqual({
      revision: 2,
      snapshots: [expect.objectContaining({
        revision: 2,
        lastSeq: 3,
        assistantText: 'AB',
      })],
    });
  });

  it('deduplicates sequence-less events by type-specific content while retaining distinct chunks', () => {
    const broker = new CronLiveRunBroker(() => 100);
    const first = event({ type: 'assistant.delta', delta: 'one' });
    const distinct = event({ type: 'assistant.delta', delta: 'two' });

    expect(broker.ingestRuntimeEvent(first)).toHaveLength(1);
    expect(broker.ingestRuntimeEvent(first)).toEqual([]);
    expect(broker.ingestRuntimeEvent(distinct)).toHaveLength(1);

    const toolUpdate = event({
      type: 'tool.updated',
      toolCallId: 'tool-1',
      name: 'inspect',
      partialResult: { z: 2, a: 1 },
    });
    expect(broker.ingestRuntimeEvent(toolUpdate)).toHaveLength(1);
    expect(broker.ingestRuntimeEvent({
      ...toolUpdate,
      partialResult: { a: 1, z: 2 },
    })).toEqual([]);

    expect(broker.getSnapshotSet()).toEqual({
      revision: 3,
      snapshots: [expect.objectContaining({ assistantText: 'onetwo' })],
    });
  });

  it('fingerprints adversarial values without throwing and still deduplicates them', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let index = 0; index < 20_000; index += 1) {
      const child: Record<string, unknown> = {};
      cursor.next = child;
      cursor = child;
    }
    const throwing: Record<string, unknown> = {};
    Object.defineProperty(throwing, 'unsafe', {
      enumerable: true,
      get: () => {
        throw new Error('getter must not escape');
      },
    });

    const values: unknown[] = [
      deep,
      Array.from({ length: 3_000 }, () => ({})),
      Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [`key-${index}`, index])),
      new Date(Number.NaN),
      throwing,
    ];

    for (let index = 0; index < values.length; index += 1) {
      const runtimeEvent = event({
        type: 'tool.updated',
        runId: `adversarial-${index}`,
        toolCallId: `tool-${index}`,
        name: 'adversarial',
        partialResult: values[index],
      });
      let firstChanges: ReturnType<CronLiveRunBroker['ingestRuntimeEvent']> = [];
      expect(() => {
        firstChanges = new CronLiveRunBroker(() => 100).ingestRuntimeEvent(runtimeEvent);
      }).not.toThrow();
      expect(firstChanges).toHaveLength(1);

      const broker = new CronLiveRunBroker(() => 100);
      expect(broker.ingestRuntimeEvent(runtimeEvent)).toHaveLength(1);
      expect(broker.ingestRuntimeEvent(runtimeEvent)).toEqual([]);
    }
  });

  it('rejects oversized required identity components without changing revision', () => {
    const oversized = 'i'.repeat(MAX_CRON_LIVE_ITEM_DETAIL_CHARS + 1);
    const broker = new CronLiveRunBroker(() => 100);
    const rejected = [
      event({ type: 'run.started', sessionKey: `agent:main:cron:job:run:${oversized}` }),
      event({ type: 'run.started', runId: oversized }),
      event({ type: 'tool.started', toolCallId: oversized, name: 'tool' }),
      event({ type: 'command.output', itemId: oversized, output: 'output' }),
      event({ type: 'patch.completed', name: oversized }),
      event({ type: 'approval.updated', kind: oversized }),
    ];

    for (const runtimeEvent of rejected) {
      expect(broker.ingestRuntimeEvent(runtimeEvent)).toEqual([]);
    }
    expect(broker.getSnapshotSet()).toEqual({ revision: 0, snapshots: [] });
  });

  it('uses collision-free tuple identities for active runs and tombstones', () => {
    const broker = new CronLiveRunBroker(() => 100);
    const firstSessionKey = `${RUN_KEY}\0x`;
    const firstRunId = 'y';
    const secondSessionKey = RUN_KEY;
    const secondRunId = 'x\0y';

    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      sessionKey: firstSessionKey,
      runId: firstRunId,
      delta: 'first',
    }))).toHaveLength(1);
    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      sessionKey: secondSessionKey,
      runId: secondRunId,
      delta: 'second',
    }))).toHaveLength(1);
    expect(broker.getSnapshotSet().snapshots.map(({ runId }) => runId).sort()).toEqual([
      secondRunId,
      firstRunId,
    ].sort());

    expect(broker.ingestRuntimeEvent(event({
      type: 'run.ended',
      sessionKey: firstSessionKey,
      runId: firstRunId,
      status: 'completed',
    }))).toHaveLength(1);
    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      sessionKey: secondSessionKey,
      runId: secondRunId,
      delta: 'still active',
    }))).toHaveLength(1);
  });

  it('bounds sequence-less fingerprints with deterministic FIFO eviction', () => {
    const broker = new CronLiveRunBroker(() => 100);

    for (let index = 0; index <= MAX_CRON_LIVE_EVENT_FINGERPRINTS; index += 1) {
      expect(broker.ingestRuntimeEvent(event({
        type: 'assistant.delta',
        delta: `[${index}]`,
      }))).toHaveLength(1);
    }

    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      delta: '[0]',
    }))).toHaveLength(1);
    expect(broker.getSnapshotSet().revision).toBe(MAX_CRON_LIVE_EVENT_FINGERPRINTS + 2);
  });

  it('removes a terminal run, then tombstones it against delayed resurrection', () => {
    const broker = new CronLiveRunBroker(() => 100);
    const terminalError = 'e'.repeat(MAX_CRON_LIVE_ITEM_DETAIL_CHARS + 20);
    broker.ingestRuntimeEvent(event({ type: 'run.started', startedAt: 10, seq: 1 }));

    expect(broker.ingestRuntimeEvent(event({
      type: 'run.ended',
      status: 'error',
      error: terminalError,
      endedAt: 20,
      seq: 2,
    }))).toEqual([{
      kind: 'remove',
      revision: 2,
      canonicalSessionKey: BASE_KEY,
      sourceSessionKey: RUN_KEY,
      runId: 'run-1',
      reason: 'ended',
      terminalStatus: 'error',
      terminalError: terminalError.slice(0, MAX_CRON_LIVE_ITEM_DETAIL_CHARS),
    }]);
    expect(broker.getSnapshotSet()).toEqual({ revision: 2, snapshots: [] });
    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      delta: 'late duplicate',
      seq: 3,
    }))).toEqual([]);
    expect(broker.ingestRuntimeEvent(event({
      type: 'run.ended',
      status: 'error',
      seq: 4,
    }))).toEqual([]);
    expect(broker.getSnapshotSet()).toEqual({ revision: 2, snapshots: [] });
  });

  it('tombstones unseen terminals and bounds tombstones with FIFO eviction', () => {
    const broker = new CronLiveRunBroker(() => 100);

    for (let index = 0; index <= MAX_CRON_LIVE_TERMINAL_TOMBSTONES; index += 1) {
      expect(broker.ingestRuntimeEvent(event({
        type: 'run.ended',
        runId: `ended-${index}`,
        status: 'completed',
      }))).toEqual([]);
    }

    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      runId: 'ended-0',
      delta: 'old tombstone evicted',
    }))).toHaveLength(1);
    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      runId: `ended-${MAX_CRON_LIVE_TERMINAL_TOMBSTONES}`,
      delta: 'latest tombstone retained',
    }))).toEqual([]);
  });

  it('evicts the least-recent active run deterministically before upserting the new run', () => {
    const broker = new CronLiveRunBroker(() => 100);
    for (let index = 0; index < MAX_ACTIVE_CRON_LIVE_RUNS; index += 1) {
      broker.ingestRuntimeEvent(event({
        type: 'run.started',
        runId: `run-${String(index).padStart(2, '0')}`,
        ts: 10,
      }));
    }

    const changes = broker.ingestRuntimeEvent(event({
      type: 'run.started',
      runId: `run-${MAX_ACTIVE_CRON_LIVE_RUNS}`,
      ts: 20,
    }));

    expect(changes).toEqual([
      {
        kind: 'remove',
        revision: MAX_ACTIVE_CRON_LIVE_RUNS + 1,
        canonicalSessionKey: BASE_KEY,
        sourceSessionKey: RUN_KEY,
        runId: 'run-00',
        reason: 'evicted',
      },
      {
        kind: 'upsert',
        revision: MAX_ACTIVE_CRON_LIVE_RUNS + 2,
        snapshot: expect.objectContaining({
          runId: `run-${MAX_ACTIVE_CRON_LIVE_RUNS}`,
          revision: MAX_ACTIVE_CRON_LIVE_RUNS + 2,
        }),
      },
    ]);
    const hydrated = broker.getSnapshotSet();
    expect(hydrated.revision).toBe(MAX_ACTIVE_CRON_LIVE_RUNS + 2);
    expect(hydrated.snapshots).toHaveLength(MAX_ACTIVE_CRON_LIVE_RUNS);
    expect(hydrated.snapshots.some(({ runId }) => runId === 'run-00')).toBe(false);
  });

  it('hydrates by updatedAt then runId and clears in the same deterministic order', () => {
    const broker = new CronLiveRunBroker(() => 100);
    broker.ingestRuntimeEvent(event({ type: 'run.started', runId: 'run-b', ts: 20 }));
    broker.ingestRuntimeEvent(event({ type: 'run.started', runId: 'run-a', ts: 20 }));
    broker.ingestRuntimeEvent(event({ type: 'run.started', runId: 'run-c', ts: 10 }));

    expect(broker.getSnapshotSet().snapshots.map(({ runId }) => runId)).toEqual([
      'run-c',
      'run-a',
      'run-b',
    ]);
    expect(broker.clear()).toEqual([
      expect.objectContaining({ kind: 'remove', revision: 4, runId: 'run-c', reason: 'gateway-reset' }),
      expect.objectContaining({ kind: 'remove', revision: 5, runId: 'run-a', reason: 'gateway-reset' }),
      expect.objectContaining({ kind: 'remove', revision: 6, runId: 'run-b', reason: 'gateway-reset' }),
    ]);
    expect(broker.clear()).toEqual([]);
    expect(broker.getSnapshotSet()).toEqual({ revision: 6, snapshots: [] });
  });

  it('permits a cleared identity to be adopted again', () => {
    const broker = new CronLiveRunBroker(() => 100);
    broker.ingestRuntimeEvent(event({ type: 'assistant.delta', delta: 'active' }));

    expect(broker.clear()).toEqual([
      expect.objectContaining({ kind: 'remove', revision: 2, runId: 'run-1', reason: 'gateway-reset' }),
    ]);
    expect(broker.ingestRuntimeEvent(event({
      type: 'assistant.delta',
      delta: 'adopted after reset',
    }))).toEqual([
      expect.objectContaining({
        kind: 'upsert',
        revision: 3,
        snapshot: expect.objectContaining({
          runId: 'run-1',
          assistantText: 'adopted after reset',
        }),
      }),
    ]);
    expect(broker.getSnapshotSet()).toEqual({
      revision: 3,
      snapshots: [expect.objectContaining({ runId: 'run-1' })],
    });
  });
});

describe('bindCronLiveRunBroker', () => {
  it('owns runtime ingestion and publishes broker changes', () => {
    const gatewayManager = new EventEmitter() as GatewayManager;
    const broker = new CronLiveRunBroker(() => 100);
    const publishChange = vi.fn();
    bindCronLiveRunBroker({ gatewayManager, broker, publishChange });

    gatewayManager.emit('chat:runtime-event', event({
      type: 'assistant.delta',
      delta: 'live',
    }));

    expect(publishChange).toHaveBeenCalledTimes(1);
    expect(publishChange).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'upsert',
      revision: 1,
    }));
    expect(broker.getSnapshotSet().snapshots).toHaveLength(1);
  });

  it('suppresses reconnecting events and re-adopts the same identity after running resumes', () => {
    const gatewayManager = new EventEmitter() as GatewayManager;
    const broker = new CronLiveRunBroker(() => 100);
    const publishChange = vi.fn();
    bindCronLiveRunBroker({ gatewayManager, broker, publishChange });

    gatewayManager.emit('chat:runtime-event', event({ type: 'run.started' }));
    gatewayManager.emit('status', { state: 'running', port: 18789 });
    expect(broker.getSnapshotSet().snapshots).toHaveLength(1);

    gatewayManager.emit('status', { state: 'reconnecting', port: 18789 });
    expect(publishChange).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'remove',
      reason: 'gateway-reset',
      runId: 'run-1',
    }));
    expect(broker.getSnapshotSet().snapshots).toEqual([]);

    gatewayManager.emit('chat:runtime-event', event({
      type: 'assistant.delta',
      runId: 'delayed-during-reconnect',
      delta: 'must be ignored',
    }));
    expect(broker.getSnapshotSet().snapshots).toEqual([]);
    expect(publishChange).toHaveBeenCalledTimes(2);

    gatewayManager.emit('status', { state: 'running', port: 18789 });
    gatewayManager.emit('chat:runtime-event', event({
      type: 'assistant.delta',
      delta: 're-adopted mid-flight',
    }));

    expect(publishChange).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'upsert',
      revision: 3,
      snapshot: expect.objectContaining({
        runId: 'run-1',
        assistantText: 're-adopted mid-flight',
      }),
    }));
    expect(broker.getSnapshotSet().snapshots).toEqual([
      expect.objectContaining({ runId: 'run-1' }),
    ]);
  });

  it('disables ingestion on exit until running resumes', () => {
    const gatewayManager = new EventEmitter() as GatewayManager;
    const broker = new CronLiveRunBroker(() => 100);
    const publishChange = vi.fn();
    bindCronLiveRunBroker({ gatewayManager, broker, publishChange });

    gatewayManager.emit('chat:runtime-event', event({ type: 'run.started' }));
    gatewayManager.emit('exit', 1);
    expect(publishChange).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'remove',
      reason: 'gateway-reset',
      runId: 'run-1',
    }));
    expect(broker.getSnapshotSet().snapshots).toEqual([]);

    gatewayManager.emit('chat:runtime-event', event({
      type: 'assistant.delta',
      runId: 'delayed-after-exit',
      delta: 'must be ignored',
    }));
    expect(broker.getSnapshotSet().snapshots).toEqual([]);

    gatewayManager.emit('status', { state: 'running', port: 18789 });
    gatewayManager.emit('chat:runtime-event', event({
      type: 'assistant.delta',
      delta: 're-adopted after restart',
    }));
    expect(broker.getSnapshotSet().snapshots).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        assistantText: 're-adopted after restart',
      }),
    ]);
  });
});
