/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import type { WorkflowEvent } from 'cloudflare:workers';

import { describe, expectTypeOf, it } from 'vitest';

import {
  defineQueue,
  defineWorkflow,
  type WorkflowContract,
  type WorkflowParams,
} from '../src/index';

import { type Closedown, closedown, echoing } from './fixtures/workflow';

/*****************************************************************************************************************/

// A project's own environment, as `wrangler types` would write it, with a binding of unknown params.
interface ProjectEnv {
  CLOSEDOWN: Workflow;
}

/*****************************************************************************************************************/

// A selector annotated with the project's own environment.
// The environment is read and never written: its bindings are what make it a mutable type.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types
const project = (env: ProjectEnv): Workflow => env.CLOSEDOWN;

/*****************************************************************************************************************/

const closedowns = defineWorkflow({
  name: 'closedown',
  schema: closedown,
  // Left unannotated, so the environment is inferred. It is read and never written: its bindings are what make
  // it a mutable type.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  workflow: env => env.ECHO,
});

/*****************************************************************************************************************/

describe('WorkflowParams', () => {
  it('reads the params from a contract defined with a schema, with no type argument given', () => {
    expectTypeOf<WorkflowParams<typeof closedowns>>().toEqualTypeOf<Closedown>();
  });

  it('reads the params from a contract defined with a parse function', () => {
    const contract = defineWorkflow({
      name: 'closedown',
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      schema: (value: unknown) => value as Closedown,
      workflow: echoing,
    });

    expectTypeOf<WorkflowParams<typeof contract>>().toEqualTypeOf<Closedown>();
  });

  it('reads the params from a contract given its type argument outright', () => {
    const contract = defineWorkflow<Closedown>({ name: 'closedown', workflow: echoing });

    expectTypeOf<WorkflowParams<typeof contract>>().toEqualTypeOf<Closedown>();
  });

  it('is unknown for a contract that names no params at all', () => {
    const contract = defineWorkflow({ name: 'anything', workflow: echoing });

    expectTypeOf<WorkflowParams<typeof contract>>().toEqualTypeOf<unknown>();
  });

  it("reads the params from a contract over a project's own environment", () => {
    const contract = defineWorkflow({
      name: 'closedown',
      schema: closedown,
      workflow: project,
    });

    expectTypeOf<WorkflowParams<typeof contract>>().toEqualTypeOf<Closedown>();
  });
});

/*****************************************************************************************************************/

describe('WorkflowParams agrees with both ends', () => {
  it('agrees with what run() takes', () => {
    expectTypeOf(closedowns.run).parameter(1).toEqualTypeOf<WorkflowParams<typeof closedowns>>();
  });

  it("agrees with the payload the Workflow's entrypoint receives", () => {
    expectTypeOf<WorkflowEvent<WorkflowParams<typeof closedowns>>['payload']>().toEqualTypeOf<
      Readonly<Closedown>
    >();
  });
});

/*****************************************************************************************************************/

describe('WorkflowParams refuses what is not one contract', () => {
  it('is never for something that is not a contract', () => {
    expectTypeOf<WorkflowParams<Closedown>>().toBeNever();

    const queue = defineQueue({ name: 'closedowns', schema: closedown });

    expectTypeOf<WorkflowParams<typeof queue>>().toBeNever();
  });

  it('is never for a contract joined with undefined', () => {
    expectTypeOf<WorkflowParams<typeof closedowns | undefined>>().toBeNever();
  });

  it('is never for a union of two contracts', () => {
    type Either = WorkflowContract<Closedown> | WorkflowContract<{ telescope: number }>;

    expectTypeOf<WorkflowParams<Either>>().toBeNever();
  });
});

/*****************************************************************************************************************/

describe('defineWorkflow infers the environment', () => {
  it('reads an unannotated selector as taking Cloudflare.Env', () => {
    expectTypeOf(closedowns).toEqualTypeOf<WorkflowContract<Closedown>>();

    expectTypeOf(closedowns.run).parameter(0).toEqualTypeOf<Cloudflare.Env>();
  });

  it("reads an annotated selector as taking the project's own environment", () => {
    const contract = defineWorkflow({
      name: 'closedown',
      schema: closedown,
      workflow: project,
    });

    expectTypeOf(contract).toEqualTypeOf<WorkflowContract<Closedown, ProjectEnv>>();

    expectTypeOf(contract.run).parameter(0).toEqualTypeOf<ProjectEnv>();
  });
});

/*****************************************************************************************************************/
