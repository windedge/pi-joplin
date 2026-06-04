import { JoplinClient } from "./joplin";
import * as os from "os";
import * as path from "path";
import * as fsPromises from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import * as net from "net";

const execAsync = promisify(exec);

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

describe("JoplinClient E2E", () => {
  let profilePath: string;
  let client: JoplinClient;
  let testPort: number;

  beforeAll(async () => {
    testPort = await getAvailablePort();

    // Create a temporary profile directory
    profilePath = await fsPromises.mkdtemp(path.join(os.tmpdir(), "joplin-e2e-"));
    client = new JoplinClient(profilePath, testPort);

    // Setup the joplin environment
    const joplinBin = require.resolve("joplin/main.js");
    const run = async (cmd: string) => {
      await execAsync(`"${process.execPath}" "${joplinBin}" --profile "${profilePath}" ${cmd}`);
    };

    // Create a notebook and two notes, one with a tag
    await run(`mkbook "E2E Notebook"`);
    
    // Switch to the notebook to create notes inside it
    const batchFile = path.join(profilePath, "setup.txt");
    await fsPromises.writeFile(batchFile, [
      `config api.port ${testPort}`,
      `use "E2E Notebook"`,
      `mknote "E2E Note 1"`,
      `mknote "E2E Note 2"`,
      `tag add e2etag "E2E Note 1"`,
      `config api.token test-e2e-token`
    ].join("\n"));
    
    await run(`batch "${batchFile}"`);
    
    // Add some content to E2E Note 1
    await run(`set "E2E Note 1" body "Hello E2E"`);

    await client.init();
  }, 15000);

  afterAll(async () => {
    await client.close();
    // Cleanup the profile directory
    await fsPromises.rm(profilePath, { recursive: true, force: true });
  });

  it("lists notebooks", async () => {
    const notebooks = await client.listNotebooks();
    expect(notebooks.length).toBe(1);
    expect(notebooks[0].title).toBe("E2E Notebook");
  });

  it("lists notes in notebook", async () => {
    const notes = await client.listNotes("E2E Notebook");
    expect(notes.length).toBe(2);
    const titles = notes.map(n => n.title).sort();
    expect(titles).toEqual(["E2E Note 1", "E2E Note 2"]);
  });

  it("lists all tags", async () => {
    const tags = await client.listTags();
    expect(tags.length).toBe(1);
    expect(tags[0].title).toBe("e2etag");
  });

  it("lists notes by tag", async () => {
    const notes = await client.listNotesByTag("e2etag");
    expect(notes.length).toBe(1);
    expect(notes[0].title).toBe("E2E Note 1");
  });

  it("reads note content", async () => {
    const content = await client.readNote("E2E Note 1");
    expect(content).toContain("Hello E2E");
  });

  it("gets note metadata with tags", async () => {
    const metadata = await client.getNoteMetadata("E2E Note 1");
    expect(metadata.title).toBe("E2E Note 1");
    expect(metadata.id).toBeDefined();
    expect(metadata.parent_id).toBeDefined();
    expect(metadata.tags).toEqual(["e2etag"]);
  });

  it("adds and removes tags", async () => {
    // Note 2 currently has no tags
    await client.addTagToNote("e2etag", "E2E Note 2");
    let meta = await client.getNoteMetadata("E2E Note 2");
    expect(meta.tags).toEqual(["e2etag"]);

    // Create a brand new tag dynamically
    await client.addTagToNote("new-dynamic-tag", "E2E Note 2");
    meta = await client.getNoteMetadata("E2E Note 2");
    expect(meta.tags).toContain("new-dynamic-tag");

    // Remove the original tag
    await client.removeTagFromNote("e2etag", "E2E Note 2");
    meta = await client.getNoteMetadata("E2E Note 2");
    expect(meta.tags).toEqual(["new-dynamic-tag"]);
  });
});
