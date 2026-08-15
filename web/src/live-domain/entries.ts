import type { EntryId, ToolCallId } from './ids';
import type { ThinkingLevel } from './models';

export interface PiUsage {
  totalTokens?: number;
  cost?: { total?: number };
}

export type PiContent = string | ReadonlyArray<PiContentBlock>;

export type PiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'toolCall'; id: ToolCallId; name: string; arguments: Readonly<Record<string, unknown>> }
  | { type: 'image'; mimeType?: string; data?: string; url?: string }
  | { type: 'unknown'; raw: Readonly<Record<string, unknown>> };

export type PiMessage =
  | { role: 'user'; content: PiContent }
  | {
      role: 'assistant';
      content: PiContent;
      stopReason?: string;
      errorMessage?: string;
      usage?: PiUsage;
    }
  | {
      role: 'toolResult';
      toolCallId?: ToolCallId;
      toolName?: string;
      content: PiContent;
      isError?: boolean;
    }
  | { role: 'bashExecution'; command: string; content?: PiContent };

interface PiEntryBase {
  id?: EntryId;
  parentId?: EntryId | null;
  timestamp?: string;
}

export type PiEntry =
  | (PiEntryBase & { type: 'message'; message: PiMessage })
  | (PiEntryBase & { type: 'custom_message'; customType: string; content: PiContent })
  | (PiEntryBase & { type: 'compaction'; tokensBefore: number })
  | (PiEntryBase & { type: 'branch_summary'; summary: string })
  | (PiEntryBase & { type: 'model_change'; provider?: string; modelId: string })
  | (PiEntryBase & { type: 'thinking_level_change'; thinkingLevel: ThinkingLevel })
  | (PiEntryBase & { type: 'label'; targetId: EntryId; label?: string })
  | (PiEntryBase & { type: 'session_info'; name?: string; autoTitle?: boolean })
  | { type: 'unknown'; raw: Readonly<Record<string, unknown>> };
