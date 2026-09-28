/**
 * Style Master (BOM).
 *
 * The header is the standard master form; the BOM grid below it is the
 * material breakdown per finished piece. The Fabric line's "Qty / Pc" mirrors
 * the header's "Avg Fabric Utilization / Pc" - the server keeps the two in
 * step, and the grid shows the fabric row as read-only for that column so the
 * rule is visible rather than surprising.
 */

import { useEffect, useState } from 'react';
import { useFieldArray, useWatch } from 'react-hook-form';
import MasterPage from './MasterPage.jsx';
import { styleMaster } from '../../config/masters.jsx';
import { EnumSelect, MasterSelect, TextInput, VarietySelect } from '../../components/ui.jsx';
import TableWrap from '../../components/TableWrap.jsx';

const BLANK_LINE = {
  itemCategory: '',
  variant: '',
  subCategory: '',
  accessoriesItem: '',
  accessoryType: '',
  description: '',
  colorCode: '',
  content: '',
  gsm: '',
  count: '',
  construction: '',
  uom: '',
  qtyPerPc: '',
  wastagePct: '0',
  hsnCode: '',
};

function BomEditor({ form, editing, isNew }) {
  const { control, register, setValue, getValues } = form;
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'bom' });
  const avg = useWatch({ control, name: 'avgFabricUtilizationPerPc' });
  const bom = useWatch({ control, name: 'bom' }) ?? [];
  const [loaded, setLoaded] = useState(false);

  // Seed the grid from the record being edited (or one blank fabric line).
  useEffect(() => {
    if (loaded) return;
    if (isNew) {
      replace([{ ...BLANK_LINE, itemCategory: 'Fabric', uom: 'Mtrs', qtyPerPc: avg || '' }]);
    } else {
      const lines = (editing?.bomLines ?? []).map((l) => ({
        itemCategory: l.itemCategory ?? '',
        subCategory: l.subCategory ?? '',
        accessoriesItem: l.accessoriesItem ?? '',
        accessoryType: l.accessoryType ?? '',
        description: l.description ?? '',
        colorCode: l.colorCode ?? '',
        content: l.content ?? '',
        gsm: l.gsm ?? '',
        count: l.count ?? '',
        construction: l.construction ?? '',
        variant: l.variant ?? '',
        uom: l.uom ?? '',
        qtyPerPc: String(l.qtyPerPc ?? ''),
        wastagePct: String(l.wastagePct ?? '0'),
        hsnCode: l.hsnCode ?? '',
      }));
      replace(lines.length ? lines : [{ ...BLANK_LINE, itemCategory: 'Fabric', uom: 'Mtrs' }]);
    }
    setLoaded(true);
  }, [loaded, isNew, editing, replace, avg]);

  // Keep the Fabric line's qty in step with the header average.
  useEffect(() => {
    // `avg === ''` is the field being empty, which is not a value to mirror.
    // `avg === '0'` is, and must reach the Fabric line like any other figure.
    if (!loaded || avg === undefined || avg === '') return;
    const idx = (getValues('bom') ?? []).findIndex((l) => l.itemCategory === 'Fabric');
    if (idx >= 0) setValue(`bom.${idx}.qtyPerPc`, String(avg), { shouldDirty: false });
  }, [avg, loaded, getValues, setValue]);

  return (
    <div style={{ marginTop: 18 }}>
      <div className="fieldset-title" style={{ marginBottom: 10 }}>
        Bill of Materials &mdash; per finished piece
      </div>

      <TableWrap>
        <table className="bom-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th style={{ minWidth: 130 }}>Item Category</th>
              <th style={{ minWidth: 120 }}>Sub Category</th>
              <th style={{ minWidth: 140 }}>Accessories Item</th>
              <th style={{ minWidth: 150 }}>Description</th>
              <th style={{ minWidth: 150 }}>Variety / Size</th>
              <th style={{ minWidth: 110 }}>Colour</th>
              <th style={{ minWidth: 100 }}>UOM</th>
              <th style={{ minWidth: 110 }}>HSN</th>
              <th className="actions" />
            </tr>
          </thead>
          <tbody>
            {fields.map((field, i) => {
              const isFabric = bom[i]?.itemCategory === 'Fabric';
              /*
               * The five singular categories were withdrawn from
               * L_ItemCategory - trim is recorded as Accessories plus an item
               * now - but they are still listed here on purpose. A BOM line
               * saved before that change still says "Zipper", and opening it
               * for edit must still enable the Accessories Item beside it
               * rather than greying out the one field that explains the row.
               */
              const isAccessory = ['Accessories', 'Handle', 'Zipper', 'Label', 'Button', 'Thread'].includes(
                bom[i]?.itemCategory,
              );
              return (
                <tr key={field.id}>
                  <td className="faint">{i + 1}</td>
                  <td>
                    <MasterSelect
                      listCode="ItemCategory"
                      /* Stationery is bought for the office, never for a bag. */
                      filter={(v) => v.value !== 'Stationery'}
                      currentValue={bom[i]?.itemCategory} value={bom[i]?.itemCategory ?? ''}
                      {...register(`bom.${i}.itemCategory`)}
                    />
                  </td>
                  <td>
                    <MasterSelect
                      listCode="FabricSubCat"
                      currentValue={bom[i]?.subCategory} value={bom[i]?.subCategory ?? ''}
                      disabled={!isFabric}
                      {...register(`bom.${i}.subCategory`)}
                    />
                  </td>
                  <td>
                    <MasterSelect
                      listCode="AccessoriesItem"
                      currentValue={bom[i]?.accessoriesItem} value={bom[i]?.accessoriesItem ?? ''}
                      disabled={!isAccessory}
                      {...register(`bom.${i}.accessoriesItem`, {
                        // A button variety means nothing on a zipper.
                        onChange: () => setValue(`bom.${i}.accessoryType`, ''),
                      })}
                    />
                  </td>
                  <td>
                    {/* The buyer's own wording for the line - "In Tafeta
                        (W/HOOK)", "Organic Cotton Newar". The dropdowns above
                        classify it; this is what the sheet actually calls it. */}
                    <TextInput
                      placeholder="as the buyer's sheet names it"
                      {...register(`bom.${i}.description`)}
                    />
                  </td>
                  <td>
                    {/* ONE column, two kinds of answer. An accessory picks its
                        Variety from the list - the value that follows it to
                        the PO and keeps its stock apart from other buttons.
                        Anything else keeps the free-text size: 25 mm, 5/1000
                        mtr - the measurement that tells two otherwise
                        identical lines apart. */}
                    {isAccessory ? (
                      <VarietySelect
                        accessoriesItem={bom[i]?.accessoriesItem}
                        currentValue={bom[i]?.accessoryType}
                        value={bom[i]?.accessoryType ?? ''}
                        {...register(`bom.${i}.accessoryType`)}
                      />
                    ) : (
                      <TextInput
                        placeholder='25 mm'
                        {...register(`bom.${i}.variant`)}
                      />
                    )}
                  </td>
                  <td>
                    <MasterSelect
                      listCode="ColorCode"
                      currentValue={bom[i]?.colorCode} value={bom[i]?.colorCode ?? ''}
                      {...register(`bom.${i}.colorCode`)}
                    />
                  </td>
                  <td>
                    <MasterSelect listCode="UOM" currentValue={bom[i]?.uom} value={bom[i]?.uom ?? ''} {...register(`bom.${i}.uom`)} />
                  </td>
                  <td>
                    <TextInput type="text" {...register(`bom.${i}.hsnCode`)} />
                  </td>
                  <td className="actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => remove(i)}
                      disabled={fields.length === 1}
                      aria-label={`Remove line ${i + 1}`}
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>

      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-sm" onClick={() => append({ ...BLANK_LINE })}>
          Add BOM line
        </button>
      </div>
    </div>
  );
}

const COMPONENT_TYPES = [
  { value: 'FRONT_PANEL', label: 'Front panel' },
  { value: 'BACK_PANEL', label: 'Back panel' },
  { value: 'GUSSET', label: 'Gusset' },
  { value: 'BASE', label: 'Base' },
  { value: 'HANDLE', label: 'Handle' },
  { value: 'STRAP', label: 'Strap' },
  { value: 'POCKET', label: 'Pocket' },
  { value: 'FLAP', label: 'Flap' },
  { value: 'LINING', label: 'Lining' },
  { value: 'OTHER', label: 'Other' },
];

/** What a new style starts with: the tote the office makes most. */
const STARTER_PANELS = [
  { componentType: 'FRONT_PANEL', name: 'Front Panel', piecesPerBag: '1' },
  { componentType: 'BACK_PANEL', name: 'Back Panel', piecesPerBag: '1' },
  { componentType: 'GUSSET', name: 'Gusset', piecesPerBag: '1' },
  { componentType: 'HANDLE', name: 'Handle', piecesPerBag: '2' },
];

const BLANK_PANEL = {
  componentType: 'OTHER', name: '', piecesPerBag: '1', cutLength: '', cutWidth: '', bomLineNo: '',
};

/**
 * THE PANEL LIST - what one bag is cut into.
 *
 * The cut-pieces receipt and the cutting issue multiply the bags cut by this
 * list, so nobody types a handle count again. A style with no panels keeps the
 * typed counts it always had.
 */
function PanelEditor({ form, editing, isNew }) {
  const { control, register } = form;
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'components' });
  const panels = useWatch({ control, name: 'components' }) ?? [];
  const bom = useWatch({ control, name: 'bom' }) ?? [];
  const uom = useWatch({ control, name: 'dimensionUom' }) || 'cm';
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;
    const existing = (editing?.components ?? []).map((c) => ({
      componentType: c.componentType,
      name: c.name ?? '',
      piecesPerBag: String(c.piecesPerBag ?? 1),
      cutLength: c.cutLength != null ? String(c.cutLength) : '',
      cutWidth: c.cutWidth != null ? String(c.cutWidth) : '',
      bomLineNo: c.bomLineNo != null ? String(c.bomLineNo) : '',
    }));
    replace(isNew ? STARTER_PANELS.map((p) => ({ ...BLANK_PANEL, ...p })) : existing);
    setLoaded(true);
  }, [loaded, isNew, editing, replace]);

  const valid = panels.filter((p) => p.name && Number(p.piecesPerBag) > 0);
  const perBag = valid.reduce((a, p) => a + Number(p.piecesPerBag), 0);
  const handles = valid
    .filter((p) => p.componentType === 'HANDLE')
    .reduce((a, p) => a + Number(p.piecesPerBag), 0);
  const bomOptions = bom
    .map((l, i) => ({
      value: String(i + 1),
      label: `${i + 1}. ${[l.itemCategory, l.description || l.subCategory || l.accessoriesItem]
        .filter(Boolean)
        .join(' - ')}`,
    }))
    .filter((_, i) => bom[i]?.itemCategory);

  return (
    <div style={{ marginTop: 18 }}>
      <div className="fieldset-title" style={{ marginBottom: 4 }}>
        Panels &mdash; what one bag is cut into
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        {valid.length
          ? `${perBag} piece(s) per bag, ${handles} of them handle(s). Cut-pieces receipts and ` +
            'cutting issues work the handle and panel counts out from this.'
          : 'No panels listed - handle counts will be typed on receipts and cutting issues.'}
      </p>

      <TableWrap>
        <table className="bom-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              <th style={{ minWidth: 130 }}>Kind</th>
              <th style={{ minWidth: 150 }}>Panel name</th>
              <th style={{ minWidth: 80 }}>Per bag</th>
              <th style={{ minWidth: 90 }}>Cut L ({uom})</th>
              <th style={{ minWidth: 90 }}>Cut W ({uom})</th>
              <th style={{ minWidth: 160 }}>Cut from BOM line</th>
              <th className="actions" />
            </tr>
          </thead>
          <tbody>
            {fields.map((field, i) => (
              <tr key={field.id}>
                <td className="faint">{i + 1}</td>
                <td>
                  <EnumSelect
                    options={COMPONENT_TYPES}
                    includeBlank={false}
                    {...register(`components.${i}.componentType`)}
                  />
                </td>
                <td>
                  <MasterSelect
                    listCode="StyleComponent"
                    currentValue={panels[i]?.name}
                    value={panels[i]?.name ?? ''}
                    {...register(`components.${i}.name`)}
                  />
                </td>
                <td>
                  <TextInput type="number" min="1" max="40" step="1" {...register(`components.${i}.piecesPerBag`)} />
                </td>
                <td>
                  <TextInput type="number" min="0" step="0.01" {...register(`components.${i}.cutLength`)} />
                </td>
                <td>
                  <TextInput type="number" min="0" step="0.01" {...register(`components.${i}.cutWidth`)} />
                </td>
                <td>
                  <EnumSelect
                    options={bomOptions}
                    placeholder="Shell fabric"
                    {...register(`components.${i}.bomLineNo`)}
                  />
                </td>
                <td className="actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => remove(i)}
                    aria-label={`Remove panel ${i + 1}`}
                  >
                    &times;
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-sm" onClick={() => append({ ...BLANK_PANEL })}>
          Add panel
        </button>
      </div>
    </div>
  );
}

/**
 * Strips blank BOM rows and normalises the numbers before submitting.
 *
 * The BOM is read from the form rather than from `values`, because the style
 * zod schema validates the header only and strips unknown keys.
 */
function buildPayload(values, form) {
  const bom = (form.getValues('bom') ?? [])
    // A row is complete once it names a material and a unit. Qty and wastage
    // are no longer entered here: the Fabric line still carries the header
    // average (the sync effect writes it into form state), and every other
    // line goes out at zero, which requirementFor() reads as "nothing to bound
    // this by" rather than as a requirement of nothing.
    .filter((l) => l.itemCategory && l.uom)
    .map((l) => ({
      itemCategory: l.itemCategory,
      subCategory: l.subCategory || null,
      accessoriesItem: l.accessoriesItem || null,
      // Only an accessory has a variety; a row switched to Fabric drops it.
      accessoryType: (l.accessoriesItem && l.accessoryType) || null,
      description: l.description || null,
      colorCode: l.colorCode || null,
      content: l.content || null,
      gsm: l.gsm || null,
      count: l.count || null,
      construction: l.construction || null,
      variant: l.variant || null,
      uom: l.uom,
      qtyPerPc: String(l.qtyPerPc || 0),
      wastagePct: String(l.wastagePct || 0),
      hsnCode: l.hsnCode || null,
    }));

  // Blank panel rows are dropped; a row with a name is sent as it stands and
  // the server says what is wrong with it rather than the row vanishing.
  const components = (form.getValues('components') ?? [])
    .filter((p) => p.name)
    .map((p) => ({
      componentType: p.componentType || 'OTHER',
      name: p.name,
      piecesPerBag: Number(p.piecesPerBag || 0),
      cutLength: p.cutLength === '' ? null : String(p.cutLength),
      cutWidth: p.cutWidth === '' ? null : String(p.cutWidth),
      bomLineNo: p.bomLineNo === '' || p.bomLineNo == null ? null : Number(p.bomLineNo),
    }));

  return { ...values, bom, components };
}

export default function Styles() {
  return (
    <MasterPage
      descriptor={styleMaster}
      renderExtraForm={(ctx) => (
        <>
          <BomEditor key={`bom-${ctx.editing?.id ?? 'new'}`} {...ctx} />
          <PanelEditor key={`panels-${ctx.editing?.id ?? 'new'}`} {...ctx} />
        </>
      )}
      buildSubmitPayload={buildPayload}
    />
  );
}
