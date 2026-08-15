import type {
  AddQueueItemInput,
  Annotation,
  AnnotationInput,
  AnnotationResult,
  AnnotationsResult,
  BtwResult,
  ChatQueue,
  CommandsResult,
  CreateBtwInput,
  CreateBtwResult,
  FileListQuery,
  FileListResult,
  GitDiff,
  GitInfo,
  LabelSessionResult,
  MetricsResult,
  PiFilePreview,
  PiSlashCommand,
  ProjectList,
  ProjectListQuery,
  RecentLocationsResult,
  RenameBranchResult,
  RenameSessionResult,
  ReviewComment,
  ReviewCommentInput,
  ReviewCommentResult,
  ReviewCommentsResult,
  RunScheduleResult,
  SaveScratchpadResult,
  SaveSettingsResult,
  ScheduleInput,
  ScheduleResult,
  ScheduleRunsResult,
  ScratchpadResult,
  SessionMutationResult,
  SettingsResult,
  UpdateProjectInput,
  UpdateProjectResult,
  UpdateResult,
  VersionInfo,
} from '../live-domain';
import {
  asProjectPath,
  asRelativePath,
  asSessionId,
  asSessionIdOrEmpty,
  parsePiProjects,
  parsePiSession,
  parsePiSessionSummaries,
} from '../live-domain';
import type { PiSession } from '../live-domain';
import type {
  ChatInput,
  ChatResult,
  ChatWorkerStatus,
  PiWebClient,
  HostContext,
  ModelsResult,
  MutationResult,
  NewSessionInput,
  NewSessionResult,
  PairedDevicesResult,
  PairingCode,
  PairingResult,
  PairingStatus,
  PairingSubmission,
  PiWebSSEEventMap,
  PiWebSSEEventName,
  PiModel,
  PiWebSSETopic,
  SSESubscription,
  SSESubscriptionHandlers,
  SessionDefaults,
  SessionDetails,
  SessionDetailsQuery,
  SessionList,
  SessionListQuery,
  SessionStatus,
  SessionSummary,
  SetThinkingLevelResult,
  ThinkingLevel,
} from './contracts';
import { createPiWebHttp, type FetchLike, PiWebClientError, type PiWebHttp } from './http';

const NAMED_SSE_EVENT_NAMES = [
  'chat-preview',
  'status-snapshot',
  'status-delta',
  'annotations',
  'queue',
  'btw-changed',
] as const satisfies readonly PiWebSSEEventName[];

const DEFAULT_HOST_CONTEXT: HostContext = {
  instanceName: 'This computer',
  currentUrl: '',
  peers: [],
};

type EventSourceConstructor = new (
  url: string | URL,
  eventSourceInitDict?: EventSourceInit,
) => EventSource;

export interface PiWebClientOptions {
  fetchImpl?: FetchLike;
  httpImpl?: PiWebHttp;
  EventSourceImpl?: EventSourceConstructor;
  documentImpl?: Pick<Document, 'getElementById'>;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeSessionSummary(raw: Record<string, unknown>): SessionSummary {
  const id = stringValue(raw.id ?? raw.ID);
  return {
    id,
    sessionUUID: stringValue(raw.sessionUUID ?? raw.SessionUUID),
    filename: stringValue(raw.filename ?? raw.Filename),
    project: stringValue(raw.project ?? raw.Project),
    lastActivity: stringValue(raw.lastActivity ?? raw.LastActivity),
    name: stringValue(raw.name ?? raw.Name) || id,
    messageCount: numberValue(raw.messageCount ?? raw.MessageCount),
    tokenTotal: numberValue(raw.tokenTotal ?? raw.TokenTotal),
    costTotal: numberValue(raw.costTotal ?? raw.CostTotal),
    model: stringValue(raw.model ?? raw.Model),
    modelProvider: stringValue(raw.modelProvider ?? raw.ModelProvider),
    chatAvailable: booleanValue(raw.chatAvailable ?? raw.ChatAvailable),
    chatDisabledReason: stringValue(raw.chatDisabledReason ?? raw.ChatDisabledReason),
  };
}

function parseSSEPayload(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

function optionalString(raw: Record<string, unknown>, key: string): string | undefined | null {
  if (!(key in raw)) return undefined;
  return typeof raw[key] === 'string' ? raw[key] : null;
}

function parseNamedSSEPayload<Name extends PiWebSSEEventName>(
  name: Name,
  data: string,
): PiWebSSEEventMap[Name] | null {
  const raw = recordValue(parseSSEPayload(data));
  if (!raw) return null;

  if (name === 'chat-preview') {
    return typeof raw.content === 'string' && typeof raw.done === 'boolean'
      ? ({ content: raw.content, done: raw.done } as PiWebSSEEventMap[Name])
      : null;
  }

  if (name === 'status-snapshot') {
    if (
      !Array.isArray(raw.running) ||
      !raw.running.every((id) => typeof id === 'string' && id.length > 0) ||
      !recordValue(raw.statuses)
    ) {
      return null;
    }
    const statusesValue = recordValue(raw.statuses)!;
    const statuses: Record<string, SessionStatus> = {};
    for (const [key, value] of Object.entries(statusesValue)) {
      const status = recordValue(value);
      if (
        !status ||
        typeof status.id !== 'string' ||
        !status.id ||
        typeof status.running !== 'boolean'
      ) {
        return null;
      }
      const normalized: SessionStatus = { id: status.id, running: status.running };
      for (const field of ['model', 'modelName', 'modelProvider', 'project'] as const) {
        const next = optionalString(status, field);
        if (next === null) return null;
        if (next !== undefined) normalized[field] = next;
      }
      statuses[key] = normalized;
    }
    return { running: raw.running, statuses } as PiWebSSEEventMap[Name];
  }

  if (name === 'status-delta') {
    if (typeof raw.id !== 'string' || !raw.id || typeof raw.running !== 'boolean') return null;
    const status: SessionStatus = { id: raw.id, running: raw.running };
    for (const field of ['model', 'modelName', 'modelProvider', 'project'] as const) {
      const next = optionalString(raw, field);
      if (next === null) return null;
      if (next !== undefined) status[field] = next;
    }
    return status as PiWebSSEEventMap[Name];
  }

  if (name === 'annotations') {
    if (raw.type !== 'snapshot' || !Array.isArray(raw.annotations)) return null;
    const annotations = raw.annotations.map((value) => {
      const annotation = recordValue(value);
      if (!annotation) return null;
      if (
        typeof annotation.id !== 'string' ||
        typeof annotation.sessionId !== 'string' ||
        typeof annotation.anchorId !== 'string' ||
        typeof annotation.startOffset !== 'number' ||
        !Number.isFinite(annotation.startOffset) ||
        typeof annotation.endOffset !== 'number' ||
        !Number.isFinite(annotation.endOffset) ||
        typeof annotation.kind !== 'string' ||
        typeof annotation.text !== 'string' ||
        typeof annotation.original !== 'string' ||
        typeof annotation.source !== 'string' ||
        typeof annotation.createdAt !== 'number' ||
        !Number.isFinite(annotation.createdAt)
      ) {
        return null;
      }
      return annotation as unknown as Annotation;
    });
    return annotations.every((annotation): annotation is Annotation => annotation !== null)
      ? ({ type: 'snapshot', annotations } as unknown as PiWebSSEEventMap[Name])
      : null;
  }

  if (name === 'queue' || name === 'btw-changed') {
    return typeof raw.sessionId === 'string'
      ? ({ sessionId: raw.sessionId } as PiWebSSEEventMap[Name])
      : null;
  }

  return null;
}

function normalizeModels(payload: unknown): ModelsResult {
  const raw = recordValue(payload);
  if (!raw || !Array.isArray(raw.models)) return { models: [] };
  const models = raw.models.flatMap((value): PiModel[] => {
    const model = recordValue(value);
    if (!model) return [];
    const provider = stringValue(model.provider).trim();
    const id = stringValue(model.id).trim();
    return provider && id ? [{ ...model, provider, id } as PiModel] : [];
  });
  return { models };
}

function readHostContext(documentImpl: Pick<Document, 'getElementById'> | undefined): HostContext {
  const text = documentImpl?.getElementById('pi-host-context')?.textContent;
  if (!text) return DEFAULT_HOST_CONTEXT;
  try {
    const parsed = JSON.parse(text) as Partial<HostContext>;
    return {
      instanceName:
        typeof parsed.instanceName === 'string' && parsed.instanceName.trim()
          ? parsed.instanceName.trim()
          : DEFAULT_HOST_CONTEXT.instanceName,
      currentUrl: typeof parsed.currentUrl === 'string' ? parsed.currentUrl : '',
      peers: Array.isArray(parsed.peers)
        ? parsed.peers.filter(
            (peer): peer is HostContext['peers'][number] =>
              typeof peer?.label === 'string' && typeof peer?.url === 'string',
          )
        : [],
    };
  } catch {
    return DEFAULT_HOST_CONTEXT;
  }
}

function queryString(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.size ? `?${params}` : '';
}

function encodedQueryString(values: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function sessionQuery(id: string, query: SessionDetailsQuery): string {
  return queryString({
    id,
    from: query.from,
    count: query.count,
    paginate: query.paginate ? 1 : undefined,
  });
}

function normalizeProjectList(payload: Record<string, unknown>): ProjectList {
  const currentSessions = parsePiSessionSummaries(payload.currentSessions);
  return {
    projects: parsePiProjects(payload.projects),
    total: numberValue(payload.total),
    currentSessions,
    currentSessionsTotal: numberValue(payload.currentSessionsTotal),
    filterEnabled: booleanValue(payload.filterEnabled),
  };
}

function normalizeCommands(payload: Record<string, unknown>): CommandsResult {
  const commands = Array.isArray(payload.commands)
    ? payload.commands.flatMap((entry) => {
        const raw = recordValue(entry);
        if (!raw || typeof raw.name !== 'string') return [];
        const source: PiSlashCommand['source'] =
          raw.source === 'prompt' || raw.source === 'skill' || raw.source === 'extension'
            ? raw.source
            : 'extension';
        return [{ name: raw.name, description: stringValue(raw.description), source }];
      })
    : [];
  return { commands, workerReady: booleanValue(payload.workerReady) };
}

function normalizeFilePreview(payload: Record<string, unknown>): PiFilePreview {
  const kind = payload.kind === 'binary' ? 'binary' : 'text';
  return {
    path: asRelativePath(stringValue(payload.path)),
    kind,
    ...(typeof payload.content === 'string' ? { content: payload.content } : {}),
    size: numberValue(payload.size),
    modifiedAt: stringValue(payload.modifiedAt),
    revision: stringValue(payload.revision),
  };
}

function normalizeReviewComment(payload: unknown): ReviewComment {
  const raw = recordValue(payload) ?? {};
  return {
    id: stringValue(raw.id),
    sessionId: asSessionId(stringValue(raw.sessionId)),
    file: stringValue(raw.file),
    startLine: numberValue(raw.startLine),
    endLine: numberValue(raw.endLine),
    side: raw.side === 'old' ? 'old' : 'new',
    body: stringValue(raw.body),
    createdAt: numberValue(raw.createdAt),
  };
}

function normalizeAnnotation(payload: unknown): Annotation {
  const raw = recordValue(payload) ?? {};
  return {
    id: stringValue(raw.id),
    sessionId: asSessionId(stringValue(raw.sessionId)),
    anchorId: stringValue(raw.anchorId),
    startOffset: numberValue(raw.startOffset),
    endOffset: numberValue(raw.endOffset),
    kind: stringValue(raw.kind),
    text: stringValue(raw.text),
    original: stringValue(raw.original),
    source: stringValue(raw.source),
    createdAt: numberValue(raw.createdAt),
  };
}

function normalizeQueue(payload: Record<string, unknown>): ChatQueue {
  const items = Array.isArray(payload.items)
    ? payload.items.map((item) => {
        const raw = recordValue(item) ?? {};
        return {
          sessionId: asSessionId(stringValue(raw.sessionId)),
          position: numberValue(raw.position),
          message: stringValue(raw.message),
          displayText: stringValue(raw.displayText),
          createdAt: stringValue(raw.createdAt),
        };
      })
    : [];
  return { items, paused: booleanValue(payload.paused) };
}

function normalizeMetrics(payload: Record<string, unknown>): MetricsResult {
  const process = recordValue(payload.process) ?? {};
  const workers = Array.isArray(payload.workers)
    ? payload.workers.map((entry) => {
        const raw = recordValue(entry) ?? {};
        return {
          session_id: asSessionId(stringValue(raw.session_id)),
          pid: numberValue(raw.pid),
          state: stringValue(raw.state),
          ...(typeof raw.model === 'string' ? { model: raw.model } : {}),
          uptime_s: numberValue(raw.uptime_s),
          idle_for_s: numberValue(raw.idle_for_s),
          rss_bytes: numberValue(raw.rss_bytes),
          cpu_time_s: numberValue(raw.cpu_time_s),
          cpu_percent: numberValue(raw.cpu_percent),
          sampled: booleanValue(raw.sampled),
          zombie: booleanValue(raw.zombie),
        };
      })
    : [];
  return {
    process: {
      pid: numberValue(process.pid),
      uptime_s: numberValue(process.uptime_s),
      goroutines: numberValue(process.goroutines),
      heap_alloc_bytes: numberValue(process.heap_alloc_bytes),
      sse_clients: numberValue(process.sse_clients),
      watched_files: numberValue(process.watched_files),
    },
    workers,
  };
}

function normalizeVersion(payload: Record<string, unknown>): VersionInfo {
  return {
    current: stringValue(payload.current),
    latest: stringValue(payload.latest),
    hasUpdate: booleanValue(payload.hasUpdate),
    isDev: booleanValue(payload.isDev),
    changelog: stringValue(payload.changelog),
    changelogUrl: stringValue(payload.changelogUrl),
    checkedAt: stringValue(payload.checkedAt),
  };
}

export function createPiWebClient({
  fetchImpl = globalThis.fetch,
  httpImpl,
  EventSourceImpl = globalThis.EventSource,
  documentImpl = globalThis.document,
}: PiWebClientOptions = {}): PiWebClient {
  const http = httpImpl ?? createPiWebHttp(fetchImpl);

  return {
    async listSessions(query: SessionListQuery = {}): Promise<SessionList> {
      const suffix = queryString({
        limit: query.limit,
        offset: query.offset,
        q: query.query,
        project: query.project,
      });
      const payload = recordValue(await http.request<unknown>(`/api/sessions${suffix}`));
      return {
        sessions: Array.isArray(payload?.sessions)
          ? payload.sessions.flatMap((entry) => {
              const raw = recordValue(entry);
              return raw ? [normalizeSessionSummary(raw)] : [];
            })
          : [],
        total: numberValue(payload?.total),
        limit: typeof payload?.limit === 'number' ? payload.limit : undefined,
        offset: typeof payload?.offset === 'number' ? payload.offset : undefined,
      };
    },

    getSession(id: string, query: SessionDetailsQuery = {}): Promise<SessionDetails> {
      return http.request<SessionDetails>(`/api/session${sessionQuery(id, query)}`);
    },

    getPiSession(id: string, query: SessionDetailsQuery = {}): Promise<PiSession> {
      return http.request<unknown>(`/api/session${sessionQuery(id, query)}`).then(parsePiSession);
    },

    createSession(input: NewSessionInput): Promise<NewSessionResult> {
      return http.postJSON<NewSessionResult>('/api/new-session', input);
    },

    getSessionDefaults(sourceSessionId?: string): Promise<SessionDefaults> {
      return http.request<SessionDefaults>(
        `/api/session-defaults${queryString({ sourceSessionId })}`,
      );
    },

    listModels(): Promise<ModelsResult> {
      return http.request<unknown>('/api/models').then(normalizeModels);
    },

    sendChat(sessionId: string, input: ChatInput): Promise<ChatResult> {
      const body = new FormData();
      body.set('message', input.message);
      for (const image of input.images ?? []) body.append('images', image);
      return http.request<ChatResult>(`/api/chat?id=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
        body,
      });
    },

    cancelChat(sessionId: string): Promise<ChatResult> {
      return http.request<ChatResult>(`/api/chat/cancel?id=${encodeURIComponent(sessionId)}`, {
        method: 'POST',
      });
    },

    getWorkerStatus(sessionId: string): Promise<ChatWorkerStatus> {
      return http.request<ChatWorkerStatus>(
        `/api/worker-status?id=${encodeURIComponent(sessionId)}`,
      );
    },

    setModel(sessionId: string, provider: string, modelId: string): Promise<MutationResult> {
      return http.postJSON<MutationResult>(`/api/set-model?id=${encodeURIComponent(sessionId)}`, {
        provider,
        modelId,
      });
    },

    setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<SetThinkingLevelResult> {
      return http.postJSON<SetThinkingLevelResult>(
        `/api/set-thinking-level?id=${encodeURIComponent(sessionId)}`,
        { level },
      );
    },

    async listProjects(query: ProjectListQuery = {}): Promise<ProjectList> {
      const payload = await http.request<Record<string, unknown>>(
        `/api/projects${queryString({
          offset: query.offset,
          limit: query.limit,
          current: query.current,
          sessionLimit: query.sessionLimit,
        })}`,
      );
      return normalizeProjectList(payload);
    },

    updateProject(input: UpdateProjectInput): Promise<UpdateProjectResult> {
      return http.postJSON<UpdateProjectResult>('/api/projects', input);
    },

    async listRecentLocations(): Promise<RecentLocationsResult> {
      const payload = await http.request<{ locations?: unknown }>('/api/recent-locations');
      return {
        locations: Array.isArray(payload.locations)
          ? payload.locations
              .filter((path): path is string => typeof path === 'string')
              .map(asProjectPath)
          : [],
      };
    },

    async listFiles(
      sessionId: string,
      query: string | FileListQuery = '',
    ): Promise<FileListResult> {
      const q = typeof query === 'string' ? query : query.query;
      const payload = await http.request<{ files?: unknown }>(
        `/api/files${encodedQueryString({ id: sessionId, q })}`,
      );
      return {
        files: Array.isArray(payload.files)
          ? payload.files.flatMap((entry) => {
              const raw = recordValue(entry);
              return raw && typeof raw.path === 'string'
                ? [{ path: asRelativePath(raw.path), isDir: booleanValue(raw.isDir) }]
                : [];
            })
          : [],
      };
    },

    async getFile(sessionId: string, relativePath: string): Promise<PiFilePreview> {
      const payload = await http.request<Record<string, unknown>>(
        `/api/file${encodedQueryString({ id: sessionId, path: relativePath })}`,
      );
      return normalizeFilePreview(payload);
    },

    getCommands(sessionId: string, load = false): Promise<CommandsResult> {
      return http
        .request<
          Record<string, unknown>
        >(`/api/commands${encodedQueryString({ id: sessionId, load: load ? 1 : undefined })}`)
        .then(normalizeCommands);
    },

    forkSession(sessionId: string, entryId: string): Promise<SessionMutationResult> {
      return http.postJSON<SessionMutationResult>(
        `/api/fork-session?id=${encodeURIComponent(sessionId)}`,
        { entryId },
      );
    },

    cloneSession(sessionId: string, leafId?: string): Promise<SessionMutationResult> {
      return http.postJSON<SessionMutationResult>(
        `/api/clone-session?id=${encodeURIComponent(sessionId)}`,
        leafId ? { leafId } : {},
      );
    },

    renameSession(sessionId: string, name: string): Promise<RenameSessionResult> {
      return http.postJSON<RenameSessionResult>(
        `/api/rename-session?id=${encodeURIComponent(sessionId)}`,
        { name },
      );
    },

    labelSession(sessionId: string, entryId: string, label: string): Promise<LabelSessionResult> {
      return http.postJSON<LabelSessionResult>(
        `/api/label-session?id=${encodeURIComponent(sessionId)}`,
        { entryId, label },
      );
    },

    getGitInfo(sessionId: string): Promise<GitInfo> {
      return http.request<GitInfo>(`/api/git/info?id=${encodeURIComponent(sessionId)}`);
    },

    getGitDiff(sessionId: string): Promise<GitDiff> {
      return http.request<GitDiff>(`/api/git/diff?id=${encodeURIComponent(sessionId)}`);
    },

    renameGitBranch(sessionId: string, name: string): Promise<RenameBranchResult> {
      return http.postJSON<RenameBranchResult>(
        `/api/git/rename-branch?id=${encodeURIComponent(sessionId)}`,
        { name },
      );
    },

    async listReviewComments(sessionId: string): Promise<ReviewCommentsResult> {
      const payload = await http.request<{ comments?: unknown }>(
        `/api/diff/reviews${queryString({ session: sessionId })}`,
      );
      return {
        comments: Array.isArray(payload.comments)
          ? payload.comments.map(normalizeReviewComment)
          : [],
      };
    },

    async saveReviewComment(
      sessionId: string,
      input: ReviewCommentInput,
    ): Promise<ReviewCommentResult> {
      const payload = await http.postJSON<{ comment?: unknown }>(
        `/api/diff/reviews${queryString({ session: sessionId })}`,
        input,
      );
      return { comment: normalizeReviewComment(payload.comment) };
    },

    deleteReviewComment(sessionId: string, commentId: string): Promise<MutationResult> {
      return http.request<MutationResult>(
        `/api/diff/reviews${queryString({ session: sessionId, id: commentId })}`,
        { method: 'DELETE' },
      );
    },

    async listAnnotations(sessionId: string): Promise<AnnotationsResult> {
      const payload = await http.request<{ annotations?: unknown }>(
        `/api/annotations${queryString({ session: sessionId })}`,
      );
      return {
        annotations: Array.isArray(payload.annotations)
          ? payload.annotations.map(normalizeAnnotation)
          : [],
      };
    },

    async saveAnnotation(sessionId: string, input: AnnotationInput): Promise<AnnotationResult> {
      const payload = await http.postJSON<{ annotation?: unknown }>(
        `/api/annotations${queryString({ session: sessionId })}`,
        input,
      );
      return { annotation: normalizeAnnotation(payload.annotation) };
    },

    deleteAnnotation(sessionId: string, annotationId: string): Promise<MutationResult> {
      return http.request<MutationResult>(
        `/api/annotations${queryString({ session: sessionId, id: annotationId })}`,
        { method: 'DELETE' },
      );
    },

    async getScratchpad(projectPath: string): Promise<ScratchpadResult> {
      const payload = await http.request<{ content?: unknown }>(
        `/api/scratchpad${queryString({ project: projectPath })}`,
      );
      return { content: stringValue(payload.content) };
    },

    saveScratchpad(projectPath: string, content: string): Promise<SaveScratchpadResult> {
      return http.postJSON<SaveScratchpadResult>('/api/scratchpad', {
        project: projectPath,
        content,
      });
    },

    async getQueue(sessionId: string): Promise<ChatQueue> {
      const payload = await http.request<Record<string, unknown>>(
        `/api/chat/queue${queryString({ id: sessionId })}`,
      );
      return normalizeQueue(payload);
    },

    async addQueueItem(sessionId: string, input: AddQueueItemInput) {
      const payload = await http.postJSON<unknown>(
        `/api/chat/queue${queryString({ id: sessionId })}`,
        input,
      );
      const queue = normalizeQueue({ items: [payload], paused: false });
      return queue.items[0];
    },

    removeQueueItem(sessionId: string, position: number): Promise<MutationResult> {
      return http.request<MutationResult>(
        `/api/chat/queue${queryString({ id: sessionId, position })}`,
        { method: 'DELETE' },
      );
    },

    setQueuePaused(sessionId: string, paused: boolean) {
      return http.request<import('../live-domain').SetQueuePausedResult>(
        `/api/chat/queue${queryString({ id: sessionId })}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paused }),
        },
      );
    },

    getSettings(): Promise<SettingsResult> {
      return http.request<SettingsResult>('/api/settings');
    },

    saveSettings(settings: Record<string, string>): Promise<SaveSettingsResult> {
      return http.postJSON<SaveSettingsResult>('/api/settings', { settings });
    },

    getBtw(parent: string): Promise<BtwResult> {
      return http
        .request<{ sessionId?: unknown }>(`/api/btw${queryString({ parent })}`)
        .then((payload) => ({ sessionId: asSessionIdOrEmpty(payload.sessionId) }));
    },

    createBtw(input: CreateBtwInput): Promise<CreateBtwResult> {
      return http.postJSON<CreateBtwResult>('/api/btw/new', input);
    },

    listSchedules(): Promise<import('../live-domain').SchedulesResult> {
      return http.request<import('../live-domain').SchedulesResult>('/api/schedules');
    },

    createSchedule(input: ScheduleInput): Promise<ScheduleResult> {
      return http.postJSON<ScheduleResult>('/api/schedules', input);
    },

    getSchedule(scheduleId: string): Promise<ScheduleResult> {
      return http.request<ScheduleResult>(`/api/schedule${queryString({ id: scheduleId })}`);
    },

    updateSchedule(scheduleId: string, input: ScheduleInput): Promise<ScheduleResult> {
      return http.postJSON<ScheduleResult>(
        `/api/schedule${queryString({ id: scheduleId })}`,
        input,
      );
    },

    deleteSchedule(scheduleId: string): Promise<MutationResult> {
      return http.request<MutationResult>(`/api/schedule${queryString({ id: scheduleId })}`, {
        method: 'DELETE',
      });
    },

    runSchedule(scheduleId: string): Promise<RunScheduleResult> {
      return http.request<RunScheduleResult>(
        `/api/schedule/run${queryString({ id: scheduleId })}`,
        {
          method: 'POST',
        },
      );
    },

    listScheduleRuns(scheduleId: string): Promise<ScheduleRunsResult> {
      return http.request<ScheduleRunsResult>(
        `/api/schedule/runs${queryString({ id: scheduleId })}`,
      );
    },

    async getMetrics(): Promise<MetricsResult> {
      return normalizeMetrics(await http.request<Record<string, unknown>>('/api/metrics'));
    },

    async getVersion(): Promise<VersionInfo> {
      return normalizeVersion(await http.request<Record<string, unknown>>('/api/version'));
    },

    async checkForUpdate(): Promise<VersionInfo> {
      return normalizeVersion(
        await http.postJSON<Record<string, unknown>>('/api/check-update', {}),
      );
    },

    installUpdate(): Promise<UpdateResult> {
      return http.postJSON<UpdateResult>('/api/update', {});
    },

    restartServer(): Promise<UpdateResult> {
      return http.postJSON<UpdateResult>('/api/restart', {});
    },

    getHostContext(): HostContext {
      return readHostContext(documentImpl);
    },

    subscribe(topic: PiWebSSETopic, handlers: SSESubscriptionHandlers): SSESubscription {
      const source = new EventSourceImpl(`/events?id=${encodeURIComponent(topic)}`);
      if (handlers.onOpen) source.onopen = handlers.onOpen;
      source.onmessage = (event) => {
        if (event.data === 'reload' || event.data === 'new-session') {
          handlers.onEvent(event.data, undefined);
        }
      };
      for (const name of NAMED_SSE_EVENT_NAMES) {
        source.addEventListener(name, (event) => {
          const message = event as MessageEvent<string>;
          const payload = parseNamedSSEPayload(name, message.data);
          if (payload !== null) handlers.onEvent(name, payload);
        });
      }
      if (handlers.onError) source.onerror = handlers.onError;
      return { close: () => source.close() };
    },

    getPairingStatus(): Promise<PairingStatus> {
      return http.request<PairingStatus>('/api/pairing-status');
    },

    createPairingCode(): Promise<PairingCode> {
      return http.postJSON<PairingCode>('/api/pairing-codes', {});
    },

    submitPairing(input: PairingSubmission): Promise<PairingResult> {
      return http.postJSON<PairingResult>('/api/pair', input);
    },

    listPairedDevices(): Promise<PairedDevicesResult> {
      return http.request<PairedDevicesResult>('/api/devices');
    },

    async revokePairedDevice(deviceId: string): Promise<void> {
      await http.request<void>(`/api/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
      });
    },
  };
}

export { PiWebClientError };
