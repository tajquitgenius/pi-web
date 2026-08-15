import { describe, expect, it } from 'vitest';
import { parsePiEntry } from './parser';

describe('parsePiEntry', () => {
  it('normalizes a Pi assistant message and keeps typed content blocks', () => {
    const entry = parsePiEntry({
      id: 'entry-1',
      parentId: null,
      timestamp: '2026-08-14T12:00:00Z',
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.txt' } },
        ],
      },
    });

    expect(entry).toEqual({
      id: 'entry-1',
      parentId: null,
      timestamp: '2026-08-14T12:00:00Z',
      type: 'message',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.txt' } },
        ],
      },
    });
  });

  it('preserves an extension entry it does not know', () => {
    const raw = { type: 'plugin_event', plugin: 'example', payload: { ok: true } };
    expect(parsePiEntry(raw)).toEqual({ type: 'unknown', raw });
  });
});
