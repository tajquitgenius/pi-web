export interface DesktopFileEntry {
  path: string;
  kind?: string;
  isDirectory?: boolean;
}

export interface DesktopDiffResult {
  isRepo?: boolean;
  diff?: string;
  branch?: string;
}

export interface DesktopCommand {
  name?: string;
  description?: string;
  source?: string;
  command?: string;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeFileEntries(value: unknown): DesktopFileEntry[] {
  const payload = recordValue(value);
  const files = Array.isArray(value) ? value : payload?.files;
  if (!Array.isArray(files)) return [];
  return files
    .map((file): DesktopFileEntry | null => {
      if (typeof file === 'string') return { path: file };
      const record = recordValue(file);
      if (!record || typeof record.path !== 'string') return null;
      return {
        path: record.path,
        kind: typeof record.kind === 'string' ? record.kind : undefined,
        isDirectory: record.isDirectory === true || record.isDir === true,
      };
    })
    .filter((file): file is DesktopFileEntry => file !== null);
}

export function normalizeDiff(value: unknown): DesktopDiffResult {
  const payload = recordValue(value);
  return {
    isRepo: typeof payload?.isRepo === 'boolean' ? payload.isRepo : undefined,
    diff:
      typeof payload?.diff === 'string'
        ? payload.diff
        : typeof payload?.patch === 'string'
          ? payload.patch
          : typeof value === 'string'
            ? value
            : '',
    branch: typeof payload?.branch === 'string' ? payload.branch : undefined,
  };
}

export function normalizeScratchpad(value: unknown): string {
  if (typeof value === 'string') return value;
  const payload = recordValue(value);
  return typeof payload?.content === 'string' ? payload.content : '';
}

export function normalizeCommands(value: unknown): DesktopCommand[] {
  const payload = recordValue(value);
  const commands = Array.isArray(value) ? value : payload?.commands;
  if (!Array.isArray(commands)) return [];
  return commands
    .map((command): DesktopCommand | null => {
      if (typeof command === 'string') return { name: command, command };
      const record = recordValue(command);
      if (!record) return null;
      const name =
        typeof record.name === 'string'
          ? record.name
          : typeof record.command === 'string'
            ? record.command
            : '';
      if (!name) return null;
      return {
        name,
        command: typeof record.command === 'string' ? record.command : name,
        description: typeof record.description === 'string' ? record.description : undefined,
        source: typeof record.source === 'string' ? record.source : undefined,
      };
    })
    .filter((command): command is DesktopCommand => command !== null);
}
