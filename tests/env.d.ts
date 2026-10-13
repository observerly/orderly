/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

// orderly owns no bindings, so there is no `wrangler types` output to extend.
// @cloudflare/workers-types declares an empty Cloudflare.Env for projects to
// redeclare, and TypeScript merges the declarations. This describes the
// bindings declared in wrangler.jsonc so the harness is typed without inventing
// a Worker for the library to own.
declare namespace Cloudflare {
  interface Env {
    QUEUE: Queue;
    // Parameterised by the class, so a stub exposes the object's own methods
    // rather than an opaque fetcher. The type is imported inline rather than at
    // the top of the file: a top level import would make this a module, and the
    // Cloudflare namespace augmentation would stop being global.
    RUN: DurableObjectNamespace<import('./fixtures/worker').Run>;
    // Left with unknown params, exactly as `wrangler types` writes a Workflow
    // binding, so the harness meets the same binding type a project would.
    ECHO: Workflow;
  }
}

/*****************************************************************************************************************/
