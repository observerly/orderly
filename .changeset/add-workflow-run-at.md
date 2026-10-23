---
'@observerly/orderly': minor
---

Add `run(env, params, { at, id })` to defineWorkflow(): hold a Workflow's run in its queue until an instant, rounded up to the next whole second, and resolve with the instance's id as soon as the run is queued. The queue is selected with the new `queue` option, and carries an Envelope of the id and the parsed params. A bad id, an invalid Date, or a contract with no queue is refused before the params are parsed. Add the Envelope type.
