import {
  AlertCircle,
  FileCode2,
  Folder,
  FolderTree,
  GitCompare,
  LoaderCircle,
  PanelRight,
  Save,
  StickyNote,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PiFilePreview } from '../live-domain';
import type { PiWebClient, SessionDetails, ThinkingLevel } from '../live-shared';
import {
  normalizeDiff,
  normalizeFileEntries,
  normalizeScratchpad,
  type DesktopFileEntry,
} from './desktop-capabilities';

export type RightPanelTab = 'details' | 'files' | 'diff' | 'scratchpad';

interface RightPanelProps {
  client: PiWebClient;
  details: SessionDetails;
  onClose: () => void;
  onTabChange: (tab: RightPanelTab) => void;
  onWidthChange: (width: number) => void;
  projectPath: string;
  running: boolean;
  sessionId: string;
  tab: RightPanelTab;
  thinking: ThinkingLevel;
  width: number;
  model: string;
  provider: string;
}

const tabs: Array<{ id: RightPanelTab; label: string; icon: typeof PanelRight }> = [
  { id: 'details', label: 'Details', icon: PanelRight },
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'diff', label: 'Diff', icon: GitCompare },
  { id: 'scratchpad', label: 'Scratchpad', icon: StickyNote },
];

function isDirectory(file: DesktopFileEntry): boolean {
  return file.isDirectory === true || file.kind === 'directory' || file.kind === 'dir';
}

function formatFileLabel(file: DesktopFileEntry): string {
  if (isDirectory(file)) return `${file.path}/`;
  return file.path;
}

export function RightPanel({
  client,
  details,
  onClose,
  onTabChange,
  onWidthChange,
  projectPath,
  running,
  sessionId,
  tab,
  thinking,
  width,
  model,
  provider,
}: RightPanelProps) {
  const [files, setFiles] = useState<DesktopFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<DesktopFileEntry | null>(null);
  const [filePreview, setFilePreview] = useState<PiFilePreview | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [filePreviewError, setFilePreviewError] = useState('');
  const fileRequestId = useRef(0);
  const [diff, setDiff] = useState('');
  const [isRepo, setIsRepo] = useState(true);
  const [branch, setBranch] = useState('');
  const [scratchpad, setScratchpad] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const subscription = client.subscribe(sessionId, {
      onEvent: (name) => {
        if (name === 'reload') setReloadNonce((current) => current + 1);
      },
    });
    return () => subscription.close();
  }, [client, sessionId]);

  useEffect(() => {
    let active = true;
    setLoaded(tab === 'details');
    setError('');
    setSaved(false);
    if (tab === 'details') return () => undefined;

    const load = async () => {
      try {
        if (tab === 'files') {
          if (typeof client.listFiles !== 'function') {
            if (active) setError('Files are not available from this Pi host.');
            return;
          }
          const listFiles = client.listFiles;
          const result = await listFiles.call(client, sessionId);
          if (active) {
            setFiles(normalizeFileEntries(result));
            setSelectedFile(null);
            setFilePreview(null);
            setFilePreviewError('');
          }
        } else if (tab === 'diff') {
          if (typeof client.getGitDiff !== 'function') {
            if (active) setError('Git diff is not available from this Pi host.');
            return;
          }
          const getGitDiff = client.getGitDiff;
          const result = normalizeDiff(await getGitDiff.call(client, sessionId));
          if (active) {
            setIsRepo(result.isRepo !== false);
            setDiff(result.diff ?? '');
            setBranch(result.branch ?? '');
          }
        } else {
          if (typeof client.getScratchpad !== 'function') {
            if (active) setError('Scratchpad is not available from this Pi host.');
            return;
          }
          const getScratchpad = client.getScratchpad;
          const result = await getScratchpad.call(client, projectPath);
          if (active) setScratchpad(normalizeScratchpad(result));
        }
      } catch (reason) {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Could not load this panel.');
      } finally {
        if (active) setLoaded(true);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [client, projectPath, reloadNonce, sessionId, tab]);

  const selectFile = async (file: DesktopFileEntry) => {
    const requestId = ++fileRequestId.current;
    setSelectedFile(file);
    setFilePreview(null);
    setFilePreviewError('');
    if (isDirectory(file)) {
      setFilePreviewError('Directories cannot be previewed.');
      setFilePreviewLoading(false);
      return;
    }
    setFilePreviewLoading(true);
    try {
      if (typeof client.getFile !== 'function') {
        setFilePreviewError('File previews are not available from this Pi host.');
        return;
      }
      const getFile = client.getFile;
      const result = await getFile.call(client, sessionId, file.path);
      if (requestId === fileRequestId.current) setFilePreview(result);
    } catch (reason) {
      if (requestId === fileRequestId.current) {
        setFilePreviewError(
          reason instanceof Error ? reason.message : 'Could not preview this file.',
        );
      }
    } finally {
      if (requestId === fileRequestId.current) setFilePreviewLoading(false);
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      if (typeof client.saveScratchpad !== 'function') {
        setError('Scratchpad is not available from this Pi host.');
        return;
      }
      const saveScratchpad = client.saveScratchpad;
      await saveScratchpad.call(client, projectPath, scratchpad);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the scratchpad.');
    } finally {
      setSaving(false);
    }
  };

  const beginResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const handleMove = (moveEvent: PointerEvent) => {
      onWidthChange(Math.min(520, Math.max(280, startWidth - moveEvent.clientX + startX)));
    };
    const handleEnd = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd, { once: true });
  };

  return (
    <>
      <div
        aria-hidden="true"
        className="desktop-context-backdrop"
        data-testid="context-panel-backdrop"
        onClick={onClose}
        role="presentation"
      />
      <aside
        aria-label="Session context panel"
        className="desktop-details-panel desktop-context-panel"
        style={{ '--desktop-right-panel-width': `${width}px` } as CSSProperties}
      >
        <div
          aria-label="Resize session panel"
          aria-orientation="vertical"
          aria-valuemax={520}
          aria-valuemin={280}
          aria-valuenow={width}
          className="desktop-details-resizer"
          onDoubleClick={() => onWidthChange(336)}
          onKeyDown={(event) => {
            if (
              event.key !== 'ArrowLeft' &&
              event.key !== 'ArrowRight' &&
              event.key !== 'Home' &&
              event.key !== 'End'
            )
              return;
            event.preventDefault();
            const next =
              event.key === 'Home'
                ? 520
                : event.key === 'End'
                  ? 280
                  : width + (event.key === 'ArrowLeft' ? 16 : -16);
            onWidthChange(Math.min(520, Math.max(280, next)));
          }}
          onPointerDown={beginResize}
          role="separator"
          tabIndex={0}
          title="Drag to resize · Use Arrow keys · Double-click to reset"
        />
        <header className="desktop-context-panel-header">
          <div>
            <span>Pi context</span>
            <strong>Session workspace</strong>
          </div>
          <button
            aria-label="Close session details"
            className="desktop-icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={15} />
          </button>
        </header>
        <div aria-label="Session context tabs" className="desktop-context-tabs" role="tablist">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              aria-selected={tab === id}
              className="desktop-context-tab"
              data-active={tab === id || undefined}
              id={`desktop-context-tab-${id}`}
              key={id}
              onClick={() => onTabChange(id)}
              onKeyDown={(event) => {
                if (
                  event.key !== 'ArrowRight' &&
                  event.key !== 'ArrowLeft' &&
                  event.key !== 'Home' &&
                  event.key !== 'End'
                )
                  return;
                event.preventDefault();
                const current = tabs.findIndex((item) => item.id === tab);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                        tabs.length;
                onTabChange(tabs[next].id);
                document.getElementById(`desktop-context-tab-${tabs[next].id}`)?.focus();
              }}
              role="tab"
              tabIndex={tab === id ? 0 : -1}
              type="button"
            >
              <Icon aria-hidden="true" size={13} />
              {label}
            </button>
          ))}
        </div>
        <div
          aria-busy={!loaded}
          aria-labelledby={`desktop-context-tab-${tab}`}
          className="desktop-details-scroll desktop-context-scroll"
          role="tabpanel"
        >
          {!loaded ? (
            <div className="desktop-panel-state">
              <LoaderCircle aria-hidden="true" className="desktop-spin" size={16} /> Loading…
            </div>
          ) : error ? (
            <div className="desktop-panel-state desktop-panel-error">
              <AlertCircle aria-hidden="true" size={16} />
              <span>{error}</span>
            </div>
          ) : tab === 'details' ? (
            <DetailsContent
              details={details}
              model={model}
              projectPath={projectPath}
              provider={provider}
              running={running}
              sessionId={sessionId}
              thinking={thinking}
            />
          ) : tab === 'files' ? (
            <FilesContent
              files={files}
              filePreview={filePreview}
              filePreviewError={filePreviewError}
              filePreviewLoading={filePreviewLoading}
              onSelectFile={(file) => void selectFile(file)}
              selectedFile={selectedFile}
            />
          ) : tab === 'diff' ? (
            <DiffContent branch={branch} diff={diff} isRepo={isRepo} />
          ) : (
            <section className="desktop-panel-card desktop-scratchpad-card">
              <div className="desktop-panel-card-heading">
                <div>
                  <h2>Project notes</h2>
                  <p>{projectPath || 'Current project'}</p>
                </div>
                <button
                  aria-label="Save scratchpad"
                  className="desktop-secondary-button"
                  disabled={saving}
                  onClick={() => void save()}
                  type="button"
                >
                  {saving ? (
                    <LoaderCircle aria-hidden="true" className="desktop-spin" size={13} />
                  ) : (
                    <Save aria-hidden="true" size={13} />
                  )}
                  {saved ? 'Saved' : 'Save'}
                </button>
              </div>
              <textarea
                aria-label="Scratchpad"
                className="desktop-scratchpad-input"
                onChange={(event) => {
                  setScratchpad(event.currentTarget.value);
                  setSaved(false);
                }}
                placeholder="Write project notes, tasks, or context for the next turn…"
                value={scratchpad}
              />
            </section>
          )}
        </div>
      </aside>
    </>
  );
}

function DetailsContent({
  details,
  model,
  projectPath,
  provider,
  running,
  sessionId,
  thinking,
}: Pick<
  RightPanelProps,
  'details' | 'model' | 'projectPath' | 'provider' | 'running' | 'sessionId' | 'thinking'
>) {
  return (
    <>
      <section className="desktop-panel-card">
        <h2>Workspace</h2>
        <div className="desktop-detail-path">
          <Folder aria-hidden="true" size={14} />
          <span>{projectPath || 'Unknown path'}</span>
        </div>
      </section>
      <section className="desktop-panel-card">
        <h2>Runtime</h2>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>{running ? 'Running' : 'Idle'}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{provider || 'Unknown'}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{model || 'Unknown'}</dd>
          </div>
          <div>
            <dt>Thinking</dt>
            <dd>{thinking}</dd>
          </div>
        </dl>
      </section>
      <section className="desktop-panel-card">
        <h2>Thread</h2>
        <dl>
          <div>
            <dt>Entries</dt>
            <dd>{details.total}</dd>
          </div>
          <div>
            <dt>Session ID</dt>
            <dd title={sessionId}>{sessionId}</dd>
          </div>
        </dl>
      </section>
      <div className="desktop-details-note">
        <PanelRight aria-hidden="true" size={13} />
        Pi keeps this context local to the selected session and host.
      </div>
    </>
  );
}

function FilesContent({
  files,
  filePreview,
  filePreviewError,
  filePreviewLoading,
  onSelectFile,
  selectedFile,
}: {
  files: DesktopFileEntry[];
  filePreview: PiFilePreview | null;
  filePreviewError: string;
  filePreviewLoading: boolean;
  onSelectFile: (file: DesktopFileEntry) => void;
  selectedFile: DesktopFileEntry | null;
}) {
  return files.length ? (
    <>
      <section className="desktop-panel-card desktop-files-card">
        <div className="desktop-panel-card-heading">
          <div>
            <h2>Workspace files</h2>
            <p>{files.length} visible paths</p>
          </div>
        </div>
        <ul className="desktop-file-list">
          {files.map((file) => (
            <li key={file.path}>
              <button
                aria-disabled={isDirectory(file) || undefined}
                aria-pressed={selectedFile?.path === file.path}
                className="desktop-file-row"
                onClick={() => onSelectFile(file)}
                title={isDirectory(file) ? 'Directory — preview unavailable' : file.path}
                type="button"
              >
                {isDirectory(file) ? (
                  <FolderTree aria-hidden="true" size={13} />
                ) : (
                  <FileCode2 aria-hidden="true" size={13} />
                )}
                <span>{formatFileLabel(file)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {selectedFile ? (
        <FilePreview
          file={selectedFile}
          preview={filePreview}
          error={filePreviewError}
          loading={filePreviewLoading}
        />
      ) : (
        <div className="desktop-panel-state desktop-file-hint">Select a file to preview it.</div>
      )}
    </>
  ) : (
    <div className="desktop-panel-state">No workspace files found.</div>
  );
}

function FilePreview({
  file,
  preview,
  error,
  loading,
}: {
  file: DesktopFileEntry;
  preview: PiFilePreview | null;
  error: string;
  loading: boolean;
}) {
  return (
    <section aria-label="File preview" className="desktop-panel-card desktop-file-preview">
      <div className="desktop-panel-card-heading">
        <div>
          <h2>Read-only preview</h2>
          <p title={file.path}>{file.path}</p>
        </div>
      </div>
      {loading ? (
        <div className="desktop-panel-state">
          <LoaderCircle aria-hidden="true" className="desktop-spin" size={15} /> Loading preview…
        </div>
      ) : error ? (
        <div className="desktop-panel-state desktop-panel-error" role="alert">
          <AlertCircle aria-hidden="true" size={15} />
          <span>{error}</span>
        </div>
      ) : preview?.kind === 'binary' ? (
        <div className="desktop-panel-state">
          <FileCode2 aria-hidden="true" size={15} /> Binary file; text preview is unavailable.
        </div>
      ) : preview ? (
        <>
          <div className="desktop-file-preview-meta">
            {formatBytes(preview.size)}
            {preview.modifiedAt ? ` / ${new Date(preview.modifiedAt).toLocaleDateString()}` : ''}
          </div>
          <pre className="desktop-file-preview-code">
            {preview.content || 'No text preview available.'}
          </pre>
        </>
      ) : (
        <div className="desktop-panel-state">Preview unavailable.</div>
      )}
    </section>
  );
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 1024) return `${Math.max(0, value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function DiffContent({ branch, diff, isRepo }: { branch: string; diff: string; isRepo: boolean }) {
  if (!isRepo) {
    return <div className="desktop-panel-state">This project is not a Git repository.</div>;
  }
  return diff ? (
    <section className="desktop-panel-card desktop-diff-card">
      <div className="desktop-panel-card-heading">
        <div>
          <h2>Working tree</h2>
          <p>{branch || 'Current branch'}</p>
        </div>
      </div>
      <pre>{diff}</pre>
    </section>
  ) : (
    <div className="desktop-panel-state">Working tree is clean.</div>
  );
}
