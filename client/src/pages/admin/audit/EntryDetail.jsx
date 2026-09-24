/**
 * One audit entry, with the full before-and-after.
 *
 * The list shows which fields moved; this shows what they moved from and to.
 * Deliberately a separate fetch rather than data carried in the list: the
 * snapshots are whole rows, and sending forty columns per row for a page of
 * fifty entries would be a large response nobody reads.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { audit as auditApi } from '../../../services/erp.js';
import { Alert, Modal, Spinner } from '../../../components/ui.jsx';
import { fmtDateTime } from '../../../utils/format.js';
import ChangeTable from './ChangeTable.jsx';

const ACTION_TEXT = {
  CREATE: 'was created',
  UPDATE: 'was edited',
  DELETE: 'was deleted',
};

export default function EntryDetail({ id, onClose, onShowTrail }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    auditApi
      .getById(id)
      .then((res) => { if (live) setEntry(res); })
      .catch((err) => { if (live) setError(err); });
    return () => { live = false; };
  }, [id]);

  return (
    <Modal
      title="Audit entry"
      onClose={onClose}
      size="lg"
      footer={
        <>
          {entry && (
            <button
              type="button"
              className="btn"
              onClick={() => onShowTrail(entry.tableName, entry.recordId)}
            >
              Full trail for this record
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </>
      }
    >
      {error && <Alert kind="error">{error.message}</Alert>}
      {!entry && !error && <Spinner label="Loading" />}

      {entry && (
        <>
          <p style={{ marginTop: 0 }}>
            <strong>{entry.label}</strong> {ACTION_TEXT[entry.action] ?? 'changed'} by{' '}
            <strong>{entry.userName ?? 'the system'}</strong> on {fmtDateTime(entry.createdAt)}
            {entry.ipAddress ? ` from ${entry.ipAddress}` : ''}.
          </p>

          {entry.route && (
            <p style={{ marginTop: -6 }}>
              <Link to={entry.route}>Open the record</Link>
            </p>
          )}

          {entry.action === 'CREATE' ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              The record did not exist before this entry, so there is nothing to compare it
              against. Its opening values are the ones on the record itself.
            </p>
          ) : entry.action === 'DELETE' ? (
            <p className="muted" style={{ marginBottom: 0 }}>
              The record was removed by this entry. Business documents are never physically
              deleted — a deletion here is a soft delete, and the row is still in the database.
            </p>
          ) : (
            <ChangeTable
              changes={entry.changes}
              emptyMessage="The record was written but no field value ended up different."
            />
          )}
        </>
      )}
    </Modal>
  );
}
