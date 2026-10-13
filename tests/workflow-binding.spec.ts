/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { env } from 'cloudflare:workers';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { settled } from './fixtures/settled';

/*****************************************************************************************************************/

// What these specs pin is the real binding, as the local engine runs it, rather than anything orderly does: the
// facts the Workflows module is built on, so a change in the engine shows here first, by name.

/*****************************************************************************************************************/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/*****************************************************************************************************************/

describe('the Workflow binding', () => {
  it('creates an instance and runs it to completion', async () => {
    const instance = await env.ECHO.create({ params: { observatory: 'greenwich' } });

    await expect(settled(instance)).resolves.toMatchObject({
      status: 'complete',
      output: { seen: { observatory: 'string' } },
    });
  });

  it('mints a version 4 UUID for an instance created without an id', async () => {
    const instance = await env.ECHO.create({ params: {} });

    expect(instance.id).toMatch(UUID);
  });

  it('carries a Date into the instance as a Date, by structured clone', async () => {
    const instance = await env.ECHO.create({ params: { at: new Date(), count: 1 } });

    await expect(settled(instance)).resolves.toMatchObject({
      output: { seen: { at: 'Date', count: 'number' } },
    });
  });
});

/*****************************************************************************************************************/

describe('the Workflow binding reading instance ids', () => {
  it.each([
    ['a single letter', 'a'],
    ['a leading underscore', '_a'],
    ['a trailing hyphen', 'a-'],
    ['letters, digits, hyphens and underscores', 'Greenwich_2026-01-15'],
    ['exactly 100 characters', 'x'.repeat(100)],
    ['a UUID', '638b5fca-be45-4d6c-a699-3d93974a227e'],
  ])('accepts %s', async (_, id) => {
    const instance = await env.ECHO.create({ id, params: {} });

    expect(instance.id).toBe(id);
  });

  it.each([
    ['the empty string', ''],
    ['a leading hyphen', '-a'],
    ['a colon', 'greenwich:sunrise'],
    ['a space', 'greenwich sunrise'],
    ['a dot', 'greenwich.sunrise'],
    ['a letter outside ASCII', 'é'],
    ['101 characters', 'x'.repeat(101)],
  ])('refuses %s', async (_, id) => {
    await expect(env.ECHO.create({ id, params: {} })).rejects.toThrow(
      'Workflow instance has invalid id',
    );
  });
});

/*****************************************************************************************************************/

describe('the Workflow binding finding instances', () => {
  it('finds an instance by its id', async () => {
    await env.ECHO.create({ id: 'found', params: {} });

    const instance = await env.ECHO.get('found');

    expect(instance.id).toBe('found');
  });

  it('refuses an id with no instance behind it', async () => {
    await expect(env.ECHO.get('missing')).rejects.toThrow('instance.not_found');
  });
});

/*****************************************************************************************************************/

// The platform's types say a create by an id that exists throws. The local engine does not: it starts nothing and
// hands back the instance already there, which keeps the params it was first created with.
describe('the Workflow binding creating by an id that exists', () => {
  it('starts nothing while the first instance is still running', async () => {
    const first = await env.ECHO.create({ id: 'running', params: { first: 1 } });

    expect((await first.status()).status).toBe('running');

    const second = await env.ECHO.create({ id: 'running', params: { second: 'two' } });

    expect(second.id).toBe('running');

    await expect(settled(first)).resolves.toMatchObject({ output: { seen: { first: 'number' } } });
  });

  it('starts nothing once the first instance has settled', async () => {
    await settled(await env.ECHO.create({ id: 'settled', params: { first: 1 } }));

    const second = await env.ECHO.create({ id: 'settled', params: { second: 'two' } });

    await expect(settled(second)).resolves.toMatchObject({
      status: 'complete',
      output: { seen: { first: 'number' } },
    });
  });

  it('starts one instance for an id repeated within a batch, keeping the first params', async () => {
    const instances = await env.ECHO.createBatch([
      { id: 'batched', params: { first: 1 } },
      { id: 'batched', params: { second: 'two' } },
    ]);

    expect(instances).toMatchObject([{ id: 'batched' }, { id: 'batched' }]);

    await expect(settled(await env.ECHO.get('batched'))).resolves.toMatchObject({
      output: { seen: { first: 'number' } },
    });
  });
});

/*****************************************************************************************************************/

type Closedown = { observatory: string };

/*****************************************************************************************************************/

// A binding's methods are checked bivariantly, so a binding is accepted where its params are unknown, as
// `wrangler types` writes them, or wider than a schema's, and refused only when they are unrelated to it.
describe('the Workflow binding as a type', () => {
  it('accepts a binding with unknown params where a typed one is wanted', () => {
    expectTypeOf(env.ECHO).toExtend<Workflow<Closedown>>();
  });

  it('accepts a binding whose params are wider', () => {
    expectTypeOf<Workflow<Closedown | null>>().toExtend<Workflow<Closedown>>();

    expectTypeOf<Workflow<object>>().toExtend<Workflow<Closedown>>();
  });

  it('refuses a binding whose params are unrelated', () => {
    expectTypeOf<Workflow<{ telescope: number }>>().not.toExtend<Workflow<Closedown>>();

    expectTypeOf<Workflow<string>>().not.toExtend<Workflow<Closedown>>();
  });
});

/*****************************************************************************************************************/
