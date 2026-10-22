/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { env } from 'cloudflare:workers';

import { describe, expect, it } from 'vitest';

import { defineWorkflow } from '../src/index';

import { settled } from './fixtures/settled';

import { type Closedown, closedown, echoing, stubbed, watched } from './fixtures/workflow';

/*****************************************************************************************************************/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/*****************************************************************************************************************/

// The real binding, with no schema, so what the Workflow saw is exactly what the run was given.
const echo = defineWorkflow({ name: 'echo', workflow: echoing });

/*****************************************************************************************************************/

describe('defineWorkflow', () => {
  it('carries the name it was defined with', () => {
    expect(echo.name).toBe('echo');
  });

  it('mints a UUID for a run given no id, naming the instance it started', async () => {
    const id = await echo.run(env, { observatory: 'greenwich' });

    expect(id).toMatch(UUID);

    await expect(settled(await env.ECHO.get(id))).resolves.toMatchObject({ status: 'complete' });
  });

  it.each([
    ['an id', 'greenwich-1768467600000'],
    ['an id of exactly 100 characters', 'x'.repeat(100)],
  ])('starts the instance by %s given', async (_, id) => {
    await expect(echo.run(env, {}, { id })).resolves.toBe(id);

    await expect(settled(await env.ECHO.get(id))).resolves.toMatchObject({ status: 'complete' });
  });

  it('carries a Date into the Workflow as a Date', async () => {
    const id = await echo.run(env, { at: new Date() });

    await expect(settled(await env.ECHO.get(id))).resolves.toMatchObject({
      output: { seen: { at: 'Date' } },
    });
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow hands the Workflow its params', () => {
  it('creates the instance with the parsed params, by the id it resolves with', async () => {
    const { binding, created } = stubbed();

    const contract = defineWorkflow({
      name: 'closedown',
      schema: closedown,
      workflow: () => binding,
    });

    const id = await contract.run(env, { observatory: ' Greenwich ' });

    expect(created).toStrictEqual([{ id, params: { observatory: 'greenwich' } }]);
  });

  it('passes the params through as given when there is no schema', async () => {
    const { binding, created } = stubbed();

    const contract = defineWorkflow({ name: 'closedown', workflow: () => binding });

    await contract.run(env, { observatory: ' Greenwich ' }, { id: 'given' });

    expect(created).toStrictEqual([{ id: 'given', params: { observatory: ' Greenwich ' } }]);
  });

  it('hands the selector the environment the run was given', async () => {
    const { binding } = stubbed();

    const selected: unknown[] = [];

    const contract = defineWorkflow({
      name: 'closedown',
      // The environment is read and never written: its bindings are what make it a mutable type.
      // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
      workflow: bindings => {
        selected.push(bindings);

        return binding;
      },
    });

    await contract.run(env, { observatory: 'greenwich' });

    expect(selected).toHaveLength(1);

    expect(selected[0]).toBe(env);
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow refuses an id before anything else', () => {
  it.each([
    ['the empty string', ''],
    ['a leading hyphen', '-greenwich'],
    ['a colon', 'greenwich:sunrise'],
    ['101 characters', 'x'.repeat(101)],
  ])('refuses %s before the schema is consulted or anything is created', async (_, id) => {
    const { binding, created } = stubbed();

    const { schema, consulted } = watched();

    const contract = defineWorkflow({ name: 'closedown', schema, workflow: () => binding });

    await expect(contract.run(env, { observatory: 'greenwich' }, { id })).rejects.toThrow(
      RangeError,
    );

    expect(consulted).toStrictEqual([]);

    expect(created).toStrictEqual([]);
  });

  it('names the rule an id broke', async () => {
    await expect(echo.run(env, {}, { id: 'greenwich:sunrise' })).rejects.toThrow(
      'a Workflow instance id must match ^[A-Za-z0-9_][A-Za-z0-9_-]*$ and be at most 100 characters long',
    );
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow refuses before starting a run', () => {
  it('creates nothing for params that fail the schema, with the issues as the cause', async () => {
    const { binding, created } = stubbed();

    const contract = defineWorkflow({
      name: 'closedown',
      schema: closedown,
      workflow: () => binding,
    });

    const error: unknown = await contract
      .run(env, { observatory: '  ' })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);

    expect(error).toHaveProperty('message', 'the params failed validation and no run was started');

    expect(error).toHaveProperty('cause', [{ message: 'observatory must name an observatory' }]);

    expect(created).toStrictEqual([]);
  });

  it('refuses a selector that throws before the schema is consulted', async () => {
    const { schema, consulted } = watched();

    const contract = defineWorkflow<Closedown>({
      name: 'closedown',
      schema,
      workflow: () => {
        throw new Error('no such binding');
      },
    });

    await expect(contract.run(env, { observatory: 'greenwich' })).rejects.toThrow(
      'no such binding',
    );

    expect(consulted).toStrictEqual([]);
  });
});

/*****************************************************************************************************************/
