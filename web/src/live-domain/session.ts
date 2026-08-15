import type { PiEntry } from './entries';
import type { ProjectPath, SessionUuid } from './ids';
import type { PiRuntimeSelection, ThinkingLevel } from './models';

export interface PiSessionHeader {
  type: 'session';
  version?: number;
  id?: SessionUuid;
  cwd: ProjectPath;
  timestamp?: string;
  name?: string;
  [extensionField: string]: unknown;
}

export interface PiSession {
  header: PiSessionHeader;
  entries: ReadonlyArray<PiEntry>;
  name: string;
  page: { from: number; total: number };
  chat: { available: true } | { available: false; reason: string };
  current: PiRuntimeSelection;
}

export interface PiSessionSummaryPage {
  sessions: ReadonlyArray<import('./models').PiSessionSummary>;
  total: number;
}

export interface PiSessionDetailsDto {
  header: unknown;
  entries: unknown[];
  name?: unknown;
  total?: unknown;
  from?: unknown;
  chatAvailable?: unknown;
  chatDisabledReason?: unknown;
  model?: unknown;
  modelProvider?: unknown;
  thinkingLevel?: unknown;
}

export interface PiSessionSummaryDto {
  id?: unknown;
  ID?: unknown;
  sessionUUID?: unknown;
  SessionUUID?: unknown;
  filename?: unknown;
  Filename?: unknown;
  project?: unknown;
  Project?: unknown;
  lastActivity?: unknown;
  LastActivity?: unknown;
  name?: unknown;
  Name?: unknown;
  messageCount?: unknown;
  MessageCount?: unknown;
  tokenTotal?: unknown;
  TokenTotal?: unknown;
  costTotal?: unknown;
  CostTotal?: unknown;
  model?: unknown;
  Model?: unknown;
  modelProvider?: unknown;
  ModelProvider?: unknown;
  chatAvailable?: unknown;
  ChatAvailable?: unknown;
  chatDisabledReason?: unknown;
  ChatDisabledReason?: unknown;
  [key: string]: unknown;
}

export type { ThinkingLevel };
