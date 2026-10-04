/**
 * Shared contract for the omp-models plugin: the model catalog, the role
 * vocabulary, selector classification, and the RPC surfaces.
 *
 * Why this file exists: `omp config set modelRoles <json>` accepts ANY record —
 * arbitrary role names and arbitrary selectors both persist silently (verified
 * against omp 18.6.0). Every write therefore goes through the validation below
 * BEFORE the host shells out, so a typo can never quietly replace a working
 * role assignment with an unresolvable one.
 */
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

/**
 * One row of `omp models --json`. Every field is optional because the catalog
 * is provider-authored: a future omp release may add keys, and a provider that
 * omits metadata must not fail the whole listing.
 */
export const catalogModelSchema = z.object({
  provider: z.string(),
  kind: z.string(),
  id: z.string(),
  /** `provider/id` — the value written into `modelRoles`. */
  selector: z.string(),
  name: z.string(),
  contextWindow: z.number().nullable().optional(),
  maxTokens: z.number().nullable().optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.string()).optional(),
  cost: z
    .object({
      input: z.number(),
      output: z.number(),
      cacheRead: z.number().optional(),
      cacheWrite: z.number().optional(),
    })
    .optional(),
  pricingStatus: z.string().optional(),
});

export type CatalogModel = z.infer<typeof catalogModelSchema>;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * `chat` roles select a conversational model; `model-kind` roles select a
 * runner of that catalog kind (image generation, search, TTS, STT, judgment).
 * omp's docs group roles exactly this way, and the grouping is what the picker
 * uses to decide which columns of the catalog a role may be pointed at.
 */
export const roleGroupSchema = z.enum(["chat", "model-kind"]);
export type RoleGroup = z.infer<typeof roleGroupSchema>;

/** A role omp ships with, or one discovered in the user's own config. */
export const roleSchema = z.object({
  name: z.string().min(1),
  group: roleGroupSchema,
  /** True when the name is not part of omp's documented vocabulary. */
  custom: z.boolean(),
  /** What omp uses the role for, shown as the picker's row description. */
  description: z.string(),
  /**
   * The stored selector, or null when the role is unset. Never validated here:
   * it is whatever the user already has, including something this plugin would
   * reject on write.
   */
  selector: z.string().nullable(),
});

export type Role = z.infer<typeof roleSchema>;

// ---------------------------------------------------------------------------
// Selector validation
// ---------------------------------------------------------------------------

/**
 * omp's documented thinking suffixes for chat selectors. `inherit` leaves the
 * session's level alone; `auto` follows the primary model's effort.
 */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "auto",
  "inherit",
] as const;

export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * Providers that are always legal role targets even though they publish no
 * rows in `omp models --json`: `web/*` are search engines the catalog reports
 * separately, and `local/*` are on-device runners.
 */
export const IMPLICIT_ROLE_PROVIDERS = ["web", "local"] as const;

/** How one comma-separated candidate of a role value resolves. */
export const selectorResolutionSchema = z.discriminatedUnion("status", [
  /** Matches a live catalog row, or is a documented model-kind / local runner. */
  z.object({ status: z.literal("ok"), candidate: z.string(), resolved: z.boolean() }),
  /** The value is not usable as a role selector at all. */
  z.object({ status: z.literal("invalid"), candidate: z.string(), reason: z.string() }),
]);

export type SelectorResolution = z.infer<typeof selectorResolutionSchema>;

/** Everything the picker needs to render and validate one role's value. */
export const roleAnalysisSchema = z.object({
  role: z.string(),
  candidates: z.array(z.string()),
  resolutions: z.array(selectorResolutionSchema),
  /** True when every candidate is usable — the only case a write may proceed. */
  valid: z.boolean(),
});

export type RoleAnalysis = z.infer<typeof roleAnalysisSchema>;

/**
 * Split one stored role value into candidates. omp accepts a comma-separated
 * ordered list and uses the first available match, so a list is ONE value, not
 * several.
 */
export function parseCandidates(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Split a candidate into its model selector and optional thinking suffix.
 * The suffix is only meaningful on the final `:` segment, and model ids in the
 * catalog never carry one.
 */
export function splitThinkingSuffix(candidate: string): { selector: string; level: string | null } {
  const at = candidate.lastIndexOf(":");
  if (at <= 0) return { selector: candidate, level: null };
  const level = candidate.slice(at + 1);
  if (!(THINKING_LEVELS as readonly string[]).includes(level)) {
    return { selector: candidate, level: null };
  }
  return { selector: candidate.slice(0, at), level };
}

/** True for `@smol`-style aliases and the bare `*` that names the default role. */
export function isRoleAlias(candidate: string): boolean {
  return candidate === "*" || candidate.startsWith("@");
}

/**
 * Classify one candidate against a live catalog.
 *
 * `resolved` reports whether omp can actually find the model; `status` reports
 * whether the value is even well-formed. A provider that exists but publishes
 * no catalog rows (`web`, `local`) resolves to `resolved: true` without a
 * catalog hit, because those runners are legitimately absent from the listing.
 */
export function classifyCandidate(
  candidate: string,
  models: readonly CatalogModel[],
): SelectorResolution {
  if (candidate.length === 0) {
    return { status: "invalid", candidate, reason: "empty selector" };
  }
  if (isRoleAlias(candidate)) return { status: "ok", candidate, resolved: true };

  const { selector, level } = splitThinkingSuffix(candidate);
  if (level !== null && selector.length === 0) {
    return { status: "invalid", candidate, reason: "a thinking suffix needs a model selector" };
  }
  const slash = selector.indexOf("/");
  if (slash <= 0 || slash === selector.length - 1) {
    return {
      status: "invalid",
      candidate,
      reason: `expected provider/model, got '${candidate}'`,
    };
  }
  const provider = selector.slice(0, slash);
  if ((IMPLICIT_ROLE_PROVIDERS as readonly string[]).includes(provider)) {
    return { status: "ok", candidate, resolved: true };
  }
  const known = models.some(
    (model) => model.selector === selector || (model.provider === provider && model.id === selector.slice(slash + 1)),
  );
  return known
    ? { status: "ok", candidate, resolved: true }
    : {
        status: "invalid",
        candidate,
        reason: `no model '${selector}' in the ${models.length}-model catalog — run \`omp models\` to list it`,
      };
}

/** Classify a whole role value; `valid` means no candidate is malformed. */
export function analyzeRole(value: string, models: readonly CatalogModel[]): RoleAnalysis {
  const candidates = parseCandidates(value);
  const resolutions = candidates.map((candidate) => classifyCandidate(candidate, models));
  return {
    role: "",
    candidates,
    resolutions,
    valid: resolutions.every((resolution) => resolution.status === "ok"),
  };
}

// ---------------------------------------------------------------------------
// Documented role vocabulary
// ---------------------------------------------------------------------------

/**
 * omp 18.6.0's built-in roles, in picker order. `tiny` and `memory` accept both
 * chat models and `tiny`-kind models; `judge` also accepts chat models, but the
 * picker only needs the group to decide which catalog columns are relevant.
 *
 * Any key present in the user's `modelRoles` but absent here is reported as a
 * custom role rather than dropped — a custom chat role is a documented omp
 * feature, and silently hiding it would make it unwritable from bb.
 */
export const BUILT_IN_ROLES: readonly { name: string; group: RoleGroup; description: string }[] = [
  { name: "default", group: "chat", description: "Primary conversation model; `*` and `@default` expand here." },
  { name: "smol", group: "chat", description: "Fast, cheap model for lightweight tool work." },
  { name: "slow", group: "chat", description: "Slow reasoning model for thorough analysis." },
  { name: "plan", group: "chat", description: "Model used in plan mode; does not enter plan mode by itself." },
  { name: "task", group: "chat", description: "Model for sub-agent task resolution." },
  { name: "vision", group: "chat", description: "Chat model for image analysis. Needs image-input support." },
  { name: "commit", group: "chat", description: "Model for commit message generation." },
  { name: "tiny", group: "chat", description: "Titles and background text; falls back to `smol` when unset." },
  { name: "memory", group: "chat", description: "Managed memory extraction; falls back to `tiny`." },
  { name: "advisor", group: "chat", description: "Advisor runtime model. An invalid assignment never falls back." },
  { name: "image", group: "model-kind", description: "Model for generate_image." },
  { name: "web", group: "model-kind", description: "Search model for the web_search tool." },
  { name: "speech", group: "model-kind", description: "Text-to-speech model." },
  { name: "dictation", group: "model-kind", description: "Speech-to-text model." },
  { name: "judge", group: "model-kind", description: "Model for typed judgments: thinking level, stop detection, staging." },
];

const BUILT_IN_BY_NAME = new Map(BUILT_IN_ROLES.map((role) => [role.name, role]));

/**
 * Merge the documented vocabulary with the user's own assignments: documented
 * roles come first in picker order, then custom roles alphabetically. A custom
 * role is a chat role, because that is what omp assigns them to.
 */
export function buildRoleList(stored: Readonly<Record<string, string>>): Role[] {
  const documented: Role[] = BUILT_IN_ROLES.map((role) => ({
    name: role.name,
    group: role.group,
    custom: false,
    description: role.description,
    selector: stored[role.name] ?? null,
  }));
  const custom: Role[] = Object.keys(stored)
    .filter((name) => !BUILT_IN_BY_NAME.has(name))
    .sort()
    .map((name) => ({
      name,
      group: "chat",
      custom: true,
      description: "Custom chat role. omp resolves it like any other role assignment.",
      selector: stored[name],
    }));
  return [...documented, ...custom];
}

// ---------------------------------------------------------------------------
// Host RPC — the real omp binary runs on the invoking machine
// ---------------------------------------------------------------------------

export const catalogResultSchema = z.object({
  version: z.string(),
  configPath: z.string(),
  models: z.array(catalogModelSchema),
  roles: z.array(roleSchema),
  /** `omp config get modelRoles`, verbatim, for diagnostics. */
  stored: z.record(z.string(), z.string()),
});

export type CatalogResult = z.infer<typeof catalogResultSchema>;

export const hostContract = defineRpcContract({
  /** Read the live catalog plus the current role assignments. */
  catalog: { input: z.null(), output: catalogResultSchema },
  /**
   * Write one role. The host validates every candidate against the catalog it
   * just read, then rewrites the WHOLE `modelRoles` record — omp replaces it
   * wholesale, so a single-role write must carry every other role forward.
   */
  assign: {
    input: z.object({ role: z.string().min(1), selector: z.string() }),
    output: z.object({ role: z.string(), selector: z.string(), stored: z.record(z.string(), z.string()) }),
  },
  /** Remove one role assignment, returning the role to omp's own resolution. */
  unset: {
    input: z.object({ role: z.string().min(1) }),
    output: z.object({ role: z.string(), stored: z.record(z.string(), z.string()) }),
  },
});

export type OmpModelsHostContract = typeof hostContract;

// ---------------------------------------------------------------------------
// Server RPC — what the bb frontend calls
// ---------------------------------------------------------------------------

export const rolePickerRowSchema = z.object({
  role: roleSchema,
  analysis: roleAnalysisSchema,
});

export const rpcContract = defineRpcContract({
  /** Catalog plus one analysis per role, so the page renders in one round trip. */
  overview: {
    input: z.null(),
    output: z.object({
      version: z.string(),
      configPath: z.string(),
      models: z.array(catalogModelSchema),
      rows: z.array(rolePickerRowSchema),
    }),
  },
  assign: {
    input: z.object({ role: z.string().min(1), selector: z.string().min(1) }),
    output: z.object({
      role: z.string(),
      selector: z.string(),
      /** The refreshed rows, so the page reflects what omp actually stored. */
      rows: z.array(rolePickerRowSchema),
    }),
  },
  unset: {
    input: z.object({ role: z.string().min(1) }),
    output: z.object({
      role: z.string(),
      rows: z.array(rolePickerRowSchema),
    }),
  },
});

export type RolePickerRow = z.infer<typeof rolePickerRowSchema>;