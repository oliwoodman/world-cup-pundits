import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "./_generated/api";

// Singleton workflow manager. Per-step action retries are on by default so a
// transient NVIDIA error retries that turn rather than killing the whole debate.
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    defaultRetryBehavior: { maxAttempts: 4, initialBackoffMs: 1000, base: 2 },
    retryActionsByDefault: true,
    maxParallelism: 5,
  },
});
