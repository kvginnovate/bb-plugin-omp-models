// bb-plugin-omp-models — headless server entry.
//
// Three surfaces share one host client:
//   - the `bb omp-models` CLI (roles / assign / unset),
//   - the `omp_model_roles` native agent tool,
//   - the RPC the omp models page calls (overview / assign / unset).
//
// The server never touches the omp config: every read and write is forwarded
// to the host entry, which drives the real `omp` binary on the target machine.
// omp is installed per-machine, so the target host is always resolved
// explicitly — an explicit flag, the thread's environment, or the system
// primary host.
import {
  cliCommand,
  defineCli,
  PluginCliError,
  type BbPluginApi,
  type ExperimentalHostClient,
  type PluginAgentToolContext,
  type PluginAgentToolResult,
  type PluginCliOption,
  type PluginCliResult,
  type StandardSchemaV1InferInput,
  type StandardSchemaV1InferOutput,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  analyzeRole,
  hostContract,
  rpcContract,
  type CatalogResult,
  type RolePickerRow,
} from "./contract.js";

// ---------------------------------------------------------------------------
// Formatting helpers — one per command, shared by the CLI and the tool.
// The tool path always renders compact text: no table, no JSON, hard cap.
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code;
    return typeof code === "string" && code !== err.name ? `${err.message} [${code}]` : err.message;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

// omp reads modelRoles when a session starts, not on file changes. Surface
// this after every write so nobody mistakes a stale TUI for a broken write.
const HOT_RELOAD_NOTE = "Running omp sessions keep their old model until restarted.";

/** One display line for a role, with a resolved display status. */
type RoleLine = {
  name: string;
  selector: string | null;
  status: "unset" | "ok" | "unresolved" | "invalid";
  detail?: string;
};

/** Collapse each picker row's analysis into a display status. */
function toLines(rows: RolePickerRow[]): RoleLine[] {
  return rows.map(({ role, analysis }) => {
    const selector = role.selector && role.selector.trim() !== "" ? role.selector : null;
    if (selector === null) return { name: role.name, selector: null, status: "unset" };
    const bad = analysis.resolutions.find((resolution) => resolution.status === "invalid");
    if (bad) return { name: role.name, selector, status: "invalid", detail: bad.reason };
    const unmet = analysis.resolutions.find((resolution) => resolution.status === "ok" && !resolution.resolved);
    if (unmet) return { name: role.name, selector, status: "unresolved", detail: unmet.candidate };
    return { name: role.name, selector, status: "ok" };
  });
}

/** Rebuild picker rows from a live catalog. The analysis of the stored
 * selector is what the picker renders; `analyzeRole` returns `role: ""`, so
 * the role name is filled in here — the only field that is not self-describing. */
function rowsFromCatalog(catalog: CatalogResult): RolePickerRow[] {
  return catalog.roles.map((role) => {
    const analysis = analyzeRole(role.selector ?? "", catalog.models);
    return { role, analysis: { ...analysis, role: role.name } };
  });
}

/** CLI `roles`: bounded table with a status column; `--json` caps the same way. */
function formatRolesTable(rows: RolePickerRow[], catalog: CatalogResult, json: boolean, limit?: number): string {
  const lines = toLines(rows);
  const shown = limit !== undefined ? lines.slice(0, limit) : lines;
  if (json) {
    return JSON.stringify({
      ok: true,
      payload: {
        version: catalog.version,
        configPath: catalog.configPath,
        total: lines.length,
        roles: shown,
        truncated: limit !== undefined && lines.length > limit,
      },
    });
  }
  if (lines.length === 0) return "No model roles found.";
  const selCell = (line: RoleLine): string => line.selector ?? "(unset)";
  // The cap is on the VALUE, and the gutter is added on top of it: capping the
  // padded width instead would let a selector exactly `selW` long butt up
  // against the status column with no separator.
  const nameW = Math.min(18, Math.max(...shown.map((line) => line.name.length)));
  const selW = Math.min(34, Math.max(...shown.map((line) => selCell(line).length)));
  const out: string[] = [];
  out.push(`${"role".padEnd(nameW)}  ${"selector".padEnd(selW)}  status`);
  for (const line of shown) {
    const status =
      line.status === "ok"
        ? "ok"
        : line.status === "unresolved"
          ? `~ ${line.detail} not in the live catalog`
          : line.status === "invalid"
            ? `! ${line.detail}`
            : "";
    out.push(
      `${truncate(line.name, nameW).padEnd(nameW)}  ${truncate(selCell(line), selW).padEnd(selW)}  ${truncate(status, 60)}`,
    );
  }
  if (limit !== undefined && lines.length > limit) {
    out.push(`… ${lines.length - limit} more. Raise --limit (max 200).`);
  }
  out.push(`\n${lines.length} model role(s). omp ${catalog.version}. Config: ${catalog.configPath}`);
  return out.join("\n");
}

/** Tool `roles`: one compact line per role, hard-capped. */
function formatRolesCompact(rows: RolePickerRow[], catalog: CatalogResult, limit: number): string {
  const lines = toLines(rows);
  const shown = lines.slice(0, limit);
  const nameW = Math.min(14, Math.max(...shown.map((line) => line.name.length)) + 2);
  const out: string[] = [`${lines.length} model role(s) — omp ${catalog.version}`];
  for (const line of shown) {
    const marker =
      line.status === "unresolved"
        ? `  ~ ${line.detail} not in catalog`
        : line.status === "invalid"
          ? `  ! ${line.detail}`
          : "";
    out.push(truncate(`${line.name.padEnd(nameW)} = ${line.selector ?? "(unset)"}${marker}`, 80));
  }
  if (lines.length > limit) {
    out.push(`… ${lines.length - limit} more — run \`bb omp-models roles\` for the full list.`);
  }
  return out.join("\n");
}

type AssignOut = { role: string; selector: string; stored: Record<string, string> };

/** `assigned` prints the host-confirmed value and how many other roles the
 * write carried forward — never a guess about what got stored. */
function formatAssign(out: AssignOut, json: boolean): string {
  const preserved = Math.max(0, Object.keys(out.stored).length - 1);
  if (json) {
    return JSON.stringify({
      ok: true,
      payload: { role: out.role, selector: out.selector, preserved, note: HOT_RELOAD_NOTE },
    });
  }
  return `${out.role} = ${out.selector} → confirmed (${preserved} other role assignment(s) preserved). ${HOT_RELOAD_NOTE}`;
}

function formatUnset(out: { role: string }, json: boolean): string {
  if (json) return JSON.stringify({ ok: true, payload: { role: out.role, note: HOT_RELOAD_NOTE } });
  return `${out.role} unset → omp's built-in resolution applies again. ${HOT_RELOAD_NOTE}`;
}

// Options shared by every subcommand. `as const` keeps the `type`
// discriminants literal so cliCommand's generics infer precise value
// types per option.
const hostOptions = {
  machine: {
    type: "string",
    description: "Target host id. Omit to resolve from the thread's environment, else the system primary host.",
  },
  json: {
    type: "boolean",
    description: "Emit a `{ ok, payload }` JSON envelope on stdout instead of the human output.",
  },
} as const satisfies Record<string, PluginCliOption>;

// ---------------------------------------------------------------------------
// Host-boundary actions. Input/output types are inferred per method from
// `hostContract` at each call site, so no per-method aliases exist here.
// ---------------------------------------------------------------------------
// The tool and the CLI both hand us a shape with an optional thread id and
// signal; the tool's context just has required fields, which is assignable.
type ResolvableCtx = { threadId?: string; signal?: AbortSignal };

type ToolArgs = {
  action: "roles" | "assign" | "unset";
  role?: string;
  selector?: string;
  machine?: string;
};

class OmpModelActions {
  private constructor(
    private readonly sdk: BbPluginApi["sdk"],
    private readonly host: ExperimentalHostClient<typeof hostContract>,
  ) {}

  static create(bb: BbPluginApi): OmpModelActions {
    const host = bb.hosts.experimental_client({ contract: hostContract });
    return new OmpModelActions(bb.sdk, host);
  }

  private throwHostError(method: string, hostId: string, err: unknown): never {
    const reason = describeError(err);
    throw new PluginCliError(`omp host call '${method}' failed on ${hostId}: ${reason}`, {
      code: "host_call_failed",
      hint:
        "Check that the host daemon is online and that the omp binary is on PATH on that host. " +
        "Pin the target with `--machine <hostId>`.",
    });
  }

  /**
   * Host resolution, in order:
   *   1. explicit machine flag,
   *   2. thread → environment → host,
   *   3. system primary host.
   * A thread whose environment vanished falls through to (3); if that is
   * also absent we fail with a hint naming `--machine`.
   */
  async resolveHost(opts: { hostId?: string; ctx: ResolvableCtx }): Promise<string> {
    if (opts.hostId) return opts.hostId;
    const { threadId, signal } = opts.ctx;
    if (threadId) {
      try {
        const thread = await this.sdk.threads.get({ threadId, signal });
        const environmentId = thread.environmentId;
        if (environmentId) {
          const env = await this.sdk.environments.get({ environmentId, signal });
          if (env.hostId) return env.hostId;
        }
      } catch (err) {
        // Aborted: stop immediately; anything else means the thread or its
        // environment is gone — fall back to the primary host.
        if (signal?.aborted) throw err;
      }
    }
    const cfg = await this.sdk.system.config({ signal });
    if (cfg.primaryHostId) return cfg.primaryHostId;
    throw new PluginCliError(
      "No target host: no --machine flag, no thread environment host, and no system primary host.",
      { code: "host_resolution_failed", hint: "Add `--machine <hostId>` to target a host explicitly." },
    );
  }

  /**
   * One thin host call. `host.call` resolves with the validated output and
   * rejects on transport or host-side failure; the catch converts that
   * rejection into a `PluginCliError` so both the CLI's `--json` envelope
   * and the tool's error string stay well formed. `M` keeps input/output
   * inference precise per method.
   */
  async callHost<M extends keyof typeof hostContract & string>(
    method: M,
    input: StandardSchemaV1InferInput<(typeof hostContract)[M]["input"]>,
    hostId: string,
    signal?: AbortSignal,
  ): Promise<StandardSchemaV1InferOutput<(typeof hostContract)[M]["output"]>> {
    try {
      return await this.host.call(method, input, { hostId, signal });
    } catch (err) {
      this.throwHostError(method, hostId, err);
    }
  }

  /** Agent tool path: one compact block, no table, hard-capped rows. */
  async run(action: ToolArgs["action"], args: ToolArgs, ctx: ResolvableCtx): Promise<string> {
    const hostId = await this.resolveHost({ hostId: args.machine, ctx });
    switch (action) {
      case "roles": {
        const catalog = await this.callHost("catalog", null, hostId, ctx.signal);
        return formatRolesCompact(rowsFromCatalog(catalog), catalog, 25);
      }
      case "assign": {
        const out = await this.callHost("assign", { role: args.role!, selector: args.selector! }, hostId, ctx.signal);
        return formatAssign(out, false);
      }
      case "unset": {
        const out = await this.callHost("unset", { role: args.role! }, hostId, ctx.signal);
        return formatUnset(out, false);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export default function plugin(bb: BbPluginApi) {
  const actions = OmpModelActions.create(bb);

  // No bb.settings.define: the host entry hardcodes the `omp` binary, so a
  // command setting on this side would not be honored end-to-end.

  // -- CLI -------------------------------------------------------------------
  bb.cli.register(
    defineCli({
      name: "omp-models",
      summary: "Read and assign omp model roles (per-role model selectors) on a target host.",
      description:
        "Drives the local omp CLI on the target machine. Role names follow omp's " +
        "documented vocabulary (default, smol, slow, plan, task, vision, commit, " +
        "tiny, memory, advisor, image, web, speech, dictation, judge) plus any " +
        "custom roles the user has stored. Without --machine, the host is " +
        "resolved from the invoking thread's environment, falling back to the " +
        "system primary host. Selectors are `provider/model`, optionally a " +
        "comma-separated candidate list with a thinking suffix like `:high`; " +
        "`web/*` and `local/*` are legal even though they publish no catalog " +
        "rows. `assign` validates before writing and preserves every other " +
        "modelRoles entry — omp replaces the record wholesale. A running omp " +
        "TUI does not pick up changes until restart.",
      commands: {
        roles: cliCommand({
          summary: "List every model role with its current selector; marks unresolved selectors.",
          description:
            "Bounded table: role, stored selector, and status — ok, unresolved " +
            "(no matching row in the live catalog), or invalid (the value is " +
            "malformed, with the first reason). Unset roles are shown as " +
            "(unset). Use --limit to cap rows; with --json the roles array is " +
            "capped the same way and a truncated flag is added.",
          options: {
            ...hostOptions,
            limit: {
              type: "integer",
              min: 1,
              max: 200,
              default: 40,
              description: "Max rows in the human table; caps the --json roles array too.",
            },
          },
          run: async (input, ctx): Promise<PluginCliResult> => {
            const hostId = await actions.resolveHost({ hostId: input.options.machine, ctx });
            const catalog = await actions.callHost("catalog", null, hostId, ctx.signal);
            const text = formatRolesTable(rowsFromCatalog(catalog), catalog, input.options.json, input.options.limit);
            return { exitCode: 0, stdout: text };
          },
        }),
        assign: cliCommand({
          summary: "Write one model role's selector, preserving the rest of modelRoles.",
          description:
            "Validates the selector against the live catalog, then rewrites the " +
            "whole modelRoles record with every other role carried forward — " +
            "omp replaces the record, so a single-role write must preserve the " +
            "rest. The selector may be a comma-separated candidate list with a " +
            "thinking suffix, e.g. `moonshotai/kimi-k2:high,openai/gpt-5.2`.",
          positionals: [
            { name: "role", description: "Role name (a built-in or a custom stored role).", required: true },
            {
              name: "selector",
              description:
                "Model selector: provider/model, optionally comma-separated and with a :thinking suffix.",
              required: true,
            },
          ],
          options: hostOptions,
          run: async (input, ctx): Promise<PluginCliResult> => {
            const hostId = await actions.resolveHost({ hostId: input.options.machine, ctx });
            const out = await actions.callHost(
              "assign",
              { role: input.positionals.role, selector: input.positionals.selector },
              hostId,
              ctx.signal,
            );
            const text = formatAssign(out, input.options.json);
            return { exitCode: 0, stdout: text };
          },
        }),
        unset: cliCommand({
          summary: "Remove one model role assignment; the role falls back to omp's built-in resolution.",
          positionals: [{ name: "role", description: "Role name to clear.", required: true }],
          options: hostOptions,
          run: async (input, ctx): Promise<PluginCliResult> => {
            const hostId = await actions.resolveHost({ hostId: input.options.machine, ctx });
            const out = await actions.callHost("unset", { role: input.positionals.role }, hostId, ctx.signal);
            const text = formatUnset(out, input.options.json);
            return { exitCode: 0, stdout: text };
          },
        }),
      },
    }),
  );

  // -- Agent tool ------------------------------------------------------------
  const toolSchema = z
    .object({
      action: z.enum(["roles", "assign", "unset"]),
      role: z.string().optional(),
      selector: z.string().optional(),
      machine: z.string().optional(),
    })
    .refine(
      (a) => {
        if (a.action === "roles") return true;
        if (a.action === "assign") return (a.role ?? "").trim() !== "" && (a.selector ?? "").trim() !== "";
        return (a.role ?? "").trim() !== "";
      },
      { message: "assign needs a non-empty role and selector; unset needs a non-empty role; roles takes no arguments." },
    );

  bb.agents.registerTool({
    name: "omp_model_roles",
    description:
      "List or change omp model role assignments on a target host. Actions: " +
      "roles (no arguments), assign (role + selector), unset (role). `roles` " +
      "returns one compact line per role — at most 25 rows — with the current " +
      "selector and markers for selectors that do not resolve in the live " +
      "catalog. `assign` validates the selector before writing and preserves " +
      "the rest of modelRoles. `machine` pins a target host; when omitted the " +
      "thread's environment host, else the system primary host, is used. A " +
      "change does not affect an already-running omp TUI session: running " +
      "sessions keep their old model until restart.",
    parameters: toolSchema,
    presentation: {
      label: {
        pending: "Updating omp model roles",
        completed: "omp model roles call finished",
      },
    },
    instructions:
      "Prefer this tool over hand-editing modelRoles in the omp config: the host " +
      "entry validates every candidate against the live catalog first, and " +
      "rewrites the whole modelRoles record with every other role preserved — " +
      "omp would otherwise replace the record and drop the rest. The selector " +
      "is `provider/model`, optionally a comma-separated candidate list with a " +
      "thinking suffix (`:off … :max`, `:auto`, `:inherit`); `web/*` and " +
      "`local/*` targets are legal even though they publish no catalog rows. " +
      "If the host cannot be resolved, the error names the machine flag to use.",
    async execute(args: ToolArgs, ctx: PluginAgentToolContext): Promise<PluginAgentToolResult> {
      try {
        return await actions.run(args.action, args, ctx);
      } catch (err) {
        if (err instanceof PluginCliError) {
          const text = err.hint ? `${err.message} (${err.hint})` : err.message;
          return { content: [{ type: "text", text }], isError: true };
        }
        return { content: [{ type: "text", text: `Unexpected error: ${describeError(err)}` }], isError: true };
      }
    },
  });

  // -- Frontend bridge --------------------------------------------------------
  // `useRpc` in app.tsx can only call methods registered here; it cannot reach
  // hostContract. These handlers reuse `actions`, so the UI writes roles by
  // exactly the same path as the CLI and the tool.
  //
  // After a write, the rows are rebuilt from a FRESH catalog read, so the page
  // reflects what omp actually stored — omp itself is the source of truth, and
  // the host entry already validated the write before it landed.
  //
  // The UI has no thread to resolve from, so this lands on the system primary
  // host — the machine running the omp install the user is configuring.
  // No abort signal here: the rpc handler context does not carry one, and each
  // `omp` call is already bounded by the host entry's own timeout.
  bb.rpc.register(
    rpcContract,
    {
      async overview() {
        const hostId = await actions.resolveHost({ ctx: {} });
        const catalog = await actions.callHost("catalog", null, hostId);
        return {
          version: catalog.version,
          configPath: catalog.configPath,
          models: catalog.models,
          rows: rowsFromCatalog(catalog),
        };
      },
      async assign(input) {
        const hostId = await actions.resolveHost({ ctx: {} });
        const out = await actions.callHost(
          "assign",
          { role: input.role, selector: input.selector },
          hostId,
        );
        const catalog = await actions.callHost("catalog", null, hostId);
        return { role: out.role, selector: out.selector, rows: rowsFromCatalog(catalog) };
      },
      async unset(input) {
        const hostId = await actions.resolveHost({ ctx: {} });
        const out = await actions.callHost("unset", { role: input.role }, hostId);
        const catalog = await actions.callHost("catalog", null, hostId);
        return { role: out.role, rows: rowsFromCatalog(catalog) };
      },
    },
    {
      // Discoverable so `bb plugin rpc list`/`call` can exercise the same
      // bridge the page uses, instead of leaving it testable only through a
      // browser.
      experimental_discoverable: true,
      experimental_description: "Read and update omp model role assignments for the omp models page.",
    },
  );
}
