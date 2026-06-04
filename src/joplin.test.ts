import { JoplinClient } from "./joplin";
import * as fsPromises from "fs/promises";
import * as child_process from "child_process";
import { EventEmitter } from "events";

jest.mock("fs/promises");
jest.mock("child_process");

describe("JoplinClient", () => {
  let client: JoplinClient;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    client = new JoplinClient();
    mockFetch = jest.fn();
    global.fetch = mockFetch;
    
    (fsPromises.readFile as jest.Mock).mockImplementation((path) => {
      if (path.includes("settings.json")) {
        return Promise.resolve(JSON.stringify({ "api.token": "test-token" }));
      }
      return Promise.reject(new Error("Not found"));
    });
  });

  afterEach(async () => {
    await client.close();
    jest.resetAllMocks();
  });

  describe("init", () => {
    it("connects to existing server via ping", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("JoplinClipperServer")
      });

      await client.init();
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/ping"));
      expect(child_process.spawn).not.toHaveBeenCalled();
    });

    it("starts headless server if ping fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused")); // 41184 ping
      mockFetch.mockRejectedValueOnce(new Error("Connection refused")); // 27583 ping

      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.stdout = new EventEmitter();
      mockChildProcess.kill = jest.fn();
      
      (child_process.spawn as jest.Mock).mockReturnValue(mockChildProcess);

      const initPromise = client.init();
      
      // Simulate stdout emitting the success string AFTER event loop tick
      setTimeout(() => {
        mockChildProcess.stdout.emit("data", Buffer.from("Starting Clipper server on port 41184\n"));
      }, 50);
      
      await initPromise;
      expect(child_process.spawn).toHaveBeenCalled();
      expect(mockChildProcess.kill).not.toHaveBeenCalled();
    });

    it("rejects if server process closes with non-zero code", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused")); // 41184 ping
      mockFetch.mockRejectedValueOnce(new Error("Connection refused")); // 27583 ping

      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.stdout = new EventEmitter();
      mockChildProcess.kill = jest.fn();
      
      (child_process.spawn as jest.Mock).mockReturnValue(mockChildProcess);

      const initPromise = client.init();
      
      setTimeout(() => {
        mockChildProcess.emit("close", 1);
      }, 50);
      
      await expect(initPromise).rejects.toThrow("Joplin server exited with code 1");
    });

    it("throws if no api.token is found", async () => {
      (fsPromises.readFile as jest.Mock).mockRejectedValue(new Error("File not found"));
      await expect(client.init()).rejects.toThrow("Could not find Joplin api.token");
    });
  });

  describe("API methods", () => {
    beforeEach(async () => {
      // Setup successful init
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve("JoplinClipperServer")
      });
      await client.init();
      mockFetch.mockClear();
    });

    const mockResponse = (data: any) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(data)),
        json: () => Promise.resolve(data)
      });
    };

    it("listNotebooks", async () => {
      mockResponse({ items: [{ id: "nb1", title: "Notebook 1" }], has_more: false });
      const nbs = await client.listNotebooks();
      expect(nbs).toEqual([{ id: "nb1", title: "Notebook 1" }]);
    });

    it("listNotes (all)", async () => {
      mockResponse({ items: [{ id: "n1", title: "Note 1" }, { id: "n2", title: "Todo", is_todo: 1 }, { id: "n3", title: "Done Todo", is_todo: 1, todo_completed: 123 }], has_more: false });
      const notes = await client.listNotes();
      expect(notes.notes.map(n => n.id)).toEqual(["n1", "n2"]); // Excludes completed todo by default
      expect(mockFetch.mock.calls[0][0]).toContain("/notes");
    });

    it("listNotes (filtered by type)", async () => {
      mockResponse({ items: [{ id: "n1", title: "Note 1" }, { id: "n2", title: "Todo", is_todo: 1 }, { id: "n3", title: "Done Todo", is_todo: 1, todo_completed: 123 }], has_more: false });
      const completed = await client.listNotes(undefined, "completed_todos");
      expect(completed.notes.map(n => n.id)).toEqual(["n3"]);

      mockResponse({ items: [{ id: "n1", title: "Note 1" }, { id: "n2", title: "Todo", is_todo: 1 }, { id: "n3", title: "Done Todo", is_todo: 1, todo_completed: 123 }], has_more: false });
      const notesOnly = await client.listNotes(undefined, "notes");
      expect(notesOnly.notes.map(n => n.id)).toEqual(["n1"]);

      mockResponse({ items: [{ id: "n1", title: "Note 1" }, { id: "n2", title: "Todo", is_todo: 1 }, { id: "n3", title: "Done Todo", is_todo: 1, todo_completed: 123 }], has_more: false });
      const todosOnly = await client.listNotes(undefined, "todos");
      expect(todosOnly.notes.map(n => n.id)).toEqual(["n2"]);
    });

    it("listNotesByTag (filtered by type)", async () => {
      mockResponse({ items: [{ id: "t1", title: "mytag" }], has_more: false });
      mockResponse({ items: [{ id: "n1", title: "Note 1" }, { id: "n2", title: "Todo", is_todo: 1 }, { id: "n3", title: "Done Todo", is_todo: 1, todo_completed: 123 }], has_more: false });
      const completed = await client.listNotesByTag("mytag", "completed_todos");
      expect(completed.notes.map(n => n.id)).toEqual(["n3"]);

      mockResponse({ items: [{ id: "t1", title: "mytag" }], has_more: false });
      mockResponse({ items: [{ id: "n1", title: "Note 1" }, { id: "n2", title: "Todo", is_todo: 1 }, { id: "n3", title: "Done Todo", is_todo: 1, todo_completed: 123 }], has_more: false });
      const notesOnly = await client.listNotesByTag("mytag", "notes");
      expect(notesOnly.notes.map(n => n.id)).toEqual(["n1"]);

      mockResponse({ items: [{ id: "t1", title: "mytag" }], has_more: false });
      mockResponse({ items: [{ id: "n1", title: "Note 1" }, { id: "n2", title: "Todo", is_todo: 1 }, { id: "n3", title: "Done Todo", is_todo: 1, todo_completed: 123 }], has_more: false });
      const todosOnly = await client.listNotesByTag("mytag", "todos");
      expect(todosOnly.notes.map(n => n.id)).toEqual(["n2"]);
    });

    it("listNotes (by notebook name)", async () => {
      // First call: listNotebooks
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ items: [{ id: "nb1", title: "Notebook 1" }], has_more: false }))
      });
      // Second call: notes in notebook
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ items: [{ id: "n1", title: "Note 1" }], has_more: false }))
      });
      
      const notes = await client.listNotes("Notebook 1");
      expect(notes.notes).toEqual([{ id: "n1", title: "Note 1" }]);
      expect(mockFetch.mock.calls[1][0]).toContain("/folders/nb1/notes");
    });

    it("listTags", async () => {
      mockResponse({ items: [{ id: "t1", title: "tag1" }], has_more: false });
      const tags = await client.listTags();
      expect(tags).toEqual([{ id: "t1", title: "tag1" }]);
    });

    it("listNotesByTag", async () => {
      // First call: list tags
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ items: [{ id: "t1", title: "mytag" }], has_more: false })),
        json: () => Promise.resolve({ items: [{ id: "t1", title: "mytag" }], has_more: false })
      });
      // Second call: notes in tag
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ items: [{ id: "n1", title: "Note 1" }], has_more: false })),
        json: () => Promise.resolve({ items: [{ id: "n1", title: "Note 1" }], has_more: false })
      });

      const notes = await client.listNotesByTag("mytag");
      expect(notes.notes).toEqual([{ id: "n1", title: "Note 1" }]);
      expect(mockFetch.mock.calls[1][0]).toContain("/tags/t1/notes");
    });

    it("readNote", async () => {
      // First call: fetch all notes to match name to ID
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ items: [{ id: "n1", title: "Note 1" }], has_more: false }))
      });
      // Second call: fetch body
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ body: "Note content" }))
      });

      const body = await client.readNote("Note 1");
      expect(body).toBe("Note content");
    });

    it("getNoteMetadata", async () => {
      // First call: fetch all notes
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ items: [{ id: "n1", title: "Note 1" }], has_more: false }))
      });
      // Second call: fetch fields
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: "n1", title: "Note 1", parent_id: "nb1" }))
      });
      // Third call: fetch tags
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ items: [{ id: "t1", title: "tag1" }], has_more: false }))
      });

      const meta = await client.getNoteMetadata("Note 1");
      expect(meta.id).toBe("n1");
      expect(meta.parent_id).toBe("nb1");
      expect(meta.tags).toEqual(["tag1"]);
    });
    
    it("getNoteMetadata by explicit ID", async () => {
      // First call: fetch all notes (no match found for title)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ items: [{ id: "different", title: "Other Note" }], has_more: false }))
      });
      // Second call: fetch fields using the provided ID
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ id: "real-id", title: "Missing Note", parent_id: "nb1" }))
      });
      // Third call: fetch tags
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ items: [], has_more: false }))
      });

      const meta = await client.getNoteMetadata("real-id");
      expect(meta.id).toBe("real-id");
    });

    it("throws if API response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error"
      });
      await expect(client.listNotebooks()).rejects.toThrow("Joplin API Error: 500 Internal Server Error");
    });

    it("throws if API called before init", async () => {
      const uninitClient = new JoplinClient();
      await expect(uninitClient.listNotebooks()).rejects.toThrow("Client not initialized");
    });

    it("listNotes returns empty array if notebook name not found", async () => {
      mockResponse({ items: [{ id: "nb1", title: "Notebook 1" }], has_more: false });
      const notes = await client.listNotes("Missing Notebook");
      expect(notes.notes).toEqual([]);
    });

    it("listNotesByTag returns empty array if tag not found", async () => {
      mockResponse({ items: [{ id: "t1", title: "tag1" }], has_more: false });
      const notes = await client.listNotesByTag("missing tag");
      expect(notes.notes).toEqual([]);
    });

    it("uses forced headless port if provided", async () => {
      const profiledClient = new JoplinClient("/tmp/test-profile", 12345);
      expect((profiledClient as any).port).toBe(12345);
      
      (fsPromises.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify({ "api.token": "test" }));
      
      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.stdout = new EventEmitter();
      (child_process.spawn as jest.Mock).mockReturnValue(mockChildProcess);

      const initPromise = profiledClient.init();
      
      setTimeout(() => {
        mockChildProcess.stdout.emit("data", Buffer.from("Starting Clipper server on port 12345\n"));
      }, 50);
      
      await initPromise;
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("starts headless server with profile path if provided", async () => {
      const profiledClient = new JoplinClient("/tmp/test-profile");
      (fsPromises.readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify({ "api.token": "test" }));
      mockFetch.mockRejectedValueOnce(new Error("Connection refused")); 
      mockFetch.mockRejectedValueOnce(new Error("Connection refused")); 
      
      const mockChildProcess = new EventEmitter() as any;
      mockChildProcess.stdout = new EventEmitter();
      (child_process.spawn as jest.Mock).mockReturnValue(mockChildProcess);

      const initPromise = profiledClient.init();
      
      setTimeout(() => {
        mockChildProcess.stdout.emit("data", Buffer.from("Starting Clipper server on port 41184\n"));
      }, 50);
      
      await initPromise;
      expect(child_process.spawn).toHaveBeenCalledWith(
        process.execPath,
        expect.arrayContaining(["--profile", "/tmp/test-profile", "server", "start"]),
        expect.any(Object)
      );
    });

    it("addTagToNote creates tag if missing", async () => {
      // 1: fetch notes
      mockResponse({ items: [{ id: "n1", title: "Note 1" }], has_more: false });
      // 2: fetch tags
      mockResponse({ items: [{ id: "t1", title: "tag1" }], has_more: false });
      // 3: create tag
      mockResponse({ id: "t2", title: "tag2" });
      // 4: link tag
      mockResponse({});

      await client.addTagToNote("tag2", "n1");
      expect(mockFetch.mock.calls[2][0]).toContain("/tags");
      expect(mockFetch.mock.calls[3][0]).toContain("/tags/t2/notes");
    });

    it("removeTagFromNote throws if tag missing", async () => {
      // 1: fetch notes
      mockResponse({ items: [{ id: "n1", title: "Note 1" }], has_more: false });
      // 2: fetch tags
      mockResponse({ items: [{ id: "t1", title: "tag1" }], has_more: false });

      await expect(client.removeTagFromNote("missing", "n1")).rejects.toThrow("Tag 'missing' not found");
    });

    it("moveNote works successfully", async () => {
      // 1: fetch notes
      mockResponse({ items: [{ id: "n1", title: "Note 1" }], has_more: false });
      // 2: fetch notebooks
      mockResponse({ items: [{ id: "nb1", title: "Notebook 1" }], has_more: false });
      // 3: update note
      mockResponse({});

      await client.moveNote("n1", "Notebook 1");
      expect(mockFetch.mock.calls[2][0]).toContain("/notes/n1");
    });

    it("moveNote throws if notebook missing", async () => {
      // 1: fetch notes
      mockResponse({ items: [{ id: "n1", title: "Note 1" }], has_more: false });
      // 2: fetch notebooks
      mockResponse({ items: [{ id: "nb1", title: "Notebook 1" }], has_more: false });

      await expect(client.moveNote("n1", "missing")).rejects.toThrow("Notebook 'missing' not found");
    });

    it("createNote works successfully", async () => {
      mockResponse({ items: [{ id: "nb1", title: "Notebook 1" }], has_more: false });
      mockResponse({ id: "new-note" });

      const result = await client.createNote({
        title: "New Note",
        type: "todo",
        body: "Body",
        notebookIdOrName: "Notebook 1"
      });
      
      expect(result.id).toBe("new-note");
      expect(mockFetch.mock.calls[1][0]).toContain("/notes");
    });

    it("createNote throws if notebook missing", async () => {
      mockResponse({ items: [{ id: "nb1", title: "Notebook 1" }], has_more: false });
      await expect(client.createNote({
        title: "New Note",
        type: "note",
        notebookIdOrName: "Missing"
      })).rejects.toThrow("Notebook 'Missing' not found");
    });

    it("editNote works successfully", async () => {
      mockResponse({ items: [{ id: "n1", title: "Note 1" }], has_more: false });
      mockResponse({});

      await client.editNote("Note 1", { title: "New Title", type: "todo" });
      expect(mockFetch.mock.calls[1][0]).toContain("/notes/n1");
    });

    it("editNote does nothing if no fields provided", async () => {
      mockResponse({ items: [{ id: "n1", title: "Note 1" }], has_more: false });
      await client.editNote("Note 1", {});
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only the initial notes fetch
    });

    it("setTodoCompletion works successfully", async () => {
      mockResponse({ items: [{ id: "n1", title: "Note 1" }], has_more: false });
      mockResponse({});

      await client.setTodoCompletion("Note 1", true);
      expect(mockFetch.mock.calls[1][0]).toContain("/notes/n1");
    });
  });
});
