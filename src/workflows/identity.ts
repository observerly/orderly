/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly/workflows
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

// The longest id the platform gives an instance.
export const MAXIMUM_INSTANCE_ID_LENGTH = 100;

/*****************************************************************************************************************/

// The characters the platform allows in an instance id: letters, digits, underscores and hyphens, never a hyphen
// first. A colon is refused, and a UUID is accepted.
const INSTANCE_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/u;

/*****************************************************************************************************************/

// Whether a value is an id the platform would accept for an instance. Checked here rather than left to the
// platform, so a bad id is refused before anything is parsed, sent or created, and refused the same way on the
// path that starts a run now and on the path that holds one in the queue.
export const isInstanceId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= MAXIMUM_INSTANCE_ID_LENGTH &&
  INSTANCE_ID.test(value);

/*****************************************************************************************************************/

// The id a run is started by: the one given, refused with the rule it broke when it breaks one, or a fresh UUID
// when none was given.
export const instanceIdOf = (id: string | undefined): string => {
  if (id === undefined) {
    return crypto.randomUUID();
  }

  if (!isInstanceId(id)) {
    throw new RangeError(
      `a Workflow instance id must match ${INSTANCE_ID.source} and be at most ` +
        `${MAXIMUM_INSTANCE_ID_LENGTH} characters long`,
    );
  }

  return id;
};

/*****************************************************************************************************************/
