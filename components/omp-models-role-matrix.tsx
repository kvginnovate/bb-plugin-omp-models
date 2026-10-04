// bb-plugin-omp-models — the roles × providers matrix.
//
// Rows are roles, columns are providers, and each cell is the first catalog
// model of that provider. omp's own picker groups by provider; keeping that
// shape here is what makes "same job, different vendor" a single glance instead
// of a search.
import { useMemo, useState } from "react";
import type { CatalogModel, RolePickerRow } from "../contract.js";
import { ModelChooser } from "@/components/omp-models-model-chooser";
import { RoleRow } from "@/components/omp-models-role-row";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** Which (role, provider) pair the chooser is currently open for. */
interface ChooserTarget {
  role: string;
  provider: string;
}

interface RoleMatrixProps {
  rows: RolePickerRow[];
  models: CatalogModel[];
  assigning: string | null;
  unsetting: string | null;
  onAssign: (role: string, selector: string) => void;
  onUnset: (role: string) => void;
}

/**
 * One provider per column, alphabetized, each with its models. A provider with
 * no models cannot be a role target, so it gets no column at all.
 */
function useProviderColumns(models: CatalogModel[]) {
  return useMemo(() => {
    const byProvider = new Map<string, CatalogModel[]>();
    for (const model of models) {
      const bucket = byProvider.get(model.provider);
      if (bucket) bucket.push(model);
      else byProvider.set(model.provider, [model]);
    }
    return [...byProvider.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([provider, providerModels]) => ({ provider, models: providerModels }));
  }, [models]);
}

/**
 * The model a stored selector actually names. A role value is an ordered
 * candidate list, so only the first candidate decides the highlight, and a
 * `:thinking` suffix is not part of the model id.
 */
function matchesSelector(selector: string | null, model: CatalogModel): boolean {
  if (selector === null) return false;
  const primary = selector.split(",")[0]?.trim();
  if (primary === undefined) return false;
  return model.selector === primary.split(":")[0];
}

/** True when the row's stored selector names one of this provider's models. */
function rowTargetsProvider(row: RolePickerRow, providerModels: CatalogModel[]): boolean {
  return providerModels.some((model) => matchesSelector(row.role.selector, model));
}

interface ProviderTableProps {
  rows: RolePickerRow[];
  columns: { provider: string; models: CatalogModel[] }[];
  busy: boolean;
  onPick: (role: string, provider: string) => void;
}

/** The wide roles × providers grid, rendered only at `md` and up. */
function ProviderTable({ rows, columns, busy, onPick }: ProviderTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="sticky left-0 z-10 bg-background px-3 py-2 text-left text-xs font-medium text-muted-foreground"
            >
              Role
            </th>
            {columns.map((column) => (
              <th
                key={column.provider}
                scope="col"
                className="px-3 py-2 text-left text-xs font-medium text-muted-foreground"
              >
                <span className="font-mono">{column.provider}</span>
                <span className="ml-1.5 font-sans text-muted-foreground/70">
                  {column.models.length}
                </span>
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Selector
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.role.name} className="border-b border-border last:border-b-0">
              <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-2 text-left">
                <span className="font-mono text-xs font-medium text-foreground">
                  {row.role.name}
                </span>
                {row.role.custom ? (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">custom</span>
                ) : null}
              </th>
              {columns.map((column) => {
                const active = rowTargetsProvider(row, column.models);
                return (
                  <td key={column.provider} className="p-1">
                    <button
                      type="button"
                      aria-label={`Assign a ${column.provider} model to ${row.role.name}`}
                      disabled={busy}
                      onClick={() => onPick(row.role.name, column.provider)}
                      className={cn(
                        "w-full min-w-24 truncate rounded-md border px-2 py-1 text-left font-mono text-[11px] transition-colors",
                        "disabled:opacity-50",
                        active
                          ? "border-primary/50 bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {active ? "●" : "○"}
                    </button>
                  </td>
                );
              })}
              <td className="px-3 py-2">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {row.role.selector ?? "(unset)"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RoleMatrix({
  rows,
  models,
  assigning,
  unsetting,
  onAssign,
  onUnset,
}: RoleMatrixProps) {
  const columns = useProviderColumns(models);
  const [target, setTarget] = useState<ChooserTarget | null>(null);

  const targetRow = target === null ? null : rows.find((row) => row.role.name === target.role);
  const targetColumn =
    target === null ? undefined : columns.find((column) => column.provider === target.provider);

  return (
    <div className="flex flex-col gap-6">
      {/*
        The matrix is a wide table on desktop, and a per-role provider list on
        narrow screens. 8 provider columns at phone width collapse to slivers,
        and the provider NAME is the only thing that distinguishes the cells —
        so below `md` each role becomes its own block listing every provider as
        a labelled row, which is both readable and a bigger tap target.
      */}
      <div className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <div key={row.role.name} className="rounded-lg border border-border">
            <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
              <span className="font-mono text-xs font-medium text-foreground">
                {row.role.name}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]",
                  row.analysis.valid ? "border-border text-muted-foreground" : "border-destructive/40 text-destructive",
                )}
              >
                {row.analysis.valid ? row.role.group : "unresolved"}
              </span>
            </div>
            <ul>
              {columns.map((column) => {
                const active = rowTargetsProvider(row, column.models);
                return (
                  <li key={column.provider}>
                    <button
                      type="button"
                      disabled={assigning !== null}
                      onClick={() => setTarget({ role: row.role.name, provider: column.provider })}
                      className={cn(
                        // `min-h-11` keeps the row a comfortable tap target on a
                        // touch screen without inflating it on desktop, where
                        // this list is hidden.
                        "flex min-h-11 w-full items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-left last:border-b-0 disabled:opacity-50",
                        active ? "bg-primary/10" : "hover:bg-muted",
                      )}
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {column.provider}
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-xs text-foreground">
                          {active
                            ? column.models.find((model) => matchesSelector(row.role.selector, model))?.name ??
                              "assigned"
                            : `${column.models.length} models`}
                        </span>
                        <Icon name={active ? "Check" : "ChevronRight"} className="size-3.5 shrink-0 text-muted-foreground" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="hidden md:block">
        <ProviderTable
          rows={rows}
          columns={columns}
          busy={assigning !== null}
          onPick={(role, provider) => setTarget({ role, provider })}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-foreground">Edit a selector</h2>
        {rows.map((row) => (
          <div key={row.role.name} className="rounded-lg border border-border">
            <RoleRow
              row={row}
              models={models}
              assigning={assigning === row.role.name}
              unsetting={unsetting === row.role.name}
              onAssign={(selector) => onAssign(row.role.name, selector)}
              onUnset={() => onUnset(row.role.name)}
            />
          </div>
        ))}
      </div>

      {targetRow && targetColumn && target !== null ? (
        <ModelChooser
          role={targetRow.role}
          provider={target.provider}
          models={targetColumn.models}
          open
          assigning={assigning !== null}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
          onAssign={(selector) => onAssign(target.role, selector)}
        />
      ) : null}
    </div>
  );
}

/** Header used by the page: the omp version and config file the data came from. */
export function MatrixHeader({ version, configPath, modelCount }: {
  version: string;
  configPath: string;
  modelCount: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>
        omp <span className="font-mono text-foreground">{version}</span>
      </span>
      <span>
        <span className="font-mono text-foreground">{modelCount}</span> models
      </span>
      <span className="font-mono truncate">{configPath}</span>
    </div>
  );
}

export function ReloadHint({ onReload, loading }: { onReload: () => void; loading: boolean }) {
  return (
    <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={onReload}>
      {loading ? (
        <span className="text-xs">Reading omp…</span>
      ) : (
        <>
          <Icon name="RefreshCw" className="size-3.5" />
          Re-read from omp
        </>
      )}
    </Button>
)
}