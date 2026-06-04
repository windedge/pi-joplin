jest.mock("typebox", () => ({ Type: { Object: jest.fn(), String: jest.fn(), Optional: jest.fn() } }), { virtual: true });
jest.mock("@earendil-works/pi-coding-agent", () => ({
  truncateHead: jest.fn().mockReturnValue({ content: "mock content", truncated: false }),
  DEFAULT_MAX_BYTES: 1000,
  DEFAULT_MAX_LINES: 100
}), { virtual: true });

jest.mock("fs/promises", () => ({
  readFile: jest.fn().mockRejectedValue(new Error("Not found")),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

import initExtension from "./index";
import { JoplinClient } from "./joplin";
import * as fsPromises from "fs/promises";

jest.mock("./joplin");

describe("Extension", () => {
  it("registers tools", async () => {
    const mockPi = {
      registerTool: jest.fn(),
      registerCommand: jest.fn(),
      on: jest.fn(),
      appendEntry: jest.fn(),
    };
    initExtension(mockPi as any);
    expect(mockPi.registerTool).toHaveBeenCalledTimes(7);
    
    const registeredTools = mockPi.registerTool.mock.calls.map(call => call[0].name);
    expect(registeredTools).toContain("joplin_list_notebooks");
    expect(registeredTools).toContain("joplin_list_tags");
    expect(registeredTools).toContain("joplin_list_notes");
    expect(registeredTools).toContain("joplin_read_note");
    expect(registeredTools).toContain("joplin_get_note_metadata");
    expect(registeredTools).toContain("joplin_add_tag_to_note");
    expect(registeredTools).toContain("joplin_remove_tag_from_note");

    // Call execute on joplin_list_notebooks to get branch coverage
    const listNotebooksTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_list_notebooks")[0];
    (JoplinClient.prototype.listNotebooks as jest.Mock).mockResolvedValue([{ id: "1" }]);
    const result = await listNotebooksTool.execute("id", {});
    expect(result.details.count).toBe(1);

    // Call execute on joplin_list_tags
    const listTagsTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_list_tags")[0];
    (JoplinClient.prototype.listTags as jest.Mock).mockResolvedValue([{ id: "1", title: "tag1" }]);
    const tagsResult = await listTagsTool.execute("id", {});
    expect(tagsResult.details.count).toBe(1);

    // Call execute on joplin_list_notes
    const listNotesTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_list_notes")[0];
    (JoplinClient.prototype.listNotes as jest.Mock).mockResolvedValue([{ id: "1" }]);
    await listNotesTool.execute("id", { notebook: "nb" });

    (JoplinClient.prototype.listNotesByTag as jest.Mock).mockResolvedValue([{ id: "1" }]);
    await listNotesTool.execute("id", { tag: "tag" });

    // Test intersection logic (with short IDs from listNotesByTag)
    (JoplinClient.prototype.listNotes as jest.Mock).mockResolvedValue([{ id: "1234567890", title: "Shared" }, { id: "2222222222", title: "Notebook Only" }]);
    (JoplinClient.prototype.listNotesByTag as jest.Mock).mockResolvedValue([{ id: "12345", title: "Shared" }, { id: "33333", title: "Tag Only" }]);
    
    const intersectionResult = await listNotesTool.execute("id", { notebook: "nb", tag: "tag" });
    expect(intersectionResult.details.count).toBe(1);
    expect(intersectionResult.content[0].text).toContain("mock content");

    // Call execute on joplin_read_note
    const readNoteTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_read_note")[0];
    (JoplinClient.prototype.readNote as jest.Mock).mockResolvedValue("content");
    await readNoteTool.execute("id", { note: "note" });

    // Call execute on joplin_get_note_metadata
    const getMetadataTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_get_note_metadata")[0];
    (JoplinClient.prototype.getNoteMetadata as jest.Mock).mockResolvedValue({ id: "1" });
    await getMetadataTool.execute("id", { note: "note" });
    
    // Call execute on joplin_add_tag_to_note
    const addTagTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_add_tag_to_note")[0];
    (JoplinClient.prototype.addTagToNote as jest.Mock).mockResolvedValue(undefined);
    await addTagTool.execute("id", { note: "note", tag: "tag" });

    // Call execute on joplin_remove_tag_from_note
    const removeTagTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_remove_tag_from_note")[0];
    (JoplinClient.prototype.removeTagFromNote as jest.Mock).mockResolvedValue(undefined);
    await removeTagTool.execute("id", { note: "note", tag: "tag" });
  });

  it("handles tool_call event for HIL approval", async () => {
    const mockPi = {
      registerTool: jest.fn(),
      registerCommand: jest.fn(),
      on: jest.fn(),
      appendEntry: jest.fn(),
    };
    initExtension(mockPi as any);
    
    const toolCallHandler = mockPi.on.mock.calls.find(call => call[0] === "tool_call")[1];
    
    // Read-only tools bypass
    const bypassResult = await toolCallHandler({ toolName: "joplin_list_notes", input: {} }, {});
    expect(bypassResult).toBeUndefined();

    // HIL tool allowed Once
    const mockCtxAllow = { ui: { select: jest.fn().mockResolvedValue("Once") } };
    const allowResult = await toolCallHandler({ toolName: "joplin_add_tag_to_note", input: { note: "n1", tag: "t1" } }, mockCtxAllow);
    expect(allowResult).toBeUndefined();
    expect(mockCtxAllow.ui.select).toHaveBeenCalled();

    // HIL tool allowed Session
    const mockCtxSession = { ui: { select: jest.fn().mockResolvedValue("Session") } };
    const sessionResult = await toolCallHandler({ toolName: "joplin_add_tag_to_note", input: { note: "n1", tag: "t1" } }, mockCtxSession);
    expect(sessionResult).toBeUndefined();
    expect(mockPi.appendEntry).toHaveBeenCalled();

    // Re-verify session allowedtools seamlessly
    const sessionBypassResult = await toolCallHandler({ toolName: "joplin_add_tag_to_note", input: { note: "n1", tag: "t1" } }, mockCtxSession);
    expect(sessionBypassResult).toBeUndefined();

    // HIL tool allowed Always (handled partially by mock behavior testing UI interaction)
    (fsPromises.readFile as jest.Mock).mockRejectedValueOnce(new Error("missing"));
    const mockCtxAlways = { ui: { select: jest.fn().mockResolvedValue("Always") } };
    const alwaysResult = await toolCallHandler({ toolName: "joplin_remove_tag_from_note", input: { note: "n1", tag: "t1" } }, mockCtxAlways);
    expect(alwaysResult).toBeUndefined();
    expect(fsPromises.writeFile).toHaveBeenCalled();

    // Re-verify that after "Always", a future call bypasses seamlessly
    (fsPromises.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(["joplin_remove_tag_from_note"]));
    const allowlistBypassResult = await toolCallHandler({ toolName: "joplin_remove_tag_from_note", input: { note: "n1", tag: "t1" } }, mockCtxAlways);
    expect(allowlistBypassResult).toBeUndefined();

    // HIL tool blocked by No
    const mockCtxBlock = { ui: { select: jest.fn().mockResolvedValue("No") } };
    const blockResult = await toolCallHandler({ toolName: "joplin_remove_tag_from_note", input: { note: "n1", tag: "t1" } }, mockCtxBlock);
    expect(blockResult).toEqual({ block: true, reason: expect.any(String) });

    // HIL tool blocked by Escape (undefined)
    const mockCtxCancel = { ui: { select: jest.fn().mockResolvedValue(undefined) } };
    const cancelResult = await toolCallHandler({ toolName: "joplin_remove_tag_from_note", input: { note: "n1", tag: "t1" } }, mockCtxCancel);
    expect(cancelResult).toEqual({ block: true, reason: expect.any(String) });
    
    // Ignored tools (non-joplin)
    const ignoreResult = await toolCallHandler({ toolName: "bash", input: {} }, {});
    expect(ignoreResult).toBeUndefined();
  });

  it("registers config command and event listener", async () => {
    const mockPi = {
      registerTool: jest.fn(),
      registerCommand: jest.fn(),
      on: jest.fn(),
      appendEntry: jest.fn(),
    };
    initExtension(mockPi as any);
    
    expect(mockPi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(mockPi.registerCommand).toHaveBeenCalledWith("joplin-config", expect.any(Object));

    // Test session_start handler
    const sessionStartHandler = mockPi.on.mock.calls.find(call => call[0] === "session_start")[1];
    
    // Default load (no config)
    await sessionStartHandler(null, { sessionManager: { getEntries: () => [] } });
    
    // Load with config
    await sessionStartHandler(null, { 
      sessionManager: { 
        getEntries: () => [
          { type: "custom", customType: "joplin-config", data: { apiToken: "test" } },
          { type: "other" }
        ] 
      } 
    });

    // Test joplin-config command
    const configHandler = mockPi.registerCommand.mock.calls.find(call => call[0] === "joplin-config")[1].handler;
    const mockCtx = {
      ui: {
        input: jest.fn()
          .mockResolvedValueOnce("new-profile")
          .mockResolvedValueOnce("new-token"),
        notify: jest.fn()
      }
    };

    await configHandler({}, mockCtx);
    
    expect(mockCtx.ui.input).toHaveBeenCalledTimes(2);
    expect(mockPi.appendEntry).toHaveBeenCalledWith("joplin-config", {
      profilePath: "new-profile",
      apiToken: "new-token"
    });
    expect(mockCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("saved"), "info");

    // Test joplin-config command with empty inputs (should save undefined)
    mockCtx.ui.input = jest.fn()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("");
    await configHandler({}, mockCtx);
    expect(mockPi.appendEntry).toHaveBeenCalledWith("joplin-config", {
      profilePath: undefined,
      apiToken: undefined
    });
  });
});