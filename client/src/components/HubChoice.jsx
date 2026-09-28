/**
 * One sidebar link, a page of buttons, then the register.
 *
 * ===========================================================================
 *  WHY THIS EXISTS
 * ===========================================================================
 *
 *  The sidebar had grown a link per SCREEN rather than a link per SUBJECT.
 *  Stock was three of them - Inventory, Stock Movement, Fabric Rolls - which
 *  are one question, "what is in the store", asked three ways. Approvals was
 *  two, and somebody looking for either goes to the same place first.
 *
 *  A menu of screens makes the reader choose from a column of short labels in
 *  the corner of the window, where nothing says which of two similar names is
 *  the one they want. A menu of subjects sends them to a page that asks the
 *  question properly, with room to say what each answer actually is.
 *
 *  PlanningHub asked it first and this is its pattern, lifted out so that the
 *  next hub does not restate it slightly differently. It owns the ASK; the
 *  hub owns what the answers are and what each one opens.
 *
 * ---------------------------------------------------------------------------
 *  PANELS, NOT A ROW OF SMALL BUTTONS
 *
 *  This is the whole page - there is nothing else on it until the choice is
 *  made - so the answers are sized like the page's subject rather than like a
 *  control. A pair of small buttons in the corner of an empty card reads as a
 *  leftover filter somebody forgot to remove.
 *
 *  Each panel carries the register's full name AND one line saying what is in
 *  it. The blurb is the part nobody can look up: "Stock" and "Stock Movement"
 *  are near enough as words that somebody new picks by meaning, not by name.
 *
 *  They are plain buttons, not a toggle. Nothing here is "currently on", so
 *  there is no selected state to paint or to announce.
 *
 * ---------------------------------------------------------------------------
 *  THE CHOICE IS ASKED ONCE
 *
 *  It is not repeated as a control on the register itself. A second way to
 *  change registers, sitting in the filter row beside things that only narrow
 *  the list, invites somebody to change WHICH DOCUMENT they are reading while
 *  believing they filtered it. The way back is the sidebar, the same way they
 *  came in.
 * ---------------------------------------------------------------------------
 */

import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHeader } from './ui.jsx';

/**
 * The question page.
 *
 * @param {string}   title     the page heading - the subject, not the answer
 * @param {string}   question  asked above the panels, in plain words
 * @param {Array}    choices   `{ value, label, blurb }` - one panel each
 * @param {Function} onChoose  called with the value of the panel pressed
 */
export default function HubChoice({ title, question, choices, onChoose }) {
  return (
    <>
      <PageHeader title={title} />
      {/* Two answers or three, the row wraps rather than shrinking them - see
          `.hub-choice` in styles.css - so nothing here counts the panels. */}
      <div className="hub-ask">
        <h2 className="hub-ask-q">{question}</h2>
        <div className="hub-choice">
          {choices.map(({ value, label, blurb }) => (
            <button
              key={value}
              type="button"
              className="hub-choice-btn"
              onClick={() => onChoose(value)}
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

/**
 * Which register a hub is showing, and how to change it.
 *
 * THE CHOICE LIVES IN THE URL, the way the Job Work register's `?process=`
 * does. Somebody who sends "the fabric rolls" to a colleague sends a link that
 * opens on fabric rolls, and a reload does not drop them back onto the
 * question they have already answered.
 *
 * REGISTERS THE USER MAY NOT SEE ARE NOT OFFERED. Each choice names the
 * permission its own route requires, so a storeman who may count rolls but may
 * not see the money in the stock summary is not shown a panel that leads to a
 * refusal.
 *
 * ONE ANSWER IS NOT A QUESTION. Somebody who may see only one of the registers
 * lands on it directly rather than being asked to press the only button.
 *
 * A `?view=` naming something they may not see - a stale link, a bookmark kept
 * from a wider role - drops them back to the question rather than to an error.
 * The screen behind it checks again regardless; this only decides what to show.
 *
 * @param {string} param    the query parameter that carries the choice
 * @param {Array}  choices  `{ value, label, blurb, permission }`
 * @returns `{ allowed, chosen, choose }` - `chosen` is the whole choice object,
 *          or null while the question is still unanswered.
 */
export function useHubChoice(param, choices) {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();

  const allowed = choices.filter((c) => !c.permission || can(c.permission));

  const asked = params.get(param);
  const valid = allowed.some((c) => c.value === asked) ? asked : null;
  const value = allowed.length === 1 ? allowed[0].value : valid;

  return {
    allowed,
    chosen: allowed.find((c) => c.value === value) ?? null,
    // A history entry, not `replace`, so Back returns to the question.
    choose: (next) => setParams(next ? { [param]: next } : {}),
  };
}
