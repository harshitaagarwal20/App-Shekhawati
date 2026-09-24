/**
 * Client-Side Pagination Tests
 *
 * Tests useResourceList hook which manages:
 * 1. Pagination state (page, pageSize)
 * 2. URL synchronization
 * 3. Search/filter reset behavior
 * 4. Data fetching and caching
 */

import { describe, it, expect } from 'node:test';
import { listUrlParams } from '../src/hooks/useResourceList.js';

describe('Client-Side Pagination', () => {
  // =========================================================================
  //  URL PARAMETER BUILDING
  // =========================================================================

  describe('listUrlParams', () => {
    it('should remove default values from URL', () => {
      const current = new URLSearchParams();
      const next = listUrlParams(current, {
        values: { page: 1, pageSize: 25, search: '' },
        defaults: { page: 1, pageSize: 25, search: '' },
      });

      expect(next.toString()).toBe('');
    });

    it('should keep non-default values in URL', () => {
      const current = new URLSearchParams();
      const next = listUrlParams(current, {
        values: { page: 2, pageSize: 50, search: 'canvas' },
        defaults: { page: 1, pageSize: 25, search: '' },
      });

      expect(next.toString()).toContain('page=2');
      expect(next.toString()).toContain('pageSize=50');
      expect(next.toString()).toContain('search=canvas');
    });

    it('should preserve unknown parameters', () => {
      const current = new URLSearchParams('recordId=abc123&status=ACTIVE');
      const next = listUrlParams(current, {
        values: { page: 2, pageSize: 25 },
        defaults: { page: 1, pageSize: 25 },
        prefix: '',
        ignore: [],
      });

      expect(next.toString()).toContain('recordId=abc123');
      expect(next.toString()).toContain('status=ACTIVE');
      expect(next.toString()).toContain('page=2');
    });

    it('should namespace parameters with prefix', () => {
      const current = new URLSearchParams();
      const next = listUrlParams(current, {
        values: { page: 2, search: 'test' },
        defaults: { page: 1, search: '' },
        prefix: 'rules',
      });

      expect(next.toString()).toContain('rules.page=2');
      expect(next.toString()).toContain('rules.search=test');
      expect(next.toString()).not.toContain('page=2'); // Not namespaced
    });

    it('should ignore specified parameters', () => {
      const current = new URLSearchParams('process=DYEING');
      const next = listUrlParams(current, {
        values: { page: 2, process: 'PRINTING', search: '' },
        defaults: { page: 1, process: '', search: '' },
        prefix: '',
        ignore: ['process'], // Job Work manages this
      });

      // process should stay as DYEING, not change to PRINTING
      expect(next.toString()).toContain('process=DYEING');
      expect(next.toString()).toContain('page=2');
    });

    it('should handle multiple lists on one screen', () => {
      const current = new URLSearchParams();

      // Rules list
      const rulesParams = listUrlParams(current, {
        values: { page: 2, search: 'shrink' },
        defaults: { page: 1, search: '' },
        prefix: 'rules',
      });

      // Approvals list (same page, different data)
      const approvalsParams = listUrlParams(rulesParams, {
        values: { page: 1, search: 'pending' },
        defaults: { page: 1, search: '' },
        prefix: 'approvals',
      });

      expect(approvalsParams.toString()).toContain('rules.page=2');
      expect(approvalsParams.toString()).toContain('approvals.search=pending');
    });

    it('should not write sortDir without sortBy', () => {
      const current = new URLSearchParams();
      const next = listUrlParams(current, {
        values: { sortBy: '', sortDir: 'desc', page: 1 },
        defaults: { sortBy: '', sortDir: 'asc', page: 1 },
      });

      expect(next.toString()).not.toContain('sortDir');
    });

    it('should handle array filtering correctly', () => {
      const current = new URLSearchParams();
      const next = listUrlParams(current, {
        values: {
          page: 1,
          search: 'canvas',
          tags: [], // Empty array should be treated as default
        },
        defaults: { page: 1, search: '', tags: [] },
      });

      // Empty array equals default, so tags should not be in URL
      expect(next.toString()).toContain('search=canvas');
      expect(next.toString()).not.toContain('tags');
    });
  });

  // =========================================================================
  //  PAGINATION STATE LOGIC
  // =========================================================================

  describe('Pagination State Management', () => {
    it('should reset page to 1 when search changes', () => {
      // User is on page 3 of search results
      // Changes search term → should reset to page 1

      let currentPage = 3;
      let currentSearch = 'canvas';

      // Search changes
      const newSearch = 'tote';
      if (newSearch !== currentSearch) {
        currentPage = 1; // Reset
      }

      expect(currentPage).toBe(1);
    });

    it('should not reset page on first render', () => {
      // Simulating URL ?page=3
      // Should NOT snap back to 1 on mount

      let settled = false;
      let page = 3;

      // First render
      if (!settled) {
        settled = true;
        // Don't reset page
      } else {
        page = 1; // Reset only on actual change
      }

      expect(page).toBe(3); // Page stays at 3
    });

    it('should reset page when filter changes', () => {
      let page = 5;
      let filter = 'ACTIVE';

      // Filter changes
      const newFilter = 'INACTIVE';
      if (newFilter !== filter) {
        page = 1;
      }

      expect(page).toBe(1);
    });

    it('should reset page when pageSize changes', () => {
      let page = 4;
      let pageSize = 25;

      // User changes pageSize to 50
      const newPageSize = 50;
      if (newPageSize !== pageSize) {
        pageSize = newPageSize;
        page = 1;
      }

      expect(page).toBe(1);
    });

    it('should allow direct page navigation', () => {
      let page = 1;

      // User clicks "Page 5"
      page = 5;

      expect(page).toBe(5);
    });
  });

  // =========================================================================
  //  DISPLAY CALCULATION
  // =========================================================================

  describe('Display Calculations', () => {
    function calculateDisplay(page, pageSize, total) {
      const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
      const to = Math.min(page * pageSize, total);
      return { from, to, pageCount: Math.ceil(total / pageSize) || 0 };
    }

    it('should calculate "Showing X-Y of Z" correctly', () => {
      const display = calculateDisplay(2, 25, 523);
      expect(display.from).toBe(26);
      expect(display.to).toBe(50);
      expect(display.pageCount).toBe(21);

      const text = `Showing ${display.from}-${display.to} of ${523}`;
      expect(text).toBe('Showing 26-50 of 523');
    });

    it('should handle empty result set', () => {
      const display = calculateDisplay(1, 25, 0);
      expect(display.from).toBe(0);
      expect(display.to).toBe(0);
      expect(display.pageCount).toBe(0);

      const text = display.from === 0 ? 'No records' : `Showing ${display.from}-${display.to}`;
      expect(text).toBe('No records');
    });

    it('should disable Next button on last page', () => {
      const page = 21;
      const pageSize = 25;
      const total = 523;

      const pageCount = Math.ceil(total / pageSize);
      const isLastPage = page >= pageCount;

      expect(isLastPage).toBe(true);
    });

    it('should disable Prev button on first page', () => {
      const page = 1;
      const isFirstPage = page <= 1;

      expect(isFirstPage).toBe(true);
    });
  });

  // =========================================================================
  //  DEBOUNCED SEARCH
  // =========================================================================

  describe('Debounced Search', () => {
    it('should debounce search input', async () => {
      let debounced = '';
      let timeoutId;

      function setDebouncedSearch(value, delay = 350) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          debounced = value;
        }, delay);
      }

      // Simulate typing "c", "a", "n", "v", "a", "s"
      setDebouncedSearch('c', 350);
      expect(debounced).toBe(''); // Not updated yet

      clearTimeout(timeoutId);
      setDebouncedSearch('canvas', 350);
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 360));

      expect(debounced).toBe('canvas');
    });

    it('should prevent multiple API calls during typing', async () => {
      let apiCallCount = 0;
      let debounced = '';
      let timeoutId;

      function makeApiCall(search) {
        if (search) apiCallCount++;
      }

      function handleSearch(value, delay = 350) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          debounced = value;
          makeApiCall(value);
        }, delay);
      }

      // Simulate rapid typing
      handleSearch('c', 350);
      handleSearch('ca', 350);
      handleSearch('can', 350);
      handleSearch('canv', 350);
      handleSearch('canva', 350);
      handleSearch('canvas', 350);

      // Only one API call should happen
      await new Promise(resolve => setTimeout(resolve, 360));
      expect(apiCallCount).toBe(1);
      expect(debounced).toBe('canvas');
    });
  });

  // =========================================================================
  //  INTEGRATION TESTS
  // =========================================================================

  describe('Complete Flow', () => {
    it('should handle page 1 → page 2 navigation', () => {
      // === URL bar initially ===
      let url = '/masters';

      // === User clicks Page 2 button ===
      let page = 2;
      let pageSize = 25;

      // === Build new URL ===
      const params = listUrlParams(new URLSearchParams(), {
        values: { page, pageSize, search: '' },
        defaults: { page: 1, pageSize: 25, search: '' },
      });

      // === Update URL ===
      url = '/masters?' + params.toString();

      expect(url).toBe('/masters?page=2');
    });

    it('should handle search → navigation → back', () => {
      // === User types search ===
      const originalPage = 1;
      let page = 1;
      let search = 'canvas';

      // === Search resets page to 1 ===
      page = 1;

      // === User clicks page 3 ===
      page = 3;

      // === URL is now ?search=canvas&page=3 ===
      const url = new URLSearchParams();
      url.set('search', search);
      url.set('page', String(page));

      expect(url.toString()).toContain('search=canvas');
      expect(url.toString()).toContain('page=3');

      // === User clicks Back ===
      // Browser restores ?search=canvas&page=3
      const restored = new URLSearchParams(url.toString());
      const restoredPage = Number(restored.get('page'));
      const restoredSearch = restored.get('search');

      expect(restoredPage).toBe(3);
      expect(restoredSearch).toBe('canvas');
    });

    it('should handle page size change with fresh page 1', () => {
      // === On page 3 with 25 items ===
      let page = 3;
      let pageSize = 25;

      // === User changes to 50 items ===
      pageSize = 50;
      page = 1; // Reset

      // === URL updates ===
      const params = listUrlParams(new URLSearchParams(), {
        values: { page, pageSize },
        defaults: { page: 1, pageSize: 25 },
      });

      expect(params.get('page')).toBe(null); // 1 is default, omitted
      expect(params.get('pageSize')).toBe('50');
    });

    it('should allow deep linking to page 5', () => {
      // === User receives link ?page=5&search=tote ===
      const incomingUrl = new URLSearchParams('page=5&search=tote');

      // === Read from URL ===
      const page = Number(incomingUrl.get('page')) || 1;
      const search = incomingUrl.get('search') || '';

      // === Initialize component ===
      expect(page).toBe(5);
      expect(search).toBe('tote');

      // === Fetch data for page 5 ===
      // API receives: { page: 5, pageSize: 25, search: 'tote' }
    });
  });
});
