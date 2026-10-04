// bb-plugin-omp-models — a BB plugin frontend entry.
//
// Compiled by `bb plugin build` into dist/app.js + dist/app.css. React and
// @get-bb/plugin-sdk/app are provided by the BB app at load time (never bundled),
// so this file must be loaded by BB, not imported directly.
//
// The page is omp's `/models` roles view: every role down the side, every
// provider across the top, and a click assigns that provider's model to the
// role. All state comes from the server's `overview` RPC — which reads the live
// catalog and the stored assignments through the plugin's host entry, i.e. the
// real `omp` binary on this machine.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, type RolePickerRow, type CatalogModel } from "./contract";
import { MatrixHeader, ReloadHint, RoleMatrix } from "@/components/omp-models-role-matrix";
import { Button } from "@/components/ui/button";

/** The dashed box BB's own list pages use for loading and empty states. */
function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

type Overview = {
  version: string;
  configPath: string;
  models: CatalogModel[];
  rows: RolePickerRow[];
};

/**
 * Every mutation returns the refreshed rows from a fresh catalog read, so the
 * page never shows a value omp did not actually store.
 */
function useRoles() {
  const rpc = useRpc<typeof rpcContract>();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [unsetting, setUnsetting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await rpc.call("overview", null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const assign = useCallback(
    async (role: string, selector: string) => {
      setAssigning(role);
      try {
        const out = await rpc.call("assign", { role, selector });
        setOverview((current) =>
          current === null ? current : { ...current, rows: out.rows },
        );
        toast.success(`${role} → ${selector}`, {
          description: "A running omp session keeps its old model until restarted.",
        });
      } catch (err) {
        toast.error(`Could not assign ${role}`, {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setAssigning(null);
      }
    },
    [rpc],
  );

  const unset = useCallback(
    async (role: string) => {
      setUnsetting(role);
      try {
        const out = await rpc.call("unset", { role });
        setOverview((current) =>
          current === null ? current : { ...current, rows: out.rows },
        );
        toast.success(`${role} is unset`, {
          description: "omp resolves the role again from its own priority chain.",
        });
      } catch (err) {
        toast.error(`Could not unset ${role}`, {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setUnsetting(null);
      }
    },
    [rpc],
  );

  return { overview, error, loading, assigning, unsetting, refresh, assign, unset };
}

function RolesPage() {
  const { overview, error, loading, assigning, unsetting, refresh, assign, unset } = useRoles();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-5">
        {/* `min-w-0` on the text column is what lets the config path truncate
            instead of pushing the reload button off a narrow screen. */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm text-muted-foreground">
              omp keeps one <code className="font-mono">modelRoles</code> record in its config
              file. This page reads the live catalog and rewrites that record, the same thing
              omp&apos;s <code className="font-mono">/models</code> roles view does.
            </p>
            {overview !== null ? (
              <MatrixHeader
                version={overview.version}
                configPath={overview.configPath}
                modelCount={overview.models.length}
              />
            ) : null}
          </div>
          <div className="shrink-0 self-start">
            <ReloadHint onReload={() => void refresh()} loading={loading} />
          </div>
        </header>

        {overview !== null ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            omp replaces the whole <code className="font-mono">modelRoles</code> record on
            every write and validates nothing, so every selector here is checked against the
            live catalog first and the other assignments are carried forward. A running omp
            session keeps the model it started with.
          </p>
        ) : null}

        {error !== null ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium text-destructive">Could not read omp</p>
            <p className="mt-1 break-words text-xs text-destructive/90">{error}</p>
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void refresh()}>
              Try again
            </Button>
          </div>
        ) : null}

        {loading && overview === null ? (
          <EmptyState>Reading the omp catalog…</EmptyState>
        ) : null}

        {overview !== null && overview.rows.length === 0 ? (
          <EmptyState>omp reports no model roles.</EmptyState>
        ) : null}

        {overview !== null && overview.rows.length > 0 ? (
          <RoleMatrix
            rows={overview.rows}
            models={overview.models}
            assigning={assigning}
            unsetting={unsetting}
            onAssign={(role, selector) => void assign(role, selector)}
            onUnset={(role) => void unset(role)}
          />
        ) : null}
      </div>
    </div>
  );
}

// The default export must be definePluginApp(...); BB interprets it after
// loading the bundle. navPanel adds a page to the left sidebar.
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "roles",
    title: "Model roles",
    icon: "Brain",
    // Routed at /plugins/omp-models/roles; the component receives the
    // remainder as `subPath` for deep links within the page.
    path: "roles",
    component: RolesPage,
  });
});