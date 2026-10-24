/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { env } from 'cloudflare:workers';

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  defineWorkflow,
  type Envelope,
  type Event,
  type RetryDecision,
  withFixedRetryBackoff,
  withoutRetry,
} from '../src/index';

import {
  type Closedown,
  closedown,
  delivered,
  echoing,
  queued,
  settlementsOf,
  stubbed,
} from './fixtures/workflow';

/*****************************************************************************************************************/

// A rejection decider that records each error it is handed and discards the message.
const recordingRejections = () => {
  const errors: unknown[] = [];

  // The rejection is read and never written.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  const onRejected = ({ error }: { error: unknown }): RetryDecision => {
    errors.push(error);

    return { action: 'discard', reason: 'not a closedown' };
  };

  return { errors, onRejected };
};

/*****************************************************************************************************************/

describe('defineWorkflow rejects anything on its queue that is not an envelope', () => {
  it.each([
    ['a string', 'greenwich'],
    ['null', null],
    ['an array', [{ id: 'greenwich', params: {} }]],
    ['a class instance', new Map([['id', 'greenwich']])],
    ['an envelope with no id', { params: { observatory: 'greenwich' } }],
    [
      'an envelope with a bad id',
      { id: 'greenwich:sunrise', params: { observatory: 'greenwich' } },
    ],
    ['an envelope with no params', { id: 'greenwich' }],
    // The body is handed to the batch as given, read and never written.
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  ])('rejects %s, starting nothing', async (_, body) => {
    const { binding, created } = stubbed();

    const events: Event['type'][] = [];

    const contract = defineWorkflow<Closedown>({
      name: 'closedown',
      workflow: () => binding,
      queue: queued,
    });

    const batch = delivered([body]);

    // The event is read and never written.
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
    await contract.consumer({ retry: withoutRetry(), onEvent: event => events.push(event.type) })(
      batch,
      env,
    );

    expect(events).toContain('message.rejected');

    await expect(settlementsOf(batch)).resolves.toStrictEqual({
      acknowledged: ['message-0'],
      retried: [],
    });

    expect(created).toStrictEqual([]);
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow rejects an envelope whose params fail the schema', () => {
  it('hands the rejection the issues, moved under the params, and starts nothing', async () => {
    const { binding, created } = stubbed();

    const { errors, onRejected } = recordingRejections();

    const contract = defineWorkflow({
      name: 'closedown',
      schema: closedown,
      workflow: () => binding,
      queue: queued,
    });

    await contract.consumer({ retry: withoutRetry(), onRejected })(
      delivered([{ id: 'greenwich', params: { observatory: '  ' } }]),
      env,
    );

    expect(errors).toStrictEqual([
      [{ message: 'observatory must name an observatory', path: ['params'] }],
    ]);

    expect(created).toStrictEqual([]);
  });

  it('reports a schema that throws as one issue at the params', async () => {
    const { errors, onRejected } = recordingRejections();

    const contract = defineWorkflow({
      name: 'closedown',
      schema: (): Closedown => {
        throw new Error('no observatory');
      },
      workflow: echoing,
      queue: queued,
    });

    await contract.consumer({ retry: withoutRetry(), onRejected })(
      delivered([{ id: 'greenwich', params: {} }]),
      env,
    );

    expect(errors).toStrictEqual([[{ message: 'no observatory', path: ['params'] }]]);
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow retries a start the platform refuses', () => {
  it('hands a refused create with no instance behind it to the retry policy', async () => {
    const { binding } = stubbed({ refusal: new Error('the platform refused') });

    const events: Event[] = [];

    const contract = defineWorkflow({ name: 'closedown', workflow: () => binding, queue: queued });

    const batch = delivered([{ id: 'greenwich', params: { observatory: 'greenwich' } }]);

    await contract.consumer({
      retry: withFixedRetryBackoff({ delaySeconds: 30, limit: 3 }),
      // The event is read and never written.
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
      onEvent: event => events.push(event),
    })(batch, env);

    await expect(settlementsOf(batch)).resolves.toStrictEqual({
      acknowledged: [],
      retried: ['message-0'],
    });

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'message.retried', delaySeconds: 30 }),
    );
  });

  it('refuses to build a consumer for a contract with no queue, naming the contract', () => {
    const contract = defineWorkflow({ name: 'closedown', workflow: echoing });

    expect(() => contract.consumer({ retry: withoutRetry() })).toThrow(
      new RangeError('the closedown Workflow has no queue to consume'),
    );
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow types its consumer', () => {
  const contract = defineWorkflow({
    name: 'closedown',
    schema: closedown,
    workflow: echoing,
    queue: queued,
  });

  type Options = Parameters<typeof contract.consumer>[0];

  it('fits the queue slot of the Worker default export', () => {
    expectTypeOf(contract.consumer).returns.toExtend<
      NonNullable<ExportedHandler<Cloudflare.Env>['queue']>
    >();
  });

  it("takes a project's own environment", () => {
    interface ProjectEnv {
      CLOSEDOWN: Workflow;
      CLOSEDOWNS: Queue;
    }

    const project = defineWorkflow<Closedown, ProjectEnv>({
      name: 'closedown',
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
      workflow: bindings => bindings.CLOSEDOWN,
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
      queue: bindings => bindings.CLOSEDOWNS,
    });

    expectTypeOf(project.consumer).returns.toExtend<
      NonNullable<ExportedHandler<ProjectEnv>['queue']>
    >();
  });

  it('carries neither a handler nor a schema in its options', () => {
    expectTypeOf<Options>().not.toHaveProperty('handle');

    expectTypeOf<Options>().not.toHaveProperty('schema');
  });

  it('hands the middleware the envelope', () => {
    expectTypeOf<NonNullable<Options['use']>[number]>()
      .parameter(0)
      .toEqualTypeOf<Envelope<Closedown>>();
  });
});

/*****************************************************************************************************************/
