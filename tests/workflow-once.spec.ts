/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { env } from 'cloudflare:workers';

import { describe, expect, it } from 'vitest';

import { defineWorkflow } from '../src/index';

import { settled } from './fixtures/settled';

import { echoing, type Existing, stubbed } from './fixtures/workflow';

/*****************************************************************************************************************/

const echo = defineWorkflow({ name: 'echo', workflow: echoing });

/*****************************************************************************************************************/

// What production does with a create by an id that already exists: the platform's types say it throws.
const duplicate = new Error('instance.already_exists');

/*****************************************************************************************************************/

describe('defineWorkflow runs by an id once', () => {
  it('starts nothing for a run by an id already started, and keeps the first params', async () => {
    await expect(echo.run(env, { first: 1 }, { id: 'once' })).resolves.toBe('once');

    await expect(echo.run(env, { second: 'two' }, { id: 'once' })).resolves.toBe('once');

    await expect(settled(await env.ECHO.get('once'))).resolves.toMatchObject({
      status: 'complete',
      output: { seen: { first: 'number' } },
    });
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow after a refused create', () => {
  it.each<[string, Existing]>([
    ['running', 'running'],
    ['complete', 'complete'],
    ['errored', 'errored'],
  ])('resolves with the id when an instance %s stands behind it', async (_, existing) => {
    const { binding } = stubbed({ refusal: duplicate, existing });

    const contract = defineWorkflow({ name: 'closedown', workflow: () => binding });

    await expect(contract.run(env, { observatory: 'greenwich' }, { id: 'taken' })).resolves.toBe(
      'taken',
    );
  });

  it.each<[string, Existing]>([
    ['no instance stands behind the id', 'missing'],
    ['the instance reads unknown', 'unknown'],
    ['the status cannot be read', 'status throws'],
  ])('rejects with the original error when %s', async (_, existing) => {
    const refusal = new Error('the platform refused');

    const { binding } = stubbed({ refusal, existing });

    const contract = defineWorkflow({ name: 'closedown', workflow: () => binding });

    await expect(contract.run(env, { observatory: 'greenwich' })).rejects.toBe(refusal);
  });
});

/*****************************************************************************************************************/
