/**
 * Ask - questions answered by Claude from the reports and the uploaded
 * reference documents.
 *
 * ===========================================================================
 *  WHAT THIS SCREEN DOES, AND WHAT IT LEAVES TO THE SERVER
 * ===========================================================================
 *
 *  The server does all of the work: it decides which reports and documents
 *  this user's questions may reach, runs the lookups, and returns the answer
 *  already split where it cites a source, with those sources and the exact
 *  passages cited from each. This screen only lays that out:
 *
 *    - the answer, with a [1] after each statement that rests on source 1
 *    - under it, the sources - a report, a day's summary, a page of a
 *      document - each with the rows or lines it quoted
 *    - a warning on any answer that cites nothing, because an answer with no
 *      source is one nobody can check
 *
 *  The conversation is kept for this browser tab only (sessionStorage), and
 *  the last few turns go back with each question so "and last week?" makes
 *  sense. Each question looks its figures up again; nothing is answered from a
 *  stale copy.
 *
 *  Documents sit beside the chat: everyone who may ask can see the list,
 *  ASSISTANT.CREATE uploads and ASSISTANT.DELETE removes.
 * ===========================================================================
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { assistant as api } from '../../services/erp.js';
import { Alert, ConfirmDialog, PageHeader, Spinner } from '../../components/ui.jsx';
import { fmtDateTime } from '../../utils/format.js';

const STORAGE_KEY = 'si.assistant.conversation';
/** Turns sent back with a question - matches MAX_HISTORY on the server. */
const HISTORY_TURNS = 12;
/** Matches MAX_BYTES on the server, so a file too big is refused before it is sent. */
const MAX_UPLOAD_MB = 10;

const EXAMPLES = [
  { area: 'Orders', question: 'What is the order book worth, and which buyers make up most of it?' },
  { area: 'Production', question: 'How many pieces did we stitch yesterday?' },
  { area: 'Stores', question: 'Which items are below their reorder level?' },
  { area: 'Quality', question: 'What External QC rejection reasons came up most this month?' },
  { area: 'Costing', question: 'What margin does the latest approved cost sheet show for each style?' },
  { area: 'Documents', question: 'What does the tech pack say about the zip on TB-DEMO-001?' },
];

const KIND_LABEL = {
  report: 'Report',
  summary: 'Daily summary',
  'cost-sheets': 'Cost sheets',
  document: 'Document',
};

function loadConversation() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function saveConversation(messages) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    /* private mode or full - the conversation simply will not survive a reload */
  }
}

/** An answer's plain text, for sending back as history. */
const answerText = (m) => m.answer.parts.map((p) => p.text).join('');

const fileSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// --- Icons: inline, decorative, sized by CSS --------------------------------

const Icon = {
  spark: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14z" /></svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4l17.5-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.2 1l1.7 6.1c.1.4.4.6.8.7l7.3 1-7.3 1c-.4.1-.7.3-.8.7l-1.7 6.1c-.2.7.5 1.3 1.2 1z" /></svg>
  ),
  upload: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l5 5h-3v6h-4V8H7l5-5zM5 17h14v2H5v-2z" /></svg>
  ),
  file: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l6 6v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm7 1.5V9h5.5L13 3.5z" /></svg>
  ),
};

// ===========================================================================
//  A SMALL MARKDOWN RENDERER - paragraphs, lists, tables, bold, code
// ===========================================================================
//
// Built from React elements, never from HTML strings, so nothing in an answer
// can become markup. Citation markers ( 1,2  - private-use
// characters, which no answer contains) are placed into the text where each
// cited part ends, and become [1][2] links to the sources.

const CITE_OPEN = '';
const CITE_CLOSE = '';
const INLINE = /([\d,]+)|\*\*(.+?)\*\*|`([^`]+)`/g;

function Inline({ text, anchor }) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      for (const n of m[1].split(',')) {
        out.push(
          <sup key={`${m.index}-${n}`} className="ask-cite">
            <a href={`#${anchor}-${n}`} aria-label={`Source ${n}`}>{n}</a>
          </sup>,
        );
      }
    } else if (m[2]) {
      out.push(<strong key={m.index}>{m[2]}</strong>);
    } else if (m[3]) {
      out.push(<code key={m.index}>{m[3]}</code>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cellsOf = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isTableRule = (line) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());

function Markdown({ text, anchor }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block, i) => {
    const lines = block.split('\n');
    if (lines.length >= 2 && lines[0].includes('|') && isTableRule(lines[1])) {
      const head = cellsOf(lines[0]);
      return (
        <div key={i} className="table-wrap ask-table">
          <table className="table">
            <thead>
              <tr>{head.map((h, j) => <th key={j}><Inline text={h} anchor={anchor} /></th>)}</tr>
            </thead>
            <tbody>
              {lines.slice(2).map((row, r) => (
                <tr key={r}>{cellsOf(row).map((c, j) => <td key={j}><Inline text={c} anchor={anchor} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
      const ordered = /^\s*\d+\./.test(lines[0]);
      const List = ordered ? 'ol' : 'ul';
      return (
        <List key={i}>
          {lines.map((l, j) => <li key={j}><Inline text={l.replace(/^\s*([-*]|\d+\.)\s+/, '')} anchor={anchor} /></li>)}
        </List>
      );
    }
    if (/^#{1,6}\s/.test(lines[0]) && lines.length === 1) {
      return <p key={i}><strong><Inline text={lines[0].replace(/^#+\s*/, '')} anchor={anchor} /></strong></p>;
    }
    return (
      <p key={i}>
        {lines.map((l, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            <Inline text={l} anchor={anchor} />
          </Fragment>
        ))}
      </p>
    );
  });
}

// ===========================================================================
//  ONE ANSWER, AND ITS SOURCES
// ===========================================================================

function describeStep({ tool, input = {} }) {
  switch (tool) {
    case 'run_report': {
      const f = Object.entries(input.filters ?? {}).map(([k, v]) => `${k} ${v}`).join(', ');
      return `Ran the ${input.report} report${f ? ` (${f})` : ''}`;
    }
    case 'search_documents':
      return `Searched the documents for "${input.query}"`;
    case 'daily_summary':
      return `Read the daily summary for ${input.date}`;
    case 'cost_sheets':
      return 'Read the cost sheets';
    case 'find_records':
      return `Looked up the ${input.kind} "${input.text}"`;
    default:
      return tool;
  }
}

function SourceLink({ source }) {
  if (source.kind === 'document') {
    return (
      <button type="button" className="btn-link ask-source-link" onClick={() => api.documents.open(source.documentId, source.fileName)}>
        Open file
      </button>
    );
  }
  if (source.kind === 'report') return <Link className="ask-source-link" to={`/reports?report=${source.reportKey}`}>Open report</Link>;
  if (source.kind === 'cost-sheets') return <Link className="ask-source-link" to="/cost-sheets">Open cost sheets</Link>;
  return null;
}

const SHOWN_EXCERPTS = 3;

function Source({ source, anchor }) {
  const [all, setAll] = useState(false);
  const excerpts = all ? source.excerpts : source.excerpts.slice(0, SHOWN_EXCERPTS);
  return (
    <li id={`${anchor}-${source.number}`} className="ask-source">
      <div className="ask-source-head">
        <span className="ask-source-num">{source.number}</span>
        <span className={`ask-kind ask-kind-${source.kind}`}>{KIND_LABEL[source.kind] ?? source.kind}</span>
        <span className="ask-source-title">{source.title}</span>
        <SourceLink source={source} />
      </div>
      {excerpts.map((e, i) => <blockquote key={i} className="ask-excerpt">{e}</blockquote>)}
      {source.excerpts.length > SHOWN_EXCERPTS && (
        <button type="button" className="btn-link ask-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${source.excerpts.length} passages`}
        </button>
      )}
    </li>
  );
}

function Answer({ message }) {
  const { answer } = message;
  const anchor = `ask-${message.id}`;
  const text = answer.parts
    .map((p) => p.text + (p.cites.length ? `${CITE_OPEN}${p.cites.join(',')}${CITE_CLOSE}` : ''))
    .join('');

  return (
    <div className="ask-answer">
      <div className="ask-answer-head">
        <span className="ask-avatar">{Icon.spark}</span>
        <span className="ask-answer-label">Answer</span>
        {answer.grounded ? (
          <span className="ask-chip ask-chip-ok">{answer.sources.length} source{answer.sources.length === 1 ? '' : 's'}</span>
        ) : (
          <span className="ask-chip ask-chip-warn">No source cited</span>
        )}
      </div>

      <div className="ask-answer-text"><Markdown text={text} anchor={anchor} /></div>

      {!answer.grounded && (
        <p className="ask-ungrounded">Nothing in the reports or documents was cited for this. Check it against the ERP before relying on it.</p>
      )}

      {answer.sources.length > 0 && (
        <div className="ask-sources">
          <div className="ask-section-label">Sources</div>
          <ol>{answer.sources.map((s) => <Source key={s.number} source={s} anchor={anchor} />)}</ol>
        </div>
      )}

      {(answer.steps?.length > 0 || answer.alsoChecked?.length > 0) && (
        <details className="ask-steps">
          <summary>How this was looked up ({answer.steps.length} step{answer.steps.length === 1 ? '' : 's'})</summary>
          <ul>
            {answer.steps.map((s, i) => (
              <li key={i} className={s.ok ? '' : 'ask-step-failed'}>{describeStep(s)}{s.ok ? '' : ' - failed'}</li>
            ))}
          </ul>
          {answer.alsoChecked.length > 0 && <p>Also checked, not cited: {answer.alsoChecked.join('; ')}</p>}
        </details>
      )}
    </div>
  );
}

function Welcome({ enabled, onPick }) {
  return (
    <div className="ask-welcome">
      <span className="ask-welcome-mark">{Icon.spark}</span>
      <h2>What would you like to know?</h2>
      <div className="ask-suggestions">
        {EXAMPLES.map((ex) => (
          <button key={ex.question} type="button" className="ask-suggestion" onClick={() => onPick(ex.question)} disabled={!enabled}>
            <span className="ask-suggestion-area">{ex.area}</span>
            <span className="ask-suggestion-text">{ex.question}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
//  THE DOCUMENTS PANEL
// ===========================================================================

function Documents({ status }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [permission, setPermission] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState(null);
  const input = useRef(null);

  const load = useCallback(async () => {
    try {
      setDocs(await api.documents.list());
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const labelOf = (code) => status.documentPermissions.find((p) => p.code === code)?.label ?? code;

  function choose(picked) {
    setError('');
    if (!picked) return;
    if (!/\.(pdf|txt)$/i.test(picked.name)) {
      setError('Only PDF and .txt files can be read by the assistant.');
      return;
    }
    if (picked.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`That file is larger than the ${MAX_UPLOAD_MB} MB limit.`);
      return;
    }
    setFile(picked);
  }

  function clear() {
    setFile(null);
    if (input.current) input.current.value = '';
  }

  async function upload(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      await api.documents.upload(file, permission);
      clear();
      setPermission('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.documents.remove(removing.id);
      setRemoving(null);
      await load();
    } catch (err) {
      setError(err.message);
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="card ask-docs">
      <div className="card-header">
        <span>Documents</span>
        {docs?.length > 0 && <span className="ask-count">{docs.length}</span>}
      </div>
      <div className="card-body">
        <Alert kind="error" onDismiss={() => setError('')}>{error}</Alert>

        {status.canUpload && (
          <form className="ask-upload" onSubmit={upload}>
            <label
              className={`ask-drop${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!busy) choose(e.dataTransfer.files?.[0]);
              }}
            >
              <input
                ref={input}
                type="file"
                className="ask-drop-input"
                accept=".pdf,.txt,application/pdf,text/plain"
                onChange={(e) => choose(e.target.files?.[0])}
                disabled={busy}
              />
              <span className="ask-drop-icon">{Icon.upload}</span>
              <span className="ask-drop-title">Drop a PDF or .txt here</span>
              <span className="ask-drop-sub">or click to browse - up to {MAX_UPLOAD_MB} MB</span>
            </label>

            {file && (
              <div className="ask-file-chip">
                <span className="ask-file-icon">{Icon.file}</span>
                <span className="ask-file-name">{file.name}</span>
                <span className="ask-file-size">{fileSize(file.size)}</span>
                <button type="button" className="ask-file-clear" onClick={clear} disabled={busy} aria-label="Remove the chosen file">×</button>
              </div>
            )}

            <label className="ask-field">
              <span>Who may read it</span>
              <select value={permission} onChange={(e) => setPermission(e.target.value)} disabled={busy}>
                <option value="">Everyone who can use Ask</option>
                {status.documentPermissions.map((p) => (
                  <option key={p.code} value={p.code}>Only those who see {p.label.toLowerCase()}</option>
                ))}
              </select>
            </label>

            {file && (
              <button type="submit" className="btn btn-primary ask-upload-btn" disabled={busy}>
                {busy ? <Spinner label="Reading the document" /> : 'Upload'}
              </button>
            )}
          </form>
        )}

        {docs === null ? (
          <Spinner label="Loading documents" />
        ) : docs.length === 0 ? (
          <p className="ask-docs-empty">No documents yet.{status.canUpload ? ' Upload one above and the assistant can quote it.' : ''}</p>
        ) : (
          <ul className="ask-doc-list">
            {docs.map((d) => (
              <li key={d.id} className="ask-doc">
                <span className={`ask-doc-type ask-doc-type-${d.mimeType === 'application/pdf' ? 'pdf' : 'txt'}`}>
                  {d.mimeType === 'application/pdf' ? 'PDF' : 'TXT'}
                </span>
                <div className="ask-doc-body">
                  <button type="button" className="btn-link ask-doc-name" onClick={() => api.documents.open(d.id, d.fileName)}>
                    {d.fileName}
                  </button>
                  <div className="ask-doc-meta">
                    {d.pageCount ? `${d.pageCount} page${d.pageCount === 1 ? '' : 's'} · ` : ''}
                    {d.chunkCount} passages · {d.uploadedByName ?? 'unknown'}, {fmtDateTime(d.createdAt)}
                  </div>
                  {d.requiredPermission && <span className="ask-restricted">Only {labelOf(d.requiredPermission).toLowerCase()}</span>}
                </div>
                {status.canDelete && (
                  <button type="button" className="ask-doc-remove" onClick={() => setRemoving(d)} disabled={busy} aria-label={`Remove ${d.fileName}`}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {removing && (
        <ConfirmDialog
          title="Remove document"
          message={`Remove ${removing.fileName}? The assistant stops quoting it at once.`}
          confirmLabel="Remove"
          danger
          busy={busy}
          onConfirm={remove}
          onCancel={() => setRemoving(null)}
        />
      )}
    </aside>
  );
}

// ===========================================================================
//  THE PAGE
// ===========================================================================

export default function AssistantPage() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [messages, setMessages] = useState(loadConversation);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const scroller = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    api.status().then(setStatus).catch((e) => setStatusError(e.message));
  }, []);
  useEffect(() => { saveConversation(messages); }, [messages]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  // The box grows with what is typed, up to a few lines.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [question]);

  async function ask(text) {
    const q = text.trim();
    if (!q || pending) return;
    const history = messages
      .flatMap((m) => [{ role: 'user', text: m.question }, ...(m.answer ? [{ role: 'assistant', text: answerText(m) }] : [])])
      .filter((h) => h.text.trim())
      .slice(-HISTORY_TURNS);

    setPending(q);
    setError('');
    setQuestion('');
    try {
      const answer = await api.ask(q, history);
      setMessages((ms) => [...ms, { id: Date.now(), question: q, answer }]);
    } catch (e) {
      setError(e.message);
      setQuestion(q);
    } finally {
      setPending(null);
      box.current?.focus();
    }
  }

  function onKeyDown(e) {
    // Enter sends; Shift+Enter is a new line.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(question);
    }
  }

  if (statusError) return <Alert kind="error">{statusError}</Alert>;
  if (!status) return <Spinner label="Loading" />;

  const canAsk = status.enabled && !pending;

  return (
    <div className="ask-page">
      <PageHeader
        title="Ask"
        actions={messages.length > 0 && (
          <button type="button" className="btn" onClick={() => setMessages([])} disabled={Boolean(pending)}>New conversation</button>
        )}
      />
      <div className="ask-layout">
        <section className="card ask-chat">
          <div className="ask-scroll" ref={scroller}>
            {messages.length === 0 && !pending ? (
              <Welcome enabled={status.enabled} onPick={ask} />
            ) : (
              <div className="ask-messages">
                {messages.map((m) => (
                  <div key={m.id} className="ask-turn">
                    <div className="ask-question">{m.question}</div>
                    <Answer message={m} />
                  </div>
                ))}
                {pending && (
                  <div className="ask-turn">
                    <div className="ask-question">{pending}</div>
                    <div className="ask-answer ask-pending">
                      <div className="ask-answer-head">
                        <span className="ask-avatar">{Icon.spark}</span>
                        <span className="ask-answer-label">Looking it up</span>
                        <span className="ask-dots" aria-hidden="true"><i /><i /><i /></span>
                      </div>
                      <p className="ask-hint">Reading the reports and documents - this can take up to a minute.</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <form
            className="ask-composer"
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
          >
            <Alert kind="error" onDismiss={() => setError('')}>{error}</Alert>
            <div className={`ask-input${canAsk ? '' : ' is-disabled'}`}>
              <textarea
                ref={box}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={status.enabled ? 'Ask about orders, stock, production, quality or a document...' : 'The assistant is switched off'}
                rows={1}
                maxLength={2000}
                disabled={!canAsk}
                aria-label="Your question"
              />
              <button type="submit" className="ask-send" disabled={!canAsk || question.trim().length < 2} aria-label="Ask">
                {Icon.send}
              </button>
            </div>
            <div className="ask-composer-hint">Enter to send · Shift+Enter for a new line · Only data you may see is used</div>
          </form>
        </section>

        <Documents status={status} />
      </div>
    </div>
  );
}
