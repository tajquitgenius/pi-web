import type {
  HostContext,
  ModelsResult,
  NewSessionInput,
  NewSessionResult,
  PairedDevicesResult,
  PairingResult,
  PairingStatus,
  PairingSubmission,
  PiWebClient,
  PiWebSSEEventMap,
  PiWebSSEEventName,
  PiWebSSETopic,
  SSESubscription,
  SSESubscriptionHandlers,
  SessionDefaults,
  SessionDetails,
  SessionDetailsQuery,
  SessionList,
  SessionListQuery,
  SessionSummary,
} from './contracts';

const SSE_EVENT_NAMES: PiWebSSEEventName[] = [
  'reload',
  'new-session',
  'chat-preview',
  'status-snapshot',
  'status-delta',
  'annotations',
  'btw',
];

const DEFAULT_HOST_CONTEXT: HostContext = {
  instanceName: 'This computer',
  currentUrl: '',
  peers: [],
};

type FetchLike = typeof fetch;
type EventSourceConstructor = new (
  url: string | URL,
  eventSourceInitDict?: EventSourceInit,
) => EventSource;

export interface PiWebClientOptions {
  fetchImpl?: FetchLike;
  EventSourceImpl?: EventSourceConstructor;
  documentImpl?: Pick<Document, 'getElementById'>;
}

export class PiWebClientError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PiWebClientError';
    this.status = status;
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
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
    chatAvailable: booleanValue(raw.chatAvailable ?? raw.ChatAvailable, true),
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

export function createPiWebClient({
  fetchImpl = globalThis.fetch,
  EventSourceImpl = globalThis.EventSource,
  documentImpl = globalThis.document,
}: PiWebClientOptions = {}): PiWebClient {
  async function request<Response>(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetchImpl(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init?.headers,
      },
    });
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: unknown };
        if (typeof payload.error === 'string' && payload.error) message = payload.error;
      } catch {
        // Keep the status-based message for non-JSON errors.
      }
      throw new PiWebClientError(response.status, message);
    }
    if (response.status === 204) return undefined as Response;
    return (await response.json()) as Response;
  }

  function postJSON<Response>(path: string, body: unknown): Promise<Response> {
    return request<Response>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  return {
    async listSessions(query: SessionListQuery = {}): Promise<SessionList> {
      const params = new URLSearchParams();
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.offset !== undefined) params.set('offset', String(query.offset));
      if (query.query) params.set('q', query.query);
      if (query.project) params.set('project', query.project);
      const suffix = params.size ? `?${params}` : '';
      const payload = await request<{
        sessions?: Record<string, unknown>[];
        total?: number;
        limit?: number;
        offset?: number;
      }>(`/api/sessions${suffix}`);
      return {
        sessions: (payload.sessions ?? []).map(normalizeSessionSummary),
        total: numberValue(payload.total),
        limit: payload.limit,
        offset: payload.offset,
      };
    },

    getSession(id: string, query: SessionDetailsQuery = {}): Promise<SessionDetails> {
      const params = new URLSearchParams({ id });
      if (query.from !== undefined) params.set('from', String(query.from));
      if (query.count !== undefined) params.set('count', String(query.count));
      if (query.paginate) params.set('paginate', '1');
      return request<SessionDetails>(`/api/session?${params}`);
    },

    createSession(input: NewSessionInput): Promise<NewSessionResult> {
      return postJSON<NewSessionResult>('/api/new-session', input);
    },

    getSessionDefaults(sourceSessionId?: string): Promise<SessionDefaults> {
      const params = new URLSearchParams();
      if (sourceSessionId) params.set('sourceSessionId', sourceSessionId);
      const suffix = params.size ? `?${params}` : '';
      return request<SessionDefaults>(`/api/session-defaults${suffix}`);
    },

    listModels(): Promise<ModelsResult> {
      return request<ModelsResult>('/api/models');
    },

    getHostContext(): HostContext {
      return readHostContext(documentImpl);
    },

    subscribe(topic: PiWebSSETopic, handlers: SSESubscriptionHandlers): SSESubscription {
      const source = new EventSourceImpl(`/events?id=${encodeURIComponent(topic)}`);
      source.onmessage = (event) => handlers.onEvent('message', parseSSEPayload(event.data));
      for (const name of SSE_EVENT_NAMES) {
        source.addEventListener(name, (event) => {
          const message = event as MessageEvent<string>;
          handlers.onEvent(name, parseSSEPayload(message.data) as PiWebSSEEventMap[typeof name]);
        });
      }
      if (handlers.onError) source.onerror = handlers.onError;
      return { close: () => source.close() };
    },

    getPairingStatus(): Promise<PairingStatus> {
      return request<PairingStatus>('/api/pairing-status');
    },

    submitPairing(input: PairingSubmission): Promise<PairingResult> {
      return postJSON<PairingResult>('/api/pair', input);
    },

    listPairedDevices(): Promise<PairedDevicesResult> {
      return request<PairedDevicesResult>('/api/devices');
    },

    async revokePairedDevice(deviceId: string): Promise<void> {
      await request<void>(`/api/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
      });
    },
  };
}
