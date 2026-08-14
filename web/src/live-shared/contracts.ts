export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface SessionSummary {
  id: string;
  sessionUUID: string;
  filename: string;
  project: string;
  lastActivity: string;
  name: string;
  messageCount: number;
  tokenTotal: number;
  costTotal: number;
  model: string;
  modelProvider: string;
  chatAvailable: boolean;
  chatDisabledReason: string;
}

export interface SessionListQuery {
  limit?: number;
  offset?: number;
  query?: string;
  project?: string;
}

export interface SessionList {
  sessions: SessionSummary[];
  total: number;
  limit?: number;
  offset?: number;
}

export interface SessionDetailsQuery {
  from?: number;
  count?: number;
  paginate?: boolean;
}

export type SessionEntry = Record<string, unknown>;

export interface SessionDetails {
  header: Record<string, unknown>;
  entries: SessionEntry[];
  name: string;
  total: number;
  from: number;
  chatAvailable: boolean;
  chatDisabledReason: string;
  model: string;
  modelProvider: string;
}

export interface SessionDefaults {
  modelProvider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

interface NewSessionPath {
  path: string;
}

export type NewSessionInput =
  | (NewSessionPath & {
      sourceSessionId?: never;
      modelProvider?: never;
      modelId?: never;
      thinkingLevel?: never;
    })
  | (NewSessionPath & {
      sourceSessionId: string;
      modelProvider?: never;
      modelId?: never;
      thinkingLevel?: never;
    })
  | (NewSessionPath &
      SessionDefaults & {
        sourceSessionId?: never;
      });

export interface NewSessionResult {
  ok: boolean;
  id: string;
}

export interface PiModel {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  [key: string]: unknown;
}

export interface ModelsResult {
  models: PiModel[];
}

export interface HostPeer {
  label: string;
  url: string;
}

export interface HostContext {
  instanceName: string;
  currentUrl: string;
  peers: HostPeer[];
}

export interface SessionStatus {
  id: string;
  running: boolean;
  model?: string;
  modelName?: string;
  modelProvider?: string;
  project?: string;
}

export interface StatusSnapshot {
  running: string[];
  statuses: Record<string, SessionStatus>;
}

export interface PiWebSSEEventMap {
  message: unknown;
  reload: unknown;
  'new-session': unknown;
  'chat-preview': unknown;
  'status-snapshot': StatusSnapshot;
  'status-delta': SessionStatus;
  annotations: unknown;
  btw: unknown;
}

export type PiWebSSEEventName = keyof PiWebSSEEventMap;
export type PiWebSSETopic = '__all__' | (string & {});

export interface SSESubscriptionHandlers {
  onEvent: <Name extends PiWebSSEEventName>(name: Name, payload: PiWebSSEEventMap[Name]) => void;
  onError?: (event: Event) => void;
}

export interface SSESubscription {
  close(): void;
}

export interface PairingStatus {
  paired: boolean;
  local: boolean;
}

export interface PairingSubmission {
  code: string;
  label: string;
}

export interface PairedDevice {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface PairingResult {
  paired: boolean;
  device: PairedDevice;
}

export interface PairedDevicesResult {
  devices: PairedDevice[];
}

export interface PiWebClient {
  listSessions(query?: SessionListQuery): Promise<SessionList>;
  getSession(id: string, query?: SessionDetailsQuery): Promise<SessionDetails>;
  createSession(input: NewSessionInput): Promise<NewSessionResult>;
  getSessionDefaults(sourceSessionId?: string): Promise<SessionDefaults>;
  listModels(): Promise<ModelsResult>;
  getHostContext(): HostContext;
  subscribe(topic: PiWebSSETopic, handlers: SSESubscriptionHandlers): SSESubscription;
  getPairingStatus(): Promise<PairingStatus>;
  submitPairing(input: PairingSubmission): Promise<PairingResult>;
  listPairedDevices(): Promise<PairedDevicesResult>;
  revokePairedDevice(deviceId: string): Promise<void>;
}
