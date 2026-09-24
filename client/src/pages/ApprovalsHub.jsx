/**
 * Approvals - one door, the queue and the plan register behind it.
 *
 * ===========================================================================
 *  WHY TWO SIDEBAR LINKS BECAME ONE
 * ===========================================================================
 *
 *  The Dashboard group carried "Approval Queue" and "Plan Approval". Two
 *  entries, both with the word approval in them, sitting one under the other -
 *  which is a coin toss for anybody who has not been told the difference. They
 *  answer different questions:
 *
 *      THE QUEUE      everything awaiting a decision, across all eleven
 *                     modules, keyed on the shared workflow state. A worklist:
 *                     what is waiting on me this morning.
 *
 *      PLAN APPROVAL  the register of one document type - the plan versions
 *                     themselves, their rounds, and what each rectified: show
 *                     me this plan's history.
 *
 *  A plan awaiting sign-off appears in both, which is the point rather than a
 *  fault: the approver finds it in the queue with everything else, and the
 *  planner finds it in the register beside its earlier rounds. They are one
 *  door now because somebody looking for either goes to the same place first,
 *  and the question page is where the difference finally gets said out loud.
 *
 * ---------------------------------------------------------------------------
 *  THE OLD ROUTES ARE UNTOUCHED
 *
 *  `/plan-approvals` and `/plan-approvals/:id` still work exactly as before,
 *  which is not optional: the approval queue's own ROUTE_FOR sends a plan
 *  approval there, the dashboard links to it, the cutting issue screen opens
 *  the approval behind a challan, a report routes to it, and the audit trail
 *  routes the `plan_approvals` table to it.
 *
 *  `/approvals` keeps its own path too - the audit trail sends an excess
 *  authorisation there - and now answers with the question page.
 * ---------------------------------------------------------------------------
 */

import HubChoice, { useHubChoice } from '../components/HubChoice.jsx';
import ApprovalQueue from './ApprovalQueue.jsx';
import { PlanApprovalList } from './planning/PlanApprovalPages.jsx';

const QUEUE = 'queue';
const PLANS = 'plans';

/*
 * The queue is first because it is what nearly everybody who clicks Approvals
 * came for: the Director is the last gate almost everywhere, and the first
 * thing they ask on signing in is what is waiting on them.
 *
 * REPORT.VIEW guards the queue because it is a read across the whole system,
 * and the Director holds it. That is the permission the route has always
 * carried - nothing about who may see what changes here.
 */
const VIEWS = [
  {
    value: QUEUE,
    label: 'Awaiting Decision',
    blurb: 'Everything waiting on a signature, across every module.',
    permission: 'REPORT.VIEW',
  },
  {
    value: PLANS,
    label: 'Plan Approvals',
    blurb: 'The plan versions themselves, their rounds and rectifications.',
    permission: 'PLAN_APPROVAL.VIEW',
  },
];

export default function ApprovalsHub() {
  const { allowed, chosen, choose } = useHubChoice('view', VIEWS);

  /*
   * A role holding neither permission never reaches this screen - the route
   * guard and the sidebar both refuse it first.
   */
  if (allowed.length === 0) return null;

  if (!chosen) {
    return (
      <HubChoice
        title="Approvals"
        question="What do you want to open?"
        choices={allowed}
        onChoose={choose}
      />
    );
  }

  /*
   * Rendered exactly as their own routes render them - no props, no wrapper -
   * so there is one version of each screen rather than a hub copy and a
   * direct-link copy that drift apart.
   */
  return chosen.value === PLANS ? <PlanApprovalList /> : <ApprovalQueue />;
}
