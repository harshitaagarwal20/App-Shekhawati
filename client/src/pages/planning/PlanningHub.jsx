/**
 * Planning - one door, two kinds of plan.
 *
 * ===========================================================================
 *  WHY THE TWO REGISTERS SIT BEHIND ONE LINK
 * ===========================================================================
 *
 *  The office does two things it calls planning, and the sidebar used to name
 *  them as if they were unrelated screens - "Planning" and "Material Plan".
 *  They are the same question asked of two departments:
 *
 *      PRODUCTION PLANNING   how many pieces, by which department, by when.
 *                            Cutting, stitching, shipping and packing each
 *                            plan their own share of an order.
 *
 *      PROCUREMENT PLANNING  what has to be BOUGHT before any of that can
 *                            start - the raw material plan, priced off the
 *                            style's bill of materials.
 *
 * ---------------------------------------------------------------------------
 *  THE SCREEN ASKS BEFORE IT SHOWS
 *
 *  Nothing is listed until the kind is chosen. The screen opens on the
 *  question alone, and the register appears once it is answered.
 *
 *  That is deliberate rather than tidy-minded: defaulting to one of them means
 *  half the people who open this screen are looking at the other department's
 *  register without having been told which one it is. Production and
 *  procurement plans carry different numbers, different approvals and
 *  different departments, and reading one as the other is the kind of mistake
 *  that survives all the way to a purchase order.
 *
 *  The choice is asked ONCE, on a screen of its own, and then it is done with.
 *  It is not repeated as a control on the register itself: a second way to
 *  change registers, sitting in the filter row beside things that only narrow
 *  the list, invites somebody to change WHICH DOCUMENT they are reading while
 *  believing they filtered it. The way back is the sidebar, the same way they
 *  came in.
 *
 *  ONE EXCEPTION. Somebody who may see only one of the two is not asked a
 *  question with a single answer - they land on their register directly.
 *
 * ---------------------------------------------------------------------------
 *  WHAT THIS DELIBERATELY DOES NOT DO
 *
 *  It does not merge the two documents. `Planning` and `MaterialPlan` remain
 *  separate tables, with their own numbers, their own approvals and their own
 *  permissions, because they ARE separate documents - one is signed by the
 *  production office and one by procurement, and a signature on one has never
 *  meant anything about the other. This is a way IN to them, not a merge.
 *
 *  The old routes still work. `/material-plans` and `/material-plans/:id` are
 *  untouched, which matters because the Approval Queue links straight to a
 *  material plan awaiting signature (see ApprovalQueue's ROUTE_FOR); removing
 *  that route would have broken the queue for the one document type whose
 *  approval nobody can reach any other way.
 * ---------------------------------------------------------------------------
 */

import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader } from '../../components/ui.jsx';
import PlanningList from './PlanningList.jsx';
import { MaterialPlanList } from './MaterialPlanPages.jsx';

const PRODUCTION = 'production';
const PROCUREMENT = 'procurement';

/*
 * `label` titles the register once it is open and names the button that opens
 * it - the same words in both places, so the screen you land on is plainly the
 * one you asked for. `blurb` is the difference between them in one line, which
 * is the part nobody can look up: "production" and "procurement" are near
 * enough as words that somebody new picks by meaning, not by name.
 */
const KINDS = [
  {
    value: PRODUCTION,
    label: 'Production Planning',
    blurb: 'How many pieces, by which department, by when.',
    permission: 'PLANNING.VIEW',
  },
  {
    value: PROCUREMENT,
    label: 'Procurement Planning',
    blurb: 'What has to be bought before production can start.',
    permission: 'MATERIAL_PLAN.VIEW',
  },
];

export default function PlanningHub() {
  const { can } = useAuth();
  /*
   * The choice lives in the URL, the way the Job Work register's `?process=`
   * does. A planner who sends "the shipping plans" to somebody sends a link
   * that opens on shipping plans, and a reload does not drop them back onto
   * the question they already answered.
   */
  const [params, setParams] = useSearchParams();

  const allowed = KINDS.filter((k) => can(k.permission));

  /*
   * A role holding neither permission never reaches this screen - the route
   * guard and the sidebar both refuse it first.
   */
  if (allowed.length === 0) return null;

  const asked = params.get('kind');
  const valid = allowed.some((k) => k.value === asked) ? asked : null;

  // One register to see is not a choice; go straight to it.
  const kind = allowed.length === 1 ? allowed[0].value : valid;

  // A history entry, not `replace`, so Back returns to the question.
  const setKind = (next) => {
    setParams(next ? { kind: next } : {});
  };

  // ---- Nothing chosen yet: the question, and nothing else. ----------------
  /*
   * BOTH ANSWERS ON SCREEN, NOT ONE BEHIND A CLICK.
   *
   * This was a dropdown reading "Choose...", which meant the screen asked its
   * question without ever saying what the answers were - you had to open the
   * control to find out that the choice was production vs procurement at all.
   *
   * It is now the only thing on the page, so it is sized like the only thing
   * on the page. A pair of small buttons in the corner of an empty card reads
   * as a leftover filter somebody forgot to remove; two panels the width of
   * the page read as the question being asked. Each carries the register's
   * full name and the one line that separates it from the other one.
   *
   * They are plain buttons, not a toggle: nothing here is "currently on", so
   * there is no selected state to announce or to paint.
   */
  if (!kind) {
    return (
      <>
        <PageHeader title="Planning" />
        <div className="hub-ask">
          <h2 className="hub-ask-q">Which plans do you want to see?</h2>
          <div className="hub-choice">
            {allowed.map(({ value, label, blurb }) => (
              <button
                key={value}
                type="button"
                className="hub-choice-btn"
                onClick={() => setKind(value)}
              >
                <span className="hub-choice-name">{label}</span>
                <span className="hub-choice-blurb">{blurb}</span>
              </button>
            ))}
          </div>
        </div>
      </>
    );
  }

  const title = allowed.find((k) => k.value === kind)?.label ?? 'Planning';

  return kind === PROCUREMENT
    ? <MaterialPlanList title={title} />
    : <PlanningList title={title} />;
}
