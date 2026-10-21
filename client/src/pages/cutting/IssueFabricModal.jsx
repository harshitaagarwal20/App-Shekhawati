/**
 * Issue fabric against one cutting challan line, on the challan itself.
 *
 * ---------------------------------------------------------------------------
 *  WHY IT LIVES HERE
 *
 *  The challan is the requirement and the issue fulfils it, so the storeman
 *  issues from the line they are looking at rather than being sent to a
 *  separate screen and asked the order, purpose and line all over again.
 *  Everything a cutting issue needs is already known from the line: the
 *  order, the purpose (Cutting) and the line id. What is left to say is which
 *  rolls, how much off each, and who is handing it over.
 *
 *  The rules are the server's, unchanged: the same `/fabric-issues/preview`
 *  answers "can this much come off this roll" per roll as quantities are
 *  typed, and the same create / batch endpoints post it - one roll as one
 *  issue, several as one batch that posts together or not at all.
 *
 *  The rolls are pre-picked by `suggestRolls` (one shade, this order's rolls
 *  first, whole rolls until the outstanding quantity is covered) - a
 *  suggestion the storeman checks against the rack before confirming.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { employees as employeesApi, fabricIssues as fiApi } from '../../services/erp.js';
import { Alert, CollapsibleField, Field, Modal, Spinner, TextArea, TextInput } from '../../components/ui.jsx';
import TableWrap from '../../components/TableWrap.jsx';
import { fmtNum, todayInput } from '../../utils/format.js';
import { suggestRolls } from '../../utils/rollSuggest.js';
import { loadFailed } from '../../services/loadFailures.js';

/** The server's batch limit - see MAX_BATCH_ROLLS in fabricIssue.service.js. */
const MAX_ROLLS = 30;

export default function IssueFabricModal({ challan, line, onClose, onIssued }) {
  const [rolls, setRolls] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [qtys, setQtys] = useState({}); // rollId -> qty string; presence = picked
  const [order, setOrder] = useState([]); // picked roll ids, in posting order
  const [previews, setPreviews] = useState({});
  const [employeeId, setEmployeeId] = useState('');
  const [issuedByName, setIssuedByName] = useState('');
  const [shadeMixReason, setShadeMixReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fiApi
      .rolls({ orderId: challan.orderId })
      .then((r) => {
        if (!live) return;
        setRolls(r);
        const s = suggestRolls(r, line, MAX_ROLLS);
        setOrder(s.picks.map((p) => p.id));
        setQtys(Object.fromEntries(s.picks.map((p) => [p.id, String(p.qty)])));
      })
      .catch((e) => live && (setRolls([]), setError(e.message)));
    employeesApi.options().then(setEmployees).catch(loadFailed(setEmployees, 'employees'));
    return () => {
      live = false;
    };
  }, [challan.orderId, line]);

  /**
   * The rolls worth showing: this fabric (same colour and UOM as the line)
   * with something left on it. "Show all rolls" lifts the colour filter for
   * the case the suggestion cannot know about - a roll relabelled on the rack.
   */
  const shown = useMemo(() => {
    const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());
    return (rolls ?? []).filter(
      (r) =>
        Number(r.balanceQty) > 0 &&
        (showAll ||
          ((!line.colorCode || norm(r.colorCode) === norm(line.colorCode)) &&
            (!line.uom || norm(r.uom) === norm(line.uom)))),
    );
  }, [rolls, line, showAll]);

  function toggle(id, balance) {
    if (order.includes(id)) {
      setOrder((o) => o.filter((x) => x !== id));
      setQtys(({ [id]: _drop, ...rest }) => rest);
    } else if (order.length < MAX_ROLLS) {
      setOrder((o) => [...o, id]);
      setQtys((q) => ({ ...q, [id]: String(balance) }));
    }
  }

  /** "Can this much come off each roll?" - the posting's own checks, in advance. */
  const runPreview = useCallback(async () => {
    if (!order.length) {
      setPreviews({});
      return;
    }
    try {
      const results = await Promise.all(
        order.map((id, i) =>
          fiApi.preview({
            rollId: id,
            fabricQtyIssued: qtys[id] ? String(qtys[id]) : undefined,
            purpose: 'CUTTING',
            cuttingChallanLineId: line.id,
            batchRollIds: i > 0 ? order.slice(0, i) : undefined,
          }),
        ),
      );
      setPreviews(Object.fromEntries(order.map((id, i) => [id, results[i]])));
    } catch (e) {
      setPreviews({});
      setError(e.message);
    }
  }, [order, qtys, line.id]);

  useEffect(() => {
    const t = setTimeout(runPreview, 250);
    return () => clearTimeout(t);
  }, [runPreview]);

  const shadeMisses = order.map((id) => previews[id]?.shade).filter((s) => s && !s.ok);
  const shadeMix = shadeMisses.length > 0;
  const total = order.reduce((sum, id) => sum + Number(qtys[id] || 0), 0);
  const ready =
    order.length > 0 &&
    order.every((id) => Number(qtys[id]) > 0 && previews[id]?.availability?.permitted) &&
    (!shadeMix || shadeMixReason.trim().length >= 10) &&
    Boolean(employeeId || issuedByName.trim());

  async function post() {
    setBusy(true);
    setError('');
    const shared = {
      issueDate: todayInput(),
      purpose: 'CUTTING',
      orderId: challan.orderId,
      cuttingChallanLineId: line.id,
      issuedByEmployeeId: employeeId || null,
      issuedByName: issuedByName.trim() || null,
      shadeMixReason: shadeMix ? shadeMixReason.trim() : undefined,
      remarks: remarks.trim() || null,
    };
    try {
      if (order.length > 1) {
        await fiApi.createBatch({
          ...shared,
          rolls: order.map((id) => ({ rollId: id, fabricQtyIssued: String(qtys[id]) })),
        });
      } else {
        await fiApi.create({ ...shared, rollId: order[0], fabricQtyIssued: String(qtys[order[0]]) });
      }
      onIssued();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const lineLabel = [line.itemCategory, line.subCategory, line.colorCode].filter(Boolean).join(' / ');

  return (
    <Modal
      title={`Issue fabric — line ${line.lineNo}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={post} disabled={!ready || busy}>
            {busy
              ? 'Posting…'
              : `Issue ${fmtNum(total)} ${line.uom ?? ''}${order.length > 1 ? ` off ${order.length} rolls` : ''}`}
          </button>
        </>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        {lineLabel} · <strong>{fmtNum(line.outstandingQty)} {line.uom}</strong> still to issue of{' '}
        {fmtNum(line.requiredQty)}. Posting moves the fabric from the store to the cutting floor and
        cannot be undone here.
      </p>

      {error && <Alert kind="error" onDismiss={() => setError('')}>{error}</Alert>}

      {rolls === null ? (
        <Spinner label="Finding rolls" />
      ) : (
        <>
          <div className="issue-rolls-head">
            <strong>Rolls</strong>
            <label className="faint">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />{' '}
              Show all rolls, not only {line.colorCode || 'this fabric'}
            </label>
          </div>
          {shown.length === 0 ? (
            <Alert kind="warning">
              No roll of this fabric has anything left in the store. Receive it on a goods receipt
              first, or close this line short.
            </Alert>
          ) : (
            <TableWrap>
              <table className="data compact">
                <thead>
                  <tr>
                    <th />
                    <th>Roll</th>
                    <th>Fabric</th>
                    <th>Shade / lot</th>
                    <th className="num">On roll</th>
                    <th className="num">Issue</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const picked = order.includes(r.id);
                    const p = previews[r.id];
                    const bad = picked && p?.availability && !p.availability.permitted;
                    return (
                      <tr key={r.id} className={picked ? 'is-selected' : ''}>
                        <td>
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={() => toggle(r.id, r.balanceQty)}
                            aria-label={`Issue from roll ${r.rollNo}`}
                          />
                        </td>
                        <td>
                          {r.rollNo}
                          {r.forThisOrder === false && <span className="faint"> · other order</span>}
                        </td>
                        <td>{[r.fabricName, r.colorCode, r.gsm].filter(Boolean).join(' · ')}</td>
                        <td>{[r.shade, r.dyeLot].filter(Boolean).join(' / ') || '—'}</td>
                        <td className="num">{fmtNum(r.balanceQty)} {r.uom}</td>
                        <td className="num" style={{ width: 130 }}>
                          {picked && (
                            <TextInput
                              inputMode="decimal"
                              value={qtys[r.id] ?? ''}
                              error={bad}
                              onChange={(e) => setQtys((q) => ({ ...q, [r.id]: e.target.value }))}
                              aria-label={`Quantity off roll ${r.rollNo}`}
                            />
                          )}
                          {bad && (
                            <div className="err" style={{ fontSize: 11 }}>
                              max {fmtNum(p.availability.maxIssuable)}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}

          {shadeMix && (
            <>
              <Alert kind="warning">
                {shadeMisses.map((s, i) => (
                  <div key={i}>{s.message}</div>
                ))}
              </Alert>
              <Field label="Why mix shades on this line?" required hint="At least 10 characters - it goes on the record.">
                <TextArea rows={2} value={shadeMixReason} onChange={(e) => setShadeMixReason(e.target.value)} />
              </Field>
            </>
          )}

          <div className="form-grid two">
            <Field label="Issued by" required>
              <select
                value={employeeId}
                onChange={(e) => {
                  setEmployeeId(e.target.value);
                  setIssuedByName('');
                }}
              >
                <option value="">Choose the person issuing...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.empName} ({e.empId})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="…or type a name" hint="If they are not on the employee list.">
              <TextInput
                value={issuedByName}
                disabled={Boolean(employeeId)}
                onChange={(e) => setIssuedByName(e.target.value)}
              />
            </Field>
          </div>
          <CollapsibleField>
            <Field label="Remarks">
              <TextInput value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
          </CollapsibleField>
        </>
      )}
    </Modal>
  );
}
