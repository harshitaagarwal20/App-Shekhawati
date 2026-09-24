/**
 * A data table that becomes a stack of cards on a phone.
 *
 * ===========================================================================
 *  WHY A TABLE CANNOT JUST BE MADE NARROWER
 * ===========================================================================
 *
 *  A register with eight columns has eight headings to fit across the screen.
 *  On a desk that is fine. On a phone it is not, and there are only three
 *  things a table can do about it:
 *
 *    SHRINK    every column squeezes until the values wrap inside the cells. A
 *              style code becomes "BS-" / "0455-" / "003" stacked three deep,
 *              and a row is suddenly four lines tall with no line meaning
 *              anything on its own.
 *
 *    SCROLL    which is what this app did. `.table-wrap` sets `overflow-x`, so
 *              the table keeps its width and slides sideways under the thumb.
 *              The headings scroll away with it, so by the third column you
 *              are reading numbers with nothing to say what they are.
 *
 *    STACK     each row becomes a card, and each cell becomes one line reading
 *              "Style   BS-0455-003". Nothing wraps, nothing scrolls, and
 *              every value carries its own label.
 *
 *  This does the third, below 640px, and leaves the table exactly as it was
 *  above it. The desk view is not compromised to serve the phone.
 *
 * ---------------------------------------------------------------------------
 *  HOW THE LABEL GETS ONTO THE CELL
 *
 *  The card layout is CSS - `td::before { content: attr(data-label) }` - which
 *  needs every cell to carry the name of its column. Writing that by hand
 *  would mean `data-label` on some hundreds of `<td>`s across forty screens,
 *  every one of them a chance to label a cell with the wrong column, and every
 *  future column a chance to forget.
 *
 *  So it is copied off the table's own `<thead>` after each render. The
 *  headings are the single source of the names, which means a renamed column
 *  renames its label, an optional column that is switched off takes its label
 *  with it, and a new column needs nothing done at all.
 *
 *  It runs on EVERY render rather than on a dependency list: the cells change
 *  when the page turns, when a filter narrows the list, when a column is
 *  toggled, and when a row is edited in place. A dependency list would have to
 *  name all four and would be wrong the first time a fifth was added. The work
 *  is a walk over the visible page of rows - twenty-five of them, not the
 *  table - and it is cheaper than the render that preceded it.
 * ---------------------------------------------------------------------------
 */

import { useLayoutEffect, useRef } from 'react';

/**
 * The column's name, without the sort arrow.
 *
 * `SortableTh` renders a `.dir` caret inside the heading, and `textContent`
 * would happily fold it into the label - "Style ▲" on every card until the
 * user sorted by something else.
 */
function headingText(th) {
  const clone = th.cloneNode(true);
  for (const el of clone.querySelectorAll('.dir')) el.remove();
  return clone.textContent.trim();
}

/**
 * How many field lines follow the heading on a card, before the last one.
 *
 * Four lines plus the heading and the state is a card you can take in without
 * scrolling, and five or six of them fit on a phone at once - which is what
 * makes a register a register rather than a stack of records.
 */
const CARD_LEAD = 3;

/**
 * Which cells a card shows, or null if it should show all of them.
 *
 * ---------------------------------------------------------------------------
 *  THE MIDDLE OF A ROW IS NOT WHAT YOU SCAN FOR
 *
 *  A quotation has eleven columns. All eleven on a card made a record you read
 *  rather than a list you scan, and the reason to open the register at all is
 *  to find one row among many.
 *
 *  Every register in this application is laid out the same way, and not by
 *  accident: THE IDENTITY IS FIRST and THE STATE IS LAST. Quotation no ... to
 *  ... status. GRN no ... to ... posted. Roll no ... to ... location. In
 *  between sit the figures, which are what you check once you have found the
 *  row - the rate, the UOM, the working behind an amount.
 *
 *  So the card keeps the identity, the next few columns (which are the party
 *  and the date - what tells two rows apart), and the last one, which is
 *  nearly always the state. The middle folds away.
 *
 *  NOTHING IS LOST, because the whole card opens the record, where every field
 *  is laid out in full. That is the trade: a shorter card, one tap from
 *  everything it left out.
 *
 * ---------------------------------------------------------------------------
 *  ONLY WHERE THERE IS SOMEWHERE TO TAP TO
 *
 *  A row that does not open anything keeps all of its cells. The line-item
 *  tables inside a detail screen - the items on a purchase order, the rolls on
 *  a GRN - are not registers being scanned; they are the document itself, and
 *  folding half of a line there would hide figures with no way to reach them.
 *  That is what `tr.clickable` is doing here: it marks the rows that have a
 *  record behind them.
 *
 *  A TRAILING CELL THAT IS NOT A FIELD NEVER TAKES THE LAST SLOT.
 *
 *  Two kinds sit at the end of these rows. The actions menu is a control, not
 *  a value. And every register with a column chooser ends its rows with an
 *  empty `<td />` lining up under the chooser's own header cell - it has no
 *  heading, because the header it belongs to is a button rather than a word.
 *
 *  Either one taken as "the last column" would fold away the real one, which
 *  is the status, and leave a blank line in its place: precisely the field
 *  somebody opened the register to read, replaced by nothing.
 * ---------------------------------------------------------------------------
 */
function cardFields(row, cells, heads) {
  if (!row.classList.contains('clickable')) return null;

  // A cell spanning the row is a message, not a record. Leave it alone.
  if (cells.some((c) => c.colSpan > 1)) return null;

  let last = cells.length - 1;
  while (last > 0 && (cells[last].classList.contains('actions') || !heads[last])) last -= 1;

  const keep = new Set([0, last]);
  for (let i = 1; i <= CARD_LEAD && i < last; i += 1) keep.add(i);
  // The actions menu stays; it was only skipped over as a candidate for last.
  cells.forEach((cell, i) => cell.classList.contains('actions') && keep.add(i));

  // Folding one line out of a short row costs a tap and saves nothing.
  return keep.size >= cells.length - 1 ? null : keep;
}

export default function TableWrap({ children, className = '' }) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    /*
     * `.bom-table` as well as `.data`: the style's BOM and the plan's
     * allotment grid are line editors rather than registers, but they are
     * tables with a heading row and they need the same labels to survive a
     * phone. Their cells hold inputs, so the stylesheet lays them out
     * differently - see `.table-cards .bom-table`.
     */
    const table = ref.current?.querySelector('table.data, table.bom-table');
    if (!table) return;

    const heads = [...table.querySelectorAll('thead tr:last-child th')].map(headingText);

    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = [...row.children];
      const keep = cardFields(row, cells, heads);

      cells.forEach((cell, i) => {
        /*
         * A cell spanning the table is not a value in a column - it is the
         * "nothing found" row, or a subtotal line. Labelling it with whatever
         * column happens to be first would be worse than leaving it bare.
         */
        const label = cell.colSpan > 1 ? '' : heads[i];
        if (label) cell.setAttribute('data-label', label);
        else cell.removeAttribute('data-label');

        // The stylesheet hides these below 640px. See `cardFields`.
        if (keep && !keep.has(i)) cell.setAttribute('data-fold', '');
        else cell.removeAttribute('data-fold');
      });
    }
  });

  /*
   * `table-cards` is what the stylesheet's phone rules key on, and only this
   * component adds it - so a table that stacks is always a table whose cells
   * have just been given their labels. A bare `.table-wrap` elsewhere (the
   * import preview inside its modal, which is a fixed-height scrolling box and
   * has no business becoming a card stack) keeps scrolling sideways.
   */
  return (
    <div ref={ref} className={`table-wrap table-cards ${className}`.trim()}>
      {children}
    </div>
  );
}
