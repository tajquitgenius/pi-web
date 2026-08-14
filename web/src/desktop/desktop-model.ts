import type { PiModel, SessionDefaults, SessionSummary, ThinkingLevel } from '../live-shared';

export const DEFAULT_SESSION_SETTINGS: SessionDefaults = {
  modelProvider: 'openai-codex-secondary',
  modelId: 'gpt-5.6-sol',
  thinkingLevel: 'high',
};

export const THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

export const SIDEBAR_COLLAPSED_KEY = 'pi-web:desktop:sidebar-collapsed';
export const SIDEBAR_WIDTH_KEY = 'pi-web:desktop:sidebar-width';
export const DETAILS_OPEN_KEY = 'pi-web:desktop:details-open';

export interface SessionGroup {
  project: string;
  sessions: SessionSummary[];
  running: boolean;
  lastActivity: number;
}

function activityTime(session: SessionSummary): number {
  const time = Date.parse(session.lastActivity);
  return Number.isFinite(time) ? time : 0;
}

export function groupSessions(
  sessions: SessionSummary[],
  runningSessionIds: ReadonlySet<string>,
): SessionGroup[] {
  const grouped = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const project = session.project || 'Unknown project';
    const group = grouped.get(project) ?? [];
    group.push(session);
    grouped.set(project, group);
  }

  return [...grouped.entries()]
    .map(([project, projectSessions]) => {
      projectSessions.sort((left, right) => {
        const runningOrder =
          Number(runningSessionIds.has(right.id)) - Number(runningSessionIds.has(left.id));
        return runningOrder || activityTime(right) - activityTime(left);
      });
      return {
        project,
        sessions: projectSessions,
        running: projectSessions.some((session) => runningSessionIds.has(session.id)),
        lastActivity: Math.max(0, ...projectSessions.map(activityTime)),
      };
    })
    .sort(
      (left, right) =>
        Number(right.running) - Number(left.running) || right.lastActivity - left.lastActivity,
    );
}

export function projectLabel(project: string): string {
  const normalized = project.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).pop() || project;
}

export function modelLabel(model: PiModel): string {
  return model.name?.trim() || model.id;
}

export function modelsForProvider(models: PiModel[], provider: string): PiModel[] {
  return models.filter((model) => model.provider === provider);
}

export function uniqueProviders(models: PiModel[], selectedProvider: string): string[] {
  return [...new Set([selectedProvider, ...models.map((model) => model.provider)].filter(Boolean))];
}

export function relativeTime(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function readStoredBoolean(storage: Storage, key: string, fallback: boolean): boolean {
  try {
    const value = storage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

export function readStoredWidth(storage: Storage, fallback = 288): number {
  try {
    const value = Number(storage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(value) && value >= 224 && value <= 440 ? value : fallback;
  } catch {
    return fallback;
  }
}
