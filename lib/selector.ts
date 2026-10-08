// Pure helpers for reading and rewriting a stored role value in the UI.
//
// A role value is an ordered candidate list (`a/b:high, c/d`), so a model pick
// from the chooser must only replace the FIRST candidate and keep both its
// thinking suffix and the fallbacks — otherwise one click silently discards
// configuration the user wrote by hand.
import { parseCandidates, splitThinkingSuffix, type CatalogModel } from "../contract.js";

export interface SelectorSummary {
  /** The first candidate exactly as stored, suffix included. */
  primary: string;
  /** The first candidate without its thinking suffix. */
  primarySelector: string;
  level: string | null;
  /** Catalog row the primary candidate names, when there is one. */
  model: CatalogModel | null;
  fallbacks: string[];
}

export function summarizeSelector(
  selector: string | null,
  models: readonly CatalogModel[],
): SelectorSummary | null {
  if (selector === null) return null;
  const [primary, ...fallbacks] = parseCandidates(selector);
  if (primary === undefined) return null;
  const { selector: primarySelector, level } = splitThinkingSuffix(primary);
  const model = models.find((candidate) => candidate.selector === primarySelector) ?? null;
  return { primary, primarySelector, level, model, fallbacks };
}

/** Swap the primary candidate, keeping the chosen thinking level and every fallback. */
export function replacePrimary(
  current: SelectorSummary | null,
  modelSelector: string,
  level: string | null,
): string {
  const primary = level === null ? modelSelector : `${modelSelector}:${level}`;
  return [primary, ...(current?.fallbacks ?? [])].join(",");
}
