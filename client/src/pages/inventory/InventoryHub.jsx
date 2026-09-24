/**
 * Inventory - one door, three ways of counting the same store.
 *
 * ===========================================================================
 *  WHY THREE SIDEBAR LINKS BECAME ONE
 * ===========================================================================
 *
 *  Stores carried three entries onto what is, to the person reading them, one
 *  subject:
 *
 *      STOCK ON HAND   what is there now, per item, with its value and whether
 *                      it has fallen below its reorder level.
 *
 *      STOCK MOVEMENT  every in and out that produced those balances - the
 *                      ledger the summary above is derived from.
 *
 *      FABRIC ROLLS    the same fabric counted the way the floor counts it,
 *                      roll by roll, with the stage each roll has reached.
 *
 *  Three links for one question, and nothing in the sidebar said the three
 *  were related - so people picked one by its name, found it was not the view
 *  they wanted, and went back out to the menu to try the next. "Stock" and
 *  "Stock Movement" in a column of short labels are not far enough apart to
 *  choose between; on the question page each one gets a line saying what is
 *  actually in it.
 *
 * ---------------------------------------------------------------------------
 *  THE OLD ROUTES ARE UNTOUCHED
 *
 *  `/inventory/stock`, `/inventory/stock/ledger`, `/inventory/rolls` and
 *  `/inventory/items/:id` all still work and still render exactly what they
 *  did. This is a new way IN, not a replacement, and the screens themselves
 *  are not changed at all.
 *
 *  That matters because they are linked INTO from outside the sidebar: the
 *  audit trail routes a stock item to `/inventory/stock`, two reports link to
 *  `/inventory/stock/ledger?itemId=...` and `/inventory/rolls/:id`, and the
 *  GRN, fabric issue, job work and scrutiny screens all open a roll directly.
 *  Collapsing the routes as well as the links would have broken every one of
 *  those for the sake of a tidier route table.
 * ---------------------------------------------------------------------------
 */

import HubChoice, { useHubChoice } from '../../components/HubChoice.jsx';
import StockSummary from './StockSummary.jsx';
import StockLedgerPage from './StockLedgerPage.jsx';
import RollList from './RollList.jsx';

const STOCK = 'stock';
const MOVEMENT = 'movement';
const ROLLS = 'rolls';

/*
 * `label` is the panel's heading and matches the heading of the screen it
 * opens, so what you land on is plainly what you asked for. `blurb` is the one
 * line that separates it from its neighbours.
 *
 * The summary is first because it answers the question people arrive with -
 * how much is there - and the other two are both ways of asking how it came to
 * be that much.
 */
const VIEWS = [
  {
    value: STOCK,
    label: 'Stock on Hand',
    blurb: 'What is in the store now, per item, with its value.',
    permission: 'INVENTORY.VIEW',
  },
  {
    value: MOVEMENT,
    label: 'Stock Movement',
    blurb: 'Every receipt and issue that made those balances.',
    permission: 'STOCK_LEDGER.VIEW',
  },
  {
    value: ROLLS,
    label: 'Fabric Rolls',
    blurb: 'Fabric counted roll by roll, and the stage each has reached.',
    permission: 'FABRIC_ROLL.VIEW',
  },
];

export default function InventoryHub() {
  const { allowed, chosen, choose } = useHubChoice('view', VIEWS);

  /*
   * A role holding none of the three never reaches this screen - the route
   * guard and the sidebar both refuse it first.
   */
  if (allowed.length === 0) return null;

  if (!chosen) {
    return (
      <HubChoice
        title="Inventory"
        question="What do you want to look at?"
        choices={allowed}
        onChoose={choose}
      />
    );
  }

  /*
   * The screens are rendered exactly as their own routes render them - no
   * props, no wrapper - so there is one version of each, not a hub copy and a
   * direct-link copy that drift apart.
   */
  if (chosen.value === MOVEMENT) return <StockLedgerPage />;
  if (chosen.value === ROLLS) return <RollList />;
  return <StockSummary />;
}
