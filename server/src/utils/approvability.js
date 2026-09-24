/**
 * F-10 - WHETHER *THIS* USER MAY APPROVE *THIS* DOCUMENT.
 *
 * ===========================================================================
 *  WHY THE SCREEN CANNOT WORK THIS OUT ITSELF
 * ===========================================================================
 *
 * A screen knows whether the user holds `PURCHASE_ORDER.APPROVE`. It does not
 * know who raised the document, and it must not be told to compare user ids -
 * that would be the maker-checker rule written a second time, in a second
 * language, free to drift from the one the server enforces.
 *
 * So the server answers the question. `canApprove` on a detail response means
 * "if you also hold the permission, pressing Approve will work". The screen
 * ANDs the two and offers the button only when both are true.
 *
 * ---------------------------------------------------------------------------
 *  WHY THE AUTHOR ID IS COMPUTED WITH AND THEN REMOVED
 *
 *  `createdById` has to be on the row to decide this, but it does not have to
 *  leave the building. Shipping it would invite exactly the client-side
 *  comparison this file exists to prevent, and it is an internal user id that
 *  no screen has a use for. It is read, used, and deleted from the payload.
 *
 *  WHY AN ABSENT ACTOR ANSWERS "YES"
 *
 *  Nothing is granted by this flag. It decides whether a BUTTON is drawn; the
 *  refusal itself lives in approvalEngine.transition() and in the four
 *  services that approve without the engine. A background caller with no actor
 *  gets `true` and is still refused if it actually tries, which is the correct
 *  direction for a hint to fail in.
 * ---------------------------------------------------------------------------
 */

import { REGISTRY } from '../services/approvalEngine.js';
import { canApprove } from '../domain/makerChecker.js';

/**
 * Adds `canApprove` to a detail payload, and takes `createdById` back out.
 *
 * @param {string} documentType  A DocumentType registered with the engine
 * @param {object} dto           The projected document, carrying createdById
 * @param {{userId?: string}} [auth]  req.auth
 * @returns {object} the same payload, plus canApprove / approvalBlockedReason
 */
export function withApprovability(documentType, dto, auth) {
  if (!dto || typeof dto !== 'object') return dto;

  const cfg = REGISTRY[documentType];
  const separateChecker = cfg?.separateChecker ?? false;

  // The same helper the server enforces with, so the button and the refusal
  // can never disagree about who the maker was.
  const allowed =
    !separateChecker || canApprove({ createdById: dto.createdById }, { userId: auth?.userId });

  const { createdById: _authorId, ...rest } = dto;

  return {
    ...rest,
    canApprove: allowed,
    approvalBlockedReason: allowed
      ? null
      : 'You raised this document, so it has to be approved by somebody else.',
  };
}

export default withApprovability;
