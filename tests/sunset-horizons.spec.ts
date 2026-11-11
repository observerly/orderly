/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { describe, expect, it } from 'vitest';

import { getSunset } from '@observerly/astrometry/sun';

import { preview, sunset, type Observer } from '../src/index';

/*****************************************************************************************************************/

// Inside the Arctic Circle: the almanac has the midnight sun from late May to late July and the polar night
// from late November to mid January, the instants below being astrometry's own for the last sunset before
// each and the first after it.
const TROMSO: Observer = { latitude: 69.6492, longitude: 18.9553 };

/*****************************************************************************************************************/

const LONDON: Observer = { latitude: 51.5074, longitude: -0.1278 };

/*****************************************************************************************************************/

// The furthest instant a Date can hold, in milliseconds from the epoch, either side of it.
const MAXIMUM_INSTANT = 8_640_000_000_000_000;

/*****************************************************************************************************************/

const MILLISECONDS_IN_DAY = 86_400_000;

/*****************************************************************************************************************/

// The sunsets astrometry files under the UTC dates of a run of days, in order, less any before the instant
// the run starts from: the answer a walk from that instant must reproduce.
const sunsetsFiledUnder = (after: Date, days: number, observer: Readonly<Observer>): Date[] => {
  const filed: Date[] = [];

  for (let day = 0; day < days; day += 1) {
    const set = getSunset(new Date(after.getTime() + day * MILLISECONDS_IN_DAY), observer);

    if (set !== null && set.getTime() > after.getTime()) {
      filed.push(set);
    }
  }

  return filed;
};

/*****************************************************************************************************************/

describe('sunset() through polar day and night', () => {
  it('skips the polar day, when the Sun never sets', () => {
    expect(sunset(TROMSO).next(new Date('2026-05-17T22:28:44.868Z'))).toStrictEqual(
      new Date('2026-07-25T22:37:32.514Z'),
    );
  });

  it('skips the polar night, when the Sun never rises', () => {
    expect(sunset(TROMSO).next(new Date('2026-11-27T10:42:15.632Z'))).toStrictEqual(
      new Date('2027-01-15T11:12:52.299Z'),
    );
  });

  it('agrees with astrometry on every sunset of a year', () => {
    const after = new Date('2026-01-01T00:00:00Z');

    const expected = sunsetsFiledUnder(after, 365, TROMSO);

    expect(preview(sunset(TROMSO), { after, take: expected.length })).toStrictEqual(expected);
  });
});

/*****************************************************************************************************************/

describe('sunset() at the ends of time', () => {
  it('exhausts at the end of the range a Date can hold, without asking past it', () => {
    expect(sunset(LONDON).next(new Date(MAXIMUM_INSTANT))).toBeNull();
  });

  it('asks nothing astrometry refuses at the start of the range a Date can hold', () => {
    expect(() => sunset(LONDON).next(new Date(-MAXIMUM_INSTANT))).not.toThrow();
  });

  it('exhausts short of the last day for an observer at the far west, which astrometry refuses', () => {
    // Asked for the last representable day, astrometry throws for any observer more than thirty degrees west
    // of Greenwich, its search for a sunset reaching later than for a sunrise. Asked from midday on the day
    // before, the walk has that day's sunset behind it and the last day ahead, and stops short of asking.
    const west: Observer = { latitude: 0, longitude: -180 };

    expect(sunset(west).next(new Date(MAXIMUM_INSTANT - MILLISECONDS_IN_DAY / 2))).toBeNull();
  });
});

/*****************************************************************************************************************/
