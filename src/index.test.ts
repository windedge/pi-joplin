jest.mock("typebox", () => ({ Type: { Object: jest.fn(), String: jest.fn(), Optional: jest.fn(), Union: jest.fn(), Literal: jest.fn(), Boolean: jest.fn(), Number: jest.fn() } }), { virtual: true });
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

function mockClientInstance(overrides: Record<string, any> = {}) {
  const instance = {
    setApiToken: jest.fn().mockResolvedValue(undefined),
    init: jest.fn().mockResolvedValue(undefined),
    listAllNotebooks: jest.fn().mockResolvedValue([]),
    setScope: jest.fn(),
    getScopeSummary: jest.fn().mockReturnValue("unrestricted"),
    isScoped: jest.fn().mockReturnValue(false),
    listNotebooks: jest.fn().mockResolvedValue([{ id: "1" }]),
    listTags: jest.fn().mockResolvedValue([{ id: "1", title: "tag1" }]),
    listNotes: jest.fn().mockResolvedValue({ notes: [{ id: "1" }], has_more: false }),
    listNotesByTag: jest.fn().mockResolvedValue({ notes: [{ id: "1" }], has_more: false }),
    readNote: jest.fn().mockResolvedValue("content"),
    getNoteMetadata: jest.fn().mockResolvedValue({ id: "1" }),
    addTagToNote: jest.fn().mockResolvedValue(undefined),
    removeTagFromNote: jest.fn().mockResolvedValue(undefined),
    moveNote: jest.fn().mockResolvedValue(undefined),
    createNote: jest.fn().mockResolvedValue({ id: "newid" }),
    editNote: jest.fn().mockResolvedValue(undefined),
    setTodoCompletion: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  (JoplinClient as unknown as jest.Mock).mockImplementation(() => instance);
  return instance;
}

describe("Extension", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fsPromises.readFile as jest.Mock).mockRejectedValue(new Error("Not found"));
    mockClientInstance();
  });

  it("registers tools", async () => {
    const mockPi = {
      registerTool: jest.fn(),
      registerCommand: jest.fn(),
      on: jest.fn(),
      appendEntry: jest.fn(),
    };
    initExtension(mockPi as any);
    expect(mockPi.registerTool).toHaveBeenCalledTimes(11);

    const registeredTools = mockPi.registerTool.mock.calls.map(call => call[0].name);
    expect(registeredTools).toContain("joplin_list_notebooks");
    expect(registeredTools).toContain("joplin_list_tags");
    expect(registeredTools).toContain("joplin_list_notes");
    expect(registeredTools).toContain("joplin_read_note");
    expect(registeredTools).toContain("joplin_get_note_metadata");
    expect(registeredTools).toContain("joplin_add_tag_to_note");
    expect(registeredTools).toContain("joplin_remove_tag_from_note");
    expect(registeredTools).toContain("joplin_move_note");
    expect(registeredTools).toContain("joplin_create_note");
    expect(registeredTools).toContain("joplin_edit_note");
    expect(registeredTools).toContain("joplin_set_todo_completion");

    const listNotebooksTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_list_notebooks")[0];
    const result = await listNotebooksTool.execute("id", {});
    expect(result.details.count).toBe(1);

    const listTagsTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_list_tags")[0];
    const tagsResult = await listTagsTool.execute("id", {});
    expect(tagsResult.details.count).toBe(1);

    const listNotesTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_list_notes")[0];
    await listNotesTool.execute("id", { notebook: "nb" });
    await listNotesTool.execute("id", { tag: "tag" });

    const client = (JoplinClient as unknown as jest.Mock).mock.results[0].value;
    client.listNotes.mockResolvedValue({ notes: [{ id: "1234567890", title: "Shared" }, { id: "2222222222", title: "Notebook Only" }], has_more: false });
    client.listNotesByTag.mockResolvedValue({ notes: [{ id: "12345", title: "Shared" }, { id: "33333", title: "Tag Only" }], has_more: false });

    const intersectionResult = await listNotesTool.execute("id", { notebook: "nb", tag: "tag" });
    expect(intersectionResult.details.count).toBe(1);
    expect(intersectionResult.content[0].text).toContain("mock content");

    const readNoteTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_read_note")[0];
    await readNoteTool.execute("id", { note: "note" });

    const getMetadataTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_get_note_metadata")[0];
    await getMetadataTool.execute("id", { note: "note" });

    const addTagTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_add_tag_to_note")[0];
    await addTagTool.execute("id", { note: "note", tag: "tag" });

    const removeTagTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_remove_tag_from_note")[0];
    await removeTagTool.execute("id", { note: "note", tag: "tag" });

    const moveNoteTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_move_note")[0];
    await moveNoteTool.execute("id", { note: "note", notebook: "notebook" });

    const createNoteTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_create_note")[0];
    expect(createNoteTool.description).toContain("AI-Generated");
    await createNoteTool.execute("id", { title: "title", type: "note" });
    const clientForCreate = (JoplinClient as unknown as jest.Mock).mock.results[0].value;
    expect(clientForCreate.createNote).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["AI-Generated"] })
    );

    const editNoteTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_edit_note")[0];
    await editNoteTool.execute("id", { note: "note", title: "title" });

    const setTodoTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_set_todo_completion")[0];
    await setTodoTool.execute("id", { note: "note", completed: true });
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

    const bypassResult = await toolCallHandler({ toolName: "joplin_list_notes", input: {} }, {});
    expect(bypassResult).toBeUndefined();

    const mockCtxAllow = { ui: { select: jest.fn().mockResolvedValue("Once") } };
    const allowResult = await toolCallHandler({ toolName: "joplin_add_tag_to_note", input: { note: "n1", tag: "t1" } }, mockCtxAllow);
    expect(allowResult).toBeUndefined();
    expect(mockCtxAllow.ui.select).toHaveBeenCalled();

    const mockCtxSession = { ui: { select: jest.fn().mockResolvedValue("Session") } };
    const sessionResult = await toolCallHandler({ toolName: "joplin_add_tag_to_note", input: { note: "n1", tag: "t1" } }, mockCtxSession);
    expect(sessionResult).toBeUndefined();
    expect(mockPi.appendEntry).toHaveBeenCalled();

    const sessionBypassResult = await toolCallHandler({ toolName: "joplin_add_tag_to_note", input: { note: "n1", tag: "t1" } }, mockCtxSession);
    expect(sessionBypassResult).toBeUndefined();

    (fsPromises.readFile as jest.Mock).mockRejectedValueOnce(new Error("missing"));
    const mockCtxAlways = { ui: { select: jest.fn().mockResolvedValue("Always") } };
    const alwaysResult = await toolCallHandler({ toolName: "joplin_remove_tag_from_note", input: { note: "n1", tag: "t1" } }, mockCtxAlways);
    expect(alwaysResult).toBeUndefined();
    expect(fsPromises.writeFile).toHaveBeenCalled();

    (fsPromises.readFile as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ allowedTools: ["joplin_remove_tag_from_note"] })
    );
    const allowlistBypassResult = await toolCallHandler({ toolName: "joplin_remove_tag_from_note", input: { note: "n1", tag: "t1" } }, mockCtxAlways);
    expect(allowlistBypassResult).toBeUndefined();

    const mockCtxBlock = { ui: { select: jest.fn().mockResolvedValue("No") } };
    const blockResult = await toolCallHandler({ toolName: "joplin_remove_tag_from_note", input: { note: "n1", tag: "t1" } }, mockCtxBlock);
    expect(blockResult).toEqual({ block: true, reason: expect.any(String) });

    const mockCtxCancel = { ui: { select: jest.fn().mockResolvedValue(undefined) } };
    const cancelResult = await toolCallHandler({ toolName: "joplin_remove_tag_from_note", input: { note: "n1", tag: "t1" } }, mockCtxCancel);
    expect(cancelResult).toEqual({ block: true, reason: expect.any(String) });

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
    expect(mockPi.registerCommand).toHaveBeenCalledWith("joplin-scope", expect.any(Object));

    const sessionStartHandler = mockPi.on.mock.calls.find(call => call[0] === "session_start")[1];

    await sessionStartHandler(null, { sessionManager: { getEntries: () => [] } });

    await sessionStartHandler(null, {
      sessionManager: {
        getEntries: () => [
          { type: "custom", customType: "joplin-config", data: { apiToken: "test" } },
          { type: "other" }
        ]
      }
    });

    const configHandler = mockPi.registerCommand.mock.calls.find(call => call[0] === "joplin-config")[1].handler;
    const mockCtx = {
      ui: {
        input: jest.fn()
          .mockResolvedValueOnce("new-profile")
          .mockResolvedValueOnce("new-token"),
        notify: jest.fn(),
        select: jest.fn().mockResolvedValue("No"),
      }
    };

    await configHandler({}, mockCtx);

    expect(mockCtx.ui.input).toHaveBeenCalledTimes(2);
    expect(mockPi.appendEntry).toHaveBeenCalledWith("joplin-config", expect.objectContaining({
      profilePath: "new-profile",
      apiToken: "new-token"
    }));
    expect(mockCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("saved"), "info");

    mockCtx.ui.input = jest.fn()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("");
    await configHandler({}, mockCtx);
    expect(mockPi.appendEntry).toHaveBeenCalledWith("joplin-config", expect.objectContaining({
      profilePath: undefined,
      apiToken: undefined
    }));
  });

  it("joplin-scope show and clear flows", async () => {
    const mockPi = {
      registerTool: jest.fn(),
      registerCommand: jest.fn(),
      on: jest.fn(),
      appendEntry: jest.fn(),
    };
    initExtension(mockPi as any);

    const scopeHandler = mockPi.registerCommand.mock.calls.find(call => call[0] === "joplin-scope")[1].handler;

    const showCtx = {
      ui: {
        select: jest.fn().mockResolvedValue("Show"),
        notify: jest.fn(),
        input: jest.fn(),
      }
    };
    await scopeHandler({}, showCtx);
    expect(showCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Global:"), "info");

    const clearSessionCtx = {
      ui: {
        select: jest.fn()
          .mockResolvedValueOnce("Clear session")
          .mockResolvedValueOnce("Clear"),
        notify: jest.fn(),
        input: jest.fn(),
      }
    };
    await scopeHandler({}, clearSessionCtx);
    expect(mockPi.appendEntry).toHaveBeenCalled();
    expect(clearSessionCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Session"), "info");

    (fsPromises.readFile as jest.Mock).mockResolvedValue(
      JSON.stringify({ allowedNotebooks: [{ id: "1", title: "Work" }] })
    );
    const clearGlobalCtx = {
      ui: {
        select: jest.fn()
          .mockResolvedValueOnce("Clear global")
          .mockResolvedValueOnce("Clear global"),
        notify: jest.fn(),
        input: jest.fn(),
      }
    };
    await scopeHandler({}, clearGlobalCtx);
    expect(fsPromises.writeFile).toHaveBeenCalled();
    expect(clearGlobalCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Global"), "info");
  });

  it("joplin-scope set global with preview confirm", async () => {
    const client = mockClientInstance({
      listAllNotebooks: jest.fn().mockResolvedValue([
        { id: "nb1", title: "Work", parent_id: "" },
        { id: "nb2", title: "Personal", parent_id: "" },
      ]),
    });

    const mockPi = {
      registerTool: jest.fn(),
      registerCommand: jest.fn(),
      on: jest.fn(),
      appendEntry: jest.fn(),
    };
    initExtension(mockPi as any);

    const scopeHandler = mockPi.registerCommand.mock.calls.find(call => call[0] === "joplin-scope")[1].handler;
    const ctx = {
      ui: {
        select: jest.fn()
          .mockResolvedValueOnce("Set global")
          .mockResolvedValueOnce("Save"),
        input: jest.fn().mockResolvedValue("Work"),
        notify: jest.fn(),
      }
    };

    await scopeHandler({}, ctx);

    expect(client.listAllNotebooks).toHaveBeenCalled();
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("joplin.json"),
      expect.stringContaining("nb1")
    );
    expect(client.setScope).toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Global"), "info");
  });

  it("joplin-scope set session rejects non-subset and unknown notebooks", async () => {
    mockClientInstance({
      listAllNotebooks: jest.fn().mockResolvedValue([
        { id: "nb1", title: "Work", parent_id: "" },
        { id: "nb2", title: "Personal", parent_id: "" },
      ]),
    });

    (fsPromises.readFile as jest.Mock).mockResolvedValue(
      JSON.stringify({ allowedNotebooks: [{ id: "nb1", title: "Work" }] })
    );

    const mockPi = {
      registerTool: jest.fn(),
      registerCommand: jest.fn(),
      on: jest.fn(),
      appendEntry: jest.fn(),
    };
    initExtension(mockPi as any);

    const scopeHandler = mockPi.registerCommand.mock.calls.find(call => call[0] === "joplin-scope")[1].handler;

    const unknownCtx = {
      ui: {
        select: jest.fn().mockResolvedValueOnce("Set session"),
        input: jest.fn().mockResolvedValue("MissingNB"),
        notify: jest.fn(),
      }
    };
    await scopeHandler({}, unknownCtx);
    expect(unknownCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Unknown"), "error");

    const subsetCtx = {
      ui: {
        select: jest.fn().mockResolvedValueOnce("Set session"),
        input: jest.fn().mockResolvedValue("Personal"),
        notify: jest.fn(),
      }
    };
    await scopeHandler({}, subsetCtx);
    expect(subsetCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("subset"), "error");
  });

  it("joplin-config can open scope setup and cancel scope menu", async () => {
    mockClientInstance({
      listAllNotebooks: jest.fn().mockResolvedValue([
        { id: "nb1", title: "Work", parent_id: "" },
      ]),
    });

    const mockPi = {
      registerTool: jest.fn(),
      registerCommand: jest.fn(),
      on: jest.fn(),
      appendEntry: jest.fn(),
    };
    initExtension(mockPi as any);

    const configHandler = mockPi.registerCommand.mock.calls.find(call => call[0] === "joplin-config")[1].handler;
    const ctx = {
      ui: {
        input: jest.fn()
          .mockResolvedValueOnce("")
          .mockResolvedValueOnce("")
          .mockResolvedValueOnce("Work"),
        select: jest.fn()
          .mockResolvedValueOnce("Set global scope")
          .mockResolvedValueOnce("Save"),
        notify: jest.fn(),
      }
    };
    await configHandler({}, ctx);
    expect(fsPromises.writeFile).toHaveBeenCalled();

    const scopeHandler = mockPi.registerCommand.mock.calls.find(call => call[0] === "joplin-scope")[1].handler;
    const cancelCtx = {
      ui: {
        select: jest.fn().mockResolvedValue("Cancel"),
        notify: jest.fn(),
        input: jest.fn(),
      }
    };
    await scopeHandler({}, cancelCtx);
    expect(cancelCtx.ui.notify).not.toHaveBeenCalled();
  });

  it("applies fail-closed scope when configured notebooks are missing", async () => {
    const client = mockClientInstance({
      listAllNotebooks: jest.fn().mockResolvedValue([{ id: "other", title: "Other", parent_id: "" }]),
      isScoped: jest.fn().mockReturnValue(true),
    });

    (fsPromises.readFile as jest.Mock).mockResolvedValue(
      JSON.stringify({ allowedNotebooks: [{ id: "missing", title: "Gone" }] })
    );

    const mockPi = {
      registerTool: jest.fn(),
      registerCommand: jest.fn(),
      on: jest.fn(),
      appendEntry: jest.fn(),
    };
    initExtension(mockPi as any);

    const sessionStartHandler = mockPi.on.mock.calls.find(call => call[0] === "session_start")[1];
    await sessionStartHandler(null, { sessionManager: { getEntries: () => [] } });

    expect(client.setScope).toHaveBeenCalledWith(expect.any(Set), expect.stringContaining("fail-closed"));

    // Tool descriptions should mention fail-closed after re-register
    const lastListTool = [...mockPi.registerTool.mock.calls].reverse().find(call => call[0].name === "joplin_list_notebooks")[0];
    expect(lastListTool.description).toContain("fail-closed");
  });

  it("handles truncated tool output branches", async () => {
    const { truncateHead } = require("@earendil-works/pi-coding-agent");
    truncateHead.mockReturnValue({
      content: "partial",
      truncated: true,
      outputLines: 1,
      totalLines: 9,
    });

    mockClientInstance();
    const mockPi = {
      registerTool: jest.fn(),
      registerCommand: jest.fn(),
      on: jest.fn(),
      appendEntry: jest.fn(),
    };
    initExtension(mockPi as any);

    const listTagsTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_list_tags")[0];
    const tagsResult = await listTagsTool.execute("id", {});
    expect(tagsResult.content[0].text).toContain("truncated");

    const listNotesTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_list_notes")[0];
    const notesResult = await listNotesTool.execute("id", {});
    expect(notesResult.content[0].text).toContain("truncated");

    const readNoteTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_read_note")[0];
    const readResult = await readNoteTool.execute("id", { note: "n" });
    expect(readResult.content[0].text).toContain("truncated");
  });
});
