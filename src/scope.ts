import * as fsPromises from "fs/promises";
import * as path from "path";
import * as os from "os";

export type NotebookRef = { id: string; title: string };

export type GlobalJoplinConfig = {
  allowedNotebooks?: NotebookRef[];
  allowedTools?: string[];
  profilePath?: string;
};

export type SessionJoplinConfig = {
  profilePath?: string;
  apiToken?: string;
  allowedTools?: string[];
  allowedNotebooks?: NotebookRef[];
};

export const GLOBAL_CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "joplin.json");
export const LEGACY_ALLOWLIST_PATH = path.join(os.homedir(), ".pi", "agent", "joplin-allowlist.json");

export type EffectiveRoots =
  | { kind: "unrestricted" }
  | { kind: "restricted"; roots: NotebookRef[] }
  | { kind: "fail-closed"; reason: string };

/**
 * Compute configured root notebooks before validating against the live tree.
 * - missing/empty config => unrestricted
 * - global set => hard ceiling; session may only narrow
 * - no global, session set => session is effective
 */
export function selectConfiguredRoots(
  globalNotebooks: NotebookRef[] | undefined,
  sessionNotebooks: NotebookRef[] | undefined
): EffectiveRoots {
  const global = globalNotebooks && globalNotebooks.length > 0 ? globalNotebooks : undefined;
  const session = sessionNotebooks && sessionNotebooks.length > 0 ? sessionNotebooks : undefined;

  if (!global) {
    if (!session) return { kind: "unrestricted" };
    return { kind: "restricted", roots: session };
  }

  if (!session) {
    return { kind: "restricted", roots: global };
  }

  const globalIds = new Set(global.map((n) => n.id));
  const narrowed = session.filter((n) => globalIds.has(n.id));
  if (narrowed.length === 0) {
    return {
      kind: "fail-closed",
      reason: "Session notebook scope has no overlap with the global scope",
    };
  }
  return { kind: "restricted", roots: narrowed };
}

/** Expand root notebook IDs to include all descendants. Invalid roots are dropped. */
export function expandAllowedIds(
  notebooks: { id: string; parent_id?: string }[],
  rootIds: string[]
): { allowedIds: Set<string>; validRoots: string[] } {
  const byId = new Map(notebooks.map((n) => [n.id, n]));
  const children = new Map<string, string[]>();
  for (const n of notebooks) {
    const parent = n.parent_id || "";
    const list = children.get(parent) || [];
    list.push(n.id);
    children.set(parent, list);
  }

  const validRoots = rootIds.filter((id) => byId.has(id));
  const allowedIds = new Set<string>();
  const stack = [...validRoots];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (allowedIds.has(id)) continue;
    allowedIds.add(id);
    for (const child of children.get(id) || []) {
      stack.push(child);
    }
  }
  return { allowedIds, validRoots };
}

/** Resolve user input (title or id, comma-separated pieces already split) to NotebookRefs. */
export function resolveNotebookInputs(
  notebooks: { id: string; title: string }[],
  inputs: string[]
): { resolved: NotebookRef[]; missing: string[] } {
  const resolved: NotebookRef[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const raw of inputs) {
    const input = raw.trim();
    if (!input) continue;
    const match = notebooks.find((n) => n.id === input || n.title === input);
    if (!match) {
      missing.push(input);
      continue;
    }
    if (seen.has(match.id)) continue;
    seen.add(match.id);
    resolved.push({ id: match.id, title: match.title });
  }
  return { resolved, missing };
}

export function parseNotebookInputList(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatScopeSummary(roots: NotebookRef[] | null | undefined, failClosedReason?: string): string {
  if (failClosedReason) {
    return `fail-closed: ${failClosedReason}`;
  }
  if (!roots || roots.length === 0) {
    return "unrestricted";
  }
  return roots.map((r) => `${r.title} (${r.id})`).join(", ");
}

export function isSubsetById(candidate: NotebookRef[], ceiling: NotebookRef[]): boolean {
  const allowed = new Set(ceiling.map((n) => n.id));
  return candidate.every((n) => allowed.has(n.id));
}

export async function loadGlobalConfig(): Promise<GlobalJoplinConfig> {
  try {
    const data = await fsPromises.readFile(GLOBAL_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(data);
    // Accidental array write / mistaken format: treat as tool allowlist
    if (Array.isArray(parsed)) {
      return { allowedTools: parsed.filter((x) => typeof x === "string") };
    }
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as GlobalJoplinConfig;
  } catch {
    // Fall through to legacy tool allowlist migration
  }

  try {
    const legacy = await fsPromises.readFile(LEGACY_ALLOWLIST_PATH, "utf8");
    const parsed = JSON.parse(legacy);
    if (Array.isArray(parsed)) {
      return { allowedTools: parsed.filter((x) => typeof x === "string") };
    }
  } catch {
    // ignore
  }

  return {};
}

export async function saveGlobalConfig(config: GlobalJoplinConfig): Promise<void> {
  await fsPromises.mkdir(path.dirname(GLOBAL_CONFIG_PATH), { recursive: true });
  await fsPromises.writeFile(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function getGlobalAllowedTools(): Promise<string[]> {
  const config = await loadGlobalConfig();
  return config.allowedTools || [];
}

export async function addGlobalAllowedTool(toolName: string): Promise<void> {
  const config = await loadGlobalConfig();
  const list = config.allowedTools || [];
  if (!list.includes(toolName)) {
    list.push(toolName);
    config.allowedTools = list;
    await saveGlobalConfig(config);
  }
}

/**
 * Validate configured roots against the live notebook tree.
 * Configured-but-all-invalid => fail-closed.
 */
export function materializeScope(
  configured: EffectiveRoots,
  notebooks: { id: string; title: string; parent_id?: string }[]
): {
  allowedIds: Set<string> | null;
  roots: NotebookRef[] | null;
  summary: string;
  failClosed: boolean;
} {
  if (configured.kind === "unrestricted") {
    return { allowedIds: null, roots: null, summary: "unrestricted", failClosed: false };
  }

  if (configured.kind === "fail-closed") {
    return {
      allowedIds: new Set(),
      roots: [],
      summary: formatScopeSummary(null, configured.reason),
      failClosed: true,
    };
  }

  const { allowedIds, validRoots } = expandAllowedIds(
    notebooks,
    configured.roots.map((r) => r.id)
  );

  if (validRoots.length === 0) {
    const reason = "Configured notebook scope entries were not found in Joplin (deleted or wrong profile)";
    return {
      allowedIds: new Set(),
      roots: [],
      summary: formatScopeSummary(null, reason),
      failClosed: true,
    };
  }

  const roots = validRoots.map((id) => {
    const live = notebooks.find((n) => n.id === id)!;
    const prior = configured.roots.find((r) => r.id === id);
    return { id, title: live.title || prior?.title || id };
  });

  return {
    allowedIds,
    roots,
    summary: formatScopeSummary(roots),
    failClosed: false,
  };
}
