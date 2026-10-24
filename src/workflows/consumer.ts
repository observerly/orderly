/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly/workflows
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { createConsumer, type CreateConsumerOptions } from '../consumer/index';

import type { DefineWorkflowOptions } from './contract';

import { type Envelope, envelopeSchema } from './envelope';

import { startInstance } from './start';

/*****************************************************************************************************************/

// The queue handler for a Workflow's envelopes: each message is checked against the envelope schema, and starts
// one instance by its id, and never a second, so a message delivered again acknowledges without starting more.
// Every other consumer option, the retry policy first among them, works as it does for any queue. The consumer
// is assembled per batch, because the binding is selected from the environment the batch arrives with.
export const consumeEnvelopes = <Params, Env>(
  // The contract's options carry a schema and selectors, which are read and never written; readonly all the way
  // down would ask the same of the schema's own Standard Schema properties, which are the schema library's concern.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  contract: DefineWorkflowOptions<Params, Env>,
  // The options carry a retry policy, middleware and observers, which are read and never written.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  options: Omit<CreateConsumerOptions<Envelope<Params>>, 'handle' | 'schema'>,
  // The batch is the platform's own type, read and never written: its messages' methods are what make it mutable.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
): ((batch: MessageBatch, env: Env) => Promise<void>) => {
  const { name, schema, workflow, queue } = contract;

  // A consumer without a queue has nothing to consume, so it is refused where the Worker is assembled rather than
  // left to fail on a batch that can never arrive.
  if (queue === undefined) {
    throw new RangeError(`the ${name} Workflow has no queue to consume`);
  }

  const envelope = envelopeSchema(schema);

  // The batch and the environment are the platform's own types, read and never written.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  return (batch, env) =>
    createConsumer<Envelope<Params>>({
      ...options,
      schema: envelope,
      // The envelope is the parsed one, read and never written.
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
      handle: body => startInstance(workflow(env), body.id, body.params),
    })(batch);
};

/*****************************************************************************************************************/
