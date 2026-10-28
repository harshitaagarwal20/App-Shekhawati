/**
 * The assistant - chunking, the tools each caller is given, and how an answer
 * is matched to its sources. No database and no API calls.
 *
 * The rule that matters most is the permission one: the tools a caller gets
 * are built from that caller's permissions, so a question can only reach what
 * the person asking could already open on screen.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { chunkText, CHUNK_CHARS } from '../src/domain/chunking.js';
import { cell, rowText, totalsText, toolsFor } from '../src/services/assistantTools.js';
import { echoable, shapeAnswer } from '../src/services/assistant.service.js';
import { fromBytes, toBytes, DIMENSIONS, VECTOR_BYTES } from '../src/services/embedding.service.js';
import { buildPermissions } from '../prisma/seed/data/rbac.js';

const sentence = (i) => `Sentence number ${i} says something about the tote bag.`;

describe('assistant - chunking', () => {
  test('a short text is one chunk', () => {
    const chunks = chunkText([{ text: 'Zip: YKK #5 metal. Label: woven, centred.' }]);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].seq, 0);
    assert.equal(chunks[0].page, null);
  });

  test('no chunk is longer than the size, and consecutive chunks overlap', () => {
    const text = Array.from({ length: 60 }, (_, i) => sentence(i)).join(' ');
    const chunks = chunkText([{ text }]);
    assert.ok(chunks.length > 2);
    for (const c of chunks) assert.ok(c.text.length <= CHUNK_CHARS, `chunk of ${c.text.length}`);
    for (let i = 1; i < chunks.length; i += 1) {
      const opening = chunks[i].text.split(/(?<=\.)\s/)[0];
      assert.ok(chunks[i - 1].text.endsWith(opening) || chunks[i - 1].text.includes(`${opening} `),
        `chunk ${i} does not open with a sentence from the end of chunk ${i - 1}`);
    }
  });

  test('every sentence is in some chunk', () => {
    const text = Array.from({ length: 40 }, (_, i) => sentence(i)).join(' ');
    const all = chunkText([{ text }]).map((c) => c.text).join(' ');
    for (let i = 0; i < 40; i += 1) assert.ok(all.includes(sentence(i)), `lost sentence ${i}`);
  });

  test('a chunk never crosses a page, and carries the page it is on', () => {
    const chunks = chunkText([
      { page: 1, text: 'Handles: cotton webbing, 2.5 cm wide.' },
      { page: 2, text: 'Final inspection follows AQL 2.5.' },
    ]);
    assert.deepEqual(chunks.map((c) => [c.seq, c.page]), [[0, 1], [1, 2]]);
    assert.ok(!chunks[0].text.includes('AQL'));
  });

  test('a line longer than a chunk is cut between words, not lost', () => {
    const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ');
    const chunks = chunkText([{ text: long }]);
    for (const c of chunks) assert.ok(c.text.length <= CHUNK_CHARS);
    assert.ok(chunks.map((c) => c.text).join(' ').includes('w299'));
  });

  test('blank pages and whitespace make no chunks', () => {
    assert.deepEqual(chunkText([{ page: 1, text: '   \n\n  ' }, { page: 2, text: '' }]), []);
  });
});

describe('assistant - vectors', () => {
  test('a vector survives the round trip through its stored bytes', () => {
    const v = Float32Array.from({ length: DIMENSIONS }, (_, i) => Math.sin(i));
    const bytes = toBytes(v);
    assert.equal(bytes.length, VECTOR_BYTES);
    assert.deepEqual(fromBytes(bytes), v);
  });
});

describe('assistant - the tools follow the caller\'s permissions', () => {
  const holder = (...codes) => (c) => codes.includes(c);
  const names = (has) => toolsFor(has).definitions.map((d) => d.name);
  const reportsOf = (has) =>
    toolsFor(has).definitions.find((d) => d.name === 'run_report')?.input_schema.properties.report.enum ?? [];

  test('everybody may search the documents they may read', () => {
    assert.ok(names(holder('ASSISTANT.VIEW')).includes('search_documents'));
  });

  test('cost sheets only for COST_SHEET.VIEW', () => {
    assert.ok(!names(holder('ASSISTANT.VIEW', 'EXTERNAL_QC.VIEW')).includes('cost_sheets'));
    assert.ok(names(holder('ASSISTANT.VIEW', 'COST_SHEET.VIEW')).includes('cost_sheets'));
  });

  test('a QC user is offered only QC reports - none that carries a price', () => {
    const qc = reportsOf(holder('ASSISTANT.VIEW', 'EXTERNAL_QC.VIEW', 'INLINE_QC.VIEW'));
    assert.ok(qc.length > 0);
    assert.ok(qc.every((k) => k.startsWith('external-qc') || k === 'checker-report'), qc.join(', '));
    for (const priced of ['stock-valuation', 'supplier-delivery']) {
      assert.ok(!qc.includes(priced), `${priced} offered to QC`);
    }
  });

  test('a caller with no report permission has no run_report tool at all', () => {
    assert.ok(!names(holder('ASSISTANT.VIEW')).includes('run_report'));
  });

  test('lookups are offered register by register', () => {
    const find = (has) => toolsFor(has).definitions.find((d) => d.name === 'find_records')?.input_schema.properties.kind.enum;
    assert.deepEqual(find(holder('ASSISTANT.VIEW', 'VENDOR.VIEW')), ['vendor']);
    assert.equal(find(holder('ASSISTANT.VIEW')), undefined);
  });

  test('a report outside the caller\'s set is refused when run', async () => {
    const qc = toolsFor(holder('ASSISTANT.VIEW', 'EXTERNAL_QC.VIEW'));
    const r = await qc.run('run_report', { report: 'stock-valuation' });
    assert.equal(r.isError, true);
    assert.deepEqual(r.sources, []);
  });

  test('a tool the caller was not given does not run', async () => {
    const r = await toolsFor(holder('ASSISTANT.VIEW')).run('cost_sheets', {});
    assert.equal(r.isError, true);
  });

  test('bad input is said back, not thrown', async () => {
    const r = await toolsFor(() => true).run('daily_summary', { date: 'yesterday' });
    assert.equal(r.isError, true);
    assert.match(r.content, /date/);
  });

  test('the seeder issues exactly the three ASSISTANT permissions', () => {
    const codes = buildPermissions().map((p) => p.code).filter((c) => c.startsWith('ASSISTANT.'));
    assert.deepEqual(codes.sort(), ['ASSISTANT.CREATE', 'ASSISTANT.DELETE', 'ASSISTANT.VIEW']);
  });
});

describe('assistant - report rows as text', () => {
  const columns = [
    { key: 'orderNo', label: 'Order No', format: 'text' },
    { key: 'orderDate', label: 'Date', format: 'date' },
    { key: 'orderQty', label: 'Order Qty', format: 'qty' },
    { key: 'poValue', label: 'PO value', format: 'money' },
    { key: 'remarks', label: 'Remarks', format: 'text' },
  ];

  test('quantities lose trailing zeros, money keeps its paise, dates are days', () => {
    assert.equal(cell('500.0000', 'qty'), '500');
    assert.equal(cell('12.5000', 'qty'), '12.5');
    assert.equal(cell('28500.00', 'money'), '28500.00');
    assert.equal(cell('2026-10-21T00:00:00.000Z', 'date'), '2026-10-21');
  });

  test('a row reads as labelled values, blanks left out', () => {
    const row = { orderNo: 'SO-00150', orderDate: '2026-10-21T00:00:00.000Z', orderQty: '500.0000', poValue: '28500.00', remarks: null };
    assert.equal(rowText(row, columns), 'Order No: SO-00150; Date: 2026-10-21; Order Qty: 500; PO value: 28500.00');
  });

  test('totals are labelled from the columns where they match', () => {
    assert.equal(totalsText({ orders: 4, orderQty: '4000.0000', poValue: '75400.00' }, columns), 'orders: 4; Order Qty: 4000; PO value: 75400.00');
  });
});

describe('assistant - an answer and its sources', () => {
  const retrieved = [
    { kind: 'report', title: 'Order book', reportKey: 'order-book' },
    { kind: 'document', title: 'techpack.pdf, page 2', documentId: 'd1', fileName: 'techpack.pdf', page: 2 },
    { kind: 'summary', title: 'Daily summary - 21-10-2026', day: '2026-10-21' },
  ];
  const cite = (index, start, text) => ({
    type: 'search_result_location',
    search_result_index: index,
    start_block_index: start,
    end_block_index: start + 1,
    cited_text: text,
    source: 'x',
    title: 'x',
  });

  test('sources are numbered in the order the answer first cites them', () => {
    const shaped = shapeAnswer(
      [
        { type: 'text', text: 'Final inspection is AQL 2.5', citations: [cite(1, 0, 'AQL 2.5 for major defects')] },
        { type: 'text', text: ' and the order book is 75,400', citations: [cite(0, 0, 'Totals: 75400')] },
        { type: 'text', text: '.' },
      ],
      retrieved,
    );
    assert.deepEqual(shaped.parts.map((p) => p.cites), [[1], [2], []]);
    assert.deepEqual(shaped.sources.map((s) => [s.number, s.kind]), [[1, 'document'], [2, 'report']]);
    assert.deepEqual(shaped.sources[0].excerpts, ['AQL 2.5 for major defects']);
    assert.equal(shaped.grounded, true);
    assert.deepEqual(shaped.alsoChecked, ['Daily summary - 21-10-2026']);
  });

  test('the same passage cited twice is listed once', () => {
    const shaped = shapeAnswer(
      [
        { type: 'text', text: 'A', citations: [cite(0, 3, 'Row 3')] },
        { type: 'text', text: 'B', citations: [cite(0, 3, 'Row 3'), cite(0, 4, 'Row 4')] },
      ],
      retrieved,
    );
    assert.equal(shaped.sources.length, 1);
    assert.deepEqual(shaped.sources[0].excerpts, ['Row 3', 'Row 4']);
  });

  test('an answer that cites nothing is not grounded', () => {
    const shaped = shapeAnswer([{ type: 'text', text: 'It is not in the data I can see.' }], retrieved);
    assert.equal(shaped.grounded, false);
    assert.deepEqual(shaped.sources, []);
  });

  test('thinking and tool calls are not part of the answer text', () => {
    const shaped = shapeAnswer(
      [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Done.' }],
      retrieved,
    );
    assert.deepEqual(shaped.parts, [{ text: 'Done.', cites: [] }]);
  });
});

describe('assistant - echoing a response back', () => {
  test('without a fallback, everything is echoed unchanged', () => {
    const content = [{ type: 'thinking' }, { type: 'text' }, { type: 'tool_use', id: 'a' }];
    assert.equal(echoable(content), content);
  });

  test('after a fallback, the declined model\'s thinking and tool calls are dropped', () => {
    const content = [
      { type: 'thinking', n: 1 },
      { type: 'tool_use', id: 'a' },
      { type: 'text', n: 2 },
      { type: 'fallback' },
      { type: 'thinking', n: 3 },
      { type: 'tool_use', id: 'b' },
    ];
    assert.deepEqual(
      echoable(content).map((b) => b.n ?? b.id ?? b.type),
      [2, 'fallback', 3, 'b'],
    );
  });
});
