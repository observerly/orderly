---
'@observerly/orderly': minor
---

Add `consumer(options)` to defineWorkflow(): the queue handler for a Workflow's queue, which starts one instance per envelope by its id and never a second, so a message delivered again is acknowledged without starting more. Anything on the queue that is not an envelope, or whose params fail the Workflow's schema, is rejected. Every other consumer option keeps working, the retry policy first among them.
