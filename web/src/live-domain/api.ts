import type { ProjectPath, RelativePath, SessionId } from './ids';
import type { PiProject, PiSessionSummary, ThinkingLevel } from './models';

export interface ProjectListQuery {
  offset?: number;
  limit?: number;
  current?: ProjectPath | string;
  sessionLimit?: number;
}

export interface ProjectList {
  projects: PiProject[];
  total: number;
  currentSessions: PiSessionSummary[];
  currentSessionsTotal: number;
  filterEnabled: boolean;
}

export type ProjectAction =
  | 'enable'
  | 'disable'
  | 'register'
  | 'remove'
  | 'enable-filter'
  | 'disable-filter'
  | 'enable-all'
  | 'disable-all';

export interface UpdateProjectInput {
  path?: ProjectPath | string;
  action: ProjectAction;
}

export interface UpdateProjectResult {
  ok: boolean;
  path?: ProjectPath;
  filterEnabled?: boolean;
}

export interface RecentLocationsResult {
  locations: ProjectPath[];
}

export interface PiFileEntry {
  path: RelativePath;
  isDir: boolean;
}

export interface FileListQuery {
  query?: string;
}

export interface FileListResult {
  files: PiFileEntry[];
}

export interface PiFilePreview {
  path: RelativePath;
  kind: 'text' | 'binary';
  content?: string;
  size: number;
  modifiedAt: string;
  revision: string;
}

export interface PiSlashCommand {
  name: string;
  description: string;
  source: 'extension' | 'prompt' | 'skill';
}

export interface CommandsResult {
  commands: PiSlashCommand[];
  workerReady: boolean;
}

export interface SessionMutationResult {
  ok: boolean;
  id: SessionId;
}

export interface RenameSessionResult {
  ok: boolean;
  name: string;
}

export interface LabelSessionResult {
  ok: boolean;
  entryId: string;
  label: string;
}

export interface GitInfo {
  isRepo: boolean;
  branch: string;
  isDefault: boolean;
  hasChanges: boolean;
  prCreateUrl: string;
  prUrl: string;
}

export interface GitDiff {
  isRepo: boolean;
  diff: string;
  branch?: string;
}

export interface RenameBranchResult {
  ok: boolean;
  branch: string;
}

export interface ReviewComment {
  id: string;
  sessionId: SessionId;
  file: RelativePath | string;
  startLine: number;
  endLine: number;
  side: 'old' | 'new';
  body: string;
  createdAt: number;
}

export interface ReviewCommentInput {
  id?: string;
  file: RelativePath | string;
  startLine: number;
  endLine: number;
  side?: 'old' | 'new';
  body?: string;
  createdAt?: number;
}

export interface ReviewCommentsResult {
  comments: ReviewComment[];
}

export interface ReviewCommentResult {
  comment: ReviewComment;
}

export interface Annotation {
  id: string;
  sessionId: SessionId;
  anchorId: string;
  startOffset: number;
  endOffset: number;
  kind: string;
  text: string;
  original: string;
  source: string;
  createdAt: number;
}

export interface AnnotationInput {
  id?: string;
  anchorId: string;
  startOffset: number;
  endOffset: number;
  kind?: string;
  text?: string;
  original?: string;
  source?: string;
  createdAt?: number;
}

export interface AnnotationsResult {
  annotations: Annotation[];
}

export interface AnnotationResult {
  annotation: Annotation;
}

export interface ScratchpadResult {
  content: string;
}

export interface SaveScratchpadResult {
  ok: boolean;
}

export interface QueueItem {
  sessionId: SessionId;
  position: number;
  message: string;
  displayText: string;
  createdAt: string;
}

export interface ChatQueue {
  items: QueueItem[];
  paused: boolean;
}

export interface AddQueueItemInput {
  message: string;
  displayText?: string;
}

export interface SetQueuePausedResult {
  ok: boolean;
  paused: boolean;
}

export interface SettingsResult {
  settings: Record<string, string>;
}

export interface SaveSettingsResult extends SettingsResult {
  ok: boolean;
}

export interface BtwResult {
  sessionId: SessionId | '';
}

export interface CreateBtwInput {
  path?: ProjectPath | string;
  parent?: SessionId | string;
}

export interface CreateBtwResult {
  ok: boolean;
  id: SessionId;
}

export interface Schedule {
  id: string;
  name: string;
  instructions: string;
  modelProvider: string;
  modelId: string;
  thinkingLevel: string;
  projectPath: ProjectPath | string;
  cronExpr: string;
  timezone: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleInput {
  name: string;
  instructions: string;
  modelProvider?: string;
  modelId?: string;
  thinkingLevel?: ThinkingLevel | string;
  projectPath?: ProjectPath | string;
  cronExpr?: string;
  timezone?: string;
  enabled?: boolean;
}

export interface SchedulesResult {
  schedules: Schedule[];
}

export interface ScheduleResult {
  schedule: Schedule;
}

export interface ScheduleRun {
  id: number;
  scheduleId: string;
  sessionId?: SessionId;
  sessionFile?: string;
  firedAt: string;
  status: string;
  error?: string;
}

export interface ScheduleRunsResult {
  runs: ScheduleRun[];
}

export interface RunScheduleResult {
  ok: boolean;
  sessionId: SessionId;
}

export interface ProcessMetrics {
  pid: number;
  uptime_s: number;
  goroutines: number;
  heap_alloc_bytes: number;
  sse_clients: number;
  watched_files: number;
}

export interface WorkerMetrics {
  session_id: SessionId;
  pid: number;
  state: string;
  model?: string;
  uptime_s: number;
  idle_for_s: number;
  rss_bytes: number;
  cpu_time_s: number;
  cpu_percent: number;
  sampled: boolean;
  zombie: boolean;
}

export interface MetricsResult {
  process: ProcessMetrics;
  workers: WorkerMetrics[];
}

export interface VersionInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  isDev: boolean;
  changelog: string;
  changelogUrl: string;
  checkedAt: string;
}

export interface UpdateResult {
  status: string;
  needsRestart?: boolean;
}

export interface RestartResult {
  status: string;
}

export interface SoundsResult {
  sounds: string[];
}

export interface PushVapidResult {
  publicKey: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface ShareResult {
  url?: string;
  [key: string]: unknown;
}

export interface UsageResult {
  [key: string]: unknown;
}
