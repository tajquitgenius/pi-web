import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { downloadSessionJson } from './session-entry-actions.js';

describe('static export JSONL download', () => {
  it('downloads the header and entries, then revokes the object URL', () => {
    const { window } = new JSDOM('<body></body>');
    const click = vi
      .spyOn(window.HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const createObjectURL = vi.fn(() => 'blob:session');
    const revokeObjectURL = vi.fn();
    const blobs = [];
    class FakeBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
        blobs.push(this);
      }
    }

    downloadSessionJson({
      header: { id: 'session-id', cwd: '/work' },
      entries: [{ id: 'entry', type: 'message' }],
      documentImpl: window.document,
      URLImpl: { createObjectURL, revokeObjectURL },
      BlobImpl: FakeBlob,
    });

    expect(blobs[0].parts[0]).toBe(
      '{"type":"header","id":"session-id","cwd":"/work"}\n{"id":"entry","type":"message"}',
    );
    expect(blobs[0].options).toEqual({ type: 'application/x-ndjson' });
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:session');
  });
});
