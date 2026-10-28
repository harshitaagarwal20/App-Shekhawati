/**
 * The tools Claude may call to look things up for the assistant.
 *
 * ===========================================================================
 *  EVERY TOOL IS A SCREEN THE CALLER COULD ALREADY OPEN
 * ===========================================================================
 *
 *  The assistant adds no access of its own. Each tool is built for ONE caller,
 *  from that caller's permissions, and reads through the same code the screens
 *  use:
 *
 *    run_report        the Reports registry (report.service.js). Only the
 *                      reports this caller's catalogue lists are offered, and
 *                      each run is checked against the report's own permission
 *                      again - the same two checks GET /reports/:key makes.
 *    daily_summary     composeSummary(), which already says a line only to a
 *                      reader of that register.
 *    cost_sheets       behind COST_SHEET.VIEW, as the Cost Sheets screen is.
 *    find_records      turns a name into the id a report filters on, per
 *                      register, each behind that register's VIEW.
 *    search_documents  the uploaded documents this caller may read
 *                      (assistantDocuments.service.js).
 *
 *  So a QC user's question cannot reach a price: there is no tool in their set
 *  that returns one, because there is no screen of theirs that shows one. And
 *  what is sent to Claude is exactly what that person could have read for
 *  themselves.
 *
 *  Every tool is read-only. Nothing here writes.
 *
 * ===========================================================================
 *  WHAT A TOOL HANDS BACK
 * ===========================================================================
 *
 *  Facts come back as `search_result` blocks - one per report run, summary,
 *  or document passage - each cut into small text blocks (a report row, a
 *  summary line, a chunk). With citations on, Claude's answer then points at
 *  the exact blocks it used, and those are what the screen shows under the
 *  answer as its sources. A tool's own words that are not facts (an id
 *  lookup, "no documents uploaded", an error) come back as plain text.
 *
 *  `sources` lines up with the search_result blocks in the order they are
 *  returned, which is the order the API numbers them in citations
 *  (`search_result_index`).
 * ===========================================================================
 */

import { z } from 'zod';
import prisma from '../config/prisma.js';
import * as reports from './report.service.js';
import { reportQuery } from '../validators/report.validator.js';
import { buildFigures, composeSummary } from './dailySummary.service.js';
import { search } from './assistantDocuments.service.js';
import { istIsoDate } from '../utils/dates.js';

/** Rows of a report Claude is shown. The totals always cover every row. */
export const REPORT_ROWS = 100;
const COST_SHEETS = 25;
const LOOKUPS = 10;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');

// ===========================================================================
//  FORMATTING - rows into sentences Claude can read and cite
// ===========================================================================

/** A cell as text, by the column's format. Blank cells say nothing. */
export function cell(value, format) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return JSON.stringify(value);
  const s = String(value);
  if (format === 'date') return s.slice(0, 10);
  // 500.0000 reads as 500. Money keeps its paise.
  if (format === 'qty' && /^-?\d+\.\d+$/.test(s)) return s.replace(/\.?0+$/, '');
  return s;
}

/** One report row as "Label: value; Label: value". */
export function rowText(row, columns) {
  return columns
    .map((c) => {
      const v = cell(row[c.key], c.format);
      return v === null ? null : `${c.label}: ${v}`;
    })
    .filter(Boolean)
    .join('; ');
}

/** The report's totals, labelled from its columns where a column matches. */
export function totalsText(totals, columns) {
  if (!totals || typeof totals !== 'object') return '';
  const byKey = Object.fromEntries(columns.map((c) => [c.key, c]));
  return Object.entries(totals)
    .map(([k, v]) => {
      const col = byKey[k];
      const label = col?.label ?? k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
      const text = cell(v, col?.format ?? 'qty');
      return text === null ? null : `${label}: ${text}`;
    })
    .filter(Boolean)
    .join('; ');
}

const filtersText = (filters) => {
  const set = Object.entries(filters).filter(([, v]) => v !== undefined && v !== '');
  return set.length ? set.map(([k, v]) => `${k}=${v}`).join(', ') : 'none';
};

const searchResult = (source, title, texts) => ({
  type: 'search_result',
  source,
  title,
  content: texts.map((text) => ({ type: 'text', text })),
  citations: { enabled: true },
});

// ===========================================================================
//  THE TOOLS
// ===========================================================================

/** Filters a report may take, as Claude is told them. Ids come from find_records. */
const FILTER_PROPERTIES = {
  buyerId: { type: 'string', description: 'Buyer id, from find_records(kind: "buyer").' },
  vendorId: { type: 'string', description: 'Vendor, supplier or job worker id, from find_records(kind: "vendor").' },
  orderId: { type: 'string', description: 'Buyer order id, from find_records(kind: "order").' },
  itemId: { type: 'string', description: 'Inventory item id, from find_records(kind: "item").' },
  dateFrom: { type: 'string', description: 'First day, YYYY-MM-DD, inclusive.' },
  dateTo: { type: 'string', description: 'Last day, YYYY-MM-DD, inclusive.' },
  status: { type: 'string', description: "The document's status, as the report's Status column shows it." },
  location: { type: 'string', description: 'Store location, as the report shows it.' },
  firmName: { type: 'string', description: 'Ironing firm, as the report shows it.' },
  itemCategory: { type: 'string', description: 'Item category, e.g. Fabric.' },
  colorCode: { type: 'string', description: 'Color, as the report shows it.' },
  checkerCode: { type: 'string', description: 'Checker code marked on the bag.' },
  purpose: { type: 'string', enum: ['CUTTING', 'DYEING', 'PRINTING', 'STITCHING', 'RETURN', 'SAMPLING', 'OTHER'] },
  stage: {
    type: 'string',
    enum: ['RAW', 'ISSUED_FOR_DYEING', 'ISSUED_FOR_PRINTING', 'DYED', 'PRINTED', 'SCRUTINY_HOLD', 'ISSUED_TO_CUTTING', 'CONSUMED', 'REJECTED'],
  },
  process: { type: 'string', enum: ['DYEING', 'PRINTING', 'WASHING', 'FINISHING'] },
  qcStage: { type: 'string', enum: ['FABRIC_SCRUTINY', 'CUT_PIECES', 'INLINE_QC', 'EXTERNAL_QC', 'REJECTED'] },
  inspectionStatus: { type: 'string', enum: ['PENDING', 'PASSED', 'FAILED'] },
};

/** Lookups, each behind the VIEW of its own register. */
const LOOKUP_KINDS = {
  buyer: {
    permission: 'BUYER.VIEW',
    find: (text) =>
      prisma.buyer
        .findMany({
          where: {
            deletedAt: null,
            OR: [{ buyerName: { contains: text, mode: 'insensitive' } }, { buyerCode: { contains: text, mode: 'insensitive' } }],
          },
          select: { id: true, buyerCode: true, buyerName: true },
          take: LOOKUPS,
        })
        .then((rows) => rows.map((r) => ({ id: r.id, label: `${r.buyerName} (${r.buyerCode})` }))),
  },
  vendor: {
    permission: 'VENDOR.VIEW',
    find: (text) =>
      prisma.vendor
        .findMany({
          where: {
            deletedAt: null,
            OR: [{ vendorName: { contains: text, mode: 'insensitive' } }, { vendorCode: { contains: text, mode: 'insensitive' } }],
          },
          select: { id: true, vendorCode: true, vendorName: true },
          take: LOOKUPS,
        })
        .then((rows) => rows.map((r) => ({ id: r.id, label: `${r.vendorName} (${r.vendorCode})` }))),
  },
  order: {
    permission: 'BUYER_ORDER.VIEW',
    find: (text) =>
      prisma.buyerOrder
        .findMany({
          where: {
            deletedAt: null,
            OR: [{ orderNo: { contains: text, mode: 'insensitive' } }, { buyerPoNo: { contains: text, mode: 'insensitive' } }],
          },
          select: { id: true, orderNo: true, buyerPoNo: true, style: { select: { styleNo: true } } },
          orderBy: { orderDate: 'desc' },
          take: LOOKUPS,
        })
        .then((rows) =>
          rows.map((r) => ({
            id: r.id,
            label: [r.orderNo, r.style?.styleNo && `style ${r.style.styleNo}`, r.buyerPoNo && `buyer PO ${r.buyerPoNo}`]
              .filter(Boolean)
              .join(', '),
          })),
        ),
  },
  item: {
    permission: 'INVENTORY.VIEW',
    find: (text) =>
      prisma.inventoryItem
        .findMany({
          where: {
            deletedAt: null,
            OR: [{ itemCode: { contains: text, mode: 'insensitive' } }, { description: { contains: text, mode: 'insensitive' } }],
          },
          select: { id: true, itemCode: true, description: true, colorCode: true },
          take: LOOKUPS,
        })
        .then((rows) =>
          rows.map((r) => ({ id: r.id, label: [r.itemCode, r.description, r.colorCode].filter(Boolean).join(', ') })),
        ),
  },
};

/** One cost sheet as a sentence. Costs are in rupees; FOB and target in the sheet's currency. */
function costSheetText(s) {
  const pct = (v) => (v === null || v === undefined ? null : `${(Number(v) * 100).toFixed(1)}%`);
  const parts = [
    `${s.costSheetNo} version ${s.version}, ${s.status}, dated ${cell(s.costDate, 'date')}`,
    `style ${s.style.styleNo}${s.style.styleDescription ? ` (${s.style.styleDescription})` : ''}`,
    s.style.buyer?.buyerName && `buyer ${s.style.buyer.buyerName}`,
    s.order?.orderNo && `order ${s.order.orderNo}`,
    s.materialCost !== null && `material cost INR ${s.materialCost}`,
    `conversion cost INR ${s.conversionCost}`,
    s.totalCost !== null && `total cost INR ${s.totalCost}`,
    s.fobInr !== null && `FOB INR ${s.fobInr}`,
    s.fobPrice !== null && `FOB price ${s.currency} ${s.fobPrice} at ${s.exchangeRate} to the ${s.currency}`,
    `margin ${pct(s.marginPct)}${s.marginAmount !== null ? ` (INR ${s.marginAmount})` : ''}`,
    `commission ${pct(s.commissionPct)}`,
    s.targetPrice !== null && `buyer's target price ${s.currency} ${s.targetPrice}`,
    s.marginAtTarget !== null && `margin at the target price ${pct(s.marginAtTarget)}`,
    s.approvedByName && `approved by ${s.approvedByName}`,
  ];
  return parts.filter(Boolean).join('; ');
}

/**
 * The tools for one caller.
 *
 * @param {(code: string) => boolean} has  the caller's permission check
 * @returns {{ definitions: object[], run: (name: string, input: unknown) => Promise<ToolOutcome> }}
 *
 * @typedef {{ content: string | object[], isError?: boolean, sources: object[] }} ToolOutcome
 */
export function toolsFor(has) {
  const catalogue = reports.catalogue(has);
  const lookupKinds = Object.keys(LOOKUP_KINDS).filter((k) => has(LOOKUP_KINDS[k].permission));
  const handlers = {};
  const definitions = [];

  // --- search_documents ---------------------------------------------------
  definitions.push({
    name: 'search_documents',
    description:
      'Search the uploaded reference documents - buyer tech packs and spec sheets, SOPs, QC manuals, and the like - by ' +
      'meaning. Returns the passages closest to the query, each with its file and page. Use for anything a document ' +
      'would say: specifications, measurements, tolerances, procedures, AQL levels, buyer requirements. Phrase the ' +
      'query as the thing you are looking for, e.g. "zip specification front pocket" or "AQL level for final inspection".',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to look for, in a few words.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  });
  handlers.search_documents = {
    schema: z.object({ query: z.string().trim().min(2).max(500) }),
    run: async ({ query }) => {
      const { documents, results } = await search(query, has);
      if (!documents) return { content: 'No documents have been uploaded that you may read.', sources: [] };
      if (!results.length) return { content: `No passage in the ${documents} uploaded document(s) matches "${query}".`, sources: [] };
      return {
        content: results.map((r) =>
          searchResult(
            `document:${r.documentId}#${r.seq}`,
            r.page ? `${r.fileName}, page ${r.page}` : r.fileName,
            [r.text],
          ),
        ),
        sources: results.map((r) => ({
          kind: 'document',
          title: r.page ? `${r.fileName}, page ${r.page}` : r.fileName,
          documentId: r.documentId,
          fileName: r.fileName,
          page: r.page,
        })),
      };
    },
  };

  // --- run_report -----------------------------------------------------------
  if (catalogue.length) {
    const keys = catalogue.map((r) => r.key);
    const accepted = new Set(catalogue.flatMap((r) => r.filters));
    definitions.push({
      name: 'run_report',
      description:
        'Run one of the ERP\'s operational reports over the live data - orders, stock, procurement, job work, ' +
        `cutting, ironing, QC, alteration, vendors. Returns the totals over every matching row and up to ${REPORT_ROWS} ` +
        'rows. Filter by id with ids from find_records. These are the reports you may run:\n' +
        catalogue
          .map((r) => `- ${r.key}: ${r.title}. ${r.description} Filters: ${r.filters.join(', ') || 'none'}.`)
          .join('\n'),
      input_schema: {
        type: 'object',
        properties: {
          report: { type: 'string', enum: keys },
          filters: {
            type: 'object',
            properties: Object.fromEntries(Object.entries(FILTER_PROPERTIES).filter(([k]) => accepted.has(k))),
            additionalProperties: false,
          },
        },
        required: ['report'],
        additionalProperties: false,
      },
    });
    handlers.run_report = {
      schema: z.object({ report: z.enum(keys), filters: z.record(z.string(), z.unknown()).optional() }),
      run: async ({ report: key, filters = {} }) => {
        const descriptor = reports.descriptorFor(key);
        // The same check the route makes, from the report's own descriptor.
        if (!has(descriptor.permission)) throw new ToolError(`You may not run the "${descriptor.title}" report.`);
        const only = Object.fromEntries(Object.entries(filters).filter(([k]) => descriptor.filters.includes(k)));
        const parsed = reportQuery.safeParse(only);
        if (!parsed.success) {
          throw new ToolError(`Those filters are not valid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
        }
        const result = await reports.run(key, { ...parsed.data, can: has, page: 1, pageSize: REPORT_ROWS });
        const shown = result.rows.length;
        const header =
          `${result.title} report. ${result.description} Filters: ${filtersText(parsed.data)}. ` +
          `${result.rowCount} row(s) matched${shown < result.rowCount ? `; the first ${shown} are listed` : ''}` +
          `${result.truncated ? ' (the report reached its row ceiling, so the totals may be partial)' : ''}.` +
          (result.totals ? ` Totals over every matching row - ${totalsText(result.totals, result.columns)}.` : '');
        const rows = result.rows.map((row, i) => `Row ${i + 1}: ${rowText(row, result.columns)}`);
        const title = `${result.title} (filters: ${filtersText(parsed.data)})`;
        return {
          content: [searchResult(`report:${key}?${new URLSearchParams(parsed.data)}`, title, [header, ...rows])],
          sources: [{ kind: 'report', title, reportKey: key, filters: parsed.data, rowCount: result.rowCount }],
        };
      },
    };
  }

  // --- daily_summary --------------------------------------------------------
  definitions.push({
    name: 'daily_summary',
    description:
      "One day's figures across the floor - pieces cut, issued to stitching units, stitched, External QC offered / " +
      'approved / sent to alteration / rejected, Inline QC checked and rejected, rejected as not repairable, and what ' +
      'is waiting for approval. Use for "how much did we stitch on ..." and other questions about a particular day.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'The day, YYYY-MM-DD.' } },
      required: ['date'],
      additionalProperties: false,
    },
  });
  handlers.daily_summary = {
    schema: z.object({ date: isoDate }),
    run: async ({ date }) => {
      if (date > istIsoDate()) throw new ToolError(`${date} has not happened yet.`);
      const summary = composeSummary(await buildFigures(date), has);
      if (!summary) return { content: `There is nothing on ${date} from the registers you may see.`, sources: [] };
      return {
        content: [searchResult(`summary:${date}`, summary.title, summary.lines)],
        sources: [{ kind: 'summary', title: summary.title, day: date }],
      };
    },
  };

  // --- cost_sheets ----------------------------------------------------------
  if (has('COST_SHEET.VIEW')) {
    definitions.push({
      name: 'cost_sheets',
      description:
        'FOB cost sheets of styles: material and conversion cost, total cost, FOB in rupees and in the quoted ' +
        "currency, margin, commission, the buyer's target price and the margin at it. Newest first. Use for " +
        'questions about costing, price and margin of a style or order.',
      input_schema: {
        type: 'object',
        properties: {
          styleNo: { type: 'string', description: 'All or part of the style number.' },
          orderNo: { type: 'string', description: 'All or part of the buyer order number.' },
          status: { type: 'string', enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'] },
        },
        additionalProperties: false,
      },
    });
    handlers.cost_sheets = {
      schema: z.object({
        styleNo: z.string().trim().max(60).optional(),
        orderNo: z.string().trim().max(40).optional(),
        status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED']).optional(),
      }),
      run: async ({ styleNo, orderNo, status }) => {
        const sheets = await prisma.styleCostSheet.findMany({
          where: {
            deletedAt: null,
            ...(styleNo ? { style: { styleNo: { contains: styleNo, mode: 'insensitive' } } } : {}),
            ...(orderNo ? { order: { orderNo: { contains: orderNo, mode: 'insensitive' } } } : {}),
            ...(status ? { status } : {}),
          },
          orderBy: [{ costDate: 'desc' }, { version: 'desc' }],
          take: COST_SHEETS,
          include: {
            style: { select: { styleNo: true, styleDescription: true, buyer: { select: { buyerName: true } } } },
            order: { select: { orderNo: true } },
          },
        });
        const filters = { styleNo, orderNo, status };
        if (!sheets.length) return { content: `No cost sheet matches (filters: ${filtersText(filters)}).`, sources: [] };
        const title = `Cost sheets (filters: ${filtersText(filters)})`;
        return {
          content: [searchResult(`cost-sheets?${new URLSearchParams(Object.entries(filters).filter(([, v]) => v))}`, title, sheets.map(costSheetText))],
          sources: [{ kind: 'cost-sheets', title }],
        };
      },
    };
  }

  // --- find_records ---------------------------------------------------------
  if (lookupKinds.length) {
    definitions.push({
      name: 'find_records',
      description:
        'Find the id of a buyer, vendor, buyer order or inventory item from its name, code or number, to filter a ' +
        'report by. Returns up to ten matches.',
      input_schema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: lookupKinds },
          text: { type: 'string', description: 'All or part of the name, code or number.' },
        },
        required: ['kind', 'text'],
        additionalProperties: false,
      },
    });
    handlers.find_records = {
      schema: z.object({ kind: z.enum(lookupKinds), text: z.string().trim().min(1).max(100) }),
      run: async ({ kind, text }) => {
        const found = await LOOKUP_KINDS[kind].find(text);
        return {
          content: found.length ? JSON.stringify(found) : `No ${kind} matches "${text}".`,
          sources: [],
        };
      },
    };
  }

  return {
    definitions,
    /** Runs one tool call. Never throws: a failure is the tool's answer, marked as an error. */
    async run(name, input) {
      const handler = handlers[name];
      if (!handler) return { content: `There is no tool called ${name}.`, isError: true, sources: [] };
      const parsed = handler.schema.safeParse(input);
      if (!parsed.success) {
        return {
          content: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`,
          isError: true,
          sources: [],
        };
      }
      try {
        return await handler.run(parsed.data);
      } catch (err) {
        // An ApiError below 500 (a report's own refusal, a bad filter) is a
        // sentence written for the user; Claude can read it too.
        if (err instanceof ToolError || (err?.expected && err.status < 500)) {
          return { content: err.message, isError: true, sources: [] };
        }
        process.stderr.write(`[assistant] ${name} failed: ${err?.stack ?? err}\n`);
        return { content: 'That lookup failed on the server. Try another way, or say it could not be found.', isError: true, sources: [] };
      }
    },
  };
}

/** A refusal or mistake a tool explains to Claude, rather than a server fault. */
class ToolError extends Error {}
