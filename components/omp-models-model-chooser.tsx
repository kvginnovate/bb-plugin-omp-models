// bb-plugin-omp-models — the model chooser opened from a matrix cell.
//
// Lists one provider's catalog models so a role can be pointed at any of them.
// The search box narrows within the open chooser; a vision role warns (never
// blocks) when a pick has no `image` input, because omp treats image support
// as an additional check, not a selector constraint.
import { useMemo, useState } from "react";
import type { CatalogModel, Role } from "../contract.js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function formatWindow(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

interface ModelChooserProps {
  role: Role;
  provider: string;
  models: CatalogModel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssign: (selector: string) => void;
  assigning: boolean;
}

export function ModelChooser({
  role,
  provider,
  models,
  open,
  onOpenChange,
  onAssign,
  assigning,
}: ModelChooserProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return models;
    return models.filter(
      (model) =>
        model.name.toLowerCase().includes(needle) ||
        model.id.toLowerCase().includes(needle),
    );
  }, [models, query]);

  // Image input is an additional check for the vision role, never a constraint
  // on the selector — so a text-only pick is discouraged, not forbidden.
  const visionRole = role.name === "vision";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        `max-h` with the Dvh unit plus a `flex-col` body lets the model list
        scroll while the title and filter box stay put. On a phone the dialog
        owns nearly the whole viewport, so a fixed `80vh` used to leave the
        last models unreachable behind the keyboard.
      */}
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>
            {provider} → {role.name}
          </DialogTitle>
          <DialogDescription>
            Pick a {provider} model for the <code className="font-mono">{role.name}</code> role.
            {visionRole
              ? " The vision role prefers models that accept image input."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Filter ${models.length} ${provider} models…`}
          aria-label={`Filter ${provider} models`}
          className="mt-3"
        />

        <ul className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {filtered.length === 0 ? (
            <li className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No {provider} models match `{query}`.
            </li>
          ) : (
            filtered.map((model) => {
              const supportsImage = model.input?.includes("image") ?? false;
              const discouraged = visionRole && !supportsImage;
              return (
                <li key={model.selector}>
                  <button
                    type="button"
                    disabled={assigning}
                    onClick={() => {
                      onAssign(model.selector);
                      onOpenChange(false);
                    }}
                    className={cn(
                      // `min-h-11` makes each model a comfortable tap target on
                      // a phone without inflating the desktop dialog.
                      "w-full min-h-11 rounded-lg border px-3 py-2 text-left transition-colors",
                      "hover:bg-muted disabled:opacity-50",
                      discouraged
                        ? "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-foreground">
                        {model.name}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {model.reasoning ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            thinking
                          </span>
                        ) : null}
                        {supportsImage ? (
                          <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            image-in
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span>ctx {formatWindow(model.contextWindow)}</span>
                      <span>out {formatWindow(model.maxTokens)}</span>
                      <code className="font-mono">{model.selector}</code>
                    </div>
                    {discouraged ? (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                        <Icon name="X" className="mt-0.5 size-3 shrink-0" />
                        No image input — the vision role may not be able to see
                        attachments with this model.
                      </p>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            <Icon name="X" className="size-3.5" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
