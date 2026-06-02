jest.mock("typebox", () => ({ Type: { Object: jest.fn(), String: jest.fn(), Optional: jest.fn() } }), { virtual: true });
jest.mock("@earendil-works/pi-coding-agent", () => ({
  truncateHead: jest.fn().mockReturnValue({ content: "mock content", truncated: false }),
  DEFAULT_MAX_BYTES: 1000,
  DEFAULT_MAX_LINES: 100
}), { virtual: true });

import initExtension from "./index";
import { JoplinClient } from "./joplin";

jest.mock("./joplin");

describe("Extension", () => {
  it("registers tools", async () => {
    const mockPi = {
      registerTool: jest.fn(),
    };
    initExtension(mockPi as any);
    expect(mockPi.registerTool).toHaveBeenCalledTimes(4);
    
    const registeredTools = mockPi.registerTool.mock.calls.map(call => call[0].name);
    expect(registeredTools).toContain("joplin_list_notebooks");
    expect(registeredTools).toContain("joplin_list_notes");
    expect(registeredTools).toContain("joplin_read_note");
    expect(registeredTools).toContain("joplin_get_note_metadata");

    // Call execute on joplin_list_notebooks to get branch coverage
    const listNotebooksTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_list_notebooks")[0];
    (JoplinClient.prototype.listNotebooks as jest.Mock).mockResolvedValue([{ id: "1" }]);
    const result = await listNotebooksTool.execute("id", {});
    expect(result.details.count).toBe(1);

    // Call execute on joplin_list_notes
    const listNotesTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_list_notes")[0];
    (JoplinClient.prototype.listNotes as jest.Mock).mockResolvedValue([{ id: "1" }]);
    await listNotesTool.execute("id", { notebook: "nb" });

    (JoplinClient.prototype.listNotesByTag as jest.Mock).mockResolvedValue([{ id: "1" }]);
    await listNotesTool.execute("id", { tag: "tag" });

    await expect(listNotesTool.execute("id", { notebook: "nb", tag: "tag" })).rejects.toThrow("Filtering by both notebook and tag simultaneously is not supported in a single call.");

    // Call execute on joplin_read_note
    const readNoteTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_read_note")[0];
    (JoplinClient.prototype.readNote as jest.Mock).mockResolvedValue("content");
    await readNoteTool.execute("id", { note: "note" });

    // Call execute on joplin_get_note_metadata
    const getMetadataTool = mockPi.registerTool.mock.calls.find(call => call[0].name === "joplin_get_note_metadata")[0];
    (JoplinClient.prototype.getNoteMetadata as jest.Mock).mockResolvedValue({ id: "1" });
    await getMetadataTool.execute("id", { note: "note" });
  });
});
