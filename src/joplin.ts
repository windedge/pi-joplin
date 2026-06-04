import { spawn, ChildProcess } from "child_process";
import { readFile } from "fs/promises";
import * as path from "path";
import * as os from "os";

export class JoplinClient {
  private apiToken?: string;
  private port: number = 41184; // Default desktop port
  private serverProcess?: ChildProcess;
  public apiLimit?: number; // Used for testing pagination with smaller page sizes

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

  // Fetch a single page of items (returns pagination state)
  private async fetchPage<T>(endpoint: string, page: number, params: Record<string, string> = {}): Promise<{ items: T[], has_more: boolean }> {
    const fetchParams: Record<string, string> = { ...params, page: page.toString() };
    if (this.apiLimit) {
      fetchParams.limit = this.apiLimit.toString();
    }
    return await this.request<{ items: T[], has_more: boolean }>(endpoint, fetchParams);
  }

  // Iterate over paginated items using 'has_more' and 'page'
  private async fetchAll<T>(endpoint: string, params: Record<string, string> = {}): Promise<T[]> {
    let allItems: T[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      // Intentionally use fetchPage directly so apiLimit bounds aren't applied to internal traversals
      const fetchParams: Record<string, string> = { ...params, page: page.toString() };
      const res = await this.request<{ items: T[], has_more: boolean }>(endpoint, fetchParams);
      allItems = allItems.concat(res.items);
      hasMore = res.has_more;
      page++;
    }

    return allItems;
  }

  async listNotebooks(): Promise<any[]> {
    const notebooks = await this.fetchAll<any>("/folders", { fields: "id,title,parent_id,icon" });
    return notebooks.map(n => {
      // If it doesn't have an icon or the icon is empty, use '🖿' (U+1F5BF)
      // We also check that the icon is likely a unicode string and not a data URI
      if (!n.icon || n.icon.startsWith("data:")) {
        n.icon = "🖿";
      }
      return n;
    });
  }

  async listTags(): Promise<any[]> {
    return await this.fetchAll("/tags");
  }

  async listNotes(notebookIdOrName?: string, type?: "all" | "notes" | "todos" | "completed_todos", page: number = 1): Promise<{ notes: any[], has_more: boolean }> {
    let res;
    const fields = "id,title,is_todo,todo_completed";
    
    if (notebookIdOrName) {
      // Check if it's an ID or a Name
      let notebookId = notebookIdOrName;
      
      const notebooks = await this.listNotebooks();
      const match = notebooks.find(n => n.id === notebookIdOrName || n.title === notebookIdOrName);
      if (match) {
        notebookId = match.id;
      } else if (!notebooks.find(n => n.id === notebookIdOrName)) {
        return { notes: [], has_more: false }; // Not found
      }

      res = await this.fetchPage<any>(`/folders/${notebookId}/notes`, page, { fields });
    } else {
      res = await this.fetchPage<any>("/notes", page, { fields });
    }
    // console.log("FETCH PAGE RETURNED:", res.items.length, "HAS MORE:", res.has_more);

    let notes = res.items;

    // The REST API sometimes returns 0/1 instead of booleans
    const isTodo = (n: any) => n.is_todo === 1 || n.is_todo === true;
    const isCompleted = (n: any) => n.todo_completed > 0;

    if (type === "notes") {
      notes = notes.filter(n => !isTodo(n));
    } else if (type === "todos") {
      notes = notes.filter(n => isTodo(n) && !isCompleted(n));
    } else if (type === "completed_todos") {
      notes = notes.filter(n => isTodo(n) && isCompleted(n));
    } else {
      // "all" - default: exclude completed todos unless explicitly requested
      notes = notes.filter(n => !(isTodo(n) && isCompleted(n)));
    }

    notes = notes.map(n => {
      n.icon = (!isTodo(n)) ? "🗎" : (isCompleted(n) ? "🗹" : "☐");
      return n;
    });

    return { notes, has_more: res.has_more };
  }

  async listNotesByTag(tagName: string, type?: "all" | "notes" | "todos" | "completed_todos", page: number = 1): Promise<{ notes: any[], has_more: boolean }> {
    const tags = await this.fetchAll<any>("/tags");
    const tag = tags.find(t => t.title === tagName);
    if (!tag) return { notes: [], has_more: false };

    const fields = "id,title,is_todo,todo_completed";
    const res = await this.fetchPage<any>(`/tags/${tag.id}/notes`, page, { fields });
    let notes = res.items;

    // The REST API sometimes returns 0/1 instead of booleans
    const isTodo = (n: any) => n.is_todo === 1 || n.is_todo === true;
    const isCompleted = (n: any) => n.todo_completed > 0;

    if (type === "notes") {
      notes = notes.filter(n => !isTodo(n));
    } else if (type === "todos") {
      notes = notes.filter(n => isTodo(n) && !isCompleted(n));
    } else if (type === "completed_todos") {
      notes = notes.filter(n => isTodo(n) && isCompleted(n));
    } else {
      // "all" - default: exclude completed todos unless explicitly requested
      notes = notes.filter(n => !(isTodo(n) && isCompleted(n)));
    }

    notes = notes.map(n => {
      n.icon = (!isTodo(n)) ? "🗎" : (isCompleted(n) ? "🗹" : "☐");
      return n;
    });

    return { notes, has_more: res.has_more };
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

  async moveNote(noteIdOrName: string, notebookIdOrName: string): Promise<void> {
    let noteId = noteIdOrName;
    const allNotes = await this.fetchAll<any>("/notes");
    const noteMatch = allNotes.find(n => n.id === noteIdOrName || n.title === noteIdOrName);
    if (noteMatch) {
      noteId = noteMatch.id;
    }

    const allNotebooks = await this.listNotebooks();
    const notebookMatch = allNotebooks.find(n => n.id === notebookIdOrName || n.title === notebookIdOrName);
    
    if (!notebookMatch) {
      throw new Error(`Notebook '${notebookIdOrName}' not found`);
    }

    const notebookId = notebookMatch.id;

    await this.request<any>(`/notes/${noteId}`, { method: "PUT" }, { parent_id: notebookId });
  }

  async createNote(options: { title: string, type: "note" | "todo", body?: string, notebookIdOrName?: string }): Promise<any> {
    const payload: any = {
      title: options.title,
      is_todo: options.type === "todo" ? 1 : 0
    };
    if (options.body !== undefined) {
      payload.body = options.body;
    }
    if (options.notebookIdOrName) {
      const allNotebooks = await this.listNotebooks();
      const notebookMatch = allNotebooks.find(n => n.id === options.notebookIdOrName || n.title === options.notebookIdOrName);
      if (!notebookMatch) {
        throw new Error(`Notebook '${options.notebookIdOrName}' not found`);
      }
      payload.parent_id = notebookMatch.id;
    }
    return await this.request<any>("/notes", { method: "POST" }, payload);
  }

  async editNote(noteIdOrName: string, options: { title?: string, body?: string, type?: "note" | "todo" }): Promise<void> {
    let noteId = noteIdOrName;
    const allNotes = await this.fetchAll<any>("/notes");
    const noteMatch = allNotes.find(n => n.id === noteIdOrName || n.title === noteIdOrName);
    if (noteMatch) {
      noteId = noteMatch.id;
    }
    
    const payload: any = {};
    if (options.title !== undefined) payload.title = options.title;
    if (options.body !== undefined) payload.body = options.body;
    if (options.type !== undefined) payload.is_todo = options.type === "todo" ? 1 : 0;
    
    if (Object.keys(payload).length === 0) return;
    
    await this.request<any>(`/notes/${noteId}`, { method: "PUT" }, payload);
  }

  async setTodoCompletion(noteIdOrName: string, completed: boolean): Promise<void> {
    let noteId = noteIdOrName;
    const allNotes = await this.fetchAll<any>("/notes");
    const noteMatch = allNotes.find(n => n.id === noteIdOrName || n.title === noteIdOrName);
    if (noteMatch) {
      noteId = noteMatch.id;
    }
    
    const payload = { todo_completed: completed ? Date.now() : 0 };
    await this.request<any>(`/notes/${noteId}`, { method: "PUT" }, payload);
  }
}
