import type { ProjectPath, SessionId, SessionUuid } from './ids';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface PiModelRef {
  provider: string;
  id: string;
}

export interface PiModel extends PiModelRef {
  name: string;
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  [key: string]: unknown;
}

export interface PiRuntimeSelection {
  model: PiModelRef;
  thinkingLevel: ThinkingLevel;
}

export interface PiHost {
  instanceName: string;
  currentUrl: string;
  peers: ReadonlyArray<{ label: string; url: string }>;
}

export interface PiProject {
  path: ProjectPath;
  label: string;
  enabled: boolean;
  source: 'discovered' | 'registered';
  sessionCount: number;
  runningSessionIds: ReadonlyArray<SessionId>;
}

export type WorkerState =
  | { kind: 'idle' }
  | { kind: 'running'; preview?: string }
  | { kind: 'error'; message: string };

export interface PiSessionSummary {
  id: SessionId;
  uuid: SessionUuid;
  projectPath: ProjectPath | null;
  title: string;
  lastActivity: string;
  messageCount: number;
  usage: { tokens: number; cost: number };
  runtime: PiModelRef | null;
  chat: { available: true } | { available: false; reason: string };
  worker: WorkerState;
}
