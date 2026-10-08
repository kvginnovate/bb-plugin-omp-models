// bb-plugin-omp-models — one role in the roles list.
//
// The row shows what the role resolves to (model name, provider, thinking
// level, fallbacks) instead of the raw selector, and offers two edit paths:
// the chooser for the common "point it at another model" case, and a text
// editor for what the chooser cannot express — `@alias`, `web/*`, `local/*`,
// and hand-ordered candidate lists. The text editor refuses to save while any
// candidate fails the same validation the host applies.
import { useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { analyzeRole, type CatalogModel, type RolePickerRow } from "../contract.js";
import { summarizeSelector } from "@/lib/selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

interface RoleRowProps {
  row: RolePickerRow;
  models: CatalogModel[];
  busy: "assigning" | "unsetting" | null;
  disabled: boolean;
  onChoose: () => void;
  onAssign: (selector: string) => void;
  onUnset: () => void;
}

function Assignment({ row, models }: { row: RolePickerRow; models: CatalogModel[] }) {
  const summary = summarizeSelector(row.role.selector, models);
  if (summary === null) {
    return <span className="text-sm text-muted-foreground">Not set — omp resolves it</span>;
  }
  const invalid = row.analysis.resolutions.find((resolution) => resolution.status === "invalid");
  return (
    <div className="min-w-0" title={row.role.selector ?? undefined}>
      <div className="flex min-w-0 items-center gap-1.5">
        {invalid !== undefined ? (
          <Icon name="TriangleAlert" fallback="AlertTriangle" className="size-3.5 shrink-0 text-destructive" />
        ) : null}
        <span className={cn("truncate text-sm", invalid ? "text-destructive" : "text-foreground")}>
          {summary.model?.name ?? summary.primarySelector}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        {summary.model !== null ? <code className="font-mono">{summary.model.selector}</code> : null}
        {summary.level !== null ? <span>thinking {summary.level}</span> : null}
        {summary.fallbacks.length > 0 ? (
          <span>
            +{summary.fallbacks.length} fallback{summary.fallbacks.length === 1 ? "" : "s"}
          </span>
        ) : null}
        {invalid !== undefined && invalid.status === "invalid" ? (
          <span className="text-destructive">{invalid.reason}</span>
        ) : null}
      </div>
    </div>
  );
}

function SelectorEditor({
  row,
  models,
  onSave,
  onCancel,
}: {
  row: RolePickerRow;
  models: CatalogModel[];
  onSave: (selector: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(row.role.selector ?? "");
  const analysis = useMemo(() => analyzeRole(draft, models), [draft, models]);
  const canSave = analysis.candidates.length > 0 && analysis.valid;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSave) onSave(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 md:col-span-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="provider/model:high, @smol, web/duckduckgo"
          aria-label={`${row.role.name} selector`}
          aria-invalid={!canSave}
          className="font-mono text-xs"
          autoFocus
        />
        <Button type="submit" size="sm" disabled={!canSave}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {analysis.candidates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Comma-separate candidates; omp uses the first one available. Esc cancels.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1" aria-live="polite">
          {analysis.resolutions.map((resolution) => (
            <li
              key={resolution.candidate}
              title={resolution.status === "invalid" ? resolution.reason : undefined}
              className={cn(
                "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
                resolution.status === "ok"
                  ? "border-border text-foreground"
                  : "border-destructive/40 text-destructive",
              )}
            >
              <Icon name={resolution.status === "ok" ? "Check" : "X"} className="size-3" />
              <code className="break-all font-mono">{resolution.candidate}</code>
              {resolution.status === "invalid" ? <span>— {resolution.reason}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

export function RoleRow({ row, models, busy, disabled, onChoose, onAssign, onUnset }: RoleRowProps) {
  const [editing, setEditing] = useState(false);
  const { role } = row;

  return (
    <li className="grid gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm font-medium text-foreground">{role.name}</span>
          {role.custom ? (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
              custom
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{role.description}</p>
      </div>

      {editing ? (
        <SelectorEditor
          row={row}
          models={models}
          onCancel={() => setEditing(false)}
          onSave={(selector) => {
            onAssign(selector);
            setEditing(false);
          }}
        />
      ) : (
        <>
          {busy !== null ? (
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
              <Icon name="LoaderCircle" fallback="Loader2" className="size-3.5 animate-spin" />
              {busy === "assigning" ? "Saving…" : "Resetting…"}
            </span>
          ) : (
            <Assignment row={row} models={models} />
          )}
          <div className="flex items-center gap-1 md:justify-end">
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onChoose}>
              {role.selector === null ? "Choose model" : "Change"}
            </Button>
            {/* The scaffold Button omits `title`, so the hover hint lives on a wrapper. */}
            <span title="Edit as text">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                disabled={disabled}
                onClick={() => setEditing(true)}
                aria-label={`Edit ${role.name} selector as text`}
              >
                <Icon name="Pencil" className="size-3.5" />
              </Button>
            </span>
            {role.selector !== null ? (
              <span title="Reset — let omp resolve this role">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  disabled={disabled}
                  onClick={onUnset}
                  aria-label={`Reset ${role.name}`}
                >
                  <Icon name="RotateCcw" className="size-3.5" />
                </Button>
              </span>
            ) : null}
          </div>
        </>
      )}
    </li>
  );
}
