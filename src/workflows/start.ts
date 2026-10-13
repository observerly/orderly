/*****************************************************************************************************************/

// @author         Michael Roberts <michael@observerly.com>
// @package        @observerly/orderly/workflows
// @license        Copyright © 2026 observerly

/*****************************************************************************************************************/

// Whether an instance already stands behind an id. Anything the platform cannot answer reads as no instance, so
// the caller falls back to the error it already has rather than to a new one from here.
const exists = async <Params>(
  // The platform's binding, read and never written: its methods are what make it a mutable type.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  binding: Workflow<Params>,
  id: string,
): Promise<boolean> => {
  try {
    const instance = await binding.get(id);

    const { status } = await instance.status();

    return status !== 'unknown';
  } catch {
    return false;
  }
};

/*****************************************************************************************************************/

// Starts one instance by its id, and never a second. A create the platform refuses is followed by asking for the
// instance by that id: one already there means the run has already started, so the id is resolved just as though
// this call had started it. Without one, the platform's own error is rethrown unchanged. The error is never
// matched on its text, which the platform does not promise, and the local engine does not refuse a repeated id
// at all, handing back the instance already there.
export const startInstance = async <Params>(
  // The platform's binding, read and never written: its methods are what make it a mutable type.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  binding: Workflow<Params>,
  id: string,
  params: Params,
): Promise<string> => {
  try {
    await binding.create({ id, params });
  } catch (error) {
    if (await exists(binding, id)) {
      return id;
    }

    throw error;
  }

  return id;
};

/*****************************************************************************************************************/
