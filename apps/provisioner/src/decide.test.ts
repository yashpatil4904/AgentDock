import assert from "node:assert/strict";
import { test } from "node:test";
import { nextProvisionStep } from "./decide.js";

const timeoutMs = 900_000;

test("a missing bootstrap job is created and a failed one is replaced", () => {
  assert.equal(nextProvisionStep({ elapsedMs: 1_000, timeoutMs, job: "missing", mcpReady: false, registered: false }).action, "create-job");
  assert.equal(nextProvisionStep({ elapsedMs: 1_000, timeoutMs, job: "failed", mcpReady: false, registered: false }).action, "recreate-job");
  assert.equal(nextProvisionStep({ elapsedMs: 1_000, timeoutMs, job: "running", mcpReady: false, registered: false }).action, "wait");
});

test("registration waits for the MCP server and then marks the store ready", () => {
  assert.equal(nextProvisionStep({ elapsedMs: 1_000, timeoutMs, job: "succeeded", mcpReady: false, registered: false }).action, "wait");
  assert.equal(nextProvisionStep({ elapsedMs: 1_000, timeoutMs, job: "succeeded", mcpReady: true, registered: false }).action, "register");
  assert.equal(nextProvisionStep({ elapsedMs: 1_000, timeoutMs, job: "succeeded", mcpReady: true, registered: true }).action, "ready");
});

test("a timeout fails with the step that was still running", () => {
  const step = nextProvisionStep({ elapsedMs: timeoutMs + 1, timeoutMs, job: "running", mcpReady: false, registered: false });
  assert.equal(step.action, "fail");
  if (step.action === "fail") assert.match(step.reason, /timed out after 900 seconds/);
});
