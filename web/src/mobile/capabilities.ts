import type { PiWebClient } from '../live-shared';

export interface MobileProject {
  path: string;
  label?: string;
  name?: string;
  enabled?: boolean;
  sessionCount?: number;
  runningSessionIds?: string[];
}

export interface MobileFile {
  path: string;
  kind?: 'file' | 'directory' | 'text' | 'binary';
  isDirectory?: boolean;
  isDir?: boolean;
  size?: number;
  modifiedAt?: string;
  content?: string;
}

export interface MobileDiffFile {
  path: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
  content?: string;
}

export interface MobileGitDiff {
  isRepo?: boolean;
  branch?: string;
  files?: MobileDiffFile[];
  diff?: string;
}

export interface MobileCommand {
  name: string;
  command?: string;
  description?: string;
  source?: string;
}

export interface MobilePiCapabilities {
  listRecentLocations?: () => Promise<{ locations: string[] }>;
  listProjects?: (query?: unknown) => Promise<{ projects: MobileProject[] }>;
  listFiles?: (sessionId: string, query?: string) => Promise<{ files: MobileFile[] }>;
  getFile?: (sessionId: string, path: string) => Promise<MobileFile>;
  getGitDiff?: (sessionId: string) => Promise<MobileGitDiff>;
  getScratchpad?: (projectPath: string) => Promise<{ content: string }>;
  saveScratchpad?: (projectPath: string, content: string) => Promise<unknown>;
  getCommands?: (sessionId: string) => Promise<{ commands: MobileCommand[] }>;
  forkSession?: (sessionId: string, entryId: string) => Promise<{ ok: boolean; id?: string }>;
  cloneSession?: (sessionId: string, leafId?: string) => Promise<{ ok: boolean; id?: string }>;
  renameSession?: (sessionId: string, name: string) => Promise<{ ok: boolean }>;
  labelSession?: (sessionId: string, entryId: string, label: string) => Promise<{ ok: boolean }>;
}

export function getMobileCapability<Name extends keyof MobilePiCapabilities>(
  client: PiWebClient,
  name: Name,
): MobilePiCapabilities[Name] | undefined {
  const capability = (client as unknown as MobilePiCapabilities)[name];
  return typeof capability === 'function' ? capability : undefined;
}
