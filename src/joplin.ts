import { spawn, ChildProcess } from "child_process";
import { readFile } from "fs/promises";
import * as path from "path";
import * as os from "os";

export class JoplinClient {
  private apiToken?: string;
  private port: number = 41184; // Default desktop port
  private serverProcess?: ChildProcess;

  constructor(private profilePath?: string, private forceHeadlessPort?: number) {
    if (forceHeadlessPort) {
      this.port = forceHeadlessPort;
    }
  }

  /**
   * Discovers and sets the API token from Joplin's settings
   */
  async setApiToken(token: string) {
    this.apiToken = token;
  }

  /**
   * Initializes the client by discovering the API token and ensuring a server is available.
   */
  async init(): Promise<void> {
    // 1. Auto-discover the API token if not manually set
    if (!this.apiToken) {
      this.apiToken = await this.discoverApiToken();
    }
    
    if (!this.apiToken) {
      throw new Error("Could not find Joplin api.token. Either configure it in pi-joplin settings or enable the Web Clipper in Joplin Desktop.");
    }

    // 2. Check if a server is already running (skip if forcing a specific headless port)
    if (!this.forceHeadlessPort) {
      const isRunning = await this.ping(41184) || await this.ping(27583);
      if (isRunning) {
        // Desktop app or another server is already running, we're good to go!
        return;
      }
    }

    // 3. Fallback to starting a headless server if not running
    await this.startHeadlessServer();
  }

  /**
   * Cleans up any managed resources (like the headless server)
   */
  async close(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill("SIGTERM");
      this.serverProcess = undefined;
    }
  }

  private async discoverApiToken(): Promise<string | undefined> {
    const searchPaths = [
      this.profilePath ? path.join(this.profilePath, "settings.json") : undefined,
      path.join(os.homedir(), ".config", "joplin-desktop", "settings.json"),
      path.join(os.homedir(), ".config", "joplin", "settings.json")
    ].filter(Boolean) as string[];

    for (const p of searchPaths) {
      try {
        const content = await readFile(p, "utf8");
        const settings = JSON.parse(content);
        if (settings["api.token"]) {
          return settings["api.token"];
        }
      } catch {
        // Ignore file read or parse errors and try the next path
      }
    }
    return undefined;
  }

  private async ping(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://localhost:${port}/ping`);
      if (res.ok) {
        const text = await res.text();
        if (text.includes("JoplinClipperServer")) {
          this.port = port;
          return true;
        }
      }
    } catch {
      // Connection refused, etc.
    }
    return false;
  }

  private async startHeadlessServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const joplinBin = require.resolve("joplin/main.js");
      const args = ["server", "start"];
      if (this.profilePath) {
        args.unshift("--profile", this.profilePath);
      }

      this.serverProcess = spawn(process.execPath, [joplinBin, ...args], {
        stdio: "pipe",
        detached: false
      });

      this.serverProcess.on("error", reject);
      this.serverProcess.on("close", (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`Joplin server exited with code ${code}`));
        }
      });

      // Listen for the "Starting Clipper server on port" line
      if (this.serverProcess.stdout) {
        this.serverProcess.stdout.on("data", (data: Buffer) => {
          const str = data.toString();
          const match = str.match(/Starting Clipper server on port (\d+)/);
          if (match) {
            this.port = parseInt(match[1], 10);
            resolve();
          }
        });
      }
    });
  }

  private async request<T>(endpoint: string, params: Record<string, string> = {}, body?: any): Promise<T> {
    if (!this.apiToken) {
      throw new Error("Client not initialized. Call init() first.");
    }

    const url = new URL(`http://localhost:${this.port}${endpoint}`);
    url.searchParams.append("token", this.apiToken);
    
    // params are query string arguments or fetch options
    const fetchOpts: any = { ...params };
    
    if (params.fields) {
      url.searchParams.append("fields", params.fields);
      delete fetchOpts.fields;
    }
    if (params.page) {
      url.searchParams.append("page", params.page);
      delete fetchOpts.page;
    }

    if (body) {
      fetchOpts.body = JSON.stringify(body);
      fetchOpts.headers = { ...fetchOpts.headers, "Content-Type": "application/json" };
    }

    const res = await fetch(url.toString(), fetchOpts);
    if (!res.ok) {
      throw new Error(`Joplin API Error: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  // Iterate over paginated items using 'has_more' and 'page'
  private async fetchAll<T>(endpoint: string, params: Record<string, string> = {}): Promise<T[]> {
    let allItems: T[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await this.request<{ items: T[], has_more: boolean }>(endpoint, { ...params, page: page.toString() });
      allItems = allItems.concat(res.items);
      hasMore = res.has_more;
      page++;
    }

    return allItems;
  }

  async listNotebooks(): Promise<any[]> {
    return await this.fetchAll("/folders");
  }

  async listTags(): Promise<any[]> {
    return await this.fetchAll("/tags");
  }

  async listNotes(notebookIdOrName?: string): Promise<any[]> {
    if (notebookIdOrName) {
      // Check if it's an ID or a Name
      let notebookId = notebookIdOrName;
      
      const notebooks = await this.listNotebooks();
      const match = notebooks.find(n => n.id === notebookIdOrName || n.title === notebookIdOrName);
      if (match) {
        notebookId = match.id;
      } else if (!notebooks.find(n => n.id === notebookIdOrName)) {
        return []; // Not found
      }

      return await this.fetchAll(`/folders/${notebookId}/notes`);
    } else {
      return await this.fetchAll("/notes");
    }
  }

  async listNotesByTag(tagName: string): Promise<any[]> {
    const tags = await this.fetchAll<any>("/tags");
    const tag = tags.find(t => t.title === tagName);
    if (!tag) return [];

    return await this.fetchAll(`/tags/${tag.id}/notes`);
  }

  async readNote(noteIdOrName: string): Promise<string> {
    let noteId = noteIdOrName;
    const allNotes = await this.fetchAll<any>("/notes");
    const match = allNotes.find(n => n.id === noteIdOrName || n.title === noteIdOrName);
    
    if (match) {
      noteId = match.id;
    }

    const note = await this.request<any>(`/notes/${noteId}`, { fields: "body" });
    return note.body;
  }

  async getNoteTags(noteId: string): Promise<string[]> {
    const tags = await this.fetchAll<any>(`/notes/${noteId}/tags`);
    return tags.map(t => t.title);
  }

  async getNoteMetadata(noteIdOrName: string): Promise<Record<string, any>> {
    let noteId = noteIdOrName;
    const allNotes = await this.fetchAll<any>("/notes");
    const match = allNotes.find(n => n.id === noteIdOrName || n.title === noteIdOrName);
    
    if (match) {
      noteId = match.id;
    }

    const fields = "id,parent_id,title,is_todo,todo_due,todo_completed,created_time,updated_time,source_url,source_application,latitude,longitude,altitude,author";
    const metadata = await this.request<Record<string, any>>(`/notes/${noteId}`, { fields });
    metadata.tags = await this.getNoteTags(noteId);
    
    return metadata;
  }

  async addTagToNote(tagIdOrName: string, noteIdOrName: string): Promise<void> {
    let noteId = noteIdOrName;
    const allNotes = await this.fetchAll<any>("/notes");
    const noteMatch = allNotes.find(n => n.id === noteIdOrName || n.title === noteIdOrName);
    if (noteMatch) {
      noteId = noteMatch.id;
    }

    const allTags = await this.fetchAll<any>("/tags");
    let tagMatch = allTags.find(t => t.id === tagIdOrName || t.title === tagIdOrName);
    
    // If the tag doesn't exist, create it first
    if (!tagMatch) {
      tagMatch = await this.request<any>("/tags", { method: "POST" }, { title: tagIdOrName });
    }
    
    const tagId = tagMatch.id;

    await this.request<any>(`/tags/${tagId}/notes`, { method: "POST" }, { id: noteId });
  }

  async removeTagFromNote(tagIdOrName: string, noteIdOrName: string): Promise<void> {
    let noteId = noteIdOrName;
    const allNotes = await this.fetchAll<any>("/notes");
    const noteMatch = allNotes.find(n => n.id === noteIdOrName || n.title === noteIdOrName);
    if (noteMatch) {
      noteId = noteMatch.id;
    }

    const allTags = await this.fetchAll<any>("/tags");
    const tagMatch = allTags.find(t => t.id === tagIdOrName || t.title === tagIdOrName);
    
    if (!tagMatch) {
      throw new Error(`Tag '${tagIdOrName}' not found`);
    }
    
    const tagId = tagMatch.id;

    await this.request<any>(`/tags/${tagId}/notes/${noteId}`, { method: "DELETE" });
  }
}
