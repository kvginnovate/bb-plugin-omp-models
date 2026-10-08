// bb-plugin-omp-models — the model chooser for one role.
//
// Searches every provider at once (provider chips narrow it), so comparing
// "same job, different vendor" never needs closing and reopening. A pick only
// replaces the role's primary candidate: the thinking level is carried over
// (and editable here for chat roles) and fallbacks are kept, because the
// stored value is often hand-written and a click must not discard it.
import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { THINKING_LEVELS, type CatalogModel, type Role } from "../contract.js";
import { replacePrimary, summarizeSelector } from "@/lib/selector";
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

const ALL_PROVIDERS = "__all__";
const NO_LEVEL = "__none__";

function formatWindow(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {children}
    </span>
  );
}

interface ModelChooserProps {
  role: Role;
  models: CatalogModel[];
  onClose: () => void;
  onAssign: (selector: string) => void;
}

export function ModelChooser({ role, models, onClose, onAssign }: ModelChooserProps) {
  const current = useMemo(() => summarizeSelector(role.selector, models), [role.selector, models]);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState(ALL_PROVIDERS);
  const [level, setLevel] = useState<string>(current?.level ?? NO_LEVEL);

  const providers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of models) counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [models]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models
      .filter((model) => provider === ALL_PROVIDERS || model.provider === provider)
      .filter(
        (model) =>
          needle.length === 0 ||
          model.name.toLowerCase().includes(needle) ||
          model.selector.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  }, [models, provider, query]);

  const visionRole = role.name === "vision";
  const chatRole = role.group === "chat";

  const pick = (model: CatalogModel) => {
    onAssign(replacePrimary(current, model.selector, level === NO_LEVEL ? null : level));
    onClose();
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const first = filtered[0];
    if (event.key === "Enter" && first !== undefined) {
      event.preventDefault();
      pick(first);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      {/* Dvh keeps the last models reachable above a phone keyboard. */}
      <DialogContent className="flex max-h-[85dvh] flex-col gap-3 sm:max-h-[80vh] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Model for <code className="font-mono">{role.name}</code>
          </DialogTitle>
          <DialogDescription>{role.description}</DialogDescription>
        </DialogHeader>

        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={`Search ${models.length} models — Enter picks the first`}
          aria-label="Search models"
          autoFocus
        />

        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Provider">
          {[[ALL_PROVIDERS, models.length] as const, ...providers].map(([id, count]) => (
            <button
              key={id}
              type="button"
              aria-pressed={provider === id}
              onClick={() => setProvider(id)}
              className={cn(
                "shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors",
                provider === id
                  ? "border-foreground/30 bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span className={id === ALL_PROVIDERS ? undefined : "font-mono"}>
                {id === ALL_PROVIDERS ? "All" : id}
              </span>
              <span className="ml-1 text-muted-foreground/70">{count}</span>
            </button>
          ))}
        </div>

        {chatRole || (current !== null && current.fallbacks.length > 0) ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {chatRole ? (
              <label className="flex items-center gap-2">
                Thinking
                <select
                  value={level}
                  onChange={(event) => setLevel(event.target.value)}
                  className="h-7 rounded-md border border-input bg-background px-1.5 font-mono text-xs text-foreground"
                >
                  <option value={NO_LEVEL}>none</option>
                  {THINKING_LEVELS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {current !== null && current.fallbacks.length > 0 ? (
              <span title={current.fallbacks.join(", ")}>
                Keeps {current.fallbacks.length} fallback{current.fallbacks.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        ) : null}

        <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1">
          {filtered.length === 0 ? (
            <li className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              No models match “{query}”.
            </li>
          ) : (
            filtered.map((model) => {
              const supportsImage = model.input?.includes("image") ?? false;
              const discouraged = visionRole && !supportsImage;
              const isCurrent = current?.primarySelector === model.selector;
              return (
                <li key={model.selector}>
                  <button
                    type="button"
                    onClick={() => pick(model)}
                    aria-current={isCurrent ? "true" : undefined}
                    className={cn(
                      "w-full min-h-11 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      isCurrent
                        ? "border-primary/50 bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-muted",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {isCurrent ? <Icon name="Check" className="size-3.5 shrink-0 text-primary" /> : null}
                        <span className="truncate text-sm font-medium text-foreground">{model.name}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {model.reasoning ? <Chip>thinking</Chip> : null}
                        {supportsImage ? <Chip>image-in</Chip> : null}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <code className="font-mono">{model.selector}</code>
                      <span>ctx {formatWindow(model.contextWindow)}</span>
                      <span>out {formatWindow(model.maxTokens)}</span>
                    </div>
                    {discouraged ? (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                        <Icon name="TriangleAlert" fallback="AlertTriangle" className="size-3 shrink-0" />
                        No image input — vision may not see attachments.
                      </p>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
