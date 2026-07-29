import {
  selectConfiguredRoots,
  expandAllowedIds,
  resolveNotebookInputs,
  parseNotebookInputList,
  formatScopeSummary,
  isSubsetById,
  materializeScope,
  loadGlobalConfig,
  saveGlobalConfig,
  addGlobalAllowedTool,
  getGlobalAllowedTools,
  GLOBAL_CONFIG_PATH,
  LEGACY_ALLOWLIST_PATH,
} from "./scope";
import * as fsPromises from "fs/promises";

jest.mock("fs/promises");

describe("scope helpers", () => {
  describe("selectConfiguredRoots", () => {
    it("is unrestricted when nothing configured", () => {
      expect(selectConfiguredRoots(undefined, undefined)).toEqual({ kind: "unrestricted" });
      expect(selectConfiguredRoots([], [])).toEqual({ kind: "unrestricted" });
    });

    it("uses session when global is unset", () => {
      const session = [{ id: "a", title: "A" }];
      expect(selectConfiguredRoots(undefined, session)).toEqual({
        kind: "restricted",
        roots: session,
      });
    });

    it("uses global when session is unset", () => {
      const global = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
      expect(selectConfiguredRoots(global, undefined)).toEqual({
        kind: "restricted",
        roots: global,
      });
    });

    it("narrows session to global subset", () => {
      const global = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
      const session = [{ id: "b", title: "B" }, { id: "c", title: "C" }];
      expect(selectConfiguredRoots(global, session)).toEqual({
        kind: "restricted",
        roots: [{ id: "b", title: "B" }],
      });
    });

    it("fail-closes when session has no overlap with global", () => {
      const global = [{ id: "a", title: "A" }];
      const session = [{ id: "c", title: "C" }];
      expect(selectConfiguredRoots(global, session).kind).toBe("fail-closed");
    });
  });

  describe("expandAllowedIds", () => {
    const tree = [
      { id: "root", title: "Root", parent_id: "" },
      { id: "child", title: "Child", parent_id: "root" },
      { id: "grand", title: "Grand", parent_id: "child" },
      { id: "other", title: "Other", parent_id: "" },
    ];

    it("includes descendants", () => {
      const { allowedIds, validRoots } = expandAllowedIds(tree, ["root"]);
      expect(validRoots).toEqual(["root"]);
      expect([...allowedIds].sort()).toEqual(["child", "grand", "root"]);
    });

    it("drops invalid roots", () => {
      const { allowedIds, validRoots } = expandAllowedIds(tree, ["missing", "other"]);
      expect(validRoots).toEqual(["other"]);
      expect([...allowedIds]).toEqual(["other"]);
    });
  });

  describe("resolveNotebookInputs", () => {
    const notebooks = [
      { id: "id1", title: "Work" },
      { id: "id2", title: "Personal" },
    ];

    it("resolves by title and id, skips duplicates", () => {
      const { resolved, missing } = resolveNotebookInputs(notebooks, ["Work", "id2", "Work", "x"]);
      expect(resolved).toEqual([
        { id: "id1", title: "Work" },
        { id: "id2", title: "Personal" },
      ]);
      expect(missing).toEqual(["x"]);
    });
  });

  it("parseNotebookInputList splits on commas and newlines", () => {
    expect(parseNotebookInputList("a, b; c\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("formatScopeSummary", () => {
    expect(formatScopeSummary(null)).toBe("unrestricted");
    expect(formatScopeSummary([{ id: "1", title: "A" }])).toBe("A (1)");
    expect(formatScopeSummary(null, "gone")).toBe("fail-closed: gone");
  });

  it("isSubsetById", () => {
    const ceiling = [{ id: "a", title: "A" }, { id: "b", title: "B" }];
    expect(isSubsetById([{ id: "a", title: "A" }], ceiling)).toBe(true);
    expect(isSubsetById([{ id: "c", title: "C" }], ceiling)).toBe(false);
  });

  describe("materializeScope", () => {
    const notebooks = [
      { id: "root", title: "Root", parent_id: "" },
      { id: "child", title: "Child", parent_id: "root" },
    ];

    it("unrestricted", () => {
      const result = materializeScope({ kind: "unrestricted" }, notebooks);
      expect(result.allowedIds).toBeNull();
      expect(result.failClosed).toBe(false);
    });

    it("expands restricted roots and refreshes titles", () => {
      const result = materializeScope(
        { kind: "restricted", roots: [{ id: "root", title: "Old" }] },
        notebooks
      );
      expect(result.failClosed).toBe(false);
      expect(result.roots).toEqual([{ id: "root", title: "Root" }]);
      expect(result.allowedIds?.has("child")).toBe(true);
    });

    it("fail-closes when all configured roots are missing", () => {
      const result = materializeScope(
        { kind: "restricted", roots: [{ id: "missing", title: "X" }] },
        notebooks
      );
      expect(result.failClosed).toBe(true);
      expect(result.allowedIds?.size).toBe(0);
    });

    it("materializes explicit fail-closed configured roots", () => {
      const result = materializeScope(
        { kind: "fail-closed", reason: "no overlap" },
        notebooks
      );
      expect(result.failClosed).toBe(true);
      expect(result.summary).toContain("no overlap");
    });
  });

  describe("global config file", () => {
    beforeEach(() => {
      jest.resetAllMocks();
    });

    it("loads object config", async () => {
      (fsPromises.readFile as jest.Mock).mockResolvedValueOnce(
        JSON.stringify({ allowedTools: ["joplin_edit_note"], profilePath: "/p" })
      );
      const config = await loadGlobalConfig();
      expect(config.allowedTools).toEqual(["joplin_edit_note"]);
      expect(config.profilePath).toBe("/p");
    });

    it("treats array joplin.json as tool allowlist", async () => {
      (fsPromises.readFile as jest.Mock).mockResolvedValueOnce(
        JSON.stringify(["joplin_edit_note"])
      );
      const config = await loadGlobalConfig();
      expect(config.allowedTools).toEqual(["joplin_edit_note"]);
    });

    it("returns empty config for invalid json types", async () => {
      (fsPromises.readFile as jest.Mock)
        .mockResolvedValueOnce("null")
        .mockRejectedValueOnce(new Error("no legacy"));
      // first path returns null object check; actually null is object? typeof null === 'object'
      // our code: !parsed => return {}
      await expect(loadGlobalConfig()).resolves.toEqual({});
    });

    it("migrates legacy allowlist array file", async () => {
      (fsPromises.readFile as jest.Mock)
        .mockRejectedValueOnce(new Error("missing joplin.json"))
        .mockResolvedValueOnce(JSON.stringify(["joplin_create_note"]));
      const config = await loadGlobalConfig();
      expect(config.allowedTools).toEqual(["joplin_create_note"]);
      expect(fsPromises.readFile).toHaveBeenCalledWith(LEGACY_ALLOWLIST_PATH, "utf8");
    });

    it("saves config and adds allowed tools", async () => {
      (fsPromises.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({ allowedTools: [] })
      );
      (fsPromises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);

      await addGlobalAllowedTool("joplin_move_note");
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        GLOBAL_CONFIG_PATH,
        expect.stringContaining("joplin_move_note")
      );

      (fsPromises.readFile as jest.Mock).mockResolvedValue(
        JSON.stringify({ allowedTools: ["joplin_move_note"] })
      );
      await expect(getGlobalAllowedTools()).resolves.toEqual(["joplin_move_note"]);
    });

    it("saveGlobalConfig writes json", async () => {
      (fsPromises.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);
      await saveGlobalConfig({ allowedNotebooks: [{ id: "1", title: "A" }] });
      expect(fsPromises.writeFile).toHaveBeenCalledWith(
        GLOBAL_CONFIG_PATH,
        expect.stringContaining("allowedNotebooks")
      );
    });
  });
});
