/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { env } from 'cloudflare:workers';

import { describe, expect, it } from 'vitest';

import { defineWorkflow, type Envelope, type Event, withoutRetry } from '../src/index';

import { settled } from './fixtures/settled';

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

// The real binding and the real queue, with no schema, so what the Workflow saw is exactly what was queued.
const echo = defineWorkflow({ name: 'echo', workflow: echoing, queue: queued });

/*****************************************************************************************************************/

describe('defineWorkflow consumes its queue', () => {
  it('starts one instance per envelope, by its id, and acknowledges every message', async () => {
    const batch = delivered([
      { id: 'consumed-observatory', params: { observatory: 'greenwich' } },
      { id: 'consumed-date', params: { at: new Date() } },
    ]);

    await echo.consumer({ retry: withoutRetry() })(batch, env);

    await expect(settlementsOf(batch)).resolves.toStrictEqual({
      acknowledged: ['message-0', 'message-1'],
      retried: [],
    });

    await expect(settled(await env.ECHO.get('consumed-observatory'))).resolves.toMatchObject({
      status: 'complete',
      output: { seen: { observatory: 'string' } },
    });

    await expect(settled(await env.ECHO.get('consumed-date'))).resolves.toMatchObject({
      status: 'complete',
      output: { seen: { at: 'Date' } },
    });
  });

  it('starts nothing more for an envelope delivered again, and acknowledges it', async () => {
    const consumer = echo.consumer({ retry: withoutRetry() });

    await consumer(
      delivered([{ id: 'consumed-again', params: { observatory: 'greenwich' } }]),
      env,
    );

    await settled(await env.ECHO.get('consumed-again'));

    const again = delivered([{ id: 'consumed-again', params: { telescope: 1 } }]);

    await consumer(again, env);

    await expect(settlementsOf(again)).resolves.toStrictEqual({
      acknowledged: ['message-0'],
      retried: [],
    });

    await expect(settled(await env.ECHO.get('consumed-again'))).resolves.toMatchObject({
      output: { seen: { observatory: 'string' } },
    });
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow hands the Workflow each envelope', () => {
  it('creates the instance with the parsed params, by the envelope id', async () => {
    const { binding, created } = stubbed();

    const contract = defineWorkflow({
      name: 'closedown',
      schema: closedown,
      workflow: () => binding,
      queue: queued,
    });

    await contract.consumer({ retry: withoutRetry() })(
      delivered([{ id: 'greenwich', params: { observatory: ' Greenwich ' } }]),
      env,
    );

    expect(created).toStrictEqual([{ id: 'greenwich', params: { observatory: 'greenwich' } }]);
  });

  it('acknowledges an envelope whose create is refused while its instance already stands', async () => {
    const { binding } = stubbed({
      refusal: new Error('instance.already_exists'),
      existing: 'running',
    });

    const contract = defineWorkflow({ name: 'closedown', workflow: () => binding, queue: queued });

    const batch = delivered([{ id: 'greenwich', params: { observatory: 'greenwich' } }]);

    await contract.consumer({ retry: withoutRetry() })(batch, env);

    await expect(settlementsOf(batch)).resolves.toStrictEqual({
      acknowledged: ['message-0'],
      retried: [],
    });
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow selects the Workflow per batch', () => {
  it('hands the selector the environment the batch arrived with', async () => {
    const { binding } = stubbed();

    const selected: unknown[] = [];

    const contract = defineWorkflow<Closedown>({
      name: 'closedown',
      // The environment is read and never written: its bindings are what make it a mutable type.
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
      workflow: bindings => {
        selected.push(bindings);

        return binding;
      },
      queue: queued,
    });

    await contract.consumer({ retry: withoutRetry() })(
      delivered([{ id: 'greenwich', params: { observatory: 'greenwich' } }]),
      env,
    );

    expect(selected).toStrictEqual([env]);
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow keeps every other consumer option working', () => {
  it('runs the middleware around each start and emits the events of a settled message', async () => {
    const { binding } = stubbed();

    const seen: Envelope<Closedown>[] = [];

    const events: Event['type'][] = [];

    const contract = defineWorkflow({
      name: 'closedown',
      schema: closedown,
      workflow: () => binding,
      queue: queued,
    });

    await contract.consumer({
      retry: withoutRetry(),
      concurrency: 1,
      use: [
        // The envelope is the parsed one every middleware is handed, read and never written.
        // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
        (envelope, _, next) => {
          seen.push(envelope);

          return next();
        },
      ],
      // The event is read and never written.
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
      onEvent: event => events.push(event.type),
    })(delivered([{ id: 'greenwich', params: { observatory: 'Greenwich' } }]), env);

    expect(seen).toStrictEqual([{ id: 'greenwich', params: { observatory: 'greenwich' } }]);

    expect(events).toStrictEqual(['batch.received', 'message.started', 'message.succeeded']);
  });
});

/*****************************************************************************************************************/
