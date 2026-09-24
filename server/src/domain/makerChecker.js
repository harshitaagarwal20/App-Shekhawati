/**
 * MAKER-CHECKER: DISABLED.
 *
 * ===========================================================================
 *  WHAT THIS USED TO DO, AND WHY IT NO LONGER DOES
 * ===========================================================================
 *
 * The rule was: the person who raises a document may not be the person who
 * approves it. A merchandiser who asked for a 5% excess could not sign it off
 * themselves; somebody else had to.
 *
 * It has been switched off at the owner's instruction. Sekawati Impex runs
 * with a small office where the same person frequently raises a document and
 * is also the only one authorised to approve it, and the rule was blocking
 * real work: the Approve / Reject buttons simply vanished from the screen for
 * the one person able to press them.
 *
 * ---------------------------------------------------------------------------
 *  WHY IT IS SWITCHED OFF *HERE*, AND NOT DELETED EVERYWHERE
 *
 *  These two functions are the single chokepoint. `assertNotSelfApproval()` is
 *  called by nine services and by approvalEngine.transition(); `canApprove()`
 *  is called by withApprovability(), which eight controllers wrap their detail
 *  responses in, and which seven screens read to decide whether to draw an
 *  Approve button.
 *
 *  Neutering the pair turns the rule off across all of that at once. Deleting
 *  it instead would mean editing twenty-odd call sites, every one of them an
 *  opportunity to miss one and leave the control half-applied - which is worse
 *  than either having it or not having it, because nobody could then say which
 *  documents it still governed.
 *
 *  It also means turning the rule back on is a change to THIS FILE and nothing
 *  else: restore the two bodies below and every call site enforces again.
 *
 * ---------------------------------------------------------------------------
 *  WHAT IS GIVEN UP
 *
 *  This was a segregation-of-duties control. With it off, one user account
 *  with both BUYER_ORDER.EDIT and BUYER_ORDER.APPROVE can raise an order with
 *  an excess and approve that excess unaided - the excess is what moves the
 *  ceiling every purchase order and cutting challan is later measured
 *  against. The audit trail still records who did both halves and when
 *  (`approvalHistory`, and `excessApprovedById` on the order), so the actions
 *  remain attributable after the fact; they are simply no longer prevented.
 *
 *  If that needs to be reinstated for some documents but not others, the
 *  per-document `separateChecker` flag in approvalEngine's REGISTRY is still
 *  declared and is the place to do it.
 * ---------------------------------------------------------------------------
 */

/**
 * Formerly refused an approval by the document's own author. Now a no-op.
 *
 * Kept as a function, with its signature intact, so the call sites read the
 * same and the rule can be restored in one place.
 *
 * @param {{createdById?: string|null}} _document
 * @param {{userId?: string}} _actor
 * @param {string} [_label]  What to call the document in the refusal
 */
export function assertNotSelfApproval(_document, _actor, _label = 'document') {
  // Maker-checker disabled: an author may approve their own document.
}

/**
 * The same question without the throw, for a screen deciding whether to render
 * an Approve button at all. Now always yes.
 *
 * Returning `true` here is what puts the buttons back on all seven approval
 * screens, and what makes `approvalBlockedReason` null in every detail
 * response - see utils/approvability.js.
 */
export function canApprove(_document, _actor) {
  return true;
}
