# orderly

Single file, no pushing. Type-safe middleware that brings a little bit of order to Cloudflare Queues.

orderly removes the two failure modes every raw queue consumer carries: messages that are never
decided, and one bad message crashing a whole batch. Every message resolves to exactly one explicit
outcome, every outcome is recorded as an event, and the consumer never rejects. Zero third-party
runtime dependencies.

## Installation

```sh
pnpm add @observerly/orderly
```

```sh
npm install @observerly/orderly
```

```sh
nub add @observerly/orderly
```

```sh
bun add @observerly/orderly
```

## Quick Start

Declare the payload once, and derive both ends from it:

```ts
// contracts/emails.ts
import { defineQueue, type QueueBody } from '@observerly/orderly';

import { z } from 'zod';

const payload = z.object({
  userId: z.string(),
  kind: z.enum(['welcome', 'digest', 'receipt']),
});

// Any Standard Schema library plugs in: zod, valibot, arktype, or a plain function that throws. The
// body's type is inferred from the schema, so it is named once, here.
export const emails = defineQueue({ name: 'emails', schema: payload });

// And read from the contract wherever a name for it is needed.
export type EmailPayload = QueueBody<typeof emails>;
```

```ts
// worker.ts
import { withExponentialRetryBackoff } from '@observerly/orderly';

import { emails } from './contracts/emails';

export default {
  async fetch(request, env) {
    const producer = emails.producer(env.EMAILS);

    await producer.send({ userId: '42', kind: 'welcome' });

    await producer.send({ userId: '42', kind: 'digest' }, { delaySeconds: 3_600 });

    return new Response('enqueued', { status: 202 });
  },

  queue: emails.consumer({
    retry: withExponentialRetryBackoff({
      initialDelaySeconds: 5,
      factor: 2,
      maximumDelaySeconds: 600,
      jitter: 'full',
      limit: 6,
    }),

    async handle(message, context) {
      // message is a parsed EmailPayload: validated before this ran.
      // Return settles the message as succeeded; throw and the retry policy decides.
    },
  }),
} satisfies ExportedHandler<Cloudflare.Env>;
```

```jsonc
// wrangler.jsonc
{
  "queues": {
    "producers": [{ "binding": "EMAILS", "queue": "emails" }],
    "consumers": [{ "queue": "emails", "max_batch_size": 25, "max_retries": 10 }],
  },
}
```

No `ack()`, no `retry()`, no batch bookkeeping, no try/catch ceremony. The handler returns or
throws, the policy decides, the events record it, and a malformed body never reaches your code.

## The Settlement Model

Every message a consumer receives resolves to exactly one of four terminal outcomes, always
explicitly:

- **succeeded** — the handler returned. Acknowledged.
- **retried** — the handler threw and the retry policy scheduled a redelivery, with the delay it
  decided.
- **discarded** — the handler threw and the policy chose to stop. Acknowledged deliberately, with
  the reason recorded. A discard never reaches the dead letter queue: that catches only messages
  which exhausted the platform's own `max_retries`.
- **rejected** — the body failed validation and never reached the handler at all.

The word ack appears nowhere in orderly's vocabulary: succeeded and discarded both acknowledge at
the transport while meaning opposite things, and that distinction living in the events rather than
the transport is the point.

The consumer itself never rejects, because a rejected queue handler makes the platform retry the
whole batch, acknowledged messages included. One message failing, one middleware throwing, or one
observer exploding never touches a sibling's settlement.

## Retry Policies

A policy is a pure function from what happened to what to do about it:

```ts
import {
  withExponentialRetryBackoff,
  withFixedRetryBackoff,
  withImmediateRetry,
  withoutRetry,
} from '@observerly/orderly';

withExponentialRetryBackoff({
  initialDelaySeconds: 1,
  factor: 2,
  maximumDelaySeconds: 300,
  jitter: 'full',
  limit: 8,
});
withFixedRetryBackoff({ delaySeconds: 30, limit: 5 });
withImmediateRetry({ limit: 3 });
withoutRetry();
```

Or write your own — delays are floored and clamped into the platform bounds for you, and a policy
that itself throws discards rather than crashing the batch:

```ts
import type { RetryPolicy } from '@observerly/orderly';

const policy: RetryPolicy = ({ attempts, error }) =>
  attempts >= 5
    ? { action: 'discard', reason: 'exhausted' }
    : { action: 'retry', delaySeconds: 2 ** attempts };
```

## Middleware

One layer around one message, outermost first. A middleware sees the parsed body and the delivery
facts, awaits the outcome the layers inside it produced, and may pass it through or substitute it:

```ts
import type { Middleware } from '@observerly/orderly';

const timing = (): Middleware => async (message, context, next) => {
  const startedAt = Date.now();

  const outcome = await next();

  console.log(`${context.id} settled as ${outcome.type} in ${Date.now() - startedAt}ms`);

  return outcome;
};
```

## Validation

The `schema` option accepts any [Standard Schema](https://standardschema.dev) or a plain parse
function. A failing body settles as rejected before the middleware or the handler ever see it, and
`onRejected` decides what a rejection becomes:

```ts
emails.consumer({
  retry: withoutRetry(),
  handle: deliver,
  // Absent: rejections are acknowledged as their own terminal. Or convert them:
  onRejected: () => ({ action: 'retry', delaySeconds: 60 }),
});
```

## Observability

Every decision emits an event, and status is derived from the event log rather than stored:

```ts
import { statusOf, type Event } from '@observerly/orderly';

const events: Event[] = [];

emails.consumer({
  retry: withoutRetry(),
  handle: deliver,
  onEvent: event => events.push(event),
  onBatch: ({ queue, size, lagInMilliseconds, backlogCount, backlogBytes }) => {},
});

statusOf(events); // 'pending' | 'running' | 'succeeded' | 'failed'
```

The vocabulary is closed: `batch.received`, `message.started`, then a terminal mirror of the
outcome for every message, with failures recorded as fact then decision.

## Scheduled Work

A queue can hold a message back, and that is how orderly runs work at an instant rather than now.
`send()` and `sendBatch()` take the instant to send at, and the platform delivers the message once
it has arrived:

```ts
import { add } from '@observerly/orderly';

const producer = emails.producer(env.EMAILS);

await producer.send({ userId: '42', kind: 'digest' }, { at: new Date('2026-01-15T09:00:00Z') });

await producer.sendBatch(reminders, { at: add(new Date(), { hours: 6 }) }); // one instant for all
```

The seconds until the instant are counted from the moment the message is handed over, after its
body has been validated, and rounded up, so a message never arrives early; an instant already
passed sends at once. A queue holds a message back for a day at most, which is what
`MAXIMUM_DELAY_SECONDS` names, and an instant further off than that is refused rather than moved,
because an appointment quietly moved to tomorrow is not the appointment that was asked for. An
instant beside `delaySeconds` is refused too, as is an invalid `Date`, each with a `RangeError`.
`delaySeconds` on its own keeps the platform's manners: floored, and clamped into its bounds.

Work further off than a day belongs to a schedule and a cron trigger. Once a day, ask the schedule
for the occurrences within the coming day and hand each to the queue with `at`, a message a job.
From there the queue is the clock: the consumer starts one Workflow per message as it lands, and
the Workflow does the work at once rather than sleeping until it is due. [Workflows](#workflows)
packages that arrangement, and [The Sun](#the-sun) shows it whole for an observatory that closes
down at sunrise.

## Workflows

A Cloudflare Workflow is declared once, and then run either now or at an instant, held in its
queue until the instant arrives. The Workflow class stays the platform's own `WorkflowEntrypoint`:
orderly validates the params, starts the instance by its id, and owns the queue in between.

```ts
// contracts/closedown.ts
import { defineWorkflow, type WorkflowParams } from '@observerly/orderly';

import { z } from 'zod';

export const closedown = defineWorkflow({
  name: 'closedown',
  schema: z.object({ observatory: z.string() }),
  workflow: env => env.CLOSEDOWN,
  queue: env => env.CLOSEDOWNS,
});

// The params are named once, in the schema, and read from the contract to type the entrypoint.
export type Params = WorkflowParams<typeof closedown>;
```

```ts
// worker.ts
import { withFixedRetryBackoff } from '@observerly/orderly';

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { closedown, type Params } from './contracts/closedown';

export default {
  async fetch(request, env) {
    // Now: the instance starts before run() resolves.
    const id = await closedown.run(env, { observatory: 'greenwich' });

    // At an instant: the run waits in the queue, and run() resolves as soon as it is queued.
    await closedown.run(
      env,
      { observatory: 'greenwich' },
      { at: new Date('2026-01-15T08:06:00Z'), id: 'greenwich-2026-01-15' },
    );

    return Response.json({ id }, { status: 202 });
  },

  // Each run that lands starts one instance by its id, and never a second.
  queue: closedown.consumer({ retry: withFixedRetryBackoff({ delaySeconds: 30, limit: 3 }) }),
} satisfies ExportedHandler<Cloudflare.Env>;

export class Closedown extends WorkflowEntrypoint<Cloudflare.Env, Params> {
  override async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    await step.do('park the mount', () => park(event.payload.observatory));
  }
}
```

```jsonc
// wrangler.jsonc
{
  "queues": {
    "producers": [{ "binding": "CLOSEDOWNS", "queue": "closedowns" }],
    "consumers": [{ "queue": "closedowns", "max_batch_size": 10, "max_retries": 3 }],
  },
  "workflows": [{ "name": "closedown", "binding": "CLOSEDOWN", "class_name": "Closedown" }],
}
```

`run()` resolves with the instance's id: the one given, or a fresh UUID. An id is at most a hundred
characters of letters, digits, underscores and hyphens, never a hyphen first, so a colon is refused.
A bad id, an invalid `Date`, or an instant on a contract with no queue is refused with a
`RangeError` before the params are parsed, and params that fail the schema start nothing. The
instant is held back exactly as `send()` holds a message back: rounded up, and never more than a
day ahead.

Worth knowing:

- **Params cross by structured clone,** on both paths, so a `Date` arrives as a `Date`. Never
  round-trip them through JSON.
- **A queued run is capped at the queue's message size,** 128 KB today, envelope included.
- **An id lives as long as the platform retains its instance,** a failed one included, and a run
  by that id starts nothing until then. Running it again takes `restart()` on the instance, or a
  new id.
- **A run without an id is not deduplicated end to end.** A caller that retries `run()` mints a new
  UUID each time, so pass an id derived from what the run is for, such as the occurrence.
- **The queue belongs to the Workflow.** Its consumer accepts the envelopes `run()` sends and
  rejects everything else, so give it a queue of its own.
- **A missed cron trigger is not replayed.** Runs a skipped trigger would have queued are never
  queued.
- **The compiler accepts a binding or queue with unknown or wider params,** as `wrangler types`
  writes them, and refuses only params unrelated to the schema's. It is not a stricter check than
  that.
- **`run()` without `at` bypasses the queue,** so there is no retry policy and no dead letter queue:
  a failure rejects to the caller. `at: new Date()` queues a run for now, retries included.

## Schedules

A schedule is the vocabulary for when something should happen, and it reduces to one pure function:
`next(after)` returns the first occurrence strictly after the instant given, or `null` once nothing
will ever follow. Every constructor below produces one, every combinator takes and returns one, and
because the same instant always yields the same occurrence, every worker on every replay computes
the same series. The module depends on nothing but `Intl`, and its sun schedules on observerly's
own astrometry.

```ts
import type { Schedule } from '@observerly/orderly';

const hourly: Schedule = { next: after => new Date(after.getTime() + 3_600_000) };
```

### At A Glance

| Schedule                                                                   | Description                                                                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `at(date).once()`                                                          | Once, at exactly that instant, to the millisecond, then exhausted.                                                                                            |
| `at(date).every(5).minutes()`                                              | That instant, then every five minutes after it.                                                                                                               |
| `every(5).minutes()`                                                       | Every five minutes on the hour, five past and ten past, aligned to the Unix epoch rather than to when it was built, so every worker computes the same series. |
| `every(6).hours()`                                                         | Every six hours: midnight, six, noon and six in the evening, UTC.                                                                                             |
| `every(1).days({ at: { hour: 9, minute: 0 }, timezone: 'Europe/London' })` | Nine each morning in London, across daylight saving.                                                                                                          |
| `every(2).weeks({ on: 'friday', at: { hour: 17, minute: 30 } })`           | Half past five every other Friday, UTC when no timezone is given.                                                                                             |
| `every(1).months({ on: 31 })`                                              | The thirty first of each month that has one; the rest are skipped, never clamped.                                                                             |
| `cron('0 9 * * 2-6', { timezone: 'Europe/London' })`                       | A crontab expression, five fields as Cloudflare reads them: weekdays at nine in London.                                                                       |
| `recurrenceRule('FREQ=MONTHLY;BYDAY=2MO', { from })`                       | A calendar's recurrence rule: the second Monday of every month, counted from `from`.                                                                          |
| `sunrise({ latitude, longitude })`                                         | Each sunrise seen from a place on Earth, to the almanac convention; none through a polar day or night, when the Sun stays up or down.                         |
| `sunset({ latitude, longitude })`                                          | Each sunset seen from the same place, the mirror of sunrise: the upper limb of the Sun touching the horizon as it sets.                                       |
| `union([weekdays, weekends])`                                              | Several schedules as one: fires whenever any member does, and exhausts once every member has.                                                                 |
| `exclude(mornings, christmas)`                                             | Every occurrence of the first, less those the second names exactly.                                                                                           |
| `between(hourly, { from, until })`                                         | Only within the window: nothing before it opens or after it closes, both ends inclusive, either open.                                                         |
| `preview(schedule, { after, take: 5 })`                                    | A dry run: the next five occurrences, as Dates.                                                                                                               |
| `preview(schedule, { after, until })`                                      | A dry run up to an instant, inclusive, with or without a count: whichever ends the walk first.                                                                |

### Instants & Clock Cadences

The grammar reads as sentences, and an unfinished one does not compile: `at(date)` and `every(5)`
are not schedules until a verb finishes them.

```ts
import { at, every } from '@observerly/orderly';

const date = new Date('2026-01-05T09:00:00Z');

at(date).once(); // once, at exactly that instant, to the millisecond, then exhausted
at(date).every(5).minutes(); // that instant and every five minutes after it
at(date).every(1.5).hours(); // the clock units take fractional counts

every(5).minutes(); // :00, :05 and :10, aligned to the Unix epoch, not to when this ran
every(6).hours(); // 00:00, 06:00, 12:00 and 18:00 UTC
```

Alignment is the decision that keeps `next()` pure: `every(5).minutes()` ticks at the same instants
for everyone, so two deploys of one schedule can never drift apart. A cadence counted from an
instant of your choosing is `at(date).every(...)`, that instant being its first occurrence.

### Calendar Units

Days, weeks and months are calendar units rather than fixed spans, because a day is not always
twenty four hours and months differ in length. They land on a timezone's own calendar at a wall
clock time, UTC and midnight when neither is given:

```ts
import { every } from '@observerly/orderly';

every(1).days({ at: { hour: 9, minute: 0 }, timezone: 'Europe/London' });
every(2).weeks({ on: 'friday', at: { hour: 17, minute: 30 }, timezone: 'America/New_York' });
every(1).months({ on: 31 }); // a month without a thirty first is skipped, never clamped
```

### Cron

Cron is the five fields Cloudflare's own triggers read, with lists, ranges, steps, `JAN` through
`DEC` and `SUN` through `SAT`, and the days of the week counted from Sunday as one. When both day
fields are written, a day matches when either does, as classic cron has always read them:

```ts
import { cron, parseCron } from '@observerly/orderly';

cron('0 9 * * 2-6', { timezone: 'Europe/London' }); // weekdays at nine, London time
cron('30 2 1 * *'); // the first of every month at 02:30 UTC
cron('0 0 13 * FRI'); // every thirteenth and every Friday, not only Friday the thirteenth

parseCron('*/15 9-17 * * *'); // the fields expanded to the values they allow, as data
```

### Recurrence Rules

Recurrence rules are the grammar of RFC 5545, the one calendars speak. `FREQ`, `INTERVAL`, `COUNT`,
`UNTIL`, `BYMONTH`, `BYMONTHDAY`, `BYDAY`, `BYHOUR`, `BYMINUTE` and `WKST` are honoured, each part
narrowing or expanding exactly as the specification's table has it for its frequency. `from` plays
the role of `DTSTART`: the parts a rule leaves unwritten take their values from it, and it is the
first occurrence.

```ts
import { parseRecurrenceRule, recurrenceRule } from '@observerly/orderly';

const from = new Date('2026-01-05T09:00:00Z');

recurrenceRule('FREQ=MONTHLY;BYDAY=2MO', { from, timezone: 'Europe/London' }); // second Mondays
recurrenceRule('FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29', { from }); // every leap day
recurrenceRule('FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10', { from }); // ten, the anchor the first
recurrenceRule('FREQ=DAILY;UNTIL=20261231T090000Z', { from }); // the end is inclusive

parseRecurrenceRule('FREQ=HOURLY;INTERVAL=6'); // the parts expanded to what they name, as data
```

The parts not honoured, `BYSECOND`, `BYYEARDAY`, `BYWEEKNO` and `BYSETPOS`, are refused by name
rather than ignored, because a rule quietly stripped of what narrows it fires far more often than
it was asked to. Two choices are stricter than the specification: a counted weekday beside
`BYMONTHDAY` is refused, and the frequencies below a day step in instants, so an hourly rule stays
hourly across a daylight saving transition rather than repeating or skipping an hour of wall clock.

### The Sun

The Sun keeps its own calendar, so its schedules are computed rather than declared: name a place on
Earth, and each occurrence is the instant the upper limb of the Sun touches the horizon there,
rising or setting, to the standard almanac convention, refraction and the height of the observer
included. It is the one place orderly reaches for astronomy, through observerly's own
[astrometry](https://github.com/observerly/astrometry).

```ts
import { preview, sunrise, sunset } from '@observerly/orderly';

const greenwich = { latitude: 51.4769, longitude: -0.0005, elevation: 46 };

sunrise(greenwich).next(new Date()); // the coming sunrise at Greenwich, strictly after now
sunset(greenwich).next(new Date()); // and the coming sunset
preview(sunrise(greenwich), { after: new Date(), take: 7 }); // a week of sunrises, as Dates
```

Latitude and longitude are degrees, north and east positive; the elevation is metres above sea
level, sea level when omitted; and a place that is not on Earth is refused at construction. Through
a polar day or a polar night the Sun stays above the horizon or below it, and those days simply
have no occurrence: the schedule walks on to the first sunrise or sunset after them. It searches
four hundred days before exhausting, which only the poles and the twentieth of a degree around
them reach: there astrometry's day-by-day search catches the one crossing of the horizon a year in
some years only, about one year in two at the poles themselves, and leaves gaps of three or four
years.

A queue holds a message back a day at most, and outside the polar circles a day holds a sunrise:
one most days, none through a polar night, and now and then two, when sunrise drifts across
midnight UTC. So a cron trigger that runs once a day can run the Workflow at each of the coming
day's sunrises, every run held in the Workflow's queue until the Sun is up:

```ts
// worker.ts
import {
  add,
  defineWorkflow,
  preview,
  sunrise,
  withFixedRetryBackoff,
  type WorkflowParams,
} from '@observerly/orderly';

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';

import { z } from 'zod';

const greenwich = { latitude: 51.4769, longitude: -0.0005, elevation: 46 };

const closedown = defineWorkflow({
  name: 'closedown',
  schema: z.object({ observatory: z.string() }),
  workflow: env => env.CLOSEDOWN,
  queue: env => env.CLOSEDOWNS,
});

type Params = WorkflowParams<typeof closedown>;

export default {
  // Each midnight UTC, a cron trigger runs the Workflow at every sunrise of the coming day. The id
  // is derived from the occurrence, so a trigger that runs twice still closes the observatory once.
  async scheduled(controller, env) {
    const now = new Date(controller.scheduledTime);

    for (const at of preview(sunrise(greenwich), { after: now, until: add(now, { days: 1 }) })) {
      await closedown.run(
        env,
        { observatory: 'greenwich' },
        { at, id: `greenwich-${at.getTime()}` },
      );
    }
  },

  // Delivered at sunrise, each run starts the Workflow that closes the observatory down, one start
  // at a time.
  queue: closedown.consumer({
    retry: withFixedRetryBackoff({ delaySeconds: 30, limit: 3 }),
    concurrency: 1,
  }),
} satisfies ExportedHandler<Cloudflare.Env>;

export class Closedown extends WorkflowEntrypoint<Cloudflare.Env, Params> {
  override async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    await step.do('park the mount', () => park(event.payload.observatory));

    await step.do('close the roof', () => close(event.payload.observatory));
  }
}
```

```jsonc
// wrangler.jsonc
{
  "triggers": { "crons": ["0 0 * * *"] },
  "queues": {
    "producers": [{ "binding": "CLOSEDOWNS", "queue": "closedowns" }],
    "consumers": [{ "queue": "closedowns", "max_batch_size": 10, "max_retries": 3 }],
  },
  "workflows": [{ "name": "closedown", "binding": "CLOSEDOWN", "class_name": "Closedown" }],
}
```

`preview()` walks to the instant given with `until`, both ends of the day included, so however many
sunrises the day holds, none, one or two, each is run once.

### Combining Schedules

```ts
import { between, cron, every, exclude, union } from '@observerly/orderly';

union([cron('0 9 * * 2-6'), cron('0 12 * * 1,7')]); // weekdays at nine and weekends at noon
exclude(cron('0 9 * * *'), cron('0 9 25 12 *')); // every morning except Christmas morning
between(every(1).hours(), { from: opens, until: closes }); // both ends inclusive, either open
```

`union` fires whenever any member does and exhausts only once every member has. `exclude` removes
the occurrences another schedule names, matched exactly to the millisecond, the way RFC 5545
removes exception dates from a recurrence set. `between` bounds a schedule to a window, firing
nothing before it opens and exhausting once it has closed.

### Time Zones & The Ends Of Time

Every constructor that reads a timezone uses the runtime's own IANA data through `Intl` and decides
daylight saving the same way: a wall time a spring forward gap swallows lands the gap's span later,
and a wall time a fall back repeats lands on its first occurrence. The end of the range a `Date`
can hold is exhaustion, never an error, and an invalid `Date` is refused loudly, at construction or
on `next()`, never read as exhaustion.

### Previewing & Date Arithmetic

To see what a schedule will do, walk it:

```ts
import { add, preview, subtract } from '@observerly/orderly';

preview(schedule, { after: new Date(), take: 5 }); // the next five occurrences, as Dates
preview(schedule, { after: now, until: add(now, { days: 1 }) }); // each in the day ahead, inclusive

add(now, { hours: 1, minutes: 30 }); // a Duration: days, hours, minutes, seconds, milliseconds
subtract(deadline, { days: 1 });
```

## Requirements

orderly runs on [workerd](https://github.com/cloudflare/workerd) and is tested inside it. It ships
as ESM with TypeScript declarations and follows Standard Schema rather than depending on any
validation library. Its one runtime dependency is observerly's own `@observerly/astrometry`, which
itself depends on nothing at runtime; a guard fails the package checks should another ever appear.

## Contributing

orderly runs on workerd rather than Node, which shapes how it is built and tested. See
[CONTRIBUTING.md](CONTRIBUTING.md) to get set up.

## Releasing

Changes that consumers would notice need a changeset, and releases happen by pushing a version tag.
See [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE) © 2026 observerly
