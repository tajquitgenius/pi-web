// Download a static conversation snapshot as JSONL: header line + entry lines.
export function downloadSessionJson({
  entries = [],
  header = null,
  documentImpl = document,
  URLImpl = URL,
  BlobImpl = Blob,
} = {}) {
  const lines = [];
  if (header) lines.push(JSON.stringify({ type: 'header', ...header }));
  for (const entry of entries) lines.push(JSON.stringify(entry));
  const blob = new BlobImpl([lines.join('\n')], { type: 'application/x-ndjson' });
  const url = URLImpl.createObjectURL(blob);
  const anchor = documentImpl.createElement('a');
  anchor.href = url;
  anchor.download = `${header?.id || 'session'}.jsonl`;
  documentImpl.body.appendChild(anchor);
  anchor.click();
  documentImpl.body.removeChild(anchor);
  URLImpl.revokeObjectURL(url);
}
