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
  MasterSelect,
  PageHeader,
  Spinner,
  TextArea,
  TextInput,
  VarietySelect,
} from '../../components/ui.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { fmtNum } from '../../utils/format.js';

/**
 * CLOTH AND TRIM ARE LOADED SEPARATELY, BY CHOICE.
 *
 * They are identified by different columns - fabric by its weight and colour,
 * a trim by the accessories item itself - and the office keeps them on
 * different sheets. One grid that carried every column of both would ask the
 * storeman to leave half of them blank on every row, which is how a fabric
 * type ends up typed into a button row. So the screen has a mode, and the
 * paste parser and the grid follow it.
 */
const FABRIC = 'FABRIC';
const ACCESSORIES = 'ACCESSORIES';

let seq = 0;
const key = () => `r${++seq}`;

const blank = (mode) =>
  mode === ACCESSORIES
    ? {
        key: key(), accessoriesItem: '', accessoryType: '', color: '', qty: '', uom: '',
        rate: '', location: 'MAIN STORE',
      }
    : {
        key: key(), fabricType: '', color: '', qty: '', rate: '', location: 'MAIN STORE', rollNo: '',
      };

/** A spreadsheet cell that is actually a number, commas and all. */
const isNum = (c) => c !== '' && Number.isFinite(Number(String(c).replace(/,/g, '')));
const toNum = (c) => String(c).replace(/,/g, '');

/**
 * Pasted spreadsheet rows, split into the columns that matter for the mode.
 *
 * Tab-separated is what Excel and Google Sheets put on the clipboard; comma is
 * accepted for a CSV someone has opened in a text editor. A header row is
 * dropped the same way in both modes - by requiring a real number where the
 * quantity belongs, because "Qty mtr." is not one.
 *
 * FABRIC expects the office's three columns in order: type, colour, quantity.
 *
 * ACCESSORIES cannot assume a fixed position, because some sheets carry a
 * variety column between the item and the quantity and some do not. So the
 * quantity is the first numeric cell after the item, anything between the two
 * is the variety, and whatever follows is taken as the unit. A sheet with no
 * unit column leaves it to the default chosen above the paste box - a trim
 * sheet is almost always all in one unit, and UOM is part of the item's
 * identity, so it is asked for rather than guessed per row.
 */
function parsePaste(text, mode, defaultUom) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\t|,/).map((c) => c.trim()));

  if (mode === ACCESSORIES) {
    return lines
      .map((cells) => {
        const qtyAt = cells.findIndex((c, i) => i > 0 && isNum(c));
        if (qtyAt < 0 || !cells[0]) return null;
        return {
          ...blank(ACCESSORIES),
          accessoriesItem: cells[0],
          accessoryType: cells.slice(1, qtyAt).filter(Boolean).join(' '),
          qty: toNum(cells[qtyAt]),
          uom: cells[qtyAt + 1] || defaultUom || '',
        };
      })
      .filter(Boolean);
  }

  return lines
    .filter((cells) => cells.length >= 3 && isNum(cells[2]))
    .map((cells) => ({
      ...blank(FABRIC),
      fabricType: cells[0],
      color: cells[1],
      qty: toNum(cells[2]),
    }));
}

export default function OpeningStockPage() {
  const { can } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState(FABRIC);
  const [pasteUom, setPasteUom] = useState('Pcs');
  const [rows, setRows] = useState([blank(FABRIC)]);
  const [paste, setPaste] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);

  const mayLoad = can('FABRIC_ROLL.CREATE');
  const isTrim = mode === ACCESSORIES;
  const setRow = (k, patch) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r)));

  /** Only the rows that say something. A blank trailing row is not an error. */
  const filled = rows.filter((r) =>
    isTrim ? r.accessoriesItem || r.qty : r.fabricType || r.color || r.qty,
  );

  /*
   * `itemCategory` is sent for a trim and left off for cloth, which defaults to
   * Fabric on the server. "Accessories" is the exact L_ItemCategory value -
   * trim is recorded one way, as that list's own note explains, so the item a
   * later purchase order resolves to is the item loaded here.
   */
  const payload = () =>
    filled.map((r) =>
      isTrim
        ? {
            itemCategory: 'Accessories',
            accessoriesItem: r.accessoriesItem,
            accessoryType: r.accessoryType || undefined,
            colorCode: r.color || undefined,
            qty: String(r.qty),
            uom: r.uom || undefined,
            rate: r.rate === '' ? undefined : String(r.rate),
            location: r.location || undefined,
          }
        : {
            fabricType: r.fabricType,
            color: r.color,
            qty: String(r.qty),
            rate: r.rate === '' ? undefined : String(r.rate),
            location: r.location || undefined,
            rollNo: r.rollNo || undefined,
          },
    );

  /** Switching mode starts the grid again - the columns are not the same ones. */
  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setRows([blank(next)]);
    setPaste('');
    setPreview(null);
    setError('');
  }

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
          Loading opening stock needs FABRIC_ROLL.CREATE - it puts stock on hand, and for cloth it
          creates the rolls that hold it.
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
                    {/* Null for a trim, which is held in bulk and has no roll. */}
                    <td className="code">{r.rollNo ?? '—'}</td>
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
        GRN against a purchase order — <strong>this is for what has no order behind it</strong>, and
        it can be posted only once per stock item.
      </Alert>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Cloth and trim are identified by different columns - see the note on
          FABRIC/ACCESSORIES above. */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">What are you loading?</div>
        <div className="card-body" style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className={`btn ${mode === FABRIC ? 'btn-primary' : ''}`}
            onClick={() => switchMode(FABRIC)}
          >
            Fabric
          </button>
          <button
            type="button"
            className={`btn ${isTrim ? 'btn-primary' : ''}`}
            onClick={() => switchMode(ACCESSORIES)}
          >
            Accessories
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Paste from the spreadsheet</div>
        <div className="card-body">
          {/* UOM is part of a trim's identity, so it is chosen rather than
              guessed: the same button in Pcs and in Gross is two stock items. */}
          {isTrim && (
            <Field
              label="Unit for pasted rows"
              hint="Used where the paste carries no unit column. Editable per row afterwards."
            >
              <MasterSelect
                listCode="UOM"
                value={pasteUom}
                onChange={(e) => setPasteUom(e.target.value)}
              />
            </Field>
          )}
          <Field
            label={isTrim ? 'Item, variety, quantity, unit' : 'Fabric type, colour, quantity'}
            hint={
              isTrim
                ? 'Copy the columns straight out of Excel. The quantity is the first number after the item; anything between is the variety. A header row is ignored.'
                : 'Copy the three columns straight out of Excel. A header row is ignored.'
            }
          >
            <TextArea
              rows={4}
              value={paste}
              placeholder={
                isTrim
                  ? 'Button\t4-hole horn 18L\t5000\tPcs\nZip\t20 cm\t1200\tPcs'
                  : '10OZ\tMid Night Blue\t2200\n10OZ\tSky Grey\t1800'
              }
              onChange={(e) => setPaste(e.target.value)}
            />
          </Field>
          <button
            type="button"
            className="btn"
            disabled={!paste.trim()}
            onClick={() => {
              const parsed = parsePaste(paste, mode, pasteUom);
              if (!parsed.length) {
                setError(
                  isTrim
                    ? 'Nothing in that paste looked like a row — each line needs the item and then a quantity that is a number.'
                    : 'Nothing in that paste looked like a row — three columns are needed, and the third has to be a number.',
                );
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
                {isTrim ? <th>Item</th> : <th>Fabric type</th>}
                {isTrim && <th>Variety</th>}
                <th>Colour</th>
                <th className="num">Qty</th>
                {isTrim && <th>UOM</th>}
                <th className="num">Rate</th>
                <th>Location</th>
                {/* A trim has no roll - it is counted in bulk off a balance. */}
                {!isTrim && <th>Roll no</th>}
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
                    {isTrim ? (
                      <td style={{ minWidth: 160 }}>
                        <MasterSelect
                          listCode="AccessoriesItem"
                          aria-label="Accessories item"
                          placeholder="Select item..."
                          value={r.accessoriesItem}
                          currentValue={r.accessoriesItem}
                          onChange={(e) => change(r.key, { accessoriesItem: e.target.value })}
                        />
                      </td>
                    ) : (
                      <td style={{ minWidth: 120 }}>
                        <TextInput aria-label="Fabric type" value={r.fabricType}
                          placeholder="10OZ" onChange={(e) => change(r.key, { fabricType: e.target.value })} />
                      </td>
                    )}
                    {/* The SAME picker the Style BOM and the purchase order use,
                        so a variety chosen here lands on the one stock item a
                        later PO for it resolves to - see VarietySelect. A value
                        that arrived by paste is kept visible either way. */}
                    {isTrim && (
                      <td style={{ minWidth: 170 }}>
                        <VarietySelect
                          accessoriesItem={r.accessoriesItem}
                          aria-label="Variety"
                          placeholder={r.accessoriesItem ? 'Select variety...' : 'Choose the item first'}
                          value={r.accessoryType}
                          currentValue={r.accessoryType}
                          onChange={(e) => change(r.key, { accessoryType: e.target.value })}
                        />
                      </td>
                    )}
                    <td style={{ minWidth: 160 }}>
                      <TextInput aria-label="Colour" value={r.color}
                        placeholder={isTrim ? 'optional' : 'Black'}
                        onChange={(e) => change(r.key, { color: e.target.value })} />
                    </td>
                    <td className="num" style={{ minWidth: 110 }}>
                      <TextInput type="number" min="0" step="any" aria-label="Quantity"
                        style={{ width: 110, textAlign: 'right' }} value={r.qty}
                        onChange={(e) => change(r.key, { qty: e.target.value })} />
                    </td>
                    {isTrim && (
                      <td style={{ minWidth: 110 }}>
                        <MasterSelect
                          listCode="UOM"
                          aria-label="UOM"
                          placeholder="Unit..."
                          value={r.uom}
                          currentValue={r.uom}
                          onChange={(e) => change(r.key, { uom: e.target.value })}
                        />
                      </td>
                    )}
                    <td className="num" style={{ minWidth: 110 }}>
                      <TextInput type="number" min="0" step="any" aria-label="Rate"
                        style={{ width: 110, textAlign: 'right' }} value={r.rate}
                        placeholder="0" onChange={(e) => change(r.key, { rate: e.target.value })} />
                    </td>
                    <td style={{ minWidth: 140 }}>
                      <TextInput aria-label="Location" value={r.location}
                        onChange={(e) => change(r.key, { location: e.target.value })} />
                    </td>
                    {!isTrim && (
                      <td style={{ minWidth: 120 }}>
                        <TextInput aria-label="Roll no" value={r.rollNo}
                          placeholder="auto" onChange={(e) => change(r.key, { rollNo: e.target.value })} />
                      </td>
                    )}
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
            onClick={() => { setRows((rs) => [...rs, blank(mode)]); setPreview(null); }}>
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
