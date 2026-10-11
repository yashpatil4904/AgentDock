export type JobState = "missing" | "running" | "succeeded" | "failed";

export type ProvisionStep =
  | { action: "fail"; reason: string }
  | { action: "wait"; detail: string }
  | { action: "create-job"; detail: string }
  | { action: "recreate-job"; detail: string }
  | { action: "register"; detail: string }
  | { action: "ready" };

export function nextProvisionStep(input: {
  elapsedMs: number;
  timeoutMs: number;
  job: JobState;
  mcpReady: boolean;
  registered: boolean;
}): ProvisionStep {
  const seconds = Math.max(1, Math.round(input.timeoutMs / 1000));
  if (input.elapsedMs > input.timeoutMs) {
    const where = input.job === "succeeded"
      ? input.mcpReady ? "the gateway registration" : "the store MCP server"
      : input.job === "failed" ? "a failed WooCommerce bootstrap" : "the WooCommerce bootstrap";
    return {
      action: "fail",
      reason: `Provisioning timed out after ${seconds} seconds while waiting on ${where}. Retry keeps this namespace and continues.`,
    };
  }
  if (input.job === "missing") return { action: "create-job", detail: "Starting WooCommerce bootstrap" };
  if (input.job === "failed") return { action: "recreate-job", detail: "Bootstrap failed. Starting it again." };
  if (input.job === "running") return { action: "wait", detail: "Waiting for WooCommerce bootstrap" };
  if (!input.mcpReady) return { action: "wait", detail: "Waiting for the store MCP server" };
  if (!input.registered) return { action: "register", detail: "Registering the store with the gateway" };
  return { action: "ready" };
}
