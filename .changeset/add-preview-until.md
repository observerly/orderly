---
'@observerly/orderly': minor
---

Add the `until` option to preview(): walk a schedule up to an instant, inclusive, as between() closes its window, with or without a count. `take` is now optional; given both, whichever ends the walk first wins, and given neither, preview() throws a RangeError.
