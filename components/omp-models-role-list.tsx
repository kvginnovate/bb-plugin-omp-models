// bb-plugin-omp-models — the roles list.
//
// One row per role, grouped the way omp's docs group them. Each row shows the
// model the role actually points at, so the page answers "what is X using?"
// at a glance; changing it opens a chooser that searches every provider.
import { useMemo, useState } from "react";
import type { CatalogModel, RolePickerRow } from "../contract.js";
import { ModelChooser } from "@/components/omp-models-model-chooser";
import { RoleRow } from "@/components/omp-models-role-row";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";

interface RoleListProps {
  rows: RolePickerRow[];
  models: CatalogModel[];
  assigning: string | null;
  unsetting: string | null;
  onAssign: (role: string, selector: string) => void;
  onUnset: (role: string) => void;
}

const SECTIONS = [
  { id: "chat", title: "Chat roles", match: (row: RolePickerRow) => !row.role.custom && row.role.group === "chat" },
  { id: "kind", title: "Model-kind roles", match: (row: RolePickerRow) => !row.role.custom && row.role.group === "model-kind" },
  { id: "custom", title: "Custom roles", match: (row: RolePickerRow) => row.role.custom },
] as const;

function matchesQuery(row: RolePickerRow, needle: string): boolean {
  if (needle.length === 0) return true;
  return [row.role.name, row.role.description, row.role.selector ?? ""].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

export function RoleList({ rows, models, assigning, unsetting, onAssign, onUnset }: RoleListProps) {
  const [query, setQuery] = useState("");
  const [chooserRole, setChooserRole] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => rows.filter((row) => matchesQuery(row, needle)), [rows, needle]);
  const chooserRow = chooserRole === null ? undefined : rows.find((row) => row.role.name === chooserRole);
  const busy = assigning !== null || unsetting !== null;

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter roles by name, purpose, or model"
          aria-label="Filter roles"
          className="pl-8"
        />
      </div>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No roles match “{query}”.
          <Button type="button" variant="link" size="sm" onClick={() => setQuery("")}>
            Clear filter
          </Button>
        </div>
      ) : null}

      {SECTIONS.map((section) => {
        const sectionRows = visible.filter(section.match);
        if (sectionRows.length === 0) return null;
        const assigned = sectionRows.filter((row) => row.role.selector !== null).length;
        return (
          <section key={section.id} aria-labelledby={`section-${section.id}`} className="flex flex-col gap-2">
            <h2 id={`section-${section.id}`} className="flex items-baseline gap-2 text-sm font-medium text-foreground">
              {section.title}
              <span className="text-xs font-normal text-muted-foreground">
                {assigned} of {sectionRows.length} set
              </span>
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {sectionRows.map((row) => (
                <RoleRow
                  key={row.role.name}
                  row={row}
                  models={models}
                  busy={
                    assigning === row.role.name ? "assigning" : unsetting === row.role.name ? "unsetting" : null
                  }
                  disabled={busy}
                  onChoose={() => setChooserRole(row.role.name)}
                  onAssign={(selector) => onAssign(row.role.name, selector)}
                  onUnset={() => onUnset(row.role.name)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {chooserRow !== undefined ? (
        <ModelChooser
          role={chooserRow.role}
          models={models}
          onClose={() => setChooserRole(null)}
          onAssign={(selector) => onAssign(chooserRow.role.name, selector)}
        />
      ) : null}
    </div>
  );
}
