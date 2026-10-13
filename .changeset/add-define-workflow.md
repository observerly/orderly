---
'@observerly/orderly': minor
---

Add defineWorkflow(): declare a Cloudflare Workflow's params and schema once, then start it with `run(env, params, { id })`, which validates the params, starts one instance by the id given or a fresh UUID, and resolves with that id. A run by an id that has already started starts nothing. Add the WorkflowParams type to type the Workflow's own WorkflowEntrypoint from the contract.
