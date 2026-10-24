/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly/workflows
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import type { BodySchema, CreateConsumerOptions } from '../consumer/index';

import { parseBody } from '../consumer/validation';

import { createProducer } from '../queues/index';

import { consumeEnvelopes } from './consumer';

import type { Envelope } from './envelope';

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
  // Selects the queue a run given an instant is held in until then. The queue belongs to the Workflow: it carries
  // the Workflow's envelopes and nothing else. NoInfer keeps it from deciding the params, as for the binding.
  // Absent means the Workflow can only be run now.
  queue?: (env: Env) => Queue<NoInfer<Envelope<Params>>>;
}

/*****************************************************************************************************************/

export interface RunOptions {
  // The instance's id. A run by an id that has already started starts nothing, so an id derived from what the
  // run is for makes it happen once. Absent means a fresh UUID.
  readonly id?: string;
  // The instant to start the run at, rounded up to the next whole second. The run is held in the Workflow's
  // queue until then, so it can lie no further away than a queue holds a message back. Absent means now.
  readonly at?: Date;
}

/*****************************************************************************************************************/

export interface WorkflowContract<Params, Env = Cloudflare.Env> {
  // The name the contract was defined with.
  readonly name: string;
  // Starts the Workflow now, and resolves with the id of the instance it started; or, given an instant, holds the
  // run in the Workflow's queue until then, and resolves with the id the instance will be started by as soon as
  // the run is queued. Every refusal rejects. The options carry a Date, whose setters are what make them a mutable
  // type; they are read and never written.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  run: (env: Env, params: Params, options?: RunOptions) => Promise<string>;
  // The handler for the Workflow's queue, for the queue slot of the Worker's default export. Each envelope starts
  // one instance by its id, and never a second. The envelope schema and the handler are the contract's own,
  // which is why these options cannot carry either. Throws for a contract with no queue.
  consumer: (
    // The options carry a retry policy, middleware and observers, which are read and never written.
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
    options: Omit<CreateConsumerOptions<Envelope<Params>>, 'handle' | 'schema'>,
    // The batch is the platform's own type, read and never written: its messages' methods are what make it mutable.
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  ) => (batch: MessageBatch, env: Env) => Promise<void>;
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

// The instant a run is held until, as milliseconds. Read before anything is awaited, so an invalid Date is
// refused before the params are parsed, and so the caller's Date is never held across that parse: a Date is
// mutable, and one changed while the params were being validated must not change what was asked for.
// A Date's setters are what make it a mutable type; it is read once here and never written.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types
const instantOf = (at: Date): number => {
  const instant = at.getTime();

  if (Number.isNaN(instant)) {
    throw new RangeError('run() requires a valid Date to run at');
  }

  return instant;
};

/*****************************************************************************************************************/

// The params a run starts with: parsed by the schema when there is one, and passed through as given when not.
const parseParams = async <Params>(
  // The schema is read and never written; readonly all the way down would ask the same of its own Standard Schema
  // properties, which are the schema library's concern.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  schema: BodySchema<Params> | undefined,
  params: Params,
): Promise<Params> => {
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

/*****************************************************************************************************************/

// The shared contract: a Workflow's params and their schema declared once, and the run started from it, now or
// at an instant. The Workflow class itself stays the platform's own WorkflowEntrypoint, typed with WorkflowParams.
export const defineWorkflow = <Params, Env = Cloudflare.Env>(
  // The options carry a schema and a selector, which are read and never written; readonly all the way down would
  // ask the same of the schema's own Standard Schema properties, which are the schema library's concern.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  options: DefineWorkflowOptions<Params, Env>,
): WorkflowContract<Params, Env> => {
  const { name, schema, workflow, queue } = options;

  return {
    name,
    // The run options carry a Date, whose setters are what make them a mutable type; they are read, never written.
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
    run: async (env, params, runOptions) => {
      // The id and the binding are settled before anything is awaited, so a bad id or a selector that throws is
      // refused before the schema is ever consulted.
      const id = instanceIdOf(runOptions?.id);

      if (runOptions?.at === undefined) {
        const binding = workflow(env);

        return startInstance(binding, id, await parseParams(schema, params));
      }

      // The same holds for the instant and the queue: an invalid Date, a contract with no queue to hold the run
      // in, or a selector that throws is refused before the schema is consulted.
      const instant = instantOf(runOptions.at);

      if (queue === undefined) {
        throw new RangeError(`the ${name} Workflow has no queue to hold a run until an instant`);
      }

      const producer = createProducer(queue(env));

      // The producer rounds the delay up, reading the clock as the envelope is handed over, and refuses an
      // instant further away than a queue holds a message back. No content type is given, so the queue's own
      // default carries the params, and a Date in them arrives as a Date.
      await producer.send(
        { id, params: await parseParams(schema, params) },
        { at: new Date(instant) },
      );

      return id;
    },
    consumer: consumerOptions => consumeEnvelopes(options, consumerOptions),
  };
};

/*****************************************************************************************************************/
