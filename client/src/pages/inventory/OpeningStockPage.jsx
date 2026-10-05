/**
 * Opening stock - loading what was already on the rack at go-live.
 *
 * ---------------------------------------------------------------------------
 *  PASTE, CHECK, POST
 * ---------------------------------------------------------------------------
 *
 *  The office keeps this in a spreadsheet - Fabric Type, COLOR, Qty mtr. - so
 *  the fastest honest path is to paste those columns straight in. The grid is
 *  editable afterwards for the things the sheet does not carry: a rate, a
 *  location, a roll number.
 *
 *  NOTHING POSTS UNTIL THE SERVER HAS CHECKED IT. The Preview button asks the
 *  server what the file would do - which items already exist, which are new,
 *  which rows it would refuse - and the answer is what the table shows. This
 *  screen decides nothing: it cannot know whether "Navy" is in the colour
 *  master or whether an item already has an opening balance.
 *
 *  And it posts ONCE. An opening balance run twice does not correct the stock,
 *  it doubles it, so the server refuses any item that already carries one.
 *  That is the real guard; the disabled button here is only courtesy.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { inventory as invApi } from '../../services/erp.js';
import {
  Alert,
  EmptyState,
  Field,
  PageHeader,
  Spinner,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { fmtNum } from '../../utils/format.js';

let seq = 0;
const key = () => `r${++seq}`;
const blank = () => ({
  key: key(), fabricType: '', color: '', qty: '', rate: '', location: 'MAIN STORE', rollNo: '',
});

/**
 * Pasted spreadsheet rows, split into the three columns that matter.
 *
 * Tab-separated is what Excel and Google Sheets put on the clipboard; comma is
 * accepted for a CSV someone has opened in a text editor. A header row is
 * dropped by looking at the third column: "Qty mtr." is not a number, and a
 * real quantity always is.
 */
function parsePaste(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|,/).map((c) => c.trim()))
    .filter((cells) => cells.length >= 3 && Number.isFinite(Number(cells[2].replace(/,/g, ''))))
    .map((cells) => ({
      ...blank(),
      key: key(),
      fabricType: cells[0],
      color: cells[1],
      qty: cells[2].replace(/,/g, ''),
    }));
}

export default function OpeningStockPage() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState([blank()]);
  const [paste, setPaste] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const mayLoad = can('FABRIC_ROLL.CREATE');
  const setRow = (k, patch) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));

  /** Only the rows that say something. A blank trailing row is not an error. */
  const filled = rows.filter((r) => r.fabricType || r.color || r.qty);

  const payload = () =>
    filled.map((r) => ({
      fabricType: r.fabricType,
      color: r.color,
      qty: String(r.qty),
      rate: r.rate === '' ? undefined : String(r.rate),
      location: r.location || undefined,
      rollNo: r.rollNo || undefined,
    }));

  /** Any edit invalidates the answer the server gave about the old rows. */
  function change(k, patch) {
    setRow(k, patch);
    setPreview(null);
  }

  async function check() {
    setBusy('preview');
    setError('');
    try {
      setPreview(await invApi.openingStockPreview(payload()));
    } catch (e) {
      setError(e.message);
      setPreview(null);
    } finally {
      setBusy('');
    }
  }

  async function post() {
    setBusy('apply');
    setError('');
    try {
      setDone(await invApi.openingStockApply(payload()));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  if (!mayLoad) {
    return (
      <>
        <PageHeader title="Opening stock" />
        <Alert kind="error">
          Loading opening stock needs FABRIC_ROLL.CREATE - it creates rolls and puts them on hand.
        </Alert>
      </>
    );
  }

  // Posted. The screen does not offer to do it again, because doing it again
  // is the one thing that must not happen.
  if (done) {
    return (
      <>
        <PageHeader
          title="Opening stock loaded"
          actions={
            <button type="button" className="btn btn-primary" onClick={() => navigate('/inventory/stock')}>
              See the stock
            </button>
          }
        />
        <Alert kind="success">
          {done.documentNo} posted — {done.rows.length} line(s), {fmtNum(done.totalQty)} in total.
        </Alert>
        <div className="card">
          <TableWrap>
            <table className="data">
              <thead>
                <tr><th>#</th><th>Item</th><th>Roll</th><th className="num">Qty</th><th>Location</th></tr>
              </thead>
              <tbody>
                {done.rows.map((r) => (
                  <tr key={r.lineNo}>
                    <td>{r.lineNo}</td>
                    <td><span className="code">{r.itemCode}</span> — {r.description}</td>
                    <td className="code">{r.rollNo}</td>
                    <td className="num">{fmtNum(r.qty)} {r.uom}</td>
                    <td>{r.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      </>
    );
  }

  const byLine = new Map((preview?.lines ?? []).map((l) => [l.lineNo, l]));

  return (
    <>
      <PageHeader title="Opening stock" />

      <Alert kind="info">
        Stock that was already here when this system started. Everything bought since comes in on a
        GRN against a purchase order — <strong>this is for the cloth that has no order behind it</strong>,
        and it can be posted only once per fabric and colour.
      </Alert>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Paste from the spreadsheet</div>
        <div className="card-body">
          <Field
            label="Fabric type, colour, quantity"
            hint="Copy the three columns straight out of Excel. A header row is ignored."
          >
            <TextArea
              rows={4}
              value={paste}
              placeholder={'10OZ\tMid Night Blue\t2200\n10OZ\tSky Grey\t1800'}
              onChange={(e) => setPaste(e.target.value)}
            />
          </Field>
          <button
            type="button"
            className="btn"
            disabled={!paste.trim()}
            onClick={() => {
              const parsed = parsePaste(paste);
              if (!parsed.length) {
                setError('Nothing in that paste looked like a row — three columns are needed, and the third has to be a number.');
                return;
              }
              setRows(parsed);
              setPaste('');
              setPreview(null);
              setError('');
            }}
          >
            Fill the grid
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span>What is on the rack</span>
          <span className="faint" style={{ fontWeight: 400, fontSize: 12 }}>
            {filled.length} row(s)
            {preview ? ` · ${fmtNum(preview.totals.qty)} in total` : ''}
          </span>
        </div>
        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Fabric type</th>
                <th>Colour</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th>Location</th>
                <th>Roll no</th>
                <th>Checked</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const line = byLine.get(i + 1);
                const bad = (line?.problems?.length ?? 0) > 0;
                return (
                  <tr key={r.key} className={bad ? 'row-bad' : ''}>
                    <td>{i + 1}</td>
                    <td style={{ minWidth: 120 }}>
                      <TextInput aria-label="Fabric type" value={r.fabricType}
                        placeholder="10OZ" onChange={(e) => change(r.key, { fabricType: e.target.value })} />
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <TextInput aria-label="Colour" value={r.color}
                        placeholder="Black" onChange={(e) => change(r.key, { color: e.target.value })} />
                    </td>
                    <td className="num" style={{ minWidth: 110 }}>
                      <TextInput type="number" min="0" step="any" aria-label="Quantity"
                        style={{ width: 110, textAlign: 'right' }} value={r.qty}
                        onChange={(e) => change(r.key, { qty: e.target.value })} />
                    </td>
                    <td className="num" style={{ minWidth: 110 }}>
                      <TextInput type="number" min="0" step="any" aria-label="Rate"
                        style={{ width: 110, textAlign: 'right' }} value={r.rate}
                        placeholder="0" onChange={(e) => change(r.key, { rate: e.target.value })} />
                    </td>
                    <td style={{ minWidth: 140 }}>
                      <TextInput aria-label="Location" value={r.location}
                        onChange={(e) => change(r.key, { location: e.target.value })} />
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <TextInput aria-label="Roll no" value={r.rollNo}
                        placeholder="auto" onChange={(e) => change(r.key, { rollNo: e.target.value })} />
                    </td>
                    <td style={{ minWidth: 200 }}>
                      {!line ? (
                        <span className="faint">—</span>
                      ) : bad ? (
                        <span className="badge badge-rejected">{line.problems[0]}</span>
                      ) : (
                        <span className="faint">
                          {line.newItem ? 'new item' : line.itemCode}
                        </span>
                      )}
                    </td>
                    <td className="actions">
                      {rows.length > 1 && (
                        <button type="button" className="btn btn-sm"
                          onClick={() => { setRows((rs) => rs.filter((x) => x.key !== r.key)); setPreview(null); }}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        <div className="card-body">
          <button type="button" className="btn"
            onClick={() => { setRows((rs) => [...rs, blank()]); setPreview(null); }}>
            Add a row
          </button>
        </div>
      </div>

      {filled.length === 0 && <EmptyState title="Nothing to load" hint="Paste the sheet, or type a row." />}

      {busy === 'preview' && <Spinner label="Checking with the server..." />}

      {preview && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header">Checked</div>
          <div className="card-body">
            <p style={{ marginTop: 0 }}>
              {preview.totals.rows} row(s) · {fmtNum(preview.totals.qty)} in total ·{' '}
              {preview.totals.newItems} new stock item(s).
            </p>
            {preview.blockedCount > 0 && (
              <Alert kind="error">
                {preview.blockedCount} row(s) cannot be posted — see the Checked column. Nothing is
                posted while any row is refused.
              </Alert>
            )}
            {/* Not an error. A rate of nothing is a legitimate choice, but it
                becomes the cost of the first issue, so it is said out loud. */}
            {preview.unvalued > 0 && (
              <Alert kind="warning">
                {preview.unvalued} row(s) have no rate and will be carried at no value. That is
                allowed — but it is what the first issue off them will cost.
              </Alert>
            )}
          </div>
        </div>
      )}

      <div className="page-actions" style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn" onClick={check} disabled={!filled.length || Boolean(busy)}>
          {busy === 'preview' ? 'Checking...' : 'Check'}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={post}
          disabled={!preview?.canApply || Boolean(busy)}
          title={preview ? undefined : 'Check it first'}
        >
          {busy === 'apply' ? 'Posting...' : 'Post the opening stock'}
        </button>
      </div>
    </>
  );
}
