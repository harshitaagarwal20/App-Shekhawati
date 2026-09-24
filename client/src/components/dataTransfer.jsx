/**
 * Tables out, masters in - the two buttons, and the dialog behind one of them.
 *
 * ===========================================================================
 *  ONE COMPONENT, NOT ONE PER SCREEN
 * ===========================================================================
 *
 *  Every list screen in this application wants the same button, and the server
 *  serves all of them from one endpoint (see dataset.registry.js). Written per
 *  screen, "Export" would be twenty-nine copies of the same six lines, each
 *  free to forget the busy state, the error, or - worst - to send different
 *  filters from the ones the table is showing.
 *
 *  So a screen says:
 *
 *      <ExportButton dataset="buyers" params={list.query} />
 *
 *  and the filters come straight off the list hook. What downloads is what is
 *  on screen, every page of it.
 *
 * ---------------------------------------------------------------------------
 *  WHY THE BUTTONS ASK THE SERVER WHETHER THEY EXIST
 *
 *  Neither takes a `permission` prop. Both read the catalogue - the tables this
 *  user may download, the masters they may import - which the server has
 *  already filtered by permission, and render nothing if their key is not in
 *  it. A screen therefore cannot offer a download the API would refuse, and
 *  cannot get the permission code wrong, because it never names one.
 *
 *  The catalogue is fetched once per session and shared by every button on
 *  every screen; see `catalogueOnce`.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { dataExports, dataImports } from '../services/erp.js';
import { Alert, Modal, Spinner } from './ui.jsx';
import { useIsMounted } from '../hooks/useIsMounted.js';

// ===========================================================================
//  THE CATALOGUES
// ===========================================================================

/**
 * One request per catalogue per session, shared by every button.
 *
 * Held in a module variable rather than in React state because it is the same
 * answer for every screen and it does not change while the user is signed in -
 * their permissions are re-read server-side on every request anyway, so the
 * worst a stale catalogue can do is show a button whose action is then refused
 * with a sentence saying why.
 */
const cache = { exports: null, imports: null };

function catalogueOnce(which, fetcher) {
  cache[which] ??= fetcher().catch(() => {
    // A catalogue that will not load hides the buttons rather than breaking
    // the screen they sit on. Exporting is never the reason someone opened it.
    cache[which] = null;
    return null;
  });
  return cache[which];
}

/** Resets the cached catalogues. Called on sign-out. */
export function forgetDataTransferCatalogues() {
  cache.exports = null;
  cache.imports = null;
}

function useCatalogueEntry(which, key, fetcher, read) {
  const [entry, setEntry] = useState(null);
  const isMounted = useIsMounted();

  useEffect(() => {
    let live = true;
    catalogueOnce(which, fetcher).then((data) => {
      if (!live || !isMounted.current || !data) return;
      setEntry(read(data).find((row) => row.key === key) ?? null);
    });
    return () => {
      live = false;
    };
  }, [which, key, fetcher, read, isMounted]);

  return entry;
}

const fetchExports = () => dataExports.catalogue();
const readExports = (d) => d.datasets ?? [];
const fetchImports = () => dataImports.catalogue();
const readImports = (d) => d.masters ?? [];

// ===========================================================================
//  EXPORT
// ===========================================================================

/**
 * "Export CSV" for one table.
 *
 * @param {string} dataset  A key from the export registry ('buyers', 'grns', ...)
 * @param {object} params   The filters the screen is showing. Pass `list.query`.
 * @param {number} [rowCount]  What the screen says it found, so an empty table
 *                             can say so instead of downloading an empty file.
 */
export function ExportButton({ dataset, params = {}, rowCount, label = 'Export CSV', className = 'btn' }) {
  const entry = useCatalogueEntry('exports', dataset, fetchExports, readExports);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // { kind, text }
  const isMounted = useIsMounted();
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const say = useCallback(
    (kind, text) => {
      if (!isMounted.current) return;
      setStatus({ kind, text });
      clearTimeout(timer.current);
      // Long enough to read, short enough not to become furniture. Errors stay.
      if (kind !== 'error') timer.current = setTimeout(() => isMounted.current && setStatus(null), 6000);
    },
    [isMounted],
  );

  if (!entry) return null;

  const empty = rowCount === 0;

  async function run() {
    setBusy(true);
    setStatus(null);
    try {
      const { rowCount: saved } = await dataExports.download(dataset, params);
      say('success', `${(saved ?? 0).toLocaleString('en-IN')} row(s) downloaded.`);
    } catch (e) {
      say('error', e.message);
    } finally {
      if (isMounted.current) setBusy(false);
    }
  }

  return (
    <span className="row" style={{ gap: 8 }}>
      <button
        type="button"
        className={className}
        onClick={run}
        disabled={busy || empty}
        title={
          empty
            ? 'There are no rows to export. Clear the search or filters.'
            : 'Downloads every row this table is showing, not just this page.'
        }
      >
        {busy ? 'Preparing...' : label}
      </button>
      {status && (
        <span className={status.kind === 'error' ? 'err' : 'muted'} role="status">
          {status.text}
        </span>
      )}
    </span>
  );
}

// ===========================================================================
//  IMPORT
// ===========================================================================

const MODES = [
  {
    value: 'upsert',
    label: 'Create and update',
    hint: 'Rows that match an existing record update it; the rest are created.',
  },
  {
    value: 'create',
    label: 'Create only',
    hint: 'Every row must be new. A row matching an existing record is refused.',
  },
  {
    value: 'update',
    label: 'Update only',
    hint: 'Every row must already exist. Nothing new is created.',
  },
];

/** "Import CSV", and the dialog it opens. */
export function ImportButton({ master, onImported, label = 'Import CSV', className = 'btn' }) {
  const entry = useCatalogueEntry('imports', master, fetchImports, readImports);
  const [open, setOpen] = useState(false);

  if (!entry) return null;

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <ImportDialog
          master={master}
          entry={entry}
          onClose={() => setOpen(false)}
          onImported={onImported}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
//  THE PREVIEW
//
//  Read in the browser for DISPLAY ONLY: the column mapping and a few sample
//  values, the way Odoo shows them before you test. What is checked and what
//  is written is still decided by the server from the File object itself.
//  The header matching mirrors `mapHeaders` / `normaliseHeader` on the server.
// ---------------------------------------------------------------------------

const PREVIEW_SAMPLES = 3;

function normaliseHeader(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, '');
}

/** A small RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF. */
function parseCsvText(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function buildPreview(text, fields) {
  const rows = parseCsvText(text);
  const headers = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  const data = rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));

  const byName = new Map();
  for (const f of fields) {
    for (const alias of [f.label, f.key]) byName.set(normaliseHeader(alias), f);
  }

  const claimed = new Map();
  const columns = headers.map((header, index) => {
    const samples = [];
    for (const r of data) {
      const v = String(r[index] ?? '').trim();
      if (v !== '') samples.push(v);
      if (samples.length === PREVIEW_SAMPLES) break;
    }
    const field = byName.get(normaliseHeader(header)) ?? null;
    let status = field ? 'mapped' : 'unknown';
    let duplicateOf = null;
    if (field && claimed.has(field.key)) {
      status = 'duplicate';
      duplicateOf = claimed.get(field.key);
    } else if (field) {
      claimed.set(field.key, header);
    }
    return { header, field, status, duplicateOf, samples };
  });

  const missingRequired = fields.filter((f) => f.required && !claimed.has(f.key));
  return { rowCount: data.length, columns, missingRequired };
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The import dialog, laid out the way Odoo's importer is: a control bar
 * (Load File, Test, Import), an options sidebar, and a column-mapping table.
 *
 * ---------------------------------------------------------------------------
 *  THE TEST IS NOT OPTIONAL, AND IT IS THE SAME REQUEST AS THE IMPORT
 *
 *  There is no "just import it" path. The file is always sent up and tested
 *  first, and the Import button stays disabled until that test comes back
 *  clean - so the number the user is agreeing to ("Import 240 rows") is a
 *  number the server worked out from their actual file, not the preview's.
 *
 *  The apply step then sends THE SAME File object again with one flag changed.
 *  Re-reading the file, or holding a parsed copy in the browser and sending
 *  that, would both allow what is applied to differ from what was approved.
 * ---------------------------------------------------------------------------
 */
function ImportDialog({ master, entry, onClose, onImported }) {
  const [spec, setSpec] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState(entry.canCreate && entry.canEdit ? 'upsert' : (entry.canCreate ? 'create' : 'update'));
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef(null);
  const isMounted = useIsMounted();

  useEffect(() => {
    dataImports
      .spec(master)
      .then((s) => isMounted.current && setSpec(s))
      .catch((e) => isMounted.current && setError(e.message));
  }, [master, isMounted]);

  // The preview follows the file. A file that will not read in the browser
  // still goes to the server on Test, which gives the real reason.
  useEffect(() => {
    if (!file || !spec) {
      setPreview(null);
      return undefined;
    }
    let live = true;
    file
      .text()
      .then((text) => live && isMounted.current && setPreview(buildPreview(text, spec.fields ?? [])))
      .catch(() => live && isMounted.current && setPreview(null));
    return () => {
      live = false;
    };
  }, [file, spec, isMounted]);

  const modes = MODES.filter(
    (m) =>
      (m.value !== 'create' || entry.canCreate)
      && (m.value !== 'update' || entry.canEdit)
      && (m.value !== 'upsert' || (entry.canCreate && entry.canEdit)),
  );
  const modeHint = MODES.find((m) => m.value === mode)?.hint;

  /** Any change to the file or the mode invalidates the test that was run. */
  function reset(apply) {
    setReport(null);
    setError('');
    setDone(false);
    apply();
  }

  function chooseFile(next) {
    if (!next) return;
    reset(() => setFile(next));
  }

  function downloadTemplate() {
    dataImports.template(master).catch((e) => setError(e.message));
  }

  async function test() {
    setBusy(true);
    setError('');
    try {
      const r = await dataImports.check(master, file, mode);
      if (isMounted.current) setReport(r);
    } catch (e) {
      if (isMounted.current) {
        setReport(null);
        setError(e.message);
      }
    } finally {
      if (isMounted.current) setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError('');
    try {
      const r = await dataImports.apply(master, file, mode);
      if (!isMounted.current) return;
      setReport(r);
      setDone(true);
      onImported?.(r);
    } catch (e) {
      if (isMounted.current) setError(e.message);
    } finally {
      if (isMounted.current) setBusy(false);
    }
  }

  const clean = report && report.failed === 0;
  const willChange = report ? report.willCreate + report.willUpdate : 0;
  const locked = busy || done;

  const dropProps = locked
    ? {}
    : {
        onDragOver: (e) => {
          e.preventDefault();
          setDragging(true);
        },
        onDragLeave: () => setDragging(false),
        onDrop: (e) => {
          e.preventDefault();
          setDragging(false);
          chooseFile(e.dataTransfer.files?.[0] ?? null);
        },
      };

  let importLabel = 'Import';
  if (busy && clean) importLabel = 'Importing...';
  else if (clean) importLabel = `Import ${willChange.toLocaleString('en-IN')} row(s)`;

  return (
    <Modal title={`Import ${entry.title}`} size="wide" onClose={onClose}>
      {/* ---- Control bar ---------------------------------------------- */}
      <div className="imp-toolbar">
        <div className="imp-toolbar-actions">
          {!done && (
            <>
              <button
                type="button"
                className={file ? 'btn' : 'btn btn-primary'}
                onClick={() => fileInput.current?.click()}
                disabled={locked || !spec}
              >
                {file ? 'Load another file' : 'Load File'}
              </button>
              <button type="button" className="btn" onClick={test} disabled={!file || locked}>
                {busy && !report ? 'Testing...' : 'Test'}
              </button>
              <button
                type="button"
                className={clean ? 'btn btn-primary' : 'btn'}
                onClick={apply}
                disabled={!clean || busy}
                title={clean ? undefined : 'Test the file first. Import is enabled once the test passes.'}
              >
                {importLabel}
              </button>
            </>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {done ? 'Close' : 'Cancel'}
          </button>
        </div>
        <button type="button" className="btn-link imp-template" onClick={downloadTemplate}>
          Import template for {entry.title}
        </button>
        <input
          ref={fileInput}
          id="import-file"
          className="imp-file-input"
          type="file"
          accept=".csv,text/csv"
          aria-label="CSV file"
          disabled={locked}
          onChange={(e) => {
            chooseFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {report && <ImportReport report={report} done={done} />}

      {!spec && !error && <Spinner label="Loading the columns..." />}

      {/* ---- No file yet: the drop zone ------------------------------- */}
      {spec && !file && (
        <div
          className={`imp-drop ${dragging ? 'is-dragging' : ''}`}
          {...dropProps}
          onClick={() => !locked && fileInput.current?.click()}
          role="presentation"
        >
          <div className="imp-drop-icon" aria-hidden="true">&#8683;</div>
          <div className="imp-drop-title">Upload a CSV file to import {entry.title.toLowerCase()}</div>
          <div className="imp-drop-sub">
            Drop it here, or click <strong>Load File</strong>.
          </div>
          <ul className="imp-drop-tips">
            <li>Export this list, edit it in Excel, and import it back.</li>
            <li>
              Or start from the{' '}
              <button
                type="button"
                className="btn-link"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadTemplate();
                }}
              >
                import template
              </button>
              .
            </li>
            {spec.maxRows ? <li>Up to {spec.maxRows.toLocaleString('en-IN')} rows per file.</li> : null}
          </ul>
        </div>
      )}

      {/* ---- File loaded: options + mapping --------------------------- */}
      {spec && file && (
        <div className={`imp-layout ${dragging ? 'is-dragging' : ''}`} {...dropProps}>
          <aside className="imp-side">
            <div className="imp-side-block">
              <div className="imp-side-label">File</div>
              <div className="imp-file-name" title={file.name}>{file.name}</div>
              <div className="muted imp-small">
                {formatSize(file.size)}
                {preview ? ` · ${preview.rowCount.toLocaleString('en-IN')} row(s)` : ''}
              </div>
            </div>

            <div className="imp-side-block">
              <label className="imp-side-label" htmlFor="import-mode">Import mode</label>
              <select
                id="import-mode"
                value={mode}
                disabled={locked || modes.length < 2}
                onChange={(e) => reset(() => setMode(e.target.value))}
              >
                {modes.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <div className="muted imp-small">{modeHint}</div>
            </div>

            <div className="imp-side-block">
              <div className="imp-side-label">Matched on</div>
              <div><strong>{spec.identityLabel}</strong></div>
            </div>

            <div className="imp-side-block imp-help">
              <div className="imp-side-label">Good to know</div>
              <ul>
                <li>A column not in your file is left unchanged.</li>
                <li>A column that is there but empty clears that field.</li>
                {spec.note ? <li>{spec.note}</li> : null}
              </ul>
            </div>
          </aside>

          <div className="imp-main">
            {!preview && <Spinner label="Reading the file..." />}
            {preview && <MappingTable preview={preview} title={entry.title} />}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** File column -> field, with a few sample values - Odoo's mapping grid. */
function MappingTable({ preview, title }) {
  const { columns, missingRequired } = preview;

  if (columns.length === 0) {
    return <Alert kind="warning">This file has no header row.</Alert>;
  }

  return (
    <>
      {missingRequired.length > 0 && (
        <div className="imp-note">
          Required for new records but not in this file:{' '}
          <strong>{missingRequired.map((f) => f.label).join(', ')}</strong>. Fine if you are only updating.
        </div>
      )}
      <div className="table-wrap imp-map">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: '32%' }}>File Column</th>
              <th style={{ width: '30%' }}>Field</th>
              <th>Sample values</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c, i) => (
              <tr key={`${c.header}-${i}`} className={c.status !== 'mapped' ? 'imp-row-bad' : ''}>
                <td className="imp-col-name">{c.header || <em className="muted">(blank header)</em>}</td>
                <td>
                  {c.status === 'mapped' && (
                    <span className="imp-field">
                      <span className="imp-dot ok" aria-hidden="true" />
                      {c.field.label}
                      {c.field.required && <span className="imp-req" title="Required">*</span>}
                    </span>
                  )}
                  {c.status === 'unknown' && (
                    <span className="imp-field bad">
                      <span className="imp-dot bad" aria-hidden="true" />
                      No such field in {title}
                    </span>
                  )}
                  {c.status === 'duplicate' && (
                    <span className="imp-field bad">
                      <span className="imp-dot bad" aria-hidden="true" />
                      Same field as &quot;{c.duplicateOf}&quot;
                    </span>
                  )}
                </td>
                <td className="imp-samples">
                  {c.samples.length > 0 ? c.samples.join(', ') : <span className="muted">(empty)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** What the file would do, or what it did. */
function ImportReport({ report, done }) {
  const { rowCount, willCreate, willUpdate, created, updated, failed, issues, issuesTruncated } = report;

  if (done) {
    return (
      <Alert kind={failed ? 'warning' : 'success'}>
        <strong>
          {created.toLocaleString('en-IN')} added, {updated.toLocaleString('en-IN')} updated
          {failed ? `, ${failed} could not be saved` : ''}.
        </strong>
        {failed > 0 && <IssueTable issues={issues} truncated={issuesTruncated} />}
      </Alert>
    );
  }

  if (failed > 0) {
    return (
      <Alert kind="error">
        <strong>
          {failed.toLocaleString('en-IN')} of {rowCount.toLocaleString('en-IN')} row(s) have a
          problem. Nothing has been written.
        </strong>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Fix these in the file and test it again. The row numbers are the ones your spreadsheet
          shows.
        </p>
        <IssueTable issues={issues} truncated={issuesTruncated} />
      </Alert>
    );
  }

  return (
    <Alert kind="success">
      <strong>Everything seems valid.</strong> {rowCount.toLocaleString('en-IN')} row(s):{' '}
      {willCreate.toLocaleString('en-IN')} to create, {willUpdate.toLocaleString('en-IN')} to update.
      Nothing is written until you click Import.
    </Alert>
  );
}

function IssueTable({ issues, truncated }) {
  return (
    <div className="table-wrap" style={{ marginTop: 8, maxHeight: 260 }}>
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: 70 }}>Row</th>
            <th style={{ width: 180 }}>Record</th>
            <th style={{ width: 180 }}>Column</th>
            <th>Problem</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue, i) => (
            <tr key={`${issue.line}-${issue.field ?? ''}-${i}`}>
              <td className="num">{issue.line}</td>
              <td className="code">{issue.identity}</td>
              <td>{issue.field ?? '-'}</td>
              <td>{issue.message}</td>
            </tr>
          ))}
          {truncated > 0 && (
            <tr>
              <td colSpan={4} className="muted">
                ...and {truncated.toLocaleString('en-IN')} more. Fix these first - the rest are
                often the same mistake.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
