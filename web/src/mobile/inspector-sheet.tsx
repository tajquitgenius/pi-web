import { ChevronRight, FileCode2, FileText, FolderOpen, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PiWebClient, SessionEntry } from '../live-shared';
import {
  getMobileCapability,
  type MobileDiffFile,
  type MobileFile,
  type MobileGitDiff,
} from './capabilities';
import { useMobileDialog } from './dialog';

interface InspectorSheetProps {
  client: PiWebClient;
  sessionId: string;
  projectPath: string;
  model: string;
  provider: string;
  thinking: string;
  entryCount: number;
  entries: SessionEntry[];
  onClose: () => void;
}

type InspectorTab = 'details' | 'files' | 'diff' | 'scratchpad';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function filesFromResult(result: unknown): MobileFile[] {
  const payload = result && typeof result === 'object' ? (result as { files?: unknown }) : null;
  const files = Array.isArray(result) ? result : payload?.files;
  if (!Array.isArray(files)) return [];
  return files
    .map((file): MobileFile | null => {
      if (typeof file === 'string') return { path: file };
      if (!file || typeof file !== 'object' || typeof (file as MobileFile).path !== 'string')
        return null;
      const value = file as MobileFile;
      return {
        ...value,
        kind: value.isDirectory || value.isDir ? 'directory' : value.kind,
      };
    })
    .filter((file): file is MobileFile => file !== null);
}

function diffFromResult(result: unknown): MobileGitDiff {
  if (typeof result === 'string') return { diff: result, files: [] };
  if (!result || typeof result !== 'object') return {};
  const value = result as MobileGitDiff;
  return {
    isRepo: typeof value.isRepo === 'boolean' ? value.isRepo : true,
    branch: typeof value.branch === 'string' ? value.branch : '',
    diff: typeof value.diff === 'string' ? value.diff : '',
    files: Array.isArray(value.files)
      ? value.files.filter(
          (file): file is MobileDiffFile =>
            !!file && typeof file === 'object' && typeof file.path === 'string',
        )
      : [],
  };
}

function ToolPaths({ entries }: { entries: SessionEntry[] }) {
  const paths = useMemo(() => {
    const values = new Set<string>();
    for (const entry of entries) {
      const message = entry.message as { content?: unknown } | undefined;
      const content = Array.isArray(message?.content) ? message.content : [];
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const args = (block as { arguments?: Record<string, unknown> }).arguments;
        for (const key of ['path', 'file', 'filePath']) {
          if (typeof args?.[key] === 'string' && args[key]) values.add(args[key]);
        }
      }
    }
    return [...values];
  }, [entries]);

  if (paths.length === 0) return null;
  return (
    <section className="mobile-inspector-derived">
      <h3>Referenced files</h3>
      {paths.map((path) => (
        <code key={path}>{path}</code>
      ))}
    </section>
  );
}

function FilesPanel({ client, sessionId }: { client: PiWebClient; sessionId: string }) {
  const listFiles = getMobileCapability(client, 'listFiles');
  const getFile = getMobileCapability(client, 'getFile');
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<MobileFile[]>([]);
  const [selected, setSelected] = useState<MobileFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!listFiles) return;
    setLoading(true);
    setError('');
    try {
      setFiles(filesFromResult(await listFiles.call(client, sessionId, query.trim() || undefined)));
    } catch (loadError) {
      setError(errorMessage(loadError, 'Could not load project files.'));
    } finally {
      setLoading(false);
    }
  }, [client, listFiles, query, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openFile = async (file: MobileFile) => {
    if (file.kind === 'directory' || file.isDirectory || file.isDir) return;
    if (!getFile) {
      setSelected(file);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setSelected({
        ...file,
        ...(await getFile.call(client, sessionId, file.path)),
      });
    } catch (loadError) {
      setError(errorMessage(loadError, 'Could not read this file.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mobile-inspector-panel">
      <form
        className="mobile-inspector-search"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <input
          aria-label="Search project files"
          placeholder="Search files"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Loading…' : 'Search'}
        </button>
      </form>
      {error && (
        <p className="mobile-form-error" role="alert">
          {error}
        </p>
      )}
      {selected ? (
        <article className="mobile-file-preview">
          <button type="button" className="mobile-inspector-back" onClick={() => setSelected(null)}>
            <ChevronRight aria-hidden="true" size={16} /> All files
          </button>
          <h3>{selected.path}</h3>
          {selected.kind === 'binary' ? (
            <p>This file is binary and cannot be previewed here.</p>
          ) : (
            <pre>{selected.content || 'No preview content returned.'}</pre>
          )}
        </article>
      ) : files.length === 0 ? (
        <p className="mobile-inspector-empty">No files found.</p>
      ) : (
        <div className="mobile-inspector-list">
          {files.map((file) =>
            file.kind === 'directory' || file.isDirectory || file.isDir ? (
              <div
                key={file.path}
                className="mobile-inspector-file-row"
                aria-label={`${file.path} directory`}
              >
                <FolderOpen aria-hidden="true" size={17} />
                <span>{file.path}</span>
              </div>
            ) : (
              <button key={file.path} type="button" onClick={() => void openFile(file)}>
                <FileText aria-hidden="true" size={17} />
                <span>{file.path}</span>
                <ChevronRight aria-hidden="true" size={17} />
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function DiffPanel({ client, sessionId }: { client: PiWebClient; sessionId: string }) {
  const getDiff = getMobileCapability(client, 'getGitDiff');
  const [diff, setDiff] = useState<MobileGitDiff | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!getDiff) return;
    let active = true;
    getDiff
      .call(client, sessionId)
      .then((result) => {
        if (active) setDiff(diffFromResult(result));
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError, 'Could not load the working-tree diff.'));
      });
    return () => {
      active = false;
    };
  }, [client, getDiff, sessionId]);

  if (error)
    return (
      <p className="mobile-form-error" role="alert">
        {error}
      </p>
    );
  if (!diff) return <p className="mobile-inspector-empty">Loading current project diff…</p>;
  if (diff.isRepo === false) {
    return <p className="mobile-inspector-empty">This project is not a Git repository.</p>;
  }
  return (
    <div className="mobile-inspector-panel">
      <p className="mobile-inspector-kicker">
        Current working tree{diff.branch ? ` · ${diff.branch}` : ''}
      </p>
      {diff.files && diff.files.length > 0 && (
        <div className="mobile-diff-file-list">
          {diff.files.map((file) => (
            <div key={file.path}>
              <FileCode2 aria-hidden="true" size={16} />
              <span>{file.path}</span>
              <small>{file.status || 'changed'}</small>
            </div>
          ))}
        </div>
      )}
      <pre className="mobile-diff-preview">{diff.diff || 'Working tree is clean.'}</pre>
    </div>
  );
}

function ScratchpadPanel({ client, projectPath }: { client: PiWebClient; projectPath: string }) {
  const read = getMobileCapability(client, 'getScratchpad');
  const save = getMobileCapability(client, 'saveScratchpad');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(Boolean(read));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!read) return;
    let active = true;
    read
      .call(client, projectPath)
      .then((result) => {
        if (active) {
          setContent(
            typeof result === 'string'
              ? result
              : typeof result?.content === 'string'
                ? result.content
                : '',
          );
        }
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError, 'Could not load the project scratchpad.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, projectPath, read]);

  if (!read && !save) return null;
  return (
    <div className="mobile-inspector-panel">
      <p className="mobile-inspector-kicker">Notes for {projectPath}</p>
      {error && (
        <p className="mobile-form-error" role="alert">
          {error}
        </p>
      )}
      <textarea
        aria-label="Project scratchpad"
        value={content}
        disabled={loading || saving || !save}
        placeholder="Keep a note for this project"
        onChange={(event) => setContent(event.currentTarget.value)}
      />
      {save && (
        <button
          type="button"
          className="mobile-primary-button mobile-wide-button"
          disabled={loading || saving}
          onClick={async () => {
            setSaving(true);
            setError('');
            try {
              const result = await save.call(client, projectPath, content);
              if (
                result &&
                typeof result === 'object' &&
                'ok' in result &&
                (result as { ok?: unknown }).ok === false
              ) {
                throw new Error('Could not save the project scratchpad.');
              }
            } catch (saveError) {
              setError(errorMessage(saveError, 'Could not save the project scratchpad.'));
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? 'Saving…' : 'Save note'}
        </button>
      )}
    </div>
  );
}

export function InspectorSheet({
  client,
  sessionId,
  projectPath,
  model,
  provider,
  thinking,
  entryCount,
  entries,
  onClose,
}: InspectorSheetProps) {
  const hasFiles = Boolean(getMobileCapability(client, 'listFiles'));
  const hasDiff = Boolean(getMobileCapability(client, 'getGitDiff'));
  const hasScratchpad = Boolean(
    getMobileCapability(client, 'getScratchpad') || getMobileCapability(client, 'saveScratchpad'),
  );
  const [tab, setTab] = useState<InspectorTab>('details');
  const dialogRef = useRef<HTMLElement | null>(null);
  useMobileDialog(dialogRef, onClose);

  return (
    <div
      className="mobile-sheet-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="mobile-bottom-sheet mobile-inspector-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-inspector-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="mobile-eyebrow">Project inspector</p>
            <h2 id="mobile-inspector-title">Files, diff, and details</h2>
          </div>
          <button
            type="button"
            className="mobile-icon-button"
            aria-label="Close inspector"
            onClick={onClose}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <nav className="mobile-inspector-tabs" role="tablist" aria-label="Inspector sections">
          <button
            id="mobile-inspector-tab-details"
            role="tab"
            aria-selected={tab === 'details'}
            aria-controls="mobile-inspector-panel-details"
            tabIndex={tab === 'details' ? 0 : -1}
            type="button"
            className={tab === 'details' ? 'is-selected' : ''}
            onClick={() => setTab('details')}
          >
            Details
          </button>
          {hasFiles && (
            <button
              id="mobile-inspector-tab-files"
              role="tab"
              aria-selected={tab === 'files'}
              aria-controls="mobile-inspector-panel-files"
              tabIndex={tab === 'files' ? 0 : -1}
              type="button"
              className={tab === 'files' ? 'is-selected' : ''}
              onClick={() => setTab('files')}
            >
              Files
            </button>
          )}
          {hasDiff && (
            <button
              id="mobile-inspector-tab-diff"
              role="tab"
              aria-selected={tab === 'diff'}
              aria-controls="mobile-inspector-panel-diff"
              tabIndex={tab === 'diff' ? 0 : -1}
              type="button"
              className={tab === 'diff' ? 'is-selected' : ''}
              onClick={() => setTab('diff')}
            >
              Diff
            </button>
          )}
          {hasScratchpad && (
            <button
              id="mobile-inspector-tab-scratchpad"
              role="tab"
              aria-selected={tab === 'scratchpad'}
              aria-controls="mobile-inspector-panel-scratchpad"
              tabIndex={tab === 'scratchpad' ? 0 : -1}
              type="button"
              className={tab === 'scratchpad' ? 'is-selected' : ''}
              onClick={() => setTab('scratchpad')}
            >
              Scratchpad
            </button>
          )}
        </nav>
        {tab === 'details' && (
          <div
            id="mobile-inspector-panel-details"
            role="tabpanel"
            aria-labelledby="mobile-inspector-tab-details"
            tabIndex={0}
            className="mobile-inspector-panel"
          >
            <dl className="mobile-detail-list">
              <div>
                <dt>Project</dt>
                <dd>{projectPath || 'Unknown project'}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{sessionId}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>
                  {provider} · {model}
                </dd>
              </div>
              <div>
                <dt>Thinking</dt>
                <dd>{thinking}</dd>
              </div>
              <div>
                <dt>Entries</dt>
                <dd>{entryCount}</dd>
              </div>
            </dl>
            <ToolPaths entries={entries} />
          </div>
        )}
        {tab === 'files' && (
          <div
            id="mobile-inspector-panel-files"
            role="tabpanel"
            aria-labelledby="mobile-inspector-tab-files"
          >
            <FilesPanel client={client} sessionId={sessionId} />
          </div>
        )}
        {tab === 'diff' && (
          <div
            id="mobile-inspector-panel-diff"
            role="tabpanel"
            aria-labelledby="mobile-inspector-tab-diff"
          >
            <DiffPanel client={client} sessionId={sessionId} />
          </div>
        )}
        {tab === 'scratchpad' && (
          <div
            id="mobile-inspector-panel-scratchpad"
            role="tabpanel"
            aria-labelledby="mobile-inspector-tab-scratchpad"
          >
            <ScratchpadPanel client={client} projectPath={projectPath} />
          </div>
        )}
      </section>
    </div>
  );
}
