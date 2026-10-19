/**
 * Excess rules and excess authorisations.
 *
 * ===========================================================================
 *  2% IS A ROW IN A TABLE, NOT A LINE OF CODE
 * ===========================================================================
 *
 * This screen exists because the brief asked for exactly one thing: do not
 * permanently hardcode 2%. Every threshold in the system is a row here, and
 * changing what a buyer or an order is allowed is a data change made by Head
 * Office, not a deployment.
 *
 * The precedence is shown rather than assumed:
 *
 *      ORDER  ►  BUYER  ►  ITEM_CATEGORY  ►  DOCUMENT_TYPE  ►  GLOBAL
 *
 * so a user can see WHY a particular percentage applied to a particular
 * transaction, instead of wondering where the number came from.
 *
 * ONLY WHAT IS READ IS OFFERED. Rules can be made for the four documents that
 * read them (RULE_CONSUMERS in excess.service.js), purchase orders and
 * receipts take the percentage alone, and item-category tolerances belong on
 * the Tolerance Rules screen. An older row that nothing reads says so in the
 * list instead of passing for policy.
 */

import { useState } from 'react';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext.jsx';
import { useResourceList } from '../../hooks/useResourceList.js';
import { excess as excessApi } from '../../services/erp.js';
import {
  Alert,
  ConfirmDialog,
  EmptyState,
  EnumSelect,
  Field,
  Modal,
  RowActions,
  PageHeader,
  Pagination,
  SortableTh,
  Spinner,
  StatusBadge,
  TextArea,
  TextInput,
} from '../../components/ui.jsx';
import {
  FieldGroup,
  FormShell,
  RHFEnumSelect,
  RHFInput,
  RHFTextArea,
  useSubmit,
  useZodForm,
} from '../../components/form.jsx';
import { fmtDateTime, fmtEnum, fmtNum } from '../../utils/format.js';
import { ExportButton } from '../../components/dataTransfer.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const SCOPES = ['GLOBAL', 'DOCUMENT_TYPE', 'ITEM_CATEGORY', 'BUYER', 'ORDER'].map((v) => ({
  value: v,
  label: fmtEnum(v),
}));

/** New rules: item category is set on the Tolerance Rules screen instead. */
const CREATE_SCOPES = SCOPES.filter((s) => s.value !== 'ITEM_CATEGORY');

/** The documents that read an excess rule - the server refuses any other. */
const DOCUMENT_TYPES = ['BUYER_ORDER', 'CUTTING_ISSUE', 'PURCHASE_ORDER', 'GRN'].map((v) => ({
  value: v,
  label: fmtEnum(v),
}));

/** What the percentage does on each document, for the form's hint. */
const PCT_MEANING = {
  BUYER_ORDER: 'An order excess up to this is granted on entry; above it the Director decides.',
  CUTTING_ISSUE: 'Cutting past this over the approved plan needs an authorisation.',
  PURCHASE_ORDER: 'The order tolerance for a category with no Tolerance Rules row. A PO over it is refused.',
  GRN: 'The receipt tolerance for a category with no Tolerance Rules row. A receipt over it is flagged.',
};

/** Purchase orders and receipts read the percentage alone. */
const PCT_ONLY = ['PURCHASE_ORDER', 'GRN'];

export default function ExcessRules() {
  const { can } = useAuth();
  const [tab, setTab] = useState('rules');

  return (
    <>
      <PageHeader
        title="Excess Rules"
      />

      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={`btn ${tab === 'rules' ? 'btn-primary' : ''}`}
          onClick={() => setTab('rules')}
        >
          Rules
        </button>
        <button
          type="button"
          className={`btn ${tab === 'approvals' ? 'btn-primary' : ''}`}
          onClick={() => setTab('approvals')}
        >
          Authorisations
        </button>
      </div>

      {tab === 'rules' ? <RulesTab can={can} /> : <ApprovalsTab can={can} />}
    </>
  );
}

// ===========================================================================
//  RULES
// ===========================================================================

function RulesTab({ can }) {
  // Two lists share this screen, so each namespaces its own query parameters -
  // otherwise both would write `page` and `search` and overwrite each other.
  const list = useResourceList((params) => excessApi.rules(params), {
    defaultSort: 'priority',
    defaultDir: 'desc',
    initialFilters: { scope: '', documentType: '', isActive: '' },
    urlPrefix: 'rules',
  });

  const [editing, setEditing] = useState(null); // rule | 'new'
  const [deleting, setDeleting] = useState(null);
  const [banner, setBanner] = useState(null);
  const [busy, setBusy] = useState(false);

  const canEdit = can('MASTER_LIST.EDIT');
  const canCreate = can('MASTER_LIST.CREATE');
  const canDelete = can('MASTER_LIST.DELETE');

  async function doDelete() {
    setBusy(true);
    try {
      await excessApi.removeRule(deleting.id);
      setDeleting(null);
      setBanner({ kind: 'success', text: 'Rule removed.' });
      list.reload();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message });
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {banner && (
        <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Alert>
      )}
      {list.error && <Alert kind="error">{list.error.message}</Alert>}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="er-search">
              <TextInput
                id="er-search"
                type="search"
                placeholder="Search scope key or basis..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Scope" htmlFor="er-f-scope">
            <EnumSelect
              id="er-f-scope"
              options={SCOPES}
              placeholder="All"
              value={list.filters.scope ?? ''}
              onChange={(e) => list.setFilter('scope', e.target.value)}
            />
          </Field>

          <Field label="Document" htmlFor="er-f-doc">
            <EnumSelect
              id="er-f-doc"
              options={DOCUMENT_TYPES}
              placeholder="All"
              value={list.filters.documentType ?? ''}
              onChange={(e) => list.setFilter('documentType', e.target.value)}
            />
          </Field>

          <div className="field">
            <label>&nbsp;</label>
            <ExportButton dataset="excess-rules" params={list.query} rowCount={list.meta.total} />
          </div>
          {canCreate && (
            <div className="field">
              <label>&nbsp;</label>
              <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
                New rule
              </button>
            </div>
          )}
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <SortableTh field="scope" label="Scope" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <SortableTh field="scopeKey" label="Applies to" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} />
                <th>Document</th>
                <SortableTh field="excessPct" label="Permitted excess" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <th className="num">Hard ceiling</th>
                <th>Approval</th>
                <SortableTh field="priority" label="Priority" sortBy={list.sortBy} sortDir={list.sortDir} onSort={list.toggleSort} className="num" />
                <th>Basis</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={9} className="loading-row">
                    <Spinner label="Loading rules..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title="No excess rules"
                      message="A GLOBAL rule must exist, or transactions have no threshold at all."
                    />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((r) => (
                  <tr key={r.id} className={!r.isActive || r.inEffect === false ? 'inactive' : ''}>
                    <td>
                      <strong>{fmtEnum(r.scope)}</strong>
                      <div className="faint">rank {r.precedenceRank + 1}</div>
                      {r.notInEffectReason && (
                        <div style={{ color: 'var(--warning)', fontSize: 12, maxWidth: 220 }}>
                          Not in effect: {r.notInEffectReason}
                        </div>
                      )}
                    </td>
                    <td className="code">{r.scopeKey || '(everything)'}</td>
                    <td>{r.documentType ? fmtEnum(r.documentType) : 'any'}</td>
                    <td className="num">
                      <strong>{r.excessPctDisplay}%</strong>
                    </td>
                    <td className="num">
                      {r.fieldsInEffect && !r.fieldsInEffect.includes('hardCeilingPct')
                        ? <span className="faint">not used</span>
                        : r.hardCeilingPctDisplay ? `${r.hardCeilingPctDisplay}%` : 'none'}
                    </td>
                    <td>
                      {r.fieldsInEffect && !r.fieldsInEffect.includes('requiresApproval')
                        ? <span className="faint">not used</span>
                        : r.requiresApproval ? 'Required over the limit' : 'Not required up to the ceiling'}
                    </td>
                    <td className="num">{r.priority}</td>
                    <td className="muted" style={{ maxWidth: 320 }}>
                      {r.basis ?? '-'}
                    </td>
                    <td className="actions">
                      <RowActions
                        items={[
                          canEdit && { label: 'Edit', onClick: () => setEditing(r) },
                          canDelete && r.scope !== 'GLOBAL' && {
                            label: 'Remove',
                            onClick: () => setDeleting(r),
                            danger: true,
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableWrap>

        <Pagination
          meta={list.meta}
          page={list.page}
          pageSize={list.pageSize}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      </div>

      {editing && (
        <Modal
          title={editing === 'new' ? 'New excess rule' : `Edit ${fmtEnum(editing.scope)} rule`}
          onClose={() => setEditing(null)}
        >
          <RuleForm
            rule={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setBanner({ kind: 'success', text: 'Rule saved. It applies from the next transaction.' });
              list.reload();
            }}
          />
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Remove excess rule"
          danger
          busy={busy}
          confirmLabel="Remove"
          message={`Remove the ${fmtEnum(deleting.scope)} rule for "${deleting.scopeKey}"? Transactions will fall back to the next-widest rule.`}
          onConfirm={doDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

const ruleSchema = z.object({
  scope: z.enum(['GLOBAL', 'DOCUMENT_TYPE', 'ITEM_CATEGORY', 'BUYER', 'ORDER']),
  scopeKey: z.string().trim().max(80).optional(),
  documentType: z.string().optional(),
  excessPctDisplay: z.coerce.number().min(0).max(99, 'Must be under 100%'),
  hardCeilingPctDisplay: z.coerce.number().min(0).max(99).optional().or(z.literal('')),
  requiresApproval: z.boolean().optional(),
  priority: z.coerce.number().int().min(0).max(1000).optional(),
  basis: z.string().trim().max(255).optional(),
});

function RuleForm({ rule, onSaved, onCancel }) {
  const isNew = !rule;

  const form = useZodForm(ruleSchema, {
    scope: rule?.scope ?? 'DOCUMENT_TYPE',
    scopeKey: rule?.scopeKey ?? '',
    documentType: rule?.documentType ?? '',
    excessPctDisplay: rule ? Number(rule.excessPctDisplay) : 2,
    hardCeilingPctDisplay: rule?.hardCeilingPctDisplay ? Number(rule.hardCeilingPctDisplay) : '',
    requiresApproval: rule?.requiresApproval ?? true,
    priority: rule?.priority ?? 0,
    basis: rule?.basis ?? '',
  });

  const scope = form.watch('scope');
  const documentType = form.watch('documentType');
  const scopeKey = form.watch('scopeKey');
  // The document this rule is for - named directly, or as a DOCUMENT_TYPE key.
  const forDocument = documentType || (scope === 'DOCUMENT_TYPE' ? scopeKey?.trim() : '') || '';
  const pctOnly = PCT_ONLY.includes(forDocument);

  const { submit, busy, banner, setBanner } = useSubmit(
    form,
    (values) => {
      const body = {
        excessPct: String(Number(values.excessPctDisplay) / 100),
        hardCeilingPct:
          pctOnly || values.hardCeilingPctDisplay === '' || values.hardCeilingPctDisplay === undefined
            ? null
            : String(Number(values.hardCeilingPctDisplay) / 100),
        requiresApproval: values.requiresApproval,
        priority: values.priority,
        basis: values.basis || null,
      };
      return isNew
        ? excessApi.createRule({
            ...body,
            scope: values.scope,
            scopeKey: values.scope === 'GLOBAL' ? '' : values.scopeKey,
            documentType: values.documentType || null,
          })
        : excessApi.updateRule(rule.id, body);
    },
    { onDone: onSaved },
  );

  return (
    <FormShell
      onSubmit={submit}
      banner={banner}
      onDismissBanner={() => setBanner('')}
      busy={busy}
      submitLabel={isNew ? 'Create rule' : 'Save rule'}
      onCancel={onCancel}
      footerNote={
        isNew
          ? undefined
          : 'The scope and key identify which rule this is, so they cannot be changed. Remove it and add another instead.'
      }
    >
      <div className="form-grid">
        <FieldGroup title="What it applies to">
          <RHFEnumSelect
            form={form}
            name="scope"
            label="Scope"
            required
            includeBlank={false}
            options={isNew ? CREATE_SCOPES : SCOPES}
            disabled={!isNew}
            hint={isNew ? 'Item-category tolerances are set on the Tolerance Rules screen.' : undefined}
          />
          <RHFInput
            form={form}
            name="scopeKey"
            label="Applies to"
            hint={
              scope === 'GLOBAL'
                ? 'GLOBAL matches everything and takes no key.'
                : scope === 'ITEM_CATEGORY'
                  ? 'An item category, e.g. Accessories.'
                  : scope === 'DOCUMENT_TYPE'
                    ? `One of ${DOCUMENT_TYPES.map((d) => d.value).join(', ')}.`
                    : 'The id of the buyer or order.'
            }
            disabled={!isNew || scope === 'GLOBAL'}
          />
          <RHFEnumSelect
            form={form}
            name="documentType"
            label="Only for document type"
            options={DOCUMENT_TYPES}
            placeholder="Any document"
            disabled={!isNew}
          />
          <RHFInput
            form={form}
            name="priority"
            label="Priority"
            type="number"
            min="0"
            hint="Breaks ties between two rules of the same scope. Higher wins."
          />
        </FieldGroup>

        <FieldGroup title="The threshold">
          <RHFInput
            form={form}
            name="excessPctDisplay"
            label="Permitted excess (%)"
            type="number"
            step="any"
            min="0"
            required
            hint={PCT_MEANING[forDocument] ?? 'Beyond this, a transaction needs an authorisation.'}
          />
          <RHFInput
            form={form}
            name="hardCeilingPctDisplay"
            label="Hard ceiling (%)"
            type="number"
            step="any"
            min="0"
            disabled={pctOnly}
            hint={
              pctOnly
                ? 'Not used: this document is judged on the percentage alone.'
                : 'Past this, no authorisation can help — only a smaller quantity. Blank means no ceiling.'
            }
          />
          <Field
            label="Approval"
            hint={pctOnly ? 'Not used: this document is judged on the percentage alone.' : undefined}
          >
            <label className="row" style={{ gap: 8, cursor: pctOnly ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                disabled={pctOnly}
                {...form.register('requiresApproval')}
                style={{ width: 18, height: 18 }}
              />
              <span>
                Exceeding the threshold requires an authorisation (unticked: allowed up to the
                ceiling without one)
              </span>
            </label>
          </Field>
          <RHFTextArea
            form={form}
            name="basis"
            label="Basis"
            className="span-2"
            hint="Why this number. Shown next to it, so nobody has to guess where it came from."
          />
        </FieldGroup>
      </div>
    </FormShell>
  );
}

// ===========================================================================
//  AUTHORISATIONS
// ===========================================================================

function ApprovalsTab({ can }) {
  // Namespaced - see the note on the rules list above.
  const list = useResourceList((params) => excessApi.approvals(params), {
    defaultSort: 'requestedAt',
    defaultDir: 'desc',
    initialFilters: { status: '', pendingOnly: '' },
    urlPrefix: 'approvals',
  });

  const [dialog, setDialog] = useState(null);
  const [banner, setBanner] = useState(null);

  const canDecide = can('BUYER_ORDER.APPROVE');

  return (
    <>
      {banner && (
        <Alert kind={banner.kind} onDismiss={() => setBanner(null)}>
          {banner.text}
        </Alert>
      )}
      {list.error && <Alert kind="error">{list.error.message}</Alert>}

      <div className="card">
        <div className="toolbar">
          <div className="grow">
            <Field label="Search" htmlFor="ea-search">
              <TextInput
                id="ea-search"
                type="search"
                placeholder="Search document no, reason, requester..."
                value={list.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Status" htmlFor="ea-f-status">
            <EnumSelect
              id="ea-f-status"
              options={[
                { value: 'PENDING', label: 'Awaiting decision' },
                { value: 'APPROVED', label: 'Approved' },
                { value: 'REJECTED', label: 'Rejected' },
              ]}
              placeholder="All"
              value={list.filters.status ?? ''}
              onChange={(e) => list.setFilter('status', e.target.value)}
            />
          </Field>

          <div className="field">
            <label>&nbsp;</label>
            <ExportButton dataset="excess-approvals" params={list.query} rowCount={list.meta.total} />
          </div>
        </div>

        <TableWrap>
          <table className="data">
            <thead>
              <tr>
                <th>Requested</th>
                <th>Document</th>
                <th className="num">Base qty</th>
                <th className="num">Permitted</th>
                <th className="num">Max</th>
                <th className="num">Requested qty</th>
                <th className="num">Over limit</th>
                <th>Reason</th>
                <th>By</th>
                <th>Status</th>
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {list.loading && (
                <tr>
                  <td colSpan={11} className="loading-row">
                    <Spinner label="Loading authorisations..." />
                  </td>
                </tr>
              )}

              {!list.loading && list.rows.length === 0 && (
                <tr>
                  <td colSpan={11}>
                    <EmptyState
                      title="No excess authorisations"
                      message="One is raised whenever a transaction goes over its permitted excess."
                    />
                  </td>
                </tr>
              )}

              {!list.loading &&
                list.rows.map((a) => (
                  <tr key={a.id} className={a.status === 'PENDING' ? 'row-warn' : ''}>
                    <td className="nowrap">{fmtDateTime(a.requestedAt)}</td>
                    <td>
                      <div>{fmtEnum(a.documentType)}</div>
                      <div className="code faint">{a.documentNo ?? 'not yet posted'}</div>
                      {a.order && <div className="faint">{a.order.orderNo}</div>}
                    </td>
                    <td className="num">{fmtNum(a.baseQty)}</td>
                    <td className="num">
                      {a.permittedPctDisplay}%
                      <div className="faint">{fmtNum(a.permittedQty)}</div>
                    </td>
                    <td className="num">{fmtNum(a.maxPermittedQty)}</td>
                    <td className="num">
                      <strong>{fmtNum(a.actualQty)}</strong>
                      <div className="faint">{a.actualExcessPctDisplay}% excess</div>
                    </td>
                    <td className="num">
                      <strong>{fmtNum(a.overLimitQty)}</strong>
                      <div className="faint">{a.uom}</div>
                    </td>
                    <td className="muted" style={{ maxWidth: 260 }}>
                      {a.reason}
                    </td>
                    <td>
                      {a.requestedByName}
                      {a.approvedByName && <div className="faint">by {a.approvedByName}</div>}
                    </td>
                    <td>
                      <StatusBadge status={a.status} />
                      {a.consumed && <div className="faint">used</div>}
                    </td>
                    <td className="actions">
                      {canDecide && a.status === 'PENDING' && (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => setDialog({ approval: a, mode: 'approve' })}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => setDialog({ approval: a, mode: 'reject' })}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableWrap>

        <Pagination
          meta={list.meta}
          page={list.page}
          pageSize={list.pageSize}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
        />
      </div>

      {dialog && (
        <ExcessDecisionDialog
          approval={dialog.approval}
          mode={dialog.mode}
          onCancel={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            setBanner({ kind: 'success', text: message });
            list.reload();
          }}
        />
      )}
    </>
  );
}

function ExcessDecisionDialog({ approval, mode, onCancel, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const rejecting = mode === 'reject';

  async function go() {
    setBusy(true);
    setError('');
    try {
      if (rejecting) {
        await excessApi.reject(approval.id, text);
        onDone('Excess refused. The transaction cannot be posted over the limit.');
      } else {
        await excessApi.approve(approval.id, { remarks: text || undefined });
        onDone(`Excess of ${fmtNum(approval.overLimitQty)} ${approval.uom} authorised.`);
      }
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={rejecting ? 'Refuse the excess' : 'Authorise the excess'}
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${rejecting ? 'btn-danger' : 'btn-primary'}`}
            onClick={go}
            disabled={busy || (rejecting && text.trim().length < 3)}
          >
            {busy ? 'Working...' : rejecting ? 'Refuse' : 'Authorise'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <Alert kind="error">{error}</Alert>

        <p style={{ marginTop: 0 }}>{approval.explanation}</p>

        <p className="muted">
          <strong>Reason given:</strong> {approval.reason}
        </p>
        {approval.ruleBasis && (
          <p className="faint" style={{ fontSize: 12 }}>
            Threshold: {approval.ruleBasis}
          </p>
        )}

        <Field label={rejecting ? 'Reason for refusing' : 'Remarks'} required={rejecting}>
          <TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
