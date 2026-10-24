/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { describe, expect, expectTypeOf, it } from 'vitest';

import { preview, type PreviewOptions, type Schedule } from '../src/index';

/*****************************************************************************************************************/

// A conforming schedule over a fixed list of instants, as in preview.spec.ts.
const listed = (...instants: readonly number[]): Schedule => {
  return {
    // The cursor is a Date, whose setters are what make it a mutable type; it is read and never written.
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
    next: after => {
      const found = instants.find(instant => instant > after.getTime());

      return found === undefined ? null : new Date(found);
    },
  };
};

// A schedule that never exhausts: every second, forever.
const ticking: Schedule = {
  // The cursor is a Date, whose setters are what make it a mutable type; it is read and never written.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  next: after => new Date(after.getTime() + 1_000),
};

/*****************************************************************************************************************/

describe('preview until an instant', () => {
  it('walks a never-exhausting schedule to the instant given, without a count', () => {
    expect(preview(ticking, { after: new Date(0), until: new Date(5_000) })).toStrictEqual([
      new Date(1_000),
      new Date(2_000),
      new Date(3_000),
      new Date(4_000),
      new Date(5_000),
    ]);
  });

  it('keeps an occurrence exactly at the instant, and none after it', () => {
    const schedule = listed(1_000, 2_000, 3_000, 4_000);

    expect(preview(schedule, { after: new Date(0), until: new Date(3_000) })).toStrictEqual([
      new Date(1_000),
      new Date(2_000),
      new Date(3_000),
    ]);

    expect(preview(schedule, { after: new Date(0), until: new Date(2_500) })).toStrictEqual([
      new Date(1_000),
      new Date(2_000),
    ]);
  });

  it('returns nothing for an instant no later than the one walked from', () => {
    expect(preview(ticking, { after: new Date(5_000), until: new Date(5_000) })).toStrictEqual([]);
  });

  it.each([
    ['the count', 2, 3_000, 2],
    ['the instant', 5, 2_000, 2],
  ])('stops at %s when given both, whichever ends the walk first', (_, take, until, expected) => {
    expect(preview(ticking, { after: new Date(0), take, until: new Date(until) })).toHaveLength(
      expected,
    );
  });
});

/*****************************************************************************************************************/

describe('preview until defensiveness', () => {
  it('refuses a walk with neither a count nor an instant to stop at', () => {
    expect(() => preview(ticking, { after: new Date(0) })).toThrow(
      new RangeError('preview() requires a take, an until, or both, to know where to stop'),
    );
  });

  it('refuses an invalid until Date loudly', () => {
    expect(() => preview(ticking, { after: new Date(0), until: new Date('not a date') })).toThrow(
      new RangeError('preview() requires a valid until Date'),
    );
  });

  it('takes the count and the instant as optional', () => {
    expectTypeOf<PreviewOptions['take']>().toEqualTypeOf<number | undefined>();

    expectTypeOf<PreviewOptions['until']>().toEqualTypeOf<Date | undefined>();
  });
});

/*****************************************************************************************************************/
