/**
 * Unit tests for the pure helpers behind PickerTypeahead.
 *
 * Pure functions, no DOM, no Svelte component testing — runs under the
 * `frontend-unit` Vitest project (Node env). Covers each helper across
 * its decision branches so the §4.12 contract is locked in:
 *   - URL building emits canonical `?search=&limit=&page=1` and skips
 *     empty filter values (R5 alignment)
 *   - Default formatter falls back to email when both names absent
 *   - Selection mutations preserve referential equality on no-op paths
 *     (so Svelte 5 reactivity doesn't churn the chip list)
 *   - Multi-mode suggestion filter hides already-selected options
 *   - Debounce factory collapses bursts into a single invocation
 *
 * @see docs/FEAT_SERVER_DRIVEN_PAGINATION_MASTERPLAN.md §4.12
 */
import { describe, expect, it, vi } from 'vitest';

import {
  addToSelected,
  buildPickerSearchQuery,
  createDebouncedFunction,
  defaultFormatOption,
  filterSuggestions,
  isOptionSelected,
  mapToPickerOption,
  removeFromSelected,
  type PickerOption,
  type PickerUserRecord,
} from './picker-typeahead-helpers';

// ─── Test fixtures ──────────────────────────────────────────────────────────

const SAMPLE_UUID = '01900000-0000-7000-8000-000000000001';
const SAMPLE_EMAIL = 'alice@example.com';

function makeUser(overrides: Partial<PickerUserRecord> = {}): PickerUserRecord {
  return {
    id: 1,
    uuid: SAMPLE_UUID,
    firstName: 'Alice',
    lastName: 'Mueller',
    email: SAMPLE_EMAIL,
    position: 'area_lead',
    role: 'admin',
    ...overrides,
  };
}

function makeOption(id: number, label = `User ${id}`): PickerOption {
  return {
    id,
    label,
    raw: makeUser({ id }),
  };
}

// ─── defaultFormatOption ────────────────────────────────────────────────────

describe('defaultFormatOption', () => {
  it('returns "FirstName LastName" + email sublabel when both names set', () => {
    const result = defaultFormatOption(makeUser());
    expect(result).toEqual({ label: 'Alice Mueller', sublabel: SAMPLE_EMAIL });
  });

  it('trims whitespace in names', () => {
    const result = defaultFormatOption(makeUser({ firstName: ' Alice ', lastName: ' Mueller ' }));
    expect(result.label).toBe('Alice Mueller');
  });

  it('falls back to email when both names null', () => {
    const result = defaultFormatOption(
      makeUser({ firstName: null, lastName: null, email: 'x@y.com' }),
    );
    expect(result).toEqual({ label: 'x@y.com' });
    expect(result.sublabel).toBeUndefined();
  });

  it('falls back to email when both names empty strings', () => {
    const result = defaultFormatOption(makeUser({ firstName: '', lastName: '', email: 'x@y.com' }));
    expect(result.label).toBe('x@y.com');
    expect(result.sublabel).toBeUndefined();
  });

  it('uses only last name when first is null', () => {
    const result = defaultFormatOption(makeUser({ firstName: null }));
    expect(result.label).toBe('Mueller');
    expect(result.sublabel).toBe(SAMPLE_EMAIL);
  });

  it('uses only first name when last is null', () => {
    const result = defaultFormatOption(makeUser({ lastName: null }));
    expect(result.label).toBe('Alice');
    expect(result.sublabel).toBe(SAMPLE_EMAIL);
  });
});

// ─── mapToPickerOption ──────────────────────────────────────────────────────

describe('mapToPickerOption', () => {
  it('uses defaultFormatOption when no formatter passed', () => {
    const opt = mapToPickerOption(makeUser());
    expect(opt.id).toBe(1);
    expect(opt.label).toBe('Alice Mueller');
    expect(opt.sublabel).toBe(SAMPLE_EMAIL);
    expect(opt.raw.email).toBe(SAMPLE_EMAIL);
  });

  it('applies custom formatter and preserves raw record', () => {
    const opt = mapToPickerOption(makeUser({ id: 7, role: 'root' }), (raw) => ({
      label: `${raw.firstName ?? ''} (${raw.role ?? '?'})`,
    }));
    expect(opt.id).toBe(7);
    expect(opt.label).toBe('Alice (root)');
    expect(opt.sublabel).toBeUndefined();
    expect(opt.raw.role).toBe('root');
  });

  it('omits sublabel key when formatter returns undefined sublabel', () => {
    const opt = mapToPickerOption(makeUser(), () => ({ label: 'X' }));
    expect('sublabel' in opt).toBe(false);
  });
});

// ─── buildPickerSearchQuery ─────────────────────────────────────────────────

describe('buildPickerSearchQuery', () => {
  it('emits search + page=1 + limit when term non-empty', () => {
    const qs = buildPickerSearchQuery('alice', {}, 20);
    const params = new URLSearchParams(qs);
    expect(params.get('search')).toBe('alice');
    expect(params.get('limit')).toBe('20');
    expect(params.get('page')).toBe('1');
  });

  it('skips search key entirely when term is empty', () => {
    const qs = buildPickerSearchQuery('', {}, 20);
    const params = new URLSearchParams(qs);
    expect(params.has('search')).toBe(false);
    expect(params.get('limit')).toBe('20');
  });

  it('skips search key when term is only whitespace', () => {
    const qs = buildPickerSearchQuery('   \t  ', {}, 20);
    const params = new URLSearchParams(qs);
    expect(params.has('search')).toBe(false);
  });

  it('trims surrounding whitespace before emitting search', () => {
    const qs = buildPickerSearchQuery('  alice  ', {}, 20);
    expect(new URLSearchParams(qs).get('search')).toBe('alice');
  });

  it('forwards baseParams (role, position, isActive) verbatim', () => {
    const qs = buildPickerSearchQuery(
      '',
      { role: 'admin', position: 'area_lead', isActive: '1' },
      20,
    );
    const params = new URLSearchParams(qs);
    expect(params.get('role')).toBe('admin');
    expect(params.get('position')).toBe('area_lead');
    expect(params.get('isActive')).toBe('1');
  });

  it('skips empty-string baseParam values (R5 — clean URLs)', () => {
    const qs = buildPickerSearchQuery('', { role: 'admin', position: '', isActive: '1' }, 20);
    const params = new URLSearchParams(qs);
    expect(params.has('position')).toBe(false);
    expect(params.get('role')).toBe('admin');
    expect(params.get('isActive')).toBe('1');
  });

  it('respects custom pageSize', () => {
    const qs = buildPickerSearchQuery('a', {}, 50);
    expect(new URLSearchParams(qs).get('limit')).toBe('50');
  });

  it('always emits page=1 (typeahead never paginates beyond first page)', () => {
    const qs = buildPickerSearchQuery('a', {}, 20);
    expect(new URLSearchParams(qs).get('page')).toBe('1');
  });
});

// ─── addToSelected ──────────────────────────────────────────────────────────

describe('addToSelected', () => {
  it('appends a new option', () => {
    const result = addToSelected([makeOption(1)], makeOption(2));
    expect(result.map((o) => o.id)).toEqual([1, 2]);
  });

  it('returns same reference when id already present (no-op for reactivity)', () => {
    const initial = [makeOption(1), makeOption(2)];
    const result = addToSelected(initial, makeOption(1));
    expect(result).toBe(initial);
  });

  it('returns same reference when maxSelected reached', () => {
    const initial = [makeOption(1), makeOption(2)];
    const result = addToSelected(initial, makeOption(3), 2);
    expect(result).toBe(initial);
  });

  it('appends when below maxSelected', () => {
    const result = addToSelected([makeOption(1)], makeOption(2), 3);
    expect(result.map((o) => o.id)).toEqual([1, 2]);
  });

  it('returns fresh array (not the input) when appending — triggers Svelte reactivity', () => {
    const initial = [makeOption(1)];
    const result = addToSelected(initial, makeOption(2));
    expect(result).not.toBe(initial);
  });
});

// ─── removeFromSelected ─────────────────────────────────────────────────────

describe('removeFromSelected', () => {
  it('removes the matching id', () => {
    const result = removeFromSelected([makeOption(1), makeOption(2), makeOption(3)], 2);
    expect(result.map((o) => o.id)).toEqual([1, 3]);
  });

  it('returns same reference when id not present', () => {
    const initial = [makeOption(1), makeOption(2)];
    const result = removeFromSelected(initial, 99);
    expect(result).toBe(initial);
  });

  it('returns empty array when removing the only entry', () => {
    const result = removeFromSelected([makeOption(1)], 1);
    expect(result).toEqual([]);
  });
});

// ─── isOptionSelected ───────────────────────────────────────────────────────

describe('isOptionSelected', () => {
  it('returns false for null value', () => {
    expect(isOptionSelected(null, 1)).toBe(false);
  });

  it('matches single-mode value by id', () => {
    expect(isOptionSelected(makeOption(7), 7)).toBe(true);
    expect(isOptionSelected(makeOption(7), 8)).toBe(false);
  });

  it('matches multi-mode value by id', () => {
    const arr = [makeOption(1), makeOption(2), makeOption(3)];
    expect(isOptionSelected(arr, 2)).toBe(true);
    expect(isOptionSelected(arr, 99)).toBe(false);
  });

  it('returns false on empty multi-mode array', () => {
    expect(isOptionSelected([], 1)).toBe(false);
  });
});

// ─── filterSuggestions ──────────────────────────────────────────────────────

describe('filterSuggestions', () => {
  const fetched = [makeOption(1), makeOption(2), makeOption(3)];

  it('returns full list in single mode regardless of value', () => {
    expect(filterSuggestions(fetched, makeOption(2), false)).toEqual(fetched);
    expect(filterSuggestions(fetched, null, false)).toEqual(fetched);
  });

  it('filters out already-selected options in multi mode', () => {
    const selected = [makeOption(2)];
    const result = filterSuggestions(fetched, selected, true);
    expect(result.map((o) => o.id)).toEqual([1, 3]);
  });

  it('returns full list in multi mode when value is null', () => {
    expect(filterSuggestions(fetched, null, true)).toEqual(fetched);
  });

  it('returns full list in multi mode when value is empty array', () => {
    expect(filterSuggestions(fetched, [], true)).toEqual(fetched);
  });

  it('returns empty result when every fetched option is already selected', () => {
    const result = filterSuggestions(fetched, [makeOption(1), makeOption(2), makeOption(3)], true);
    expect(result).toEqual([]);
  });
});

// ─── createDebouncedFunction — basic behaviour ──────────────────────────────

describe('createDebouncedFunction (timing)', () => {
  it('invokes the wrapped fn once after delay for a single call', () => {
    vi.useFakeTimers();
    const fn = vi.fn<(s: string) => void>();
    const debounced = createDebouncedFunction(fn, 100);

    debounced.call('a');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');

    vi.useRealTimers();
  });

  it('collapses a burst of calls into a single invocation with the latest args', () => {
    vi.useFakeTimers();
    const fn = vi.fn<(s: string) => void>();
    const debounced = createDebouncedFunction(fn, 250);

    debounced.call('a');
    vi.advanceTimersByTime(100);
    debounced.call('al');
    vi.advanceTimersByTime(100);
    debounced.call('ali');
    vi.advanceTimersByTime(250);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('ali');

    vi.useRealTimers();
  });
});

// ─── createDebouncedFunction — cancel + reuse ──────────────────────────────

describe('createDebouncedFunction (cancel)', () => {
  it('cancel() prevents a pending invocation from firing', () => {
    vi.useFakeTimers();
    const fn = vi.fn<(s: string) => void>();
    const debounced = createDebouncedFunction(fn, 100);

    debounced.call('a');
    debounced.cancel();
    vi.advanceTimersByTime(500);

    expect(fn).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('cancel() is a no-op when nothing is pending', () => {
    vi.useFakeTimers();
    const fn = vi.fn<() => void>();
    const debounced = createDebouncedFunction(fn, 100);

    expect(() => {
      debounced.cancel();
    }).not.toThrow();

    vi.useRealTimers();
  });

  it('a fresh call after cancel still works', () => {
    vi.useFakeTimers();
    const fn = vi.fn<(s: string) => void>();
    const debounced = createDebouncedFunction(fn, 100);

    debounced.call('a');
    debounced.cancel();
    debounced.call('b');
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');

    vi.useRealTimers();
  });

  it('preserves the wrapped fn argument tuple type (compile-time)', () => {
    // Compile-time check — the test passes if it type-checks. The
    // generic signature must accept a multi-arg function and route
    // arguments through unchanged.
    const fn = vi.fn<(a: number, b: string) => void>();
    const debounced = createDebouncedFunction(fn, 50);
    debounced.call(1, 'x');
    expect(true).toBe(true);
  });
});
