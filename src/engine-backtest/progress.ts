export const PROGRESS_MILESTONE_COUNT = 10;

type ProgressFormat = "json" | "jsonl" | "text";
type WriteLine = (value: unknown) => void;

/**
 * Keeps JSONL useful for monitoring long runs without forwarding every
 * high-frequency runtime callback to stdout.
 */
export function createProgressEmitter(
  format: ProgressFormat,
  writeLine: WriteLine
): (stage: string, fraction: number, detail?: string) => void {
  const lastMilestoneByStage = new Map<string, number>();
  const completedStages = new Set<string>();

  return (stage, fraction, detail) => {
    if (format !== "jsonl") return;

    const milestone = Math.floor(fraction * PROGRESS_MILESTONE_COUNT);
    const lastMilestone = lastMilestoneByStage.get(stage);
    const isFirstUpdate = lastMilestone === undefined;
    const isNewMilestone = !isFirstUpdate && milestone > lastMilestone;
    const isNewCompletion = fraction === 1 && !completedStages.has(stage);
    if (!isFirstUpdate && !isNewMilestone && !isNewCompletion) return;

    lastMilestoneByStage.set(stage, milestone);
    if (fraction === 1) completedStages.add(stage);
    writeLine({
      event: "progress",
      stage,
      fraction,
      ...(detail ? { detail } : {}),
    });
  };
}
