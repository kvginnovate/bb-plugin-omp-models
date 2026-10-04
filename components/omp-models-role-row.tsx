// bb-plugin-omp-models — one role row of the roles matrix.
//
// The matrix cells (the provider buttons) are the fast assign path; this row
// is the slow one: free-text editing of the role's selector. omp accepts more
// than `provider/model` — `@alias`, `*`, comma-separated ordered candidates,
// and `:thinking` suffixes — so the editor shows a live candidate-by-candidate
// analysis (the server's `analyzeRole` output) and refuses to commit while any
// candidate is invalid.
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { analyzeRole, type CatalogModel, type RolePickerRow } from "../contract.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";


interface RoleRowProps {
  row: RolePickerRow;
  models: CatalogModel[];
  assigning: boolean;
  unsetting: boolean;
  onAssign: (selector: string) => void;
  onUnset: () => void;
}

export function RoleRow({
  row,
  models,
  assigning,
  unsetting,
  onAssign,
  onUnset,
}: RoleRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // Keep the draft in sync when the server refreshes the rows and the user
  // is not in the middle of editing this row.
  useEffect(() => {
    if (!editing) setDraft(row.role.selector ?? "");
  }, [row.role.selector, editing]);

  const analysis = useMemo(
    () => analyzeRole(draft, models),
    [draft, models],
  );
  const canSave =
    analysis.candidates.length > 0 &&
    analysis.valid &&
    !assigning;
  const invalidReasons = analysis.resolutions
    .filter((resolution) => resolution.status === "invalid")
    .map((resolution) => resolution.reason);

  const save = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSave) return;
    onAssign(draft);
    setEditing(false);
  };
  const cancel = () => {
    setDraft(row.role.selector ?? "");
    setEditing(false);
  };

  const selector = row.role.selector;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">{row.role.name}</h3>
        <span
          className={cn(
            "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
            row.role.group === "chat"
              ? "border-primary/30 text-primary"
              : "border-border text-muted-foreground",
          )}
        >
          {row.role.group === "chat" ? "chat" : "model-kind"}
        </span>
        {row.role.custom ? (
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            custom
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{row.role.description}</p>

      {editing ? (
        <form onSubmit={save} className="mt-2 flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="provider/model, @alias, provider/model:high"
              aria-label={`${row.role.name} selector`}
              autoFocus
            />
            <Button type="submit" size="sm" disabled={!canSave}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
          {analysis.candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Enter a selector — `provider/model`, an `@alias`, or a comma-separated ordered list.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {analysis.resolutions.map((resolution) => (
                <li
                  key={resolution.candidate}
                  className={cn(
                    "flex items-start gap-1.5 rounded-md border px-2 py-1 text-xs",
                    resolution.status === "ok"
                      ? "border-border text-foreground"
                      : "border-destructive/40 text-destructive",
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    {resolution.status === "ok" ? (
                      <Icon name="Check" className="size-3 text-primary" />
                    ) : (
                      <Icon name="X" className="size-3" />
                    )}
                  </span>
                  <code className="shrink-0 break-all font-mono">{resolution.candidate}</code>
                  {resolution.status === "invalid" ? (
                    <span className="text-destructive">{resolution.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canSave ? null : (
            <p className="text-xs text-muted-foreground">
              {invalidReasons.length > 0
                ? "Fix the invalid candidates above to save."
                : "Enter a selector to save."}
            </p>
          )}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            // The value is the point of this button, so it takes the full row
            // width and ellipsizes instead of competing with a hint beside it.
            "mt-2 block w-full truncate rounded-md border border-border bg-background px-2.5 py-2 text-left font-mono text-xs hover:bg-muted",
            selector === null ? "text-muted-foreground" : "text-foreground",
          )}
          title={selector ?? `assign a selector to ${row.role.name}`}
        >
          {selector ?? "(unset — omp resolves the role itself)"}
        </button>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={assigning}
          onClick={() => setEditing(true)}
        >
          <Icon name="Plus" className="size-3.5" />
          Edit selector
        </Button>
        {selector !== null ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={unsetting}
            onClick={onUnset}
          >
            <Icon name="Trash2" className="size-3.5" />
            Reset
          </Button>
        ) : null}
      </div>
    </div>
  );
}
