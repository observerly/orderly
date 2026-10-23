/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { env } from 'cloudflare:workers';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineWorkflow, MAXIMUM_DELAY_SECONDS, type StandardSchema } from '../src/index';

import {
  type Closedown,
  closedown,
  echoing,
  queued,
  recording,
  stubbed,
} from './fixtures/workflow';

/*****************************************************************************************************************/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/*****************************************************************************************************************/

// The instant the clock is frozen at while a run is queued, so the delay it computes is exact rather than a
// second short whenever the runner is slow between the test's reading of the clock and the producer's.
const NOW = new Date('2026-01-15T09:00:00Z');

/*****************************************************************************************************************/

beforeEach(() => {
  vi.useFakeTimers();

  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/*****************************************************************************************************************/

describe('defineWorkflow runs at an instant', () => {
  it('queues the parsed params by the id given, rounding the delay up so the run never starts early', async () => {
    const { binding, created } = stubbed();

    const { queue, sends } = recording();

    const contract = defineWorkflow({
      name: 'closedown',
      schema: closedown,
      workflow: () => binding,
      queue: () => queue,
    });

    await expect(
      contract.run(
        env,
        { observatory: ' Greenwich ' },
        { at: new Date(NOW.getTime() + 3_600_500), id: 'greenwich-1768471200500' },
      ),
    ).resolves.toBe('greenwich-1768471200500');

    expect(sends).toStrictEqual([
      {
        body: { id: 'greenwich-1768471200500', params: { observatory: 'greenwich' } },
        options: { delaySeconds: 3601 },
      },
    ]);

    expect(created).toStrictEqual([]);
  });

  it('mints a UUID for a run given no id, and queues the run by it', async () => {
    const { queue, sends } = recording();

    const contract = defineWorkflow({ name: 'closedown', workflow: echoing, queue: () => queue });

    const id = await contract.run(env, { observatory: 'greenwich' }, { at: NOW });

    expect(id).toMatch(UUID);

    expect(sends).toStrictEqual([
      { body: { id, params: { observatory: 'greenwich' } }, options: { delaySeconds: 0 } },
    ]);
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow queues through the platform', () => {
  it('queues the run through the real binding', async () => {
    const contract = defineWorkflow({
      name: 'closedown',
      schema: closedown,
      workflow: echoing,
      queue: queued,
    });

    await expect(
      contract.run(
        env,
        { observatory: 'greenwich' },
        { at: new Date(NOW.getTime() + 60_000), id: 'greenwich-real' },
      ),
    ).resolves.toBe('greenwich-real');
  });

  it('sends the envelope with no content type, so the queue default carries the params', async () => {
    const { queue, sends } = recording();

    const contract = defineWorkflow({ name: 'closedown', workflow: echoing, queue: () => queue });

    await contract.run(env, { observatory: 'greenwich' }, { at: NOW });

    expect(sends[0]?.options).not.toHaveProperty('contentType');
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow holds a run as long as a queue holds a message back', () => {
  it.each([
    ['an instant already passed, at once', NOW.getTime() - 5_000, 0],
    [
      'an instant exactly as far away as a queue holds a message back, at the ceiling',
      NOW.getTime() + MAXIMUM_DELAY_SECONDS * 1000,
      MAXIMUM_DELAY_SECONDS,
    ],
  ])('queues a run for %s', async (_, instant, delaySeconds) => {
    const { queue, sends } = recording();

    const contract = defineWorkflow({ name: 'closedown', workflow: echoing, queue: () => queue });

    await contract.run(env, { observatory: 'greenwich' }, { at: new Date(instant), id: 'held' });

    expect(sends).toStrictEqual([
      { body: { id: 'held', params: { observatory: 'greenwich' } }, options: { delaySeconds } },
    ]);
  });

  it('refuses an instant further away than a queue holds a message back, and queues nothing', async () => {
    const { queue, sends } = recording();

    const contract = defineWorkflow({ name: 'closedown', workflow: echoing, queue: () => queue });

    await expect(
      contract.run(
        env,
        { observatory: 'greenwich' },
        { at: new Date(NOW.getTime() + (MAXIMUM_DELAY_SECONDS + 1) * 1000) },
      ),
    ).rejects.toThrow(RangeError);

    expect(sends).toStrictEqual([]);
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow reads what it is given before it queues a run', () => {
  it('holds to the instant asked for, even when the Date is changed while the params are parsed', async () => {
    const { queue, sends } = recording();

    const at = new Date(NOW.getTime() + 60_000);

    // A schema that moves the caller's Date an hour on as it validates. The instant was read before the parse,
    // so the run must still be held for the minute that was asked for.
    const moving: StandardSchema<unknown, Closedown> = {
      '~standard': {
        ...closedown['~standard'],
        validate: value => {
          at.setTime(at.getTime() + 3_600_000);

          return closedown['~standard'].validate(value);
        },
      },
    };

    const contract = defineWorkflow({
      name: 'closedown',
      schema: moving,
      workflow: echoing,
      queue: () => queue,
    });

    await contract.run(env, { observatory: 'greenwich' }, { at });

    expect(sends[0]?.options).toStrictEqual({ delaySeconds: 60 });
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow selects only the queue for a run at an instant', () => {
  it('hands the queue selector the environment the run was given, and never selects the Workflow', async () => {
    const { queue } = recording();

    const selected: unknown[] = [];

    const contract = defineWorkflow<Closedown>({
      name: 'closedown',
      workflow: () => {
        throw new Error('the Workflow was selected');
      },
      // The environment is read and never written: its bindings are what make it a mutable type.
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
      queue: bindings => {
        selected.push(bindings);

        return queue;
      },
    });

    await contract.run(env, { observatory: 'greenwich' }, { at: NOW });

    expect(selected).toHaveLength(1);

    expect(selected[0]).toBe(env);
  });
});

/*****************************************************************************************************************/
