/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

/*****************************************************************************************************************/

export type EchoParams = Record<string, unknown>;

/*****************************************************************************************************************/

// What the Workflow saw of each param: 'Date' for a Date, its typeof otherwise. A Date is named apart because
// typeof reads every object alike, and whether a Date survived the crossing intact is the fact worth reading.
export interface EchoOutput {
  seen: Record<string, string>;
}

/*****************************************************************************************************************/

const kindOf = (value: unknown): string => (value instanceof Date ? 'Date' : typeof value);

/*****************************************************************************************************************/

// A Workflow that reports what reached it and does nothing else, so a test can read from the instance's output
// exactly which params it was created with, and in what form they crossed.
export class Echo extends WorkflowEntrypoint<Cloudflare.Env, EchoParams> {
  override run(
    // The event and the step are the platform's own types, read and never written, and neither can be made
    // readonly here without departing from the signature WorkflowEntrypoint declares.
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
    event: Readonly<WorkflowEvent<EchoParams>>,
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
    step: WorkflowStep,
  ): Promise<EchoOutput> {
    const { payload } = event;

    return step.do('echo', () =>
      Promise.resolve({
        seen: Object.fromEntries(Object.keys(payload).map(key => [key, kindOf(payload[key])])),
      }),
    );
  }
}

/*****************************************************************************************************************/
