export type SweepExecutionState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly total: number }
  | { readonly status: "succeeded"; readonly resultId: string }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "cancelled" };

export type SweepCloudSaveState =
  | { readonly status: "idle" }
  | { readonly status: "saving" }
  | { readonly status: "saved"; readonly sweepId: string }
  | { readonly status: "failed"; readonly message: string };

export interface SweepSessionState {
  readonly execution: SweepExecutionState;
  readonly cloudSave: SweepCloudSaveState;
}

export type SweepSessionEvent =
  | { readonly type: "execution-started"; readonly total: number }
  | { readonly type: "execution-succeeded"; readonly resultId: string }
  | { readonly type: "execution-failed"; readonly message: string }
  | { readonly type: "execution-cancelled" }
  | { readonly type: "execution-reset" }
  | { readonly type: "cloud-save-started" }
  | { readonly type: "cloud-save-succeeded"; readonly sweepId: string }
  | { readonly type: "cloud-save-failed"; readonly message: string }
  | { readonly type: "cloud-save-retry" };

const IDLE_CLOUD_SAVE: SweepCloudSaveState = { status: "idle" };

export function createSweepSessionState(): SweepSessionState {
  return {
    execution: { status: "idle" },
    cloudSave: IDLE_CLOUD_SAVE,
  };
}

export function reduceSweepSession(
  state: SweepSessionState,
  event: SweepSessionEvent
): SweepSessionState {
  switch (event.type) {
    case "execution-started":
      return {
        execution: { status: "running", total: event.total },
        cloudSave: IDLE_CLOUD_SAVE,
      };
    case "execution-succeeded":
      return {
        execution: { status: "succeeded", resultId: event.resultId },
        cloudSave: IDLE_CLOUD_SAVE,
      };
    case "execution-failed":
      return {
        execution: { status: "failed", message: event.message },
        cloudSave: IDLE_CLOUD_SAVE,
      };
    case "execution-cancelled":
      return {
        execution: { status: "cancelled" },
        cloudSave: IDLE_CLOUD_SAVE,
      };
    case "execution-reset":
      return createSweepSessionState();
    case "cloud-save-started":
    case "cloud-save-retry":
      return applyCloudSave(state, { status: "saving" });
    case "cloud-save-succeeded":
      return applyCloudSave(state, {
        status: "saved",
        sweepId: event.sweepId,
      });
    case "cloud-save-failed":
      return applyCloudSave(state, {
        status: "failed",
        message: event.message,
      });
  }
}

function applyCloudSave(
  state: SweepSessionState,
  cloudSave: SweepCloudSaveState
): SweepSessionState {
  if (state.execution.status !== "succeeded") {
    return state;
  }
  return { ...state, cloudSave };
}
