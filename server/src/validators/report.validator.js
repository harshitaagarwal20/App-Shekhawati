/**
 * Report query validation.
 *
 * One schema for all fourteen reports. Each report declares which of these
 * filters it actually accepts (`descriptor.filters`), and ignores the rest —
 * so a stray `vendorId` on the inventory report is harmless rather than an
 * error a user has to understand.
 *
 * There is no `permission` field, and no way to nominate one: the report's own
 * descriptor decides what it requires.
 */

import { z } from 'zod';
import { isoDate, uuid } from './common.validator.js';


export const reportQuery = z
  .object({
    // Who and what
    buyerId: uuid.optional(),
    vendorId: uuid.optional(),
    orderId: uuid.optional(),

    // Where
    location: z.string().trim().max(80).optional(),
    firmName: z.string().trim().max(120).optional(),

    // What kind
    itemCategory: z.string().trim().max(60).optional(),
    colorCode: z.string().trim().max(60).optional(),
    purpose: z
      .enum(['CUTTING', 'DYEING', 'PRINTING', 'STITCHING', 'RETURN', 'SAMPLING', 'OTHER'])
      .optional(),
    stage: z
      .enum([
        'RAW',
        'ISSUED_FOR_DYEING',
        'ISSUED_FOR_PRINTING',
        'DYED',
        'PRINTED',
        'SCRUTINY_HOLD',
        'ISSUED_TO_CUTTING',
        'CONSUMED',
        'REJECTED',
      ])
      .optional(),

    // What state
    status: z.string().trim().max(30).optional(),
    approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
    decision: z.enum(['ACCEPT', 'REJECT', 'REWORK']).optional(),

    // When
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),

    /**
     * A ceiling, not a page size. These are operational reports over one
     * factory's live documents, but a mis-set date filter should still not be
     * able to pull an entire table into a browser.
     */
    limit: z.coerce.number().int().positive().max(2000).optional(),

    /**
     * Paging of the assembled report. The CSV export ignores both - it is
     * always the whole thing. See `runForExport` in the service.
     */
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(500).optional(),
  })
  .passthrough();
