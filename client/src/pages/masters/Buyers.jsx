/**
 * Buyer Master, with its address book.
 *
 * ===========================================================================
 *  WHY A BUYER NEEDS MORE THAN THREE ADDRESSES
 * ===========================================================================
 *
 *  The buyer row carries three, and they are three ROLES on a shipping
 *  document rather than three slots in a list: the buyer's own address, the
 *  consignee, and the notify party. Those are edited in the form above this
 *  editor, and they stay there - the printed documents, the import sheet and
 *  the export each name them individually.
 *
 *  A buyer ships to more places than that. Trade Word's orders went twice to
 *  "Trade Word DC, New Jersey", which is none of its three, so it was typed by
 *  hand on each order, offered by nothing, and forgotten as soon as the order
 *  was saved. The Ship To picker could only ever show three, which is what it
 *  looked like when somebody asked why their addresses were missing.
 *
 *  This is the rest of them. Each row is labelled with something the office
 *  would actually say - "Tokyo warehouse", "DC New Jersey" - because that
 *  label is what the order screen shows in its dropdown.
 *
 * ---------------------------------------------------------------------------
 *  THE ORDER OF THE ROWS IS KEPT
 *
 *  The server stores the position as `lineNo` and hands them back in it, so
 *  the destination somebody uses every week can sit at the top instead of
 *  wherever the database felt like returning it.
 *
 *  EDITING THE BOOK NEVER REWRITES A SHIPPED ORDER. An order copies the
 *  address TEXT onto itself when it is raised; nothing holds a reference to a
 *  row here. Correcting a typo fixes the next order and leaves last season's
 *  paperwork saying what it said at the time, which is what paperwork is for.
 * ---------------------------------------------------------------------------
 */

import { useEffect, useState } from 'react';
import { useFieldArray } from 'react-hook-form';
import MasterPage from './MasterPage.jsx';
import { buyerMaster } from '../../config/masters.jsx';
import { Field, TextArea, TextInput } from '../../components/ui.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const BLANK = { label: '', name: '', address: '', country: '' };

function AddressBook({ form, editing, isNew }) {
  const { control, register } = form;
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'addresses' });
  const [loaded, setLoaded] = useState(false);

  // Seed from the record being edited. A new buyer starts with no rows rather
  // than one blank one: most buyers need none of these, and an empty row that
  // has to be deleted reads as something gone wrong.
  useEffect(() => {
    if (loaded) return;
    replace(
      isNew
        ? []
        : (editing?.addresses ?? []).map((a) => ({
            label: a.label ?? '',
            name: a.name ?? '',
            address: a.address ?? '',
            country: a.country ?? '',
          })),
    );
    setLoaded(true);
  }, [loaded, isNew, editing, replace]);

  return (
    <>
      <div className="fieldset-title">Other ship-to addresses</div>
      <p className="hint span-2" style={{ marginTop: -4 }}>
        Everywhere else this buyer has goods sent. These appear in the order
        screen&apos;s Ship To picker, alongside the consignee and notify party above.
      </p>

      {fields.length > 0 && (
        <div className="span-2">
          <TableWrap>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Label</th>
                  <th style={{ width: 190 }}>Name at the address</th>
                  <th>Address</th>
                  <th style={{ width: 110 }}>Country</th>
                  <th className="actions-head" />
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={f.id}>
                    <td>
                      <TextInput
                        placeholder="Tokyo warehouse"
                        aria-label={`Label for address ${i + 1}`}
                        {...register(`addresses.${i}.label`)}
                      />
                    </td>
                    <td>
                      <TextInput
                        placeholder="who is there"
                        aria-label={`Name at address ${i + 1}`}
                        {...register(`addresses.${i}.name`)}
                      />
                    </td>
                    <td>
                      <TextArea
                        rows={2}
                        placeholder="street, city, postcode"
                        aria-label={`Address ${i + 1}`}
                        {...register(`addresses.${i}.address`)}
                      />
                    </td>
                    <td>
                      <TextInput
                        aria-label={`Country for address ${i + 1}`}
                        {...register(`addresses.${i}.country`)}
                      />
                    </td>
                    <td className="actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => remove(i)}
                        aria-label={`Remove address ${i + 1}`}
                        title="Remove this address"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      <Field className="span-2">
        <button type="button" className="btn" onClick={() => append({ ...BLANK })}>
          Add an address
        </button>
      </Field>
    </>
  );
}

/**
 * The book is read from the form rather than from `values`: the buyer zod
 * schema validates the header only and strips keys it does not know.
 *
 * A row is kept once it has a label and an address. The other two are genuinely
 * optional - a warehouse abroad often has no contact name the office knows -
 * and a row with neither is a line somebody started and abandoned, not an
 * instruction to store an empty destination. The server applies the same rule.
 */
function buildPayload(values, form) {
  const addresses = (form.getValues('addresses') ?? [])
    .filter((a) => a.label?.trim() && a.address?.trim())
    .map((a) => ({
      label: a.label.trim(),
      name: a.name?.trim() || null,
      address: a.address.trim(),
      country: a.country?.trim() || null,
    }));

  return { ...values, addresses };
}

export default function Buyers() {
  return (
    <MasterPage
      descriptor={buyerMaster}
      renderExtraForm={(ctx) => <AddressBook key={ctx.editing?.id ?? 'new'} {...ctx} />}
      buildSubmitPayload={buildPayload}
      formWidth="wide"
    />
  );
}
