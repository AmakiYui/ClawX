export type CronLiveRunStatus = 'running';

export type CronLiveRunItem =
  | {
      kind: 'tool';
      id: string;
      toolCallId: string;
      title: string;
      status: 'running' | 'completed' | 'failed';
      inputText?: string;
      outputText?: string;
      error?: string;
    }
  | {
      kind: 'command';
      id: string;
      title: string;
      status: 'running' | 'completed' | 'failed';
      output: string;
      exitCode?: number;
    }
  | {
      kind: 'patch';
      id: string;
      title: string;
      summary?: string;
      added?: number;
      modified?: number;
      deleted?: number;
    }
  | {
      kind: 'approval';
      id: string;
      title: string;
      status: 'running' | 'completed' | 'failed';
      message?: string;
    };

export interface CronLiveRunOverlaySnapshot {
  canonicalSessionKey: string;
  sourceSessionKey: string;
  runSessionId: string;
  runId: string;
  revision: number;
  status: CronLiveRunStatus;
  startedAt?: number;
  updatedAt: number;
  lastSeq?: number;
  assistantText: string;
  thinking: boolean;
  items: CronLiveRunItem[];
}

export interface CronLiveRunOverlaySnapshotSet {
  revision: number;
  snapshots: CronLiveRunOverlaySnapshot[];
}

export type CronLiveRunOverlayChange =
  | {
      kind: 'upsert';
      revision: number;
      snapshot: CronLiveRunOverlaySnapshot;
    }
  | {
      kind: 'remove';
      revision: number;
      canonicalSessionKey: string;
      sourceSessionKey: string;
      runId: string;
      reason: 'ended' | 'evicted' | 'gateway-reset';
      terminalStatus?: 'completed' | 'error' | 'aborted';
      terminalError?: string;
    };
