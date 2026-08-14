import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

// Mock node:fs before importing the module under test
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    chmodSync: vi.fn(),
    mkdirSync: vi.fn((path: string, options?: unknown) => {
      if (typeof path === 'string' && path.includes('/.tmp-test-')) {
        return (actual as any).mkdirSync(path, options as any);
      }
      return undefined;
    }),
    writeFileSync: vi.fn((path: string, content: string, options?: unknown) => {
      const tokenEnvPath = `${homedir()}/.config/pi-web/env`;
      if (typeof path === 'string' && path === tokenEnvPath) {
        (globalThis as any).__MOCK_PI_WEB_ENV_CONTENT__ = content;
        return undefined;
      }
      return (actual as any).writeFileSync(path, content, options);
    }),
    readFileSync: vi.fn((path: string, encoding: BufferEncoding) => {
      // Delegate to actual unless it's the token env file
      const tokenEnvPath = `${homedir()}/.config/pi-web/env`;
      if (typeof path === 'string' && path === tokenEnvPath) {
        const content = (globalThis as any).__MOCK_PI_WEB_ENV_CONTENT__;
        if (content !== undefined) return content;
        const token = (globalThis as any).__MOCK_PI_WEB_TOKEN__;
        if (token === undefined) {
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }
        if (token === null) return '';
        return `PI_WEB_TOKEN=${token}\n`;
      }
      return (actual as any).readFileSync(path, encoding);
    }),
  };
});

import {
  detectHostPort,
  isSSH,
  normalizeCommandArgs,
  readPiWebToken,
  writePiWebToken,
  cleanupPiWebNpmTemps,
  piWebBinaryCandidates,
} from '../../.pi/extensions/pi-web.ts';

declare global {
  var __MOCK_PI_WEB_TOKEN__: string | null | undefined;
  var __MOCK_PI_WEB_ENV_CONTENT__: string | undefined;
}

describe('piWebBinaryCandidates', () => {
  it('includes the unprivileged user binary independently of PATH', () => {
    expect(piWebBinaryCandidates('/tmp/agent', '/home/work-claw')).toEqual([
      './pi-web',
      '/tmp/agent/bin/pi-web',
      '/home/work-claw/.local/bin/pi-web',
    ]);
  });
});

// ── isSSH ───────────────────────────────────────────────────────────
describe('isSSH', () => {
  const orig = { ...process.env };

  beforeEach(() => {
    delete process.env.SSH_TTY;
    delete process.env.SSH_CONNECTION;
    delete process.env.SSH_CLIENT;
  });

  afterEach(() => {
    process.env = { ...orig };
  });

  it('returns false when no SSH env vars are set', () => {
    expect(isSSH()).toBe(false);
  });

  it('returns true when SSH_TTY is set', () => {
    process.env.SSH_TTY = '/dev/pts/0';
    expect(isSSH()).toBe(true);
  });

  it('returns true when SSH_CONNECTION is set', () => {
    process.env.SSH_CONNECTION = '192.168.1.1 1234 10.0.0.1 22';
    expect(isSSH()).toBe(true);
  });

  it('returns true when SSH_CLIENT is set', () => {
    process.env.SSH_CLIENT = '192.168.1.1 1234 22';
    expect(isSSH()).toBe(true);
  });
});

// ── state discovery ─────────────────────────────────────────────────
describe('detectHostPort', () => {
  it('reads publicUrl and ignores legacy Tailscale fields', async () => {
    const root = `${process.cwd()}/.tmp-test-state-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    mkdirSync(`${root}/pi-web`, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = root;
    try {
      writeFileSync(
        `${root}/pi-web/pi-web-state.json`,
        JSON.stringify({
          pid: process.pid,
          host: '127.0.0.1',
          port: '31415',
          publicUrl: 'https://pi.example',
          tailscale: true,
          tailscaleUrl: 'https://legacy.example',
        }),
      );
      const pi = { exec: vi.fn() } as any;
      await expect(detectHostPort(pi)).resolves.toEqual({
        host: '127.0.0.1',
        port: '31415',
        publicUrl: 'https://pi.example',
      });
      expect(pi.exec).not.toHaveBeenCalled();
    } finally {
      delete process.env.PI_CODING_AGENT_DIR;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses old state for local discovery without inventing a public URL', async () => {
    const root = `${process.cwd()}/.tmp-test-state-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    mkdirSync(`${root}/pi-web`, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = root;
    try {
      writeFileSync(
        `${root}/pi-web/pi-web-state.json`,
        JSON.stringify({
          pid: process.pid,
          host: '127.0.0.1',
          port: '31415',
          tailscale: true,
          tailscaleUrl: 'https://legacy.example',
        }),
      );
      await expect(detectHostPort({ exec: vi.fn() } as any)).resolves.toEqual({
        host: '127.0.0.1',
        port: '31415',
      });
    } finally {
      delete process.env.PI_CODING_AGENT_DIR;
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── normalizeCommandArgs ────────────────────────────────────────────
describe('normalizeCommandArgs', () => {
  it('returns empty for undefined', () => {
    expect(normalizeCommandArgs(undefined)).toEqual([]);
  });

  it('returns empty for empty string', () => {
    expect(normalizeCommandArgs('')).toEqual([]);
  });

  it('returns empty for whitespace string', () => {
    expect(normalizeCommandArgs('   ')).toEqual([]);
  });

  it('splits a string into words', () => {
    expect(normalizeCommandArgs('hello world')).toEqual(['hello', 'world']);
  });

  it('handles array input', () => {
    expect(normalizeCommandArgs(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('converts numbers to strings', () => {
    expect(normalizeCommandArgs([1, 2])).toEqual(['1', '2']);
  });

  it('set-token destructure: [, token] from [subcommand, token]', () => {
    const [, token] = normalizeCommandArgs('set-token my-secret');
    expect(token).toBe('my-secret');
  });

  it('set-token destructure: token with special chars', () => {
    const [, token] = normalizeCommandArgs('set-token sec=ret&val');
    expect(token).toBe('sec=ret&val');
  });
});

// ── npm cleanup ────────────────────────────────────────────────────
describe('cleanupPiWebNpmTemps', () => {
  it('removes stale pi-web npm temp dirs only', () => {
    const root = `${process.cwd()}/.tmp-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const scope = `${root}/npm/node_modules/@tajquitgenius`;
    const stale = `${scope}/.pi-web-F7YwHA7A`;
    const keep = `${scope}/pi-web`;
    mkdirSync(`${stale}/nested`, { recursive: true });
    mkdirSync(keep, { recursive: true });
    writeFileSync(`${stale}/nested/file`, 'x');

    try {
      expect(cleanupPiWebNpmTemps(root)).toBe(1);
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(keep)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── readPiWebToken ──────────────────────────────────────────────────
describe('token helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as any).__MOCK_PI_WEB_TOKEN__;
    delete (globalThis as any).__MOCK_PI_WEB_ENV_CONTENT__;
  });

  it('readPiWebToken reads token from env file', () => {
    (globalThis as any).__MOCK_PI_WEB_TOKEN__ = 'secret-123';

    expect(readPiWebToken()).toBe('secret-123');
  });

  it('readPiWebToken returns null when file does not exist', () => {
    (globalThis as any).__MOCK_PI_WEB_TOKEN__ = undefined;

    expect(readPiWebToken()).toBeNull();
  });

  it('readPiWebToken prefers process.env over env file', () => {
    process.env['PI_WEB_TOKEN'] = 'from-env';
    (globalThis as any).__MOCK_PI_WEB_TOKEN__ = 'from-file';

    expect(readPiWebToken()).toBe('from-env');

    delete process.env['PI_WEB_TOKEN'];
  });

  it('readPiWebToken returns token from env var even when no file exists', () => {
    process.env['PI_WEB_TOKEN'] = 'env-only';
    (globalThis as any).__MOCK_PI_WEB_TOKEN__ = undefined;

    expect(readPiWebToken()).toBe('env-only');

    delete process.env['PI_WEB_TOKEN'];
  });

  it('writePiWebToken creates a private env file and directory', () => {
    const path = `${homedir()}/.config/pi-web/env`;

    writePiWebToken('secret-123');

    expect(mkdirSync).toHaveBeenCalledWith(dirname(path), { recursive: true });
    expect(chmodSync).toHaveBeenCalledWith(dirname(path), 0o700);
    expect(writeFileSync).toHaveBeenCalledWith(path, 'PI_WEB_TOKEN=secret-123\n', {
      mode: 0o600,
    });
    expect(chmodSync).toHaveBeenCalledWith(path, 0o600);
  });
});
