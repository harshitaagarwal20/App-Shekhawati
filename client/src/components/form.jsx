/**
 * Reusable form building blocks, bound to React Hook Form and Zod.
 *
 * ---------------------------------------------------------------------------
 *  WHY THESE EXIST
 *
 *  Every transaction form in this application needs the same six things:
 *  a Zod schema, field-level errors under the inputs, server errors mapped back
 *  onto the fields that caused them, a submit button that cannot be pressed
 *  twice, dropdowns that read from the List Master, and a layout that works on
 *  a phone. Written per form, that is six chances per screen to do it slightly
 *  differently.
 *
 *  So it is written once here. A form built from these components is a schema,
 *  a handful of `<RHF*>` fields and a submit handler - which is why none of the
 *  pages in this application is a thousand-line file.
 *
 *  CLIENT VALIDATION IS FOR THE PERSON TYPING. IT IS NOT THE AUTHORITY.
 *
 *  The Zod schemas passed to `useZodForm` mirror the server's - required
 *  fields, positive quantities, valid dates - so a user is told about an empty
 *  box without a round trip. Every one of those rules is enforced again on the
 *  server, which is where the rule actually lives; `applyServerErrors` exists
 *  precisely because the server is expected to refuse things the browser let
 *  through.
 * ---------------------------------------------------------------------------
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, EnumSelect, Field, MasterSelect, RecordSelect, SuffixInput, TextArea, TextInput } from './ui.jsx';

/**
 * A React Hook Form instance wired to a Zod schema.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {object} defaultValues
 */
export function useZodForm(schema, defaultValues) {
  return useForm({
    resolver: zodResolver(schema),
    defaultValues,
    // Validate on blur rather than on every keystroke: a quantity box that
    // turns red while somebody is still typing "1500" is telling them off for
    // having typed "1".
    mode: 'onBlur',
    reValidateMode: 'onChange',
  });
}

/**
 * Maps a server refusal back onto the form.
 *
 * The API answers with `{ success: false, code, message, error: { details } }`,
 * and `details.field` names the input that caused it where the server knows
 * one. That field gets the message; everything else goes to the banner.
 *
 * @returns {string} The message for the banner
 */
export function applyServerErrors(err, setError) {
  const details = err?.details ?? err?.error?.details;
  const marked = [];

  // A Zod failure on the server side carries per-field messages.
  if (details?.fields) {
    for (const [field, messages] of Object.entries(details.fields)) {
      setError(field, { type: 'server', message: [].concat(messages).join(' ') });
      marked.push(field);
    }
  }
  // A business rule refusal names one field.
  if (details?.field) {
    setError(details.field, { type: 'server', message: err.message });
    marked.push(details.field);
  }
  if (err?.fieldErrors) {
    for (const [field, message] of Object.entries(err.fieldErrors)) {
      setError(field, { type: 'server', message: [].concat(message).join(' ') });
      marked.push(field);
    }
  }

  return { message: err?.message ?? 'Something went wrong', fields: marked };
}

/**
 * Puts the cursor on the field that is wrong.
 *
 * ---------------------------------------------------------------------------
 *  A MESSAGE AT THE TOP OF A FORM YOU CANNOT SEE IS NOT AN ERROR MESSAGE
 *
 *  The Buyer Order form is thirty-three inputs over four fieldsets, and it
 *  opens in a modal that scrolls. Press Save with a bad delivery date and the
 *  server refuses it, the date turns red, and a banner appears - eight hundred
 *  pixels above where the person is looking. From where they sit, the button
 *  did nothing. They press it again.
 *
 *  React Hook Form already solves half of this: `shouldFocusError` moves the
 *  cursor to the first field that fails CLIENT-side validation, and focusing
 *  scrolls it into view. But a refusal from the SERVER arrives long after that
 *  has run - `setError` marks the field and moves nothing - which is precisely
 *  the case where the reason is least guessable, because it is a business rule
 *  rather than a missing box.
 *
 *  So the same thing is done by hand for server errors. `setFocus` is tried
 *  first because it knows about registered inputs; a plain DOM lookup follows
 *  for fields rendered by a component RHF cannot focus (a combobox, a picker),
 *  and `scrollIntoView` still puts it on screen even when nothing can take the
 *  cursor.
 * ---------------------------------------------------------------------------
 */
export function focusFirstError(form, fields) {
  const name = fields?.[0];
  if (!name) return;

  try {
    form.setFocus(name);
  } catch {
    /* not a registered input - the DOM lookup below still has a chance */
  }

  // Whether or not the focus landed, make sure the field is actually visible.
  const el =
    document.getElementById(name)
    ?? document.querySelector(`[name="${CSS.escape(name)}"]`);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/**
 * Submit handling with the two things every form needs and forms routinely
 * forget: server errors on screen, and exactly one submission per press.
 *
 * `busy` is held here rather than taken from RHF's `isSubmitting`, because it
 * has to stay true through the parent's `onSaved` - which usually navigates -
 * and RHF clears its own flag the moment the promise settles.
 */
export function useSubmit(form, action, { onDone } = {}) {
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);

  // handleSubmit() is called on every render rather than memoised: wrapping it
  // in useCallback hides its dependencies from the linter and buys nothing, as
  // RHF already guards against re-entrant submits and `busy` disables the
  // button. The real double-submission guard is `busy`, below and on the button.
  const run = async (values) => {
    if (busy) return; // belt as well as braces
    setBusy(true);
    setBanner('');
    try {
      const result = await action(values);
      await onDone?.(result);
      // Deliberately NOT clearing `busy` on success: the caller is expected to
      // navigate or close, and a button that re-enables underneath a closing
      // modal is a button somebody double-posts with.
    } catch (err) {
      const { message, fields } = applyServerErrors(err, form.setError);
      setBanner(message);
      // The refusal names a field: take the user to it rather than leaving
      // them to find the red box in a form they cannot see the top of.
      focusFirstError(form, fields);
      setBusy(false);
    }
  };

  /*
   * A submit that never reaches the server still has to say so.
   *
   * RHF simply does not call `run` when client-side validation fails. It
   * focuses the offending input, which is most of the answer - but on a long
   * form the person has usually already looked at the Save button, and a
   * cursor moving somewhere off-screen is not something you notice. The banner
   * gives the press an outcome; the field itself still carries the detail.
   */
  const onInvalid = () => {
    setBanner('Some entries need checking. The fields with a problem are marked below.');
  };

  const submit = form.handleSubmit(run, onInvalid);

  return { submit, busy, banner, setBanner };
}

// ---------------------------------------------------------------------------
//  Fields
// ---------------------------------------------------------------------------

/** Pulls the message for one field out of RHF's nested error object. */
const errorOf = (errors, name) => errors?.[name]?.message;

/** A text, number or date input, registered with the form. */
export function RHFInput({
  form,
  name,
  label,
  required,
  hint,
  type = 'text',
  className = '',
  ...props
}) {
  const message = errorOf(form.formState.errors, name);
  return (
    <Field label={label} required={required} error={message} hint={hint} htmlFor={name} className={className}>
      <TextInput id={name} type={type} error={message} {...props} {...form.register(name)} />
    </Field>
  );
}

/**
 * A quantity box.
 *
 * `inputMode="decimal"` is what brings up the numeric keypad on a phone, and
 * `step="any"` stops the browser rounding a fabric length to whole metres.
 */
/**
 * A quantity, with the unit it is counted in.
 *
 * ---------------------------------------------------------------------------
 *  THE UNIT GOES IN THE BOX, NOT ONLY IN THE LABEL
 *
 *  It used to be folded into the caption - "Qty (Mtrs)" - which has two
 *  problems. The label is read when the form opens and not again, so at the
 *  moment somebody is looking at the figure they typed and asking "600 what?",
 *  the answer is above their eyeline. And the unit comes from the ROLL, so
 *  before a roll is chosen there is no unit to fold in and the caption is a
 *  bare "Qty" - which is exactly when a person is most likely to guess.
 *
 *  So the unit sits inside the field, next to the digits, and the field says
 *  plainly when it does not know it yet. Same treatment as the Excess %
 *  box on the order form.
 * ---------------------------------------------------------------------------
 */
export function RHFQty({ form, name, label, required, hint, uom, className = '', ...props }) {
  const message = errorOf(form.formState.errors, name);
  return (
    <Field
      label={label}
      required={required}
      error={message}
      hint={hint}
      htmlFor={name}
      className={className}
    >
      <SuffixInput
        id={name}
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        suffix={uom || ''}
        error={message}
        {...props}
        {...form.register(name)}
      />
    </Field>
  );
}

export function RHFTextArea({ form, name, label, required, hint, rows = 2, className = '',
  ...props
}) {
  const message = errorOf(form.formState.errors, name);
  return (
    <Field label={label} required={required} error={message} hint={hint} htmlFor={name} className={className}>
      <TextArea id={name} rows={rows} error={message} {...props} {...form.register(name)} />
    </Field>
  );
}

/**
 * A business dropdown. Reads its options from the List Master by code.
 *
 * This is the ONLY select used for business values in this application - there
 * are no hardcoded business option lists in the React code, which is what makes
 * "add a colour on the List Master screen" work immediately.
 */
/*
 * ===========================================================================
 *  THESE WRAPPERS FORWARD WHAT THEY DO NOT UNDERSTAND
 * ===========================================================================
 *
 *  Each of them used to name every prop it accepted and pass on exactly those.
 *  That reads as tidy and behaves as a trap: a caller writing
 *
 *      <RHFRecordSelect ... disabled={!rollId} noOptionsLabel="Choose a roll" />
 *
 *  got neither. The props were destructured into nothing and dropped, with no
 *  error, no warning and no visible difference - the field simply stayed
 *  enabled and kept saying "No match", and the only way to find out was to
 *  open the screen and try it.
 *
 *  There is no type checking in this project to catch a prop that goes
 *  nowhere, so the wrappers stop deciding what the underlying control is
 *  allowed to be told. Whatever they are given that they have no use for
 *  themselves goes straight through.
 * ===========================================================================
 */
export function RHFMasterSelect({
  form,
  name,
  label,
  listCode,
  required,
  hint,
  placeholder,
  className = '',
  ...props
}) {
  const message = errorOf(form.formState.errors, name);
  return (
    <Field label={label} required={required} error={message} hint={hint} htmlFor={name} className={className}>
      <MasterSelect
        id={name}
        listCode={listCode}
        error={message}
        placeholder={placeholder}
        currentValue={form.watch(name)}
        value={form.watch(name) ?? ''}
        {...props}
        {...form.register(name)}
      />
    </Field>
  );
}

/** A select backed by a record master's /options endpoint (Vendor, Order, …). */
export function RHFRecordSelect({
  form,
  name,
  label,
  options,
  loading,
  getValue = (o) => o.id,
  getLabel = (o) => o.name,
  required,
  hint,
  placeholder,
  className = '',
  ...props
}) {
  const message = errorOf(form.formState.errors, name);
  return (
    <Field label={label} required={required} error={message} hint={hint} htmlFor={name} className={className}>
      <RecordSelect
        id={name}
        options={options ?? []}
        loading={loading}
        getValue={getValue}
        getLabel={getLabel}
        error={message}
        placeholder={placeholder}
        value={form.watch(name) ?? ''}
        {...props}
        {...form.register(name)}
      />
    </Field>
  );
}

/**
 * A fixed enumeration - a workflow status, a document type, a process.
 *
 * Distinct from RHFMasterSelect on purpose: these values are in the Prisma
 * schema and cannot be added to on a screen, so reading them from the List
 * Master would be a lie about how changeable they are.
 */
export function RHFEnumSelect({
  form,
  name,
  label,
  options,
  required,
  hint,
  placeholder = 'Select...',
  includeBlank = true,
  className = '',
  ...props
}) {
  const message = errorOf(form.formState.errors, name);
  return (
    <Field label={label} required={required} error={message} hint={hint} htmlFor={name} className={className}>
      <EnumSelect
        id={name}
        error={message}
        options={options}
        placeholder={placeholder}
        includeBlank={includeBlank}
        value={form.watch(name) ?? ''}
        {...props}
        {...form.register(name)}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
//  Chrome
// ---------------------------------------------------------------------------

/**
 * The wrapper every form uses: server banner at the top, a scrolling body, and
 * a footer whose submit button disables itself while a request is in flight.
 */
export function FormShell({
  onSubmit,
  banner,
  onDismissBanner,
  busy,
  submitLabel = 'Save',
  busyLabel = 'Saving...',
  onCancel,
  cancelLabel = 'Cancel',
  disabled,
  children,
  footerNote,
}) {
  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="modal-body">
        {banner && (
          <Alert kind="error" onDismiss={onDismissBanner}>
            {banner}
          </Alert>
        )}
        {children}
      </div>

      <div className="modal-footer">
        {footerNote && <div className="faint form-footer-note">{footerNote}</div>}
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
        )}
        {/*
          Disabled while busy, which is the whole double-submission guard: a
          storeman on a slow connection WILL press it twice otherwise, and the
          second press would post a second fabric issue.
        */}
        <button type="submit" className="btn btn-primary" disabled={busy || disabled}>
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** A titled group of fields inside a form grid. */
export function FieldGroup({ title, hint, children }) {
  return (
    <>
      <div className="fieldset-title">
        {title}
        {hint && <span className="faint"> &mdash; {hint}</span>}
      </div>
      {children}
    </>
  );
}

/**
 * A read-only value that came from the server already calculated.
 *
 * Deliberately not an input: there is nothing here for a user to type, because
 * there is nothing here the server would accept. Used for amounts, variations,
 * permitted quantities and every other derived figure.
 */
export function ServerValue({ label, value, sub, tone = '' }) {
  return (
    <div className={`stat ${tone}`}>
      <div className="label">{label}</div>
      <div className="value">{value ?? '-'}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
