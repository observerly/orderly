/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import { DurableObject } from 'cloudflare:workers';

/*****************************************************************************************************************/

// The runtime reads Workflow classes from the main module, as it does Durable Objects, so the test Workflow is
// re-exported here from the file that defines it.
export { Echo } from './echo';

export type { EchoOutput, EchoParams } from './echo';

/*****************************************************************************************************************/

export type StepEvent = 'started' | 'succeeded' | 'failed';

/*****************************************************************************************************************/

export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed';

/*****************************************************************************************************************/

export interface StepRecord {
  name: string;
  event: StepEvent;
  at: number;
}

/*****************************************************************************************************************/

const isStepEvent = (value: unknown): value is StepEvent =>
  value === 'started' || value === 'succeeded' || value === 'failed';

/*****************************************************************************************************************/

// A stand-in for whatever orderly's run object becomes. It exists to prove that
// a Durable Object can hold a step log in its own SQLite storage, fire an alarm
// at an exact time, and report a status that is derived from the log rather
// than stored alongside it.
export class Run extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);

    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS steps (name TEXT NOT NULL, event TEXT NOT NULL, at INTEGER NOT NULL)',
    );
  }

  record(name: string, event: StepEvent, at: number): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO steps (name, event, at) VALUES (?, ?, ?)',
      name,
      event,
      at,
    );
  }

  steps(): StepRecord[] {
    return this.ctx.storage.sql
      .exec('SELECT name, event, at FROM steps ORDER BY at, rowid')
      .toArray()
      .map(row => {
        const name = row['name'];
        const event = row['event'];
        const at = row['at'];

        // Guards rather than assertions or coercion. Columns come back untyped
        // from SQLite, and quietly widening them would let a malformed row
        // reach the status calculation, which is the one thing here that has to
        // be trustworthy.
        if (typeof name !== 'string' || !isStepEvent(event) || typeof at !== 'number') {
          throw new Error(`unrecognised step row: ${JSON.stringify(row)}`);
        }

        return { name, event, at };
      });
  }

  // Status is computed from the log on every read and is never written down.
  // A status column would go stale the moment an isolate died mid step, which
  // is exactly the case that matters.
  status(): RunStatus {
    const steps = this.steps();

    if (steps.length === 0) {
      return 'pending';
    }

    // The latest event per step name decides that step's state. Set membership
    // is not enough: a step that succeeded and then started again is a rerun in
    // flight, not a settled step, and a step that failed and then started again
    // is a retry in flight, not a terminal failure.
    const latest = new Map<string, StepEvent>();

    for (const step of steps) {
      latest.set(step.name, step.event);
    }

    const events = [...latest.values()];

    if (events.some(event => event === 'failed')) {
      return 'failed';
    }

    return events.every(event => event === 'succeeded') ? 'succeeded' : 'running';
  }

  async scheduleAt(when: number): Promise<void> {
    await this.ctx.storage.setAlarm(when);
  }

  async scheduledFor(): Promise<number | null> {
    return await this.ctx.storage.getAlarm();
  }

  override async alarm(): Promise<void> {
    this.record('alarm', 'succeeded', Date.now());

    return await Promise.resolve();
  }
}

/*****************************************************************************************************************/

export default {
  fetch(): Response {
    return new Response('orderly test fixture', { status: 200 });
  },
} satisfies ExportedHandler<Cloudflare.Env>;

/*****************************************************************************************************************/
