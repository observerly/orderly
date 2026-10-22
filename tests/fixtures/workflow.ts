/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import type { StandardSchema } from '../../src/index';

/*****************************************************************************************************************/

export type Closedown = { observatory: string };

/*****************************************************************************************************************/

// A conforming schema that trims and lowercases the observatory, standing in for zod and friends, so a test can
// tell the parsed params from the params a run was given. An observatory that trims to nothing is refused.
export const closedown: StandardSchema<unknown, Closedown> = {
  '~standard': {
    version: 1,
    vendor: 'orderly-tests',
    validate: value =>
      typeof value === 'object' &&
      value !== null &&
      'observatory' in value &&
      typeof value.observatory === 'string' &&
      value.observatory.trim() !== ''
        ? { value: { observatory: value.observatory.trim().toLowerCase() } }
        : { issues: [{ message: 'observatory must name an observatory' }] },
  },
};

/*****************************************************************************************************************/

// The closedown schema, counting every time it is consulted, so a test can say a refusal came before it.
export const watched = () => {
  const consulted: unknown[] = [];

  const schema: StandardSchema<unknown, Closedown> = {
    '~standard': {
      ...closedown['~standard'],
      validate: value => {
        consulted.push(value);

        return closedown['~standard'].validate(value);
      },
    },
  };

  return { schema, consulted };
};

/*****************************************************************************************************************/

// What an instance behind an id answers when asked for its status: a status it reads, a status() that throws,
// or no instance behind the id at all.
export type Existing = InstanceStatus['status'] | 'status throws' | 'missing';

/*****************************************************************************************************************/

export interface StubbedOptions {
  // The error create() rejects with. Absent means create() resolves.
  refusal?: Error;
  // What stands behind the id once create() has refused. Absent means no instance at all.
  existing?: Existing;
}

/*****************************************************************************************************************/

// A binding that records what it was created with, and refuses the way it is told to, because what reaches the
// Workflow, and what a refused create does next, is not observable through the real binding.
// The options are read and never written; the refusal is an Error, whose own fields are what make them mutable.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types
export const stubbed = <Params = Closedown>(options: StubbedOptions = {}) => {
  const { refusal, existing = 'missing' } = options;

  const created: WorkflowInstanceCreateOptions<Params>[] = [];

  const instance = {
    id: 'stubbed',
    status: () =>
      existing === 'status throws'
        ? Promise.reject(new Error('the status could not be read'))
        : Promise.resolve({ status: existing }),
  };

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const binding = {
    // Recorded as given, so the options a create was handed are exactly what a test reads back.
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
    create: (createOptions: WorkflowInstanceCreateOptions<Params>) => {
      created.push(createOptions);

      return refusal === undefined ? Promise.resolve(instance) : Promise.reject(refusal);
    },
    get: () =>
      existing === 'missing'
        ? Promise.reject(new Error('instance.not_found'))
        : Promise.resolve(instance),
  } as unknown as Workflow<Params>;

  return { binding, created };
};

/*****************************************************************************************************************/

// The real binding, selected from the environment a run is given.
// The environment is the platform's own type, read and never written: its bindings are what make it mutable.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types
export const echoing = (bindings: Cloudflare.Env): Workflow => bindings.ECHO;

/*****************************************************************************************************************/
