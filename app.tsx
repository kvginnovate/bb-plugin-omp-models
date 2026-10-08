// bb-plugin-omp-models — a BB plugin frontend entry.
//
// Compiled by `bb plugin build` into dist/app.js + dist/app.css. React and
// @get-bb/plugin-sdk/app are provided by the BB app at load time (never bundled),
// so this file must be loaded by BB, not imported directly.
//
// The page is omp's `/models` roles view: one row per role showing the model
// it points at, with a chooser that searches every provider. All state comes from the server's `overview` RPC — which reads the live
// catalog and the stored assignments through the plugin's host entry, i.e. the
// real `omp` binary on this machine.
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rpcContract, type RolePickerRow, type CatalogModel } from "./contract";
import { RoleList } from "@/components/omp-models-role-list";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

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

function LoadingRows() {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Reading the omp catalog">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="flex items-center gap-4 px-4 py-4">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-7 w-16 animate-pulse rounded bg-muted" />
        </li>
      ))}
    </ul>
  );
}

function PageHeader({
  overview,
  loading,
  onReload,
}: {
  overview: Overview | null;
  loading: boolean;
  onReload: () => void;
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      {/* `min-w-0` lets the config path truncate instead of pushing the button off-screen. */}
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-muted-foreground">
          Pick the model omp uses for each job. Changes are validated against the live catalog;
          running omp sessions pick them up on restart.
        </p>
        {overview !== null ? (
          <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              omp <span className="font-mono text-foreground">{overview.version}</span>
            </span>
            <span>
              <span className="text-foreground">{overview.models.length}</span> models
            </span>
            <span className="min-w-0 truncate font-mono" title={overview.configPath}>
              {overview.configPath}
            </span>
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="shrink-0"
        disabled={loading}
        onClick={onReload}
        aria-label="Reload the catalog and roles from omp"
      >
        <Icon name="RefreshCw" className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
        Reload
      </Button>
    </header>
  );
}

function RolesPage() {
  const { overview, error, loading, assigning, unsetting, refresh, assign, unset } = useRoles();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-5 p-4 md:p-6">
        <PageHeader overview={overview} loading={loading} onReload={() => void refresh()} />

        {error !== null ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
            <p className="font-medium text-destructive">Could not read omp</p>
            <p className="mt-1 break-words text-xs text-destructive/90">{error}</p>
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void refresh()}>
              Try again
            </Button>
          </div>
        ) : null}

        {loading && overview === null ? <LoadingRows /> : null}

        {overview !== null && overview.rows.length === 0 ? (
          <EmptyState>omp reports no model roles.</EmptyState>
        ) : null}

        {overview !== null && overview.rows.length > 0 ? (
          <RoleList
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