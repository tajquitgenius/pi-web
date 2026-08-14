import { describe, expect, it } from 'vitest';
import { SessionDataModel } from './session-data.svelte.js';

const entries = [
  {
    id: 'root',
    timestamp: '2026-01-01T00:00:00Z',
    type: 'message',
    message: { role: 'user', content: 'hello world' },
  },
  {
    id: 'old',
    parentId: 'root',
    timestamp: '2026-01-01T00:01:00Z',
    type: 'message',
    message: { role: 'assistant', content: 'old branch reply' },
  },
  {
    id: 'mid',
    parentId: 'root',
    timestamp: '2026-01-01T00:02:00Z',
    type: 'message',
    message: { role: 'assistant', content: 'mid reply' },
  },
  {
    id: 'leaf',
    parentId: 'mid',
    timestamp: '2026-01-01T00:03:00Z',
    type: 'message',
    message: { role: 'user', content: 'tell me about widgets' },
  },
];

function model() {
  return new SessionDataModel({ entries, header: {}, leafId: 'leaf' });
}

describe('static export SessionDataModel', () => {
  it('builds the branch tree and active path', () => {
    const value = model();
    expect(value.tree.map((node) => node.entry.id)).toEqual(['root']);
    expect(value.tree[0].children.map((node) => node.entry.id)).toEqual(['old', 'mid']);
    expect(value.activePath.map((entry) => entry.id)).toEqual(['root', 'mid', 'leaf']);
    expect([...value.activePathIds].sort()).toEqual(['leaf', 'mid', 'root']);
  });

  it('navigates between branches', () => {
    const value = model();
    value.navigateTo('old');
    expect(value.currentLeafId).toBe('old');
    expect(value.activePath.map((entry) => entry.id)).toEqual(['root', 'old']);
  });

  it('finds the newest leaf below a tree node', () => {
    expect(model().newestLeaf('root')).toBe('leaf');
  });

  it('applies the export outline search filter reactively', () => {
    const value = model();
    const unfiltered = value.filteredNodes.length;
    value.searchQuery = 'widgets';
    expect(value.filteredNodes.map((node) => node.node.entry.id)).toContain('leaf');
    expect(value.filteredNodes.length).toBeLessThan(unfiltered);
  });

  it('honors an embedded target id', () => {
    const value = new SessionDataModel({ entries, header: {}, leafId: 'leaf', urlTargetId: 'mid' });
    expect(value.currentLeafId).toBe('leaf');
    expect(value.currentTargetId).toBe('mid');
  });
});
