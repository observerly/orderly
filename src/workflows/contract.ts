/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly/workflows
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import type { BodySchema } from '../consumer/index';

import { parseBody } from '../consumer/validation';

import { instanceIdOf } from './identity';

import { startInstance } from './start';

/*****************************************************************************************************************/

export interface DefineWorkflowOptions<Params, Env = Cloudflare.Env> {
  // The Workflow's name as declared in the wrangler configuration. Carried as metadata on the contract; nothing
  // is enforced against it at runtime.
  name: string;
  // Validates params before a run is started, and the parsed value is what the Workflow receives. The same
  // schema the consumer takes, so any Standard Schema or a plain parse function plugs in.
  schema?: BodySchema<Params>;
  // Selects the Workflow's binding from the environment a run is given. NoInfer keeps the binding from deciding
  // the params: a binding written by `wrangler types` has unknown params, and would otherwise widen them to
  // unknown, so the schema or the type argument decides them alone.
  workflow: (env: Env) => Workflow<NoInfer<Params>>;
}

/*****************************************************************************************************************/

export interface RunOptions {
  // The instance's id. A run by an id that has already started starts nothing, so an id derived from what the
  // run is for makes it happen once. Absent means a fresh UUID.
  readonly id?: string;
}

/*****************************************************************************************************************/

export interface WorkflowContract<Params, Env = Cloudflare.Env> {
  // The name the contract was defined with.
  readonly name: string;
  // Starts the Workflow now, and resolves with the id of the instance it started. Every refusal rejects.
  run: (env: Env, params: Params, options?: RunOptions) => Promise<string>;
}

/*****************************************************************************************************************/

// The params a contract carries, taken from the contract itself, so the shape is named once in the schema and
// read from the contract everywhere else, the Workflow's entrypoint first among them. Anything that is not a
// contract yields never, and the tuples keep the conditional from distributing, so a contract joined with
// undefined yields never too. The second check is what refuses a union of contracts: params are read from a
// parameter, so inferring them from two contracts yields the intersection of both, which no single contract
// carries, and one contract, one set of params, is the rule.
export type WorkflowParams<Contract> = [Contract] extends [
  WorkflowContract<infer Params, infer Env>,
]
  ? [WorkflowContract<Params, Env>] extends [Contract]
    ? Params
    : never
  : never;

/*****************************************************************************************************************/

// The shared contract: a Workflow's params and their schema declared once, and the run started from it. The
// Workflow class itself stays the platform's own WorkflowEntrypoint, typed with WorkflowParams.
export const defineWorkflow = <Params, Env = Cloudflare.Env>(
  // The options carry a schema and a selector, which are read and never written; readonly all the way down would
  // ask the same of the schema's own Standard Schema properties, which are the schema library's concern.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  options: DefineWorkflowOptions<Params, Env>,
): WorkflowContract<Params, Env> => {
  const { name, schema, workflow } = options;

  const parse = async (params: Params): Promise<Params> => {
    if (schema === undefined) {
      return params;
    }

    const attempt = await parseBody(schema, params);

    if (attempt.parsed) {
      return attempt.value;
    }

    throw new Error('the params failed validation and no run was started', {
      cause: attempt.error,
    });
  };

  return {
    name,
    run: async (env, params, runOptions) => {
      // The id and the binding are settled before anything is awaited, so a bad id or a selector that throws is
      // refused before the schema is ever consulted.
      const id = instanceIdOf(runOptions?.id);

      const binding = workflow(env);

      return startInstance(binding, id, await parse(params));
    },
  };
};

/*****************************************************************************************************************/
