import { JoplinClient } from "./joplin";
import * as child_process from "child_process";
import * as fsPromises from "fs/promises";

jest.mock("child_process");
jest.mock("fs/promises");

const mockedExec = child_process.exec as unknown as jest.Mock;

describe("JoplinClient", () => {
  let client: JoplinClient;

  beforeEach(() => {
    client = new JoplinClient();
    mockedExec.mockImplementation((cmd: string, cb: any) => {
      cb(null, { stdout: "[]", stderr: "" });
    });
    (fsPromises.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fsPromises.unlink as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe("listNotebooks", () => {
    it("returns notebooks", async () => {
      mockedExec.mockImplementation((cmd: string, cb: any) => cb(null, { stdout: `[{"id":"1","title":"Notebook 1"}]` }));
      const notebooks = await client.listNotebooks();
      expect(notebooks).toEqual([{ id: "1", title: "Notebook 1" }]);
    });

    it("handles empty output", async () => {
      mockedExec.mockImplementation((cmd: string, cb: any) => cb(null, { stdout: `   ` }));
      const notebooks = await client.listNotebooks();
      expect(notebooks).toEqual([]);
    });
  });

  describe("listNotes", () => {
    it("returns notes for a specific notebook", async () => {
      mockedExec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: `[{"id":"1","title":"Note 1"}]` });
      });
      const notes = await client.listNotes("nb-1");
      expect(notes).toEqual([{ id: "1", title: "Note 1" }]);
    });

    it("returns empty if no json lines found for notebook", async () => {
      mockedExec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: `no notes here` });
      });
      const notes = await client.listNotes("nb-1");
      expect(notes).toEqual([]);
    });

    it("returns all notes if no notebook provided", async () => {
      let callCount = 0;
      mockedExec.mockImplementation((cmd: string, cb: any) => {
        if (callCount === 0) {
          callCount++;
          cb(null, { stdout: `[{"id":"nb1"}]` });
        } else {
          cb(null, { stdout: `[{"id":"note1"}]\n[{"id":"note2"}]` });
        }
      });
      const notes = await client.listNotes();
      expect(notes).toEqual([{ id: "note1" }, { id: "note2" }]);
    });

    it("returns empty if no notebooks exist", async () => {
      mockedExec.mockImplementation((cmd: string, cb: any) => cb(null, { stdout: `[]` }));
      const notes = await client.listNotes();
      expect(notes).toEqual([]);
    });

    it("handles bad json lines in batch output", async () => {
      let callCount = 0;
      mockedExec.mockImplementation((cmd: string, cb: any) => {
        if (callCount === 0) {
          callCount++;
          cb(null, { stdout: `[{"id":"nb1"}]` });
        } else {
          cb(null, { stdout: `[{"id":"note1"}]\n[bad json\n[{"id":"note2"}]` });
        }
      });
      const notes = await client.listNotes();
      expect(notes).toEqual([{ id: "note1" }, { id: "note2" }]);
    });
  });

  describe("readNote", () => {
    it("returns note content", async () => {
      mockedExec.mockImplementation((cmd: string, cb: any) => cb(null, { stdout: `Note content` }));
      const content = await client.readNote("note-1");
      expect(content).toEqual("Note content");
    });
  });

  describe("listNotesByTag", () => {
    it("returns parsed notes from long format", async () => {
      mockedExec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: `94749 02/06/2026 03:52 \tFirst note\nabcde 02/06/2026 04:00 \tSecond note\n` });
      });
      const notes = await client.listNotesByTag("mytag");
      expect(notes).toEqual([
        { id: "94749", title: "First note" },
        { id: "abcde", title: "Second note" }
      ]);
    });

    it("ignores empty lines", async () => {
      mockedExec.mockImplementation((cmd: string, cb: any) => {
        cb(null, { stdout: `\n\n  \n` });
      });
      const notes = await client.listNotesByTag("mytag");
      expect(notes).toEqual([]);
    });
  });

  describe("runJoplinBatch error handling", () => {
    it("cleans up batch file if exec fails", async () => {
      mockedExec.mockImplementation((cmd: string, cb: any) => {
        cb(new Error("exec failed"));
      });
      await expect(client.listNotes("nb-1")).rejects.toThrow("exec failed");
      expect(fsPromises.unlink).toHaveBeenCalled();
    });
  });
});
