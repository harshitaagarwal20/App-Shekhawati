/**
 * THE COLOURWAY GRID - one style, many colourways, entered as a matrix.
 *
 * ---------------------------------------------------------------------------
 *  WHAT IT IS FOR
 *
 *  A buyer's PO for a tote rarely says "5,000 pieces". It says 1,200 Natural
 *  Small, 1,800 Natural Large, 900 Black Small, 1,100 Black Large - a matrix,
 *  colours down the side and sizes across the top. An order has always been
 *  able to HOLD that (one BuyerOrderLine per style / colour / size), but the
 *  form could only enter one line, so a matrix order was typed as four orders
 *  or imported from a spreadsheet.
 *
 *  This is the matrix as the buyer sends it. Every non-zero cell becomes one
 *  order line on save; nothing new is stored. The server derives the order
 *  quantity as the sum and refuses a colour or size that is not in the master
 *  lists, exactly as it does for a line entered any other way.
 * ---------------------------------------------------------------------------
 */

import { EnumSelect, MasterSelect, TextInput } from '../../components/ui.jsx';
import { useMasterList } from '../../hooks/useMasterList.js';
import TableWrap from '../../components/TableWrap.jsx';

/** The key used for "the style's own size group" - a line with no size set. */
export const STYLE_SIZE = '';

/** An empty grid for a style: one blank colour row, one size column. */
export function blankGrid(style) {
  return {
    sizes: [style?.sizeGroup ?? STYLE_SIZE],
    rows: [{ colorCode: style?.colorCode ?? '', unitPrice: '', qty: {} }],
  };
}

/**
 * The grid an existing order already describes, or null when it is not a
 * single-style order (several styles are not a matrix of one style).
 */
export function gridFromLines(lines) {
  const live = (lines ?? []).filter((l) => !l.deletedAt);
  if (live.length === 0) return null;
  const styleIds = new Set(live.map((l) => l.styleId ?? l.style?.id));
  if (styleIds.size !== 1) return null;

  const sizes = [...new Set(live.map((l) => l.sizeGroup ?? STYLE_SIZE))];
  const byColour = new Map();
  for (const l of live) {
    const colour = l.colorCode ?? '';
    const row = byColour.get(colour) ?? {
      colorCode: colour,
      unitPrice: l.unitPrice != null ? String(Number(l.unitPrice)) : '',
      qty: {},
    };
    row.qty[l.sizeGroup ?? STYLE_SIZE] = String(Number(l.orderQty));
    byColour.set(colour, row);
  }
  return { sizes, rows: [...byColour.values()] };
}

/** Every non-zero cell, as an order line the API accepts. */
export function linesFromGrid(grid, styleId) {
  const out = [];
  for (const row of grid.rows) {
    for (const size of grid.sizes) {
      const qty = Number(row.qty[size] || 0);
      if (qty > 0) {
        out.push({
          styleId,
          colorCode: row.colorCode || null,
          sizeGroup: size === STYLE_SIZE ? null : size,
          orderQty: String(qty),
          unitPrice: row.unitPrice === '' ? null : String(row.unitPrice),
        });
      }
    }
  }
  return out;
}

export const gridTotal = (grid) =>
  grid.rows.reduce((a, r) => a + grid.sizes.reduce((b, s) => b + Number(r.qty[s] || 0), 0), 0);

/** Why the grid cannot be saved as it stands, or null when it can. */
export function gridProblem(grid) {
  const colours = grid.rows.map((r) => r.colorCode || '');
  if (new Set(colours).size !== colours.length) {
    return 'The same colour is on two rows. Put its quantities on one row.';
  }
  if (new Set(grid.sizes).size !== grid.sizes.length) return 'The same size is in two columns.';
  if (gridTotal(grid) <= 0) return 'Enter a quantity in at least one cell.';
  return null;
}

export default function ColourwayGrid({ grid, onChange, currency, disabled }) {
  const { values: sizeValues } = useMasterList('SizeGroup');
  const sizeLabel = (s) => (s === STYLE_SIZE ? "Style's size" : s);
  const unusedSizes = sizeValues.map((v) => v.value).filter((v) => !grid.sizes.includes(v));

  const setRow = (i, patch) =>
    onChange({ ...grid, rows: grid.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setCell = (i, size, value) => setRow(i, { qty: { ...grid.rows[i].qty, [size]: value } });

  const colTotal = (s) => grid.rows.reduce((a, r) => a + Number(r.qty[s] || 0), 0);
  const rowTotal = (r) => grid.sizes.reduce((a, s) => a + Number(r.qty[s] || 0), 0);
  const total = gridTotal(grid);
  const problem = gridProblem(grid);

  return (
    <div className="span-2">
      <TableWrap>
        <table className="bom-table">
          <thead>
            <tr>
              <th style={{ minWidth: 150 }}>Colourway</th>
              {grid.sizes.map((s) => (
                <th key={s || 'style'} className="num" style={{ minWidth: 100 }}>
                  {sizeLabel(s)}
                  {grid.sizes.length > 1 && !disabled && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      aria-label={`Remove size ${sizeLabel(s)}`}
                      onClick={() =>
                        onChange({
                          sizes: grid.sizes.filter((x) => x !== s),
                          rows: grid.rows.map((r) => {
                            const { [s]: _dropped, ...rest } = r.qty;
                            return { ...r, qty: rest };
                          }),
                        })
                      }
                    >
                      &times;
                    </button>
                  )}
                </th>
              ))}
              <th className="num">Total</th>
              <th style={{ minWidth: 100 }}>Price{currency ? ` (${currency})` : ''}</th>
              <th className="actions" />
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <MasterSelect
                    listCode="ColorCode"
                    currentValue={r.colorCode}
                    value={r.colorCode}
                    disabled={disabled}
                    onChange={(e) => setRow(i, { colorCode: e.target.value })}
                  />
                </td>
                {grid.sizes.map((s) => (
                  <td key={s || 'style'}>
                    <TextInput
                      type="number"
                      min="0"
                      step="1"
                      value={r.qty[s] ?? ''}
                      disabled={disabled}
                      onChange={(e) => setCell(i, s, e.target.value)}
                      aria-label={`${r.colorCode || 'Colour'} ${sizeLabel(s)} pieces`}
                    />
                  </td>
                ))}
                <td className="num"><strong>{rowTotal(r).toLocaleString('en-IN')}</strong></td>
                <td>
                  <TextInput
                    type="number"
                    min="0"
                    step="0.0001"
                    value={r.unitPrice}
                    disabled={disabled}
                    onChange={(e) => setRow(i, { unitPrice: e.target.value })}
                    aria-label={`${r.colorCode || 'Colour'} price per piece`}
                  />
                </td>
                <td className="actions">
                  {grid.rows.length > 1 && !disabled && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => onChange({ ...grid, rows: grid.rows.filter((_, j) => j !== i) })}
                      aria-label={`Remove colourway ${i + 1}`}
                    >
                      &times;
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <td className="faint">Total</td>
              {grid.sizes.map((s) => (
                <td key={s || 'style'} className="num">{colTotal(s).toLocaleString('en-IN')}</td>
              ))}
              <td className="num"><strong>{total.toLocaleString('en-IN')}</strong></td>
              <td colSpan={2} />
            </tr>
          </tbody>
        </table>
      </TableWrap>

      {!disabled && (
        <div className="row" style={{ marginTop: 8, gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onChange({ ...grid, rows: [...grid.rows, { colorCode: '', unitPrice: '', qty: {} }] })}
          >
            Add colourway
          </button>
          {unusedSizes.length > 0 && (
            <div style={{ minWidth: 180 }}>
              <EnumSelect
                options={unusedSizes}
                placeholder="Add a size column..."
                value=""
                onChange={(e) => e.target.value && onChange({ ...grid, sizes: [...grid.sizes, e.target.value] })}
              />
            </div>
          )}
        </div>
      )}

      {problem && total > 0 && <p className="hint" style={{ color: 'var(--danger)' }}>{problem}</p>}
      <p className="hint">
        Each filled cell becomes one order line. The order quantity is the total, {total.toLocaleString('en-IN')} pieces.
      </p>
    </div>
  );
}
