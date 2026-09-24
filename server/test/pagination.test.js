/**
 * Server-Side Pagination Tests
 *
 * Tests the complete pagination flow:
 * 1. Query parameter parsing
 * 2. Skip/Take calculation
 * 3. Total count vs page data
 * 4. Meta information accuracy
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseListQuery } from '../src/utils/http.js';

describe('Server-Side Pagination', () => {
  // =========================================================================
  //  QUERY PARSING
  // =========================================================================

  describe('parseListQuery', () => {
    it('should parse basic pagination params', () => {
      const mockReq = { query: { page: '2', pageSize: '50' } };
      const result = parseListQuery(mockReq, { sortable: ['name'], defaultSort: 'name' });

      assert.strictEqual(result.page, 2);
      assert.strictEqual(result.pageSize, 50);
      assert.strictEqual(result.skip, 50); // (2-1) * 50
      assert.strictEqual(result.take, 50);
    });

    it('should apply defaults when no params provided', () => {
      const mockReq = { query: {} };
      const result = parseListQuery(mockReq, { sortable: ['name'], defaultSort: 'name' });

      assert.strictEqual(result.page, 1);
      assert.strictEqual(result.pageSize, 25);
      assert.strictEqual(result.skip, 0); // (1-1) * 25
      assert.strictEqual(result.take, 25);
    });

    it('should clamp page to minimum 1', () => {
      const mockReq = { query: { page: '0' } };
      const result = parseListQuery(mockReq, { sortable: ['name'], defaultSort: 'name' });

      assert.strictEqual(result.page, 1);
      assert.strictEqual(result.skip, 0);
    });

    it('should clamp pageSize to maximum 200', () => {
      const mockReq = { query: { pageSize: '500' } };
      const result = parseListQuery(mockReq, { sortable: ['name'], defaultSort: 'name' });

      assert.strictEqual(result.pageSize, 200);
    });

    it('should clamp pageSize to minimum 1', () => {
      const mockReq = { query: { pageSize: '0' } };
      const result = parseListQuery(mockReq, { sortable: ['name'], defaultSort: 'name' });

      assert.strictEqual(result.pageSize, 1);
    });

    it('should handle invalid page as 1', () => {
      const mockReq = { query: { page: 'invalid' } };
      const result = parseListQuery(mockReq, { sortable: ['name'], defaultSort: 'name' });

      assert.strictEqual(result.page, 1);
    });

    it('should calculate skip/take correctly for middle pages', () => {
      // Page 5, Size 25: should skip 100, take 25
      const mockReq = { query: { page: '5', pageSize: '25' } };
      const result = parseListQuery(mockReq, { sortable: ['name'], defaultSort: 'name' });

      assert.strictEqual(result.skip, 100);
      assert.strictEqual(result.take, 25);
    });

    it('should handle sort parameters', () => {
      const mockReq = { query: { sortBy: 'name', sortDir: 'desc' } };
      const result = parseListQuery(mockReq, { sortable: ['name', 'date'], defaultSort: 'date' });

      assert.strictEqual(result.sortBy, 'name');
      assert.strictEqual(result.sortDir, 'desc');
      assert.deepStrictEqual(result.orderBy, { name: 'desc' });
    });

    it('should reject invalid sortBy fields', () => {
      const mockReq = { query: { sortBy: 'sql_injection', sortDir: 'asc' } };
      const result = parseListQuery(mockReq, { sortable: ['name'], defaultSort: 'name' });

      assert.strictEqual(result.sortBy, 'name'); // Falls back to default
    });

    it('should handle search parameter', () => {
      const mockReq = { query: { search: '  canvas  ' } };
      const result = parseListQuery(mockReq, { sortable: ['name'], defaultSort: 'name' });

      assert.strictEqual(result.search, 'canvas'); // Trimmed
    });
  });

  // =========================================================================
  //  PAGE METADATA CALCULATION
  // =========================================================================

  describe('Page Metadata Calculation', () => {
    function calculatePageMeta(total, page, pageSize) {
      return {
        total,
        page,
        pageSize,
        pageCount: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
        hasNext: page * pageSize < total,
        hasPrev: page > 1,
      };
    }

    it('should calculate pageCount correctly', () => {
      const meta = calculatePageMeta(100, 1, 25);
      assert.strictEqual(meta.pageCount, 4); // 100 / 25 = 4
    });

    it('should handle non-divisible totals', () => {
      const meta = calculatePageMeta(101, 1, 25);
      assert.strictEqual(meta.pageCount, 5); // ceil(101 / 25) = 5
    });

    it('should set hasNext correctly', () => {
      assert.strictEqual(calculatePageMeta(100, 1, 25).hasNext, true);  // Page 1 of 4
      assert.strictEqual(calculatePageMeta(100, 4, 25).hasNext, false); // Page 4 of 4
    });

    it('should set hasPrev correctly', () => {
      assert.strictEqual(calculatePageMeta(100, 1, 25).hasPrev, false); // Page 1
      assert.strictEqual(calculatePageMeta(100, 2, 25).hasPrev, true);  // Page 2+
    });

    it('should handle empty results', () => {
      const meta = calculatePageMeta(0, 1, 25);
      assert.strictEqual(meta.pageCount, 0);
      assert.strictEqual(meta.hasNext, false);
      assert.strictEqual(meta.hasPrev, false);
    });

    it('should handle single page', () => {
      const meta = calculatePageMeta(10, 1, 25);
      assert.strictEqual(meta.pageCount, 1);
      assert.strictEqual(meta.hasNext, false);
      assert.strictEqual(meta.hasPrev, false);
    });

    it('should handle large datasets', () => {
      const meta = calculatePageMeta(10000, 50, 25);
      assert.strictEqual(meta.pageCount, 400);
      assert.strictEqual(meta.hasNext, true);
      assert.strictEqual(meta.hasPrev, true);
    });
  });

  // =========================================================================
  //  PAGINATION LOGIC EDGE CASES
  // =========================================================================

  describe('Edge Cases', () => {
    function calculatePageMeta(total, page, pageSize) {
      return {
        total,
        page,
        pageSize,
        pageCount: pageSize > 0 ? Math.ceil(total / pageSize) : 0,
        hasNext: page * pageSize < total,
        hasPrev: page > 1,
      };
    }

    it('should handle exactly divisible totals', () => {
      const meta = calculatePageMeta(100, 4, 25);
      assert.strictEqual(meta.pageCount, 4);
      assert.strictEqual(meta.hasNext, false); // No next page
    });

    it('should handle single item per page', () => {
      const meta = calculatePageMeta(100, 50, 1);
      assert.strictEqual(meta.pageCount, 100);
      assert.strictEqual(meta.hasNext, true);
      assert.strictEqual(meta.hasPrev, true);
    });

    it('should handle single item total', () => {
      const meta = calculatePageMeta(1, 1, 25);
      assert.strictEqual(meta.pageCount, 1);
      assert.strictEqual(meta.hasNext, false);
      assert.strictEqual(meta.hasPrev, false);
    });

    it('should handle very large pageSize', () => {
      const meta = calculatePageMeta(10000, 1, 200);
      assert.strictEqual(meta.pageCount, 50);
      assert.strictEqual(meta.hasNext, true);
    });

    it('should handle requesting beyond last page gracefully', () => {
      // User requests page 100 but only 4 pages exist
      // Backend should clamp or the frontend should catch this
      const meta = calculatePageMeta(100, 100, 25);
      assert.strictEqual(meta.pageCount, 4);
      assert.strictEqual(meta.hasNext, false); // Page 100 doesn't exist
    });
  });

  // =========================================================================
  //  ROW CALCULATION (From/To Display)
  // =========================================================================

  describe('Row Display Calculation', () => {
    function calculateDisplayRange(page, pageSize, total) {
      const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
      const to = Math.min(page * pageSize, total);
      return { from, to };
    }

    it('should calculate first page range', () => {
      const range = calculateDisplayRange(1, 25, 100);
      assert.strictEqual(range.from, 1);
      assert.strictEqual(range.to, 25);
    });

    it('should calculate middle page range', () => {
      const range = calculateDisplayRange(3, 25, 100);
      assert.strictEqual(range.from, 51);
      assert.strictEqual(range.to, 75);
    });

    it('should calculate last page range with remainder', () => {
      const range = calculateDisplayRange(5, 25, 101);
      assert.strictEqual(range.from, 101);
      assert.strictEqual(range.to, 101); // Only 1 item on page 5
    });

    it('should handle empty result set', () => {
      const range = calculateDisplayRange(1, 25, 0);
      assert.strictEqual(range.from, 0);
      assert.strictEqual(range.to, 0);
    });

    it('should display correctly for 50-item pages', () => {
      const range = calculateDisplayRange(2, 50, 500);
      assert.strictEqual(range.from, 51);
      assert.strictEqual(range.to, 100);
    });
  });
});

describe('Pagination Integration Test', () => {
  /**
   * Simulates a complete pagination flow:
   * 1. User requests page 2 with 25 items per page
   * 2. Server calculates skip/take
   * 3. Database returns data + total count
   * 4. Server builds response meta
   * 5. Client renders pagination controls
   */

  it('should handle complete pagination flow', () => {
    // === FRONTEND: User clicks page 2 ===
    const userRequest = { page: '2', pageSize: '25' };

    // === BACKEND: Parse query ===
    const parsed = parseListQuery(
      { query: userRequest },
      { sortable: ['name'], defaultSort: 'name' }
    );

    assert.strictEqual(parsed.page, 2);
    assert.strictEqual(parsed.skip, 25); // Skip first 25 rows
    assert.strictEqual(parsed.take, 25);

    // === DATABASE: Simulated query ===
    const mockDatabaseResult = {
      rows: Array.from({ length: 25 }, (_, i) => ({
        id: `item-${26 + i}`,
        name: `Item ${26 + i}`,
      })),
      total: 523, // Total matching rows
    };

    // === BACKEND: Build response meta ===
    const meta = {
      total: mockDatabaseResult.total,
      page: parsed.page,
      pageSize: parsed.pageSize,
      pageCount: Math.ceil(mockDatabaseResult.total / parsed.pageSize),
      hasNext: parsed.page * parsed.pageSize < mockDatabaseResult.total,
      hasPrev: parsed.page > 1,
    };

    assert.strictEqual(meta.pageCount, 21); // 523 / 25 = 20.92 → 21
    assert.strictEqual(meta.hasNext, true);
    assert.strictEqual(meta.hasPrev, true);

    // === FRONTEND: Calculate display range ===
    const from = (meta.page - 1) * meta.pageSize + 1;
    const to = Math.min(meta.page * meta.pageSize, meta.total);

    assert.strictEqual(from, 26);
    assert.strictEqual(to, 50);

    // === FRONTEND: Render Pagination ===
    // Display text should be: "Showing 26-50 of 523"
    const displayText = `Showing ${from}-${to} of ${meta.total}`;
    assert.strictEqual(displayText, 'Showing 26-50 of 523');

    // === FRONTEND: Check button states ===
    assert.strictEqual(meta.hasPrev, true);  // Prev button enabled
    assert.strictEqual(meta.hasNext, true);  // Next button enabled
  });

  it('should handle last page with remainder', () => {
    // === Last page with partial results ===
    const parsed = parseListQuery(
      { query: { page: '21', pageSize: '25' } },
      { sortable: ['name'], defaultSort: 'name' }
    );

    const total = 523;
    const meta = {
      total,
      page: parsed.page,
      pageSize: parsed.pageSize,
      pageCount: Math.ceil(total / parsed.pageSize),
      hasNext: parsed.page * parsed.pageSize < total,
      hasPrev: parsed.page > 1,
    };

    // === Calculate range ===
    const from = (meta.page - 1) * meta.pageSize + 1;
    const to = Math.min(meta.page * meta.pageSize, total);

    assert.strictEqual(from, 501);
    assert.strictEqual(to, 523);
    assert.strictEqual(meta.hasNext, false); // No next page
    assert.strictEqual(meta.hasPrev, true);

    const displayText = `Showing ${from}-${to} of ${total}`;
    assert.strictEqual(displayText, 'Showing 501-523 of 523');
  });

  it('should handle page size change', () => {
    // === User changes from 25 to 50 items per page ===
    // Should reset to page 1
    const before = parseListQuery(
      { query: { page: '5', pageSize: '25' } },
      { sortable: ['name'], defaultSort: 'name' }
    );

    assert.strictEqual(before.page, 5);
    assert.strictEqual(before.skip, 100);

    // After changing pageSize, page should reset to 1
    const after = parseListQuery(
      { query: { page: '1', pageSize: '50' } },
      { sortable: ['name'], defaultSort: 'name' }
    );

    assert.strictEqual(after.page, 1);
    assert.strictEqual(after.skip, 0);
    assert.strictEqual(after.take, 50);
  });

  it('should handle search + pagination together', () => {
    // === User searches "tote" and browses results ===
    const parsed = parseListQuery(
      { query: { page: '2', pageSize: '25', search: '  tote  ' } },
      { sortable: ['name'], defaultSort: 'name' }
    );

    assert.strictEqual(parsed.search, 'tote'); // Trimmed
    assert.strictEqual(parsed.page, 2);
    assert.strictEqual(parsed.skip, 25);

    // Simulate: search returns 87 matching results
    const total = 87;
    const meta = {
      total,
      page: 2,
      pageSize: 25,
      pageCount: Math.ceil(total / 25),
      hasNext: 2 * 25 < total,
    };

    assert.strictEqual(meta.pageCount, 4); // 87/25 = 3.48 → 4
    assert.strictEqual(meta.hasNext, true); // Page 2 of 4, has page 3
  });
});
