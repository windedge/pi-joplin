import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

export class JoplinClient {
  private async runJoplin(args: string[]): Promise<string> {
    const joplinBin = require.resolve("joplin/main.js");
    const cmdArgs = args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(" ");
    const { stdout } = await execAsync(`"${process.execPath}" "${joplinBin}" ${cmdArgs}`);
    return stdout;
  }

  private async runJoplinBatch(commands: string[]): Promise<string> {
    const joplinBin = require.resolve("joplin/main.js");
    const batchFile = path.join(os.tmpdir(), `joplin-batch-${Date.now()}-${Math.random().toString(36).substring(7)}.txt`);
    await writeFile(batchFile, commands.join("\n"));
    try {
      const { stdout } = await execAsync(`"${process.execPath}" "${joplinBin}" batch "${batchFile}"`);
      return stdout;
    } finally {
      await unlink(batchFile).catch(() => {});
    }
  }

  async listNotebooks(): Promise<any[]> {
    const stdout = await this.runJoplin(["ls", "/", "--format", "json"]);
    if (!stdout.trim()) return [];
    return JSON.parse(stdout);
  }

  async listNotes(notebook?: string): Promise<any[]> {
    if (notebook) {
      // List for a specific notebook
      const stdout = await this.runJoplinBatch([`use "${notebook}"`, `ls --format json`]);
      const lines = stdout.split("\n").filter(l => l.trim().startsWith("["));
      if (lines.length > 0) {
        return JSON.parse(lines[lines.length - 1]);
      }
      return [];
    } else {
      // List for all notebooks
      const notebooks = await this.listNotebooks();
      if (notebooks.length === 0) return [];

      const commands = notebooks.map((nb: any) => `use "${nb.id}"\nls --format json`);
      const stdout = await this.runJoplinBatch(commands);

      const lines = stdout.split("\n").filter(l => l.trim().startsWith("["));
      const allNotes: any[] = [];
      for (const line of lines) {
        try {
          allNotes.push(...JSON.parse(line));
        } catch (e) {
          // ignore invalid json lines
        }
      }
      return allNotes;
    }
  }

  async readNote(note: string): Promise<string> {
    return await this.runJoplin(["cat", note]);
  }

  async listNotesByTag(tag: string): Promise<any[]> {
    const stdout = await this.runJoplin(["tag", "list", tag, "--long"]);
    const lines = stdout.split("\n").filter(l => l.trim().length > 0);
    // Long output format: ID DATE TITLE
    // Example: 94749 02/06/2026 03:52 	First note
    return lines.map(line => {
      const parts = line.split("\t");
      const idDate = parts[0].trim();
      const firstSpace = idDate.indexOf(" ");
      const id = idDate.substring(0, firstSpace);
      const title = parts.slice(1).join("\t").trim();
      return {
        id,
        title
      };
    }).filter(note => note.id && note.title);
  }

  async getNoteTags(note: string): Promise<string[]> {
    const stdout = await this.runJoplin(["tag", "notetags", note]);
    return stdout.split("\n").map(t => t.trim()).filter(t => t.length > 0);
  }

  async getNoteMetadata(note: string): Promise<Record<string, any>> {
    const stdout = await this.runJoplin(["cat", note, "-v"]);
    const lines = stdout.split("\n");
    const metadata: Record<string, any> = {};
    
    // Parse metadata from the bottom up until the first blank line
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line === "") {
        if (Object.keys(metadata).length > 0) {
          // We've found the empty line separating properties from the body
          break;
        } else {
          // Trailing blank lines at the very end of output, skip them
          continue;
        }
      }
      const colonIndex = line.indexOf(":");
      if (colonIndex >= 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        metadata[key] = value;
      }
    }
    
    metadata.tags = await this.getNoteTags(note);
    
    return metadata;
  }
}
