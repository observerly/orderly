/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { env } from 'cloudflare:workers';

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type DefineWorkflowOptions,
  defineWorkflow,
  type Envelope,
  type RunOptions,
  type WorkflowContract,
} from '../src/index';

import {
  type Closedown,
  closedown,
  echoing,
  queued,
  recording,
  watched,
} from './fixtures/workflow';

/*****************************************************************************************************************/

// An instant a minute from now, comfortably within what a queue holds a message back.
const soon = () => new Date(Date.now() + 60_000);

/*****************************************************************************************************************/

describe('defineWorkflow refuses an id for a run at an instant before the schema is consulted', () => {
  it.each([
    ['the empty string', ''],
    ['a leading hyphen', '-greenwich'],
    ['a colon', 'greenwich:sunrise'],
    ['101 characters', 'x'.repeat(101)],
  ])('refuses %s as an id, and queues nothing', async (_, id) => {
    const { queue, sends } = recording();

    const { schema, consulted } = watched();

    const contract = defineWorkflow({
      name: 'closedown',
      schema,
      workflow: echoing,
      queue: () => queue,
    });

    await expect(
      contract.run(env, { observatory: 'greenwich' }, { at: soon(), id }),
    ).rejects.toThrow(RangeError);

    expect(consulted).toStrictEqual([]);

    expect(sends).toStrictEqual([]);
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow refuses an instant or a queue before the schema is consulted', () => {
  it('refuses an invalid Date, and queues nothing', async () => {
    const { queue, sends } = recording();

    const { schema, consulted } = watched();

    const contract = defineWorkflow({
      name: 'closedown',
      schema,
      workflow: echoing,
      queue: () => queue,
    });

    await expect(
      contract.run(env, { observatory: 'greenwich' }, { at: new Date(Number.NaN) }),
    ).rejects.toThrow(new RangeError('run() requires a valid Date to run at'));

    expect(consulted).toStrictEqual([]);

    expect(sends).toStrictEqual([]);
  });

  it('refuses a contract with no queue, naming the contract', async () => {
    const { schema, consulted } = watched();

    const contract = defineWorkflow({ name: 'closedown', schema, workflow: echoing });

    await expect(contract.run(env, { observatory: 'greenwich' }, { at: soon() })).rejects.toThrow(
      new RangeError('the closedown Workflow has no queue to hold a run until an instant'),
    );

    expect(consulted).toStrictEqual([]);
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow refuses a selector or params before queueing a run', () => {
  it('refuses a queue selector that throws', async () => {
    const { schema, consulted } = watched();

    const contract = defineWorkflow<Closedown>({
      name: 'closedown',
      schema,
      workflow: echoing,
      queue: () => {
        throw new Error('no such queue');
      },
    });

    await expect(contract.run(env, { observatory: 'greenwich' }, { at: soon() })).rejects.toThrow(
      'no such queue',
    );

    expect(consulted).toStrictEqual([]);
  });

  it('queues nothing for params that fail the schema, with the issues as the cause', async () => {
    const { queue, sends } = recording();

    const contract = defineWorkflow({
      name: 'closedown',
      schema: closedown,
      workflow: echoing,
      queue: () => queue,
    });

    const error: unknown = await contract
      .run(env, { observatory: '  ' }, { at: soon() })
      .catch((reason: unknown) => reason);

    expect(error).toHaveProperty('message', 'the params failed validation and no run was started');

    expect(error).toHaveProperty('cause', [{ message: 'observatory must name an observatory' }]);

    expect(sends).toStrictEqual([]);
  });
});

/*****************************************************************************************************************/

type Selector = NonNullable<DefineWorkflowOptions<Closedown>['queue']>;

/*****************************************************************************************************************/

describe('defineWorkflow types a run at an instant', () => {
  it('carries an id and the params in the envelope', () => {
    expectTypeOf<Envelope<Closedown>>().toEqualTypeOf<{ id: string; params: Closedown }>();
  });

  it('takes the instant as a Date', () => {
    expectTypeOf<RunOptions['at']>().toEqualTypeOf<Date | undefined>();
  });

  it('accepts a queue with unknown bodies, as `wrangler types` writes one, without widening the params', () => {
    expectTypeOf<() => Cloudflare.Env['QUEUE']>().toExtend<Selector>();

    const contract = defineWorkflow({
      name: 'closedown',
      schema: closedown,
      workflow: echoing,
      queue: queued,
    });

    expectTypeOf(contract).toEqualTypeOf<WorkflowContract<Closedown>>();
  });

  it('accepts a queue of the envelope itself', () => {
    expectTypeOf<() => Queue<Envelope<Closedown>>>().toExtend<Selector>();
  });

  it('refuses a queue of bodies unrelated to the envelope', () => {
    expectTypeOf<() => Queue<string>>().not.toExtend<Selector>();

    expectTypeOf<() => Queue<{ id: number }>>().not.toExtend<Selector>();
  });
});

/*****************************************************************************************************************/
