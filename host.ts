// bb-plugin-omp-models — host entry.
//
// The host side owns the real `omp` binary: every method shells out to
// `omp models/config ...` on the machine that invoked the call. `config set`
// for `modelRoles` replaces the WHOLE record, so every write here is a
// read-modify-write of one YAML file and must carry every other role forward.
import { spawn } from "node:child_process";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import type { ExperimentalHostRpcHandlers } from "@get-bb/plugin-sdk/host";
import {
  analyzeRole,
  BUILT_IN_ROLES,
  buildRoleList,
  catalogModelSchema,
  hostContract,
} from "./contract.js";
import type { CatalogModel } from "./contract.js";

/** The `omp` executable, resolved from PATH (on Windows that is `omp.exe`). */
const OMP_BINARY = "omp";

/**
 * One `omp` invocation costs a process spawn, and `models --json` is the slow
 * one. Cap every call so a wedged child cannot pin the worker forever.
 */
const CALL_TIMEOUT_MS = 60_000;

/**
 * Run one `omp` invocation and resolve with its stdout.
 *
 * `shell: false` plus an argv array means a selector like `a:b c` can never
 * be interpreted by a shell. The 60 s cap kills a wedged child and settles,
 * and aborts kill and settle immediately so cancellation never hangs.
 */
function runOmp(args: readonly string[], signal: AbortSignal, label: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // `signal` makes Node kill the child on cancellation too; the listener
    // below settles first so the caller sees a clear "cancelled" error.
    const child = spawn(OMP_BINARY, [...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (error: Error | null, output: string): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(output);
    };
    const onAbort = (): void => {
      child.kill();
      settle(new Error(`omp ${label} was cancelled`), "");
    };
    timer = setTimeout(() => {
      // Settle here rather than waiting for `close`: a child that ignores the
      // kill must not leave the caller hanging.
      child.kill();
      settle(new Error(`omp ${label} timed out after ${CALL_TIMEOUT_MS} ms`), "");
    }, CALL_TIMEOUT_MS);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => settle(new Error(`failed to run omp ${label}: ${error.message}`), ""));
    child.on("close", (code) => {
      if (code === 0) {
        settle(null, stdout);
        return;
      }
      // omp's own stderr carries the actionable text; surface it verbatim
      // rather than inventing a message.
      const detail = stderr.trim() || stdout.trim();
      settle(new Error(`omp ${label} exited with code ${code}${detail ? `: ${detail}` : ""}`), "");
    });

    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

// `assign` and `unset` are read-modify-write of one YAML file through the CLI.
// Serializing every call keeps one call's write from interleaving with another's
// read and silently dropping roles.
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`omp ${label} did not return JSON`);
  }
}

/** `omp models --json` → `{"models":[...]}`; one bad row is dropped, not fatal. */
async function readModels(signal: AbortSignal): Promise<CatalogModel[]> {
  const parsed = parseJson(await runOmp(["models", "--json"], signal, "models --json"), "models --json");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("omp models --json did not return a JSON object");
  }
  const rows = (parsed as { models?: unknown }).models;
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) {
    throw new Error("omp models --json returned a non-array `models` field");
  }
  // The catalog is provider-authored; a row that fails validation must not
  // break the whole picker, so drop it and keep the rest.
  const models: CatalogModel[] = [];
  for (const row of rows) {
    const result = catalogModelSchema.safeParse(row);
    if (result.success) models.push(result.data);
  }
  return models;
}

/** `omp config get modelRoles --json` → `{"value":{...}}` as strings only. */
async function readStoredRoles(signal: AbortSignal): Promise<Record<string, string>> {
  const parsed = parseJson(
    await runOmp(["config", "get", "modelRoles", "--json"], signal, "config get modelRoles --json"),
    "config get modelRoles --json",
  );
  const value = (parsed as { value?: unknown }).value;
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("omp config get modelRoles --json did not return a record");
  }
  // Coerce: a role value that is not a string (a corrupt or hand-edited entry)
  // is skipped rather than trusted or stringified.
  const stored: Record<string, string> = {};
  for (const [role, selector] of Object.entries(value as Record<string, unknown>)) {
    if (typeof selector === "string") stored[role] = selector;
  }
  return stored;
}

async function readConfigPath(signal: AbortSignal): Promise<string> {
  return (await runOmp(["config", "path"], signal, "config path")).trim();
}

/** `omp --version` prints `omp/18.6.0`; the contract wants the bare version. */
function parseVersion(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim() !== "")?.trim() ?? "";
  const match = /^omp\/(.+)$/.exec(line);
  return match?.[1] ?? line;
}

async function readVersion(signal: AbortSignal): Promise<string> {
  return parseVersion(await runOmp(["--version"], signal, "--version"));
}

/** The single write path: one whole-record `config set`, nothing else. */
async function writeStoredRoles(next: Record<string, string>, signal: AbortSignal): Promise<void> {
  // `--` ends option parsing so a value like `a/b: -x` is never read as a flag.
  await runOmp(
    ["config", "set", "modelRoles", "--", JSON.stringify(next)],
    signal,
    "config set modelRoles",
  );
}

/** A role name is legal when it is documented or already assigned by the user. */
function assertKnownRole(role: string, stored: Record<string, string>): void {
  const builtIn = BUILT_IN_ROLES.some((candidate) => candidate.name === role);
  if (builtIn || Object.hasOwn(stored, role)) return;
  const vocabulary = BUILT_IN_ROLES.map((candidate) => candidate.name).join(", ");
  throw new Error(
    `Unknown role \`${role}\`. Known roles: ${vocabulary} — or a role already present in your modelRoles. ` +
      "The plugin refuses to invent new role names because omp would store them silently.",
  );
}

/** Reject a selector the contract classifies as malformed, naming the offender. */
function assertValidSelector(selector: string, models: readonly CatalogModel[]): void {
  if (selector.trim().length === 0) {
    throw new Error("Rejecting an empty selector. Use `unset` to clear a role instead.");
  }
  const analysis = analyzeRole(selector, models);
  if (analysis.valid) return;
  const offending = analysis.resolutions.find((resolution) => resolution.status === "invalid");
  const reason =
    offending?.status === "invalid" ? offending.reason : "one of the candidates is not usable";
  throw new Error(`Rejecting selector \`${selector}\`: ${reason}`);
}

const handlers: ExperimentalHostRpcHandlers<typeof hostContract> = {
  async catalog(_input, context) {
    return serialize(async () => {
      const [version, configPath, models, stored] = await Promise.all([
        readVersion(context.signal),
        readConfigPath(context.signal),
        readModels(context.signal),
        readStoredRoles(context.signal),
      ]);
      return { version, configPath, models, roles: buildRoleList(stored), stored };
    });
  },

  async assign(input, context) {
    return serialize(async () => {
      const [stored, models] = await Promise.all([
        readStoredRoles(context.signal),
        readModels(context.signal),
      ]);
      assertKnownRole(input.role, stored);
      assertValidSelector(input.selector, models);
      // Carry every other role forward: `config set` replaces the record whole.
      const next = { ...stored, [input.role]: input.selector };
      await writeStoredRoles(next, context.signal);
      // Verify by re-reading: report what the config now holds, not what we
      // asked for. A mismatch means the write did not land as computed.
      const reRead = await readStoredRoles(context.signal);
      if (reRead[input.role] !== input.selector) {
        throw new Error(
          `omp config set reported success but role \`${input.role}\` now holds ` +
            `\`${reRead[input.role] ?? "(unset)"}\`, not \`${input.selector}\``,
        );
      }
      return { role: input.role, selector: input.selector, stored: reRead };
    });
  },

  async unset(input, context) {
    return serialize(async () => {
      const stored = await readStoredRoles(context.signal);
      if (!Object.hasOwn(stored, input.role)) {
        throw new Error(`Role \`${input.role}\` is not currently assigned; nothing to unset.`);
      }
      const next = { ...stored };
      delete next[input.role];
      await writeStoredRoles(next, context.signal);
      const reRead = await readStoredRoles(context.signal);
      if (Object.hasOwn(reRead, input.role)) {
        throw new Error(`omp config set reported success but role \`${input.role}\` still holds \`${reRead[input.role]}\``);
      }
      return { role: input.role, stored: reRead };
    });
  },
};

export default experimental_defineHostEntry({ contract: hostContract, handlers });
