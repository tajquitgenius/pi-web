export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type SessionId = Brand<string, 'SessionId'>;
export type SessionUuid = Brand<string, 'SessionUuid'>;
export type EntryId = Brand<string, 'EntryId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;
export type ProjectPath = Brand<string, 'ProjectPath'>;
export type RelativePath = Brand<string, 'RelativePath'>;

export function asSessionId(value: string): SessionId {
  return value as SessionId;
}

export function asSessionUuid(value: string): SessionUuid {
  return value as SessionUuid;
}

export function asEntryId(value: string): EntryId {
  return value as EntryId;
}

export function asToolCallId(value: string): ToolCallId {
  return value as ToolCallId;
}

export function asProjectPath(value: string): ProjectPath {
  return value as ProjectPath;
}

export function asRelativePath(value: string): RelativePath {
  return value as RelativePath;
}
