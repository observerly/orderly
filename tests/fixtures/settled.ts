/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

// How long to wait between reads of an instance's status, and how many reads to make before giving up.
const INTERVAL_IN_MILLISECONDS = 20;

const READS = 250;

/*****************************************************************************************************************/

// Follows an instance until it settles, reading its status until it is complete or errored, and resolves with
// that status. Status is read rather than introspected, because the introspection the pool offers floods the
// log with the engine's own noise. Recursive rather than a loop, so each read waits on the one before it.
export const settled = async (
  // A handle the platform owns, read and never written: its methods are what make it a mutable type.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  instance: WorkflowInstance,
  reads = READS,
): Promise<InstanceStatus> => {
  const status = await instance.status();

  if (status.status === 'complete' || status.status === 'errored') {
    return status;
  }

  if (reads <= 1) {
    throw new Error(`instance ${instance.id} had not settled, reading ${status.status}`);
  }

  await new Promise(resolve => {
    setTimeout(resolve, INTERVAL_IN_MILLISECONDS);
  });

  return settled(instance, reads - 1);
};

/*****************************************************************************************************************/
