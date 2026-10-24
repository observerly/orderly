/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly/workflows
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

import type { BodySchema } from '../consumer/index';

import { parseBody } from '../consumer/validation';

import type { StandardSchema, StandardSchemaIssue } from '../schema/index';

import { isInstanceId } from './identity';

/*****************************************************************************************************************/

// What a run held until an instant travels through the Workflow's queue as: the id the instance will be started
// by, and the params it will be started with, already parsed.
export type Envelope<Params> = { id: string; params: Params };

/*****************************************************************************************************************/

// Whether a value is an object written as a literal, rather than an array, a class instance or a primitive, which
// is all an envelope ever arrives as.
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
};

/*****************************************************************************************************************/

const isIssue = (value: unknown): value is StandardSchemaIssue =>
  typeof value === 'object' &&
  value !== null &&
  'message' in value &&
  typeof value.message === 'string';

/*****************************************************************************************************************/

// The issues the Workflow's schema found, moved under the envelope's params so each still points at the value it
// is about. A schema that threw rather than returning issues is reported as one issue at the params.
const issuesOf = (error: unknown): readonly StandardSchemaIssue[] => {
  const issues: unknown[] = Array.isArray(error) ? error : [];

  if (issues.length === 0 || !issues.every(issue => isIssue(issue))) {
    return [
      {
        message: error instanceof Error ? error.message : 'the params failed validation',
        path: ['params'],
      },
    ];
  }

  return issues.map(issue => ({ message: issue.message, path: ['params', ...(issue.path ?? [])] }));
};

/*****************************************************************************************************************/

// The schema the Workflow's queue is consumed with. It is strict, because the queue belongs to the Workflow:
// anything that is not a plain object carrying an id the platform would accept and params is rejected, and the
// params must pass the Workflow's own schema, or pass as given when there is none.
export const envelopeSchema = <Params>(
  // The schema is read and never written; readonly all the way down would ask the same of its own Standard Schema
  // properties, which are the schema library's concern.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  schema: BodySchema<Params> | undefined,
): StandardSchema<unknown, Envelope<Params>> => ({
  '~standard': {
    version: 1,
    vendor: 'orderly',
    validate: async value => {
      if (!isPlainObject(value) || !isInstanceId(value.id) || !('params' in value)) {
        return {
          issues: [
            { message: 'an envelope must be a plain object with an instance id and params' },
          ],
        };
      }

      const { id, params } = value;

      if (schema === undefined) {
        // The raw trust path, as for a consumer without a schema: the params are taken as the Workflow's.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        return { value: { id, params: params as Params } };
      }

      const attempt = await parseBody(schema, params);

      return attempt.parsed
        ? { value: { id, params: attempt.value } }
        : { issues: issuesOf(attempt.error) };
    },
  },
});

/*****************************************************************************************************************/
