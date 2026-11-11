/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { describe, expect, it } from 'vitest';

import { getSunrise } from '@observerly/astrometry/sun';

import { preview, sunrise, type Observer } from '../src/index';

/*****************************************************************************************************************/

// Inside the Arctic Circle: the almanac has the midnight sun from late May to late July and the polar night
// from late November to mid January, the instants below being astrometry's own for the last sunrise before
// each and the first after it.
const TROMSO: Observer = { latitude: 69.6492, longitude: 18.9553 };

/*****************************************************************************************************************/

// Where astrometry's day-by-day search catches the one sunrise a year in about one year in two: from the
// solstice below, the next it finds is in March 2029, well past the days the walk searches.
const NORTH_POLE: Observer = { latitude: 90, longitude: 0 };

/*****************************************************************************************************************/

const LONDON: Observer = { latitude: 51.5074, longitude: -0.1278 };

/*****************************************************************************************************************/

// The furthest instant a Date can hold, in milliseconds from the epoch, either side of it.
const MAXIMUM_INSTANT = 8_640_000_000_000_000;

/*****************************************************************************************************************/

const MILLISECONDS_IN_DAY = 86_400_000;

/*****************************************************************************************************************/

// The sunrises astrometry files under the UTC dates of a run of days, in order, less any before the instant
// the run starts from: the answer a walk from that instant must reproduce.
const sunrisesFiledUnder = (after: Date, days: number, observer: Readonly<Observer>): Date[] => {
  const filed: Date[] = [];

  for (let day = 0; day < days; day += 1) {
    const rise = getSunrise(new Date(after.getTime() + day * MILLISECONDS_IN_DAY), observer);

    if (rise !== null && rise.getTime() > after.getTime()) {
      filed.push(rise);
    }
  }

  return filed;
};

/*****************************************************************************************************************/

describe('sunrise() through polar day and night', () => {
  it('skips the polar day, when the Sun never sets', () => {
    expect(sunrise(TROMSO).next(new Date('2026-05-17T22:51:33.325Z'))).toStrictEqual(
      new Date('2026-07-25T23:04:47.994Z'),
    );
  });

  it('skips the polar night, when the Sun never rises', () => {
    expect(sunrise(TROMSO).next(new Date('2026-11-27T10:20:32.928Z'))).toStrictEqual(
      new Date('2027-01-15T10:34:49.312Z'),
    );
  });

  it('agrees with astrometry on every sunrise of a year', () => {
    const after = new Date('2026-01-01T00:00:00Z');

    const expected = sunrisesFiledUnder(after, 365, TROMSO);

    expect(preview(sunrise(TROMSO), { after, take: expected.length })).toStrictEqual(expected);
  });

  it('exhausts at the pole, where the next sunrise astrometry finds lies years past the bound', () => {
    expect(sunrise(NORTH_POLE).next(new Date('2026-06-21T00:00:00Z'))).toBeNull();
  });
});

/*****************************************************************************************************************/

describe('sunrise() at the ends of time', () => {
  it('exhausts at the end of the range a Date can hold, without asking past it', () => {
    expect(sunrise(LONDON).next(new Date(MAXIMUM_INSTANT))).toBeNull();
  });

  it('asks nothing of the days astrometry refuses at the start of the range a Date can hold', () => {
    expect(() => sunrise(LONDON).next(new Date(-MAXIMUM_INSTANT))).not.toThrow();
  });

  it('exhausts short of the last day for an observer at the far west, which astrometry refuses', () => {
    // Asked for the last representable day, astrometry throws for an observer this far west: its search for
    // the day's transit leaves the range a Date can hold. A walk keeping one day clear would ask it.
    const west: Observer = { latitude: 0, longitude: -180 };

    expect(sunrise(west).next(new Date(MAXIMUM_INSTANT - MILLISECONDS_IN_DAY - 1))).toBeNull();
  });
});

/*****************************************************************************************************************/
