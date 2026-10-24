/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly/schedules
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import type { Schedule } from './contract';

/*****************************************************************************************************************/

export interface PreviewOptions {
  // The instant to walk from, exclusive: the first occurrence returned is strictly after it.
  after: Date;
  // How many occurrences to return at most; a schedule that exhausts first returns fewer. Floored, never below
  // zero, and a value that is not finite means none, because a never-exhausting schedule would walk forever.
  // Absent means as many as until allows.
  take?: number;
  // The instant to walk to, inclusive, as between() closes its window: an occurrence exactly here is returned,
  // and none after it. Absent means as many as take allows.
  until?: Date;
}

/*****************************************************************************************************************/

// How many occurrences a walk may return: as many as the close allows when no count was given.
const countOf = (take: number | undefined): number => {
  if (take === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  return Number.isFinite(take) ? Math.max(Math.floor(take), 0) : 0;
};

/*****************************************************************************************************************/

// The instant a walk closes at, as milliseconds, or never when no close was given. Read once, so the walk stays
// pure however the Date it was handed is changed afterwards.
// A Date's setters are what make it a mutable type; it is read once here and never written.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types
const closeOf = (until: Date | undefined): number => {
  if (until === undefined) {
    return Number.POSITIVE_INFINITY;
  }

  const instant = until.getTime();

  if (Number.isNaN(instant)) {
    throw new RangeError('preview() requires a valid until Date');
  }

  return instant;
};

/*****************************************************************************************************************/

// The dry run: walks next() from the instant given, each occurrence becoming the cursor for the one after it,
// until the count is reached or the close is passed, whichever comes first. One of the two is required, because a
// never-exhausting schedule would otherwise walk forever. A schedule whose occurrence fails to advance past its
// cursor is broken, and this is the debugging tool, so it says so loudly rather than looping forever.
export const preview = (schedule: Schedule, options: PreviewOptions): Date[] => {
  const { after, take, until } = options;

  if (Number.isNaN(after.getTime())) {
    throw new RangeError('preview() requires a valid after Date');
  }

  if (take === undefined && until === undefined) {
    throw new RangeError('preview() requires a take, an until, or both, to know where to stop');
  }

  const count = countOf(take);

  const close = closeOf(until);

  const occurrences: Date[] = [];

  let cursor = after;

  while (occurrences.length < count) {
    const occurrence = schedule.next(cursor);

    if (occurrence === null) {
      break;
    }

    if (occurrence.getTime() <= cursor.getTime()) {
      throw new RangeError('preview() was handed a schedule whose occurrences do not advance');
    }

    if (occurrence.getTime() > close) {
      break;
    }

    occurrences.push(occurrence);

    cursor = occurrence;
  }

  return occurrences;
};

/*****************************************************************************************************************/
