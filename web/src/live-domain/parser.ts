import type { PiContent, PiContentBlock, PiEntry, PiMessage, PiUsage } from './entries';
import { asEntryId, asProjectPath, asSessionId, asSessionUuid, asToolCallId } from './ids';
import type { ProjectPath, SessionId } from './ids';
import type { PiSession, PiSessionDetailsDto, PiSessionHeader } from './session';
import type { PiModelRef, PiProject, PiSessionSummary, ThinkingLevel, WorkerState } from './models';

const THINKING_LEVELS = new Set<ThinkingLevel>([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function entryBase(raw: Record<string, unknown>): {
  id?: ReturnType<typeof asEntryId>;
  parentId?: ReturnType<typeof asEntryId> | null;
  timestamp?: string;
} {
  const base: ReturnType<typeof entryBase> = {};
  if (typeof raw.id === 'string' && raw.id) base.id = asEntryId(raw.id);
  if (raw.parentId === null) base.parentId = null;
  else if (typeof raw.parentId === 'string' && raw.parentId)
    base.parentId = asEntryId(raw.parentId);
  if (typeof raw.timestamp === 'string') base.timestamp = raw.timestamp;
  return base;
}

function parseUsage(value: unknown): PiUsage | undefined {
  const raw = recordValue(value);
  if (!raw) return undefined;
  const cost = recordValue(raw.cost);
  const usage: PiUsage = {};
  if (typeof raw.totalTokens === 'number' && Number.isFinite(raw.totalTokens)) {
    usage.totalTokens = raw.totalTokens;
  }
  if (cost && typeof cost.total === 'number' && Number.isFinite(cost.total)) {
    usage.cost = { total: cost.total };
  }
  return Object.keys(usage).length ? usage : undefined;
}

function parseContentBlock(value: unknown): PiContentBlock {
  const raw = recordValue(value);
  if (!raw || typeof raw.type !== 'string') return { type: 'unknown', raw: raw ?? {} };
  switch (raw.type) {
    case 'text':
      return { type: 'text', text: stringValue(raw.text) };
    case 'thinking':
      return { type: 'thinking', thinking: stringValue(raw.thinking) };
    case 'toolCall':
      return {
        type: 'toolCall',
        id: asToolCallId(stringValue(raw.id)),
        name: stringValue(raw.name),
        arguments: recordValue(raw.arguments) ?? {},
      };
    case 'image':
      return {
        type: 'image',
        ...(typeof raw.mimeType === 'string' ? { mimeType: raw.mimeType } : {}),
        ...(typeof raw.data === 'string' ? { data: raw.data } : {}),
        ...(typeof raw.url === 'string' ? { url: raw.url } : {}),
      };
    default:
      return { type: 'unknown', raw };
  }
}

export function parsePiContent(value: unknown): PiContent {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return [];
  return value.map(parseContentBlock);
}

function parseMessage(value: unknown): PiMessage | null {
  const raw = recordValue(value);
  if (!raw || typeof raw.role !== 'string') return null;
  const content = parsePiContent(raw.content);
  switch (raw.role) {
    case 'user':
      return { role: 'user', content };
    case 'assistant': {
      const usage = parseUsage(raw.usage);
      return {
        role: 'assistant',
        content,
        ...(typeof raw.stopReason === 'string' ? { stopReason: raw.stopReason } : {}),
        ...(typeof raw.errorMessage === 'string' ? { errorMessage: raw.errorMessage } : {}),
        ...(usage ? { usage } : {}),
      };
    }
    case 'toolResult':
      return {
        role: 'toolResult',
        content,
        ...(typeof raw.toolCallId === 'string' ? { toolCallId: asToolCallId(raw.toolCallId) } : {}),
        ...(typeof raw.toolName === 'string' ? { toolName: raw.toolName } : {}),
        ...(typeof raw.isError === 'boolean' ? { isError: raw.isError } : {}),
      };
    case 'bashExecution':
      return {
        role: 'bashExecution',
        command: stringValue(raw.command),
        ...(raw.content !== undefined ? { content } : {}),
      };
    default:
      return null;
  }
}

export function parsePiEntry(value: unknown): PiEntry {
  const raw = recordValue(value);
  if (!raw || typeof raw.type !== 'string') return { type: 'unknown', raw: raw ?? {} };
  const base = entryBase(raw);
  switch (raw.type) {
    case 'message': {
      const message = parseMessage(raw.message);
      return message ? { ...base, type: 'message', message } : { type: 'unknown', raw };
    }
    case 'custom_message':
      return {
        ...base,
        type: 'custom_message',
        customType: stringValue(raw.customType),
        content: parsePiContent(raw.content),
      };
    case 'compaction':
      return { ...base, type: 'compaction', tokensBefore: numberValue(raw.tokensBefore) };
    case 'branch_summary':
      return { ...base, type: 'branch_summary', summary: stringValue(raw.summary) };
    case 'model_change':
      return {
        ...base,
        type: 'model_change',
        ...(typeof raw.provider === 'string' ? { provider: raw.provider } : {}),
        modelId: stringValue(raw.modelId),
      };
    case 'thinking_level_change':
      return {
        ...base,
        type: 'thinking_level_change',
        thinkingLevel: parseThinkingLevel(raw.thinkingLevel),
      };
    case 'label':
      return {
        ...base,
        type: 'label',
        targetId: asEntryId(stringValue(raw.targetId)),
        ...(typeof raw.label === 'string' ? { label: raw.label } : {}),
      };
    case 'session_info':
      return {
        ...base,
        type: 'session_info',
        ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
        ...(typeof raw.autoTitle === 'boolean' ? { autoTitle: raw.autoTitle } : {}),
      };
    default:
      return { type: 'unknown', raw };
  }
}

export function parsePiEntries(value: unknown): PiEntry[] {
  return Array.isArray(value) ? value.map(parsePiEntry) : [];
}

export function parsePiSessionHeader(value: unknown): PiSessionHeader {
  const raw = recordValue(value) ?? {};
  const header: PiSessionHeader = {
    ...raw,
    type: 'session',
    cwd: asProjectPath(stringValue(raw.cwd)),
  };
  if (typeof raw.version === 'number' && Number.isFinite(raw.version)) header.version = raw.version;
  if (typeof raw.id === 'string' && raw.id) header.id = asSessionUuid(raw.id);
  if (typeof raw.timestamp === 'string') header.timestamp = raw.timestamp;
  if (typeof raw.name === 'string') header.name = raw.name;
  return header;
}

function parseThinkingLevel(value: unknown): ThinkingLevel {
  return THINKING_LEVELS.has(value as ThinkingLevel) ? (value as ThinkingLevel) : 'off';
}

function parseModelRef(provider: unknown, id: unknown): PiModelRef | null {
  const modelProvider = stringValue(provider);
  const modelId = stringValue(id);
  return modelProvider && modelId ? { provider: modelProvider, id: modelId } : null;
}

export function parsePiSession(value: unknown): PiSession {
  const raw = recordValue(value) as PiSessionDetailsDto | null;
  const source: PiSessionDetailsDto = raw ?? ({} as PiSessionDetailsDto);
  const currentModel = parseModelRef(source.modelProvider, source.model);
  const header = parsePiSessionHeader(source.header);
  return {
    header,
    entries: parsePiEntries(source.entries),
    name: stringValue(source.name, header.name ?? ''),
    page: { from: numberValue(source.from), total: numberValue(source.total) },
    chat: booleanValue(source.chatAvailable)
      ? { available: true }
      : { available: false, reason: stringValue(source.chatDisabledReason) },
    current: {
      model: currentModel ?? { provider: '', id: '' },
      thinkingLevel: parseThinkingLevel(source.thinkingLevel),
    },
  };
}

function parseWorkerState(value: unknown): WorkerState {
  const raw = recordValue(value);
  if (!raw) return { kind: 'idle' };
  if (raw.state === 'error') return { kind: 'error', message: stringValue(raw.error) };
  if (raw.state === 'running') {
    return {
      kind: 'running',
      ...(typeof raw.preview === 'string' ? { preview: raw.preview } : {}),
    };
  }
  return { kind: 'idle' };
}

export function parsePiSessionSummary(value: unknown, worker?: unknown): PiSessionSummary {
  const raw = recordValue(value) ?? {};
  const idValue = stringValue(raw.id ?? raw.ID);
  const project = stringValue(raw.project ?? raw.Project);
  const model = parseModelRef(raw.modelProvider ?? raw.ModelProvider, raw.model ?? raw.Model);
  const available = booleanValue(raw.chatAvailable ?? raw.ChatAvailable);
  return {
    id: asSessionId(idValue),
    uuid: asSessionUuid(stringValue(raw.sessionUUID ?? raw.SessionUUID)),
    projectPath: project ? asProjectPath(project) : null,
    title: stringValue(raw.name ?? raw.Name, idValue),
    lastActivity: stringValue(raw.lastActivity ?? raw.LastActivity),
    messageCount: numberValue(raw.messageCount ?? raw.MessageCount),
    usage: {
      tokens: numberValue(raw.tokenTotal ?? raw.TokenTotal),
      cost: numberValue(raw.costTotal ?? raw.CostTotal),
    },
    runtime: model,
    chat: available
      ? { available: true }
      : {
          available: false,
          reason: stringValue(raw.chatDisabledReason ?? raw.ChatDisabledReason),
        },
    worker: parseWorkerState(worker),
  };
}

export function parsePiSessionSummaries(
  value: unknown,
  workers?: Record<string, unknown>,
): PiSessionSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const raw = recordValue(entry);
      if (!raw) return null;
      const id = stringValue(raw.id ?? raw.ID);
      return parsePiSessionSummary(raw, workers?.[id]);
    })
    .filter((entry): entry is PiSessionSummary => entry !== null);
}

export function parsePiProject(value: unknown): PiProject | null {
  const raw = recordValue(value);
  if (!raw || typeof raw.path !== 'string') return null;
  const running = Array.isArray(raw.runningSessionIds)
    ? raw.runningSessionIds.filter((id): id is string => typeof id === 'string').map(asSessionId)
    : [];
  return {
    path: asProjectPath(raw.path),
    label: stringValue(raw.label) || raw.path.split(/[\\/]/).filter(Boolean).pop() || raw.path,
    enabled: booleanValue(raw.enabled),
    source: raw.source === 'registered' ? 'registered' : 'discovered',
    sessionCount: numberValue(raw.sessionCount),
    runningSessionIds: running,
  };
}

export function parsePiProjects(value: unknown): PiProject[] {
  if (!Array.isArray(value)) return [];
  return value.map(parsePiProject).filter((project): project is PiProject => project !== null);
}

export function asSessionIdOrEmpty(value: unknown): SessionId | '' {
  return typeof value === 'string' && value ? asSessionId(value) : '';
}

export function asProjectPathOrEmpty(value: unknown): ProjectPath | '' {
  return typeof value === 'string' && value ? asProjectPath(value) : '';
}
