import { spawn, ChildProcess } from "child_process";
import { readFile } from "fs/promises";
import * as path from "path";
import * as os from "os";

export class JoplinClient {
  private apiToken?: string;
  private port: number = 41184; // Default desktop port
  private serverProcess?: ChildProcess;
  public apiLimit?: number; // Used for testing pagination with smaller page sizes
  /** null = unrestricted; empty Set = fail-closed deny-all */
  private allowedNotebookIds: Set<string> | null = null;
  private scopeSummary: string = "unrestricted";
  /** Per-request timeout (ms). */
  public requestTimeoutMs = 8000;
  /** Timeout for ping probes and headless server startup (ms). */
  public connectTimeoutMs = 5000;

  constructor(private profilePath?: string, private forceHeadlessPort?: number) {
    if (forceHeadlessPort) {
      this.port = forceHeadlessPort;
    }
  }

  /**
   * Restrict access to the given notebook IDs (already expanded to include descendants).
   * Pass null for unrestricted access.
   */
  setScope(allowedNotebookIds: Set<string> | null, summary: string = "unrestricted") {
    this.allowedNotebookIds = allowedNotebookIds;
    this.scopeSummary = summary;
  }

  getScopeSummary(): string {
    return this.scopeSummary;
  }

  isScoped(): boolean {
    return this.allowedNotebookIds !== null;
  }

  private scopeError(what: string): Error {
    return new Error(
      `${what} is outside the allowed notebook scope. Effective scope: ${this.scopeSummary}`
    );
  }

  private isNotebookAllowed(notebookId: string): boolean {
    if (this.allowedNotebookIds === null) return true;
    return this.allowedNotebookIds.has(notebookId);
  }

  private assertNotebookAllowed(notebookId: string, what: string) {
    if (!this.isNotebookAllowed(notebookId)) {
      throw this.scopeError(what);
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.connectTimeoutMs);
    try {
      const res = await fetch(`http://localhost:${port}/ping`, { signal: controller.signal });
      if (res.ok) {
        const text = await res.text();
        if (text.includes("JoplinClipperServer")) {
          this.port = port;
          return true;
        }
      }
    } catch {
      // Connection refused, timeout, etc.
    } finally {
      clearTimeout(timer);
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

      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        reject(err);
      };
      const succeed = () => {
        if (settled) return;
        settled = true;
        clearTimeout(startupTimer);
        resolve();
      };

      const startupTimer = setTimeout(() => {
        fail(new Error(`Joplin headless server did not start within ${this.connectTimeoutMs}ms`));
        // Best-effort cleanup: don't leave a half-started process behind.
        try {
          this.serverProcess?.kill("SIGTERM");
        } catch {
          // ignore
        }
        this.serverProcess = undefined;
      }, this.connectTimeoutMs);

      this.serverProcess.on("error", fail);
      this.serverProcess.on("close", (code) => {
        if (code !== 0 && code !== null) {
          fail(new Error(`Joplin server exited with code ${code}`));
        }
      });

      // Listen for the "Starting Clipper server on port" line
      if (this.serverProcess.stdout) {
        this.serverProcess.stdout.on("data", (data: Buffer) => {
          const str = data.toString();
          const match = str.match(/Starting Clipper server on port (\d+)/);
          if (match) {
            this.port = parseInt(match[1], 10);
            succeed();
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      fetchOpts.signal = controller.signal;
      const res = await fetch(url.toString(), fetchOpts);
      if (!res.ok) {
        throw new Error(`Joplin API Error: ${res.status} ${res.statusText}`);
      }

      const text = await res.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    } catch (err: any) {
      if (err?.name === "AbortError") {
        throw new Error(`Joplin request timed out after ${this.requestTimeoutMs}ms: ${endpoint}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
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

  /** Unfiltered notebook list (for scope resolution / config UI). */
  async listAllNotebooks(): Promise<any[]> {
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

  async listNotebooks(): Promise<any[]> {
    const notebooks = await this.listAllNotebooks();
    if (this.allowedNotebookIds === null) return notebooks;
    return notebooks.filter(n => this.allowedNotebookIds!.has(n.id));
  }

  async listTags(): Promise<any[]> {
    return await this.fetchAll("/tags");
  }

  /** Filter notes by type and attach display icons (shared by listNotes and listNotesByTag). */
  private processNotes(
    notes: any[],
    type?: "all" | "notes" | "todos" | "completed_todos"
  ): any[] {
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

    return notes.map(n => {
      n.icon = (!isTodo(n)) ? "🗎" : (isCompleted(n) ? "🗹" : "☐");
      return n;
    });
  }

  async listNotes(notebookIdOrName?: string, type?: "all" | "notes" | "todos" | "completed_todos", page: number = 1): Promise<{ notes: any[], has_more: boolean }> {
    let res;
    const fields = "id,title,is_todo,todo_completed,parent_id";
    
    if (notebookIdOrName) {
      // Check if it's an ID or a Name (search unscoped tree so we can silently filter out-of-scope)
      let notebookId = notebookIdOrName;
      
      const notebooks = await this.listAllNotebooks();
      const match = notebooks.find(n => n.id === notebookIdOrName || n.title === notebookIdOrName);
      if (match) {
        notebookId = match.id;
      } else if (!notebooks.find(n => n.id === notebookIdOrName)) {
        return { notes: [], has_more: false }; // Not found
      }

      // List filter: out-of-scope notebook => empty result
      if (!this.isNotebookAllowed(notebookId)) {
        return { notes: [], has_more: false };
      }

      res = await this.fetchPage<any>(`/folders/${notebookId}/notes`, page, { fields });
    } else {
      res = await this.fetchPage<any>("/notes", page, { fields });
    }
    // console.log("FETCH PAGE RETURNED:", res.items.length, "HAS MORE:", res.has_more);

    let notes = res.items;

    // Scope filter for global listing
    if (this.allowedNotebookIds !== null) {
      notes = notes.filter(n => this.allowedNotebookIds!.has(n.parent_id));
    }

    notes = this.processNotes(notes, type);

    return { notes, has_more: res.has_more };
  }

  async listNotesByTag(tagName: string, type?: "all" | "notes" | "todos" | "completed_todos", page: number = 1): Promise<{ notes: any[], has_more: boolean }> {
    const tags = await this.fetchAll<any>("/tags");
    const tag = tags.find(t => t.title === tagName);
    if (!tag) return { notes: [], has_more: false };

    const fields = "id,title,is_todo,todo_completed,parent_id";
    const res = await this.fetchPage<any>(`/tags/${tag.id}/notes`, page, { fields });
    let notes = res.items;

    if (this.allowedNotebookIds !== null) {
      notes = notes.filter(n => this.allowedNotebookIds!.has(n.parent_id));
    }

    notes = this.processNotes(notes, type);

    return { notes, has_more: res.has_more };
  }

  /**
   * Resolve a note by id or title and enforce notebook scope for single-item ops.
   * Title matches prefer in-scope notes when scoped.
   */
  private async resolveNote(noteIdOrName: string): Promise<{ id: string; parent_id: string; title?: string }> {
    const allNotes = await this.fetchAll<any>("/notes", { fields: "id,title,parent_id" });

    if (this.allowedNotebookIds !== null) {
      const inScope = allNotes.filter((n: any) => this.allowedNotebookIds!.has(n.parent_id));
      const scopedMatch = inScope.find((n: any) => n.id === noteIdOrName || n.title === noteIdOrName);
      if (scopedMatch) {
        return { id: scopedMatch.id, parent_id: scopedMatch.parent_id, title: scopedMatch.title };
      }

      const anyMatch = allNotes.find((n: any) => n.id === noteIdOrName || n.title === noteIdOrName);
      if (anyMatch) {
        throw this.scopeError(`Note '${noteIdOrName}'`);
      }

      // Direct id fetch path: load parent_id and check scope
      try {
        const direct = await this.request<any>(`/notes/${noteIdOrName}`, { fields: "id,title,parent_id" });
        if (direct && direct.id) {
          this.assertNotebookAllowed(direct.parent_id, `Note '${noteIdOrName}'`);
          return { id: direct.id, parent_id: direct.parent_id, title: direct.title };
        }
      } catch {
        // fall through
      }

      throw this.scopeError(`Note '${noteIdOrName}'`);
    }

    const match = allNotes.find((n: any) => n.id === noteIdOrName || n.title === noteIdOrName);
    if (match) {
      return { id: match.id, parent_id: match.parent_id, title: match.title };
    }
    return { id: noteIdOrName, parent_id: "" };
  }

  private async resolveNotebookId(notebookIdOrName: string): Promise<string> {
    const notebooks = await this.listAllNotebooks();
    const match = notebooks.find(n => n.id === notebookIdOrName || n.title === notebookIdOrName);
    if (!match) {
      throw new Error(`Notebook '${notebookIdOrName}' not found`);
    }
    return match.id;
  }

  async readNote(noteIdOrName: string): Promise<string> {
    const resolved = await this.resolveNote(noteIdOrName);
    const note = await this.request<any>(`/notes/${resolved.id}`, { fields: "body" });
    return note.body;
  }

  async getNoteTags(noteId: string): Promise<string[]> {
    const tags = await this.fetchAll<any>(`/notes/${noteId}/tags`);
    return tags.map(t => t.title);
  }

  async getNoteMetadata(noteIdOrName: string): Promise<Record<string, any>> {
    const resolved = await this.resolveNote(noteIdOrName);

    const fields = "id,parent_id,title,is_todo,todo_due,todo_completed,created_time,updated_time,source_url,source_application,latitude,longitude,altitude,author";
    const metadata = await this.request<Record<string, any>>(`/notes/${resolved.id}`, { fields });
    // Enforce scope using authoritative parent_id from the note record
    if (metadata.parent_id) {
      this.assertNotebookAllowed(metadata.parent_id, `Note '${noteIdOrName}'`);
    }
    metadata.tags = await this.getNoteTags(resolved.id);
    
    return metadata;
  }

  async addTagToNote(tagIdOrName: string, noteIdOrName: string): Promise<void> {
    const resolved = await this.resolveNote(noteIdOrName);
    const noteId = resolved.id;

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
    const resolved = await this.resolveNote(noteIdOrName);
    const noteId = resolved.id;

    const allTags = await this.fetchAll<any>("/tags");
    const tagMatch = allTags.find(t => t.id === tagIdOrName || t.title === tagIdOrName);
    
    if (!tagMatch) {
      throw new Error(`Tag '${tagIdOrName}' not found`);
    }
    
    const tagId = tagMatch.id;

    await this.request<any>(`/tags/${tagId}/notes/${noteId}`, { method: "DELETE" });
  }

  async moveNote(noteIdOrName: string, notebookIdOrName: string): Promise<void> {
    const resolved = await this.resolveNote(noteIdOrName);
    const noteId = resolved.id;

    const notebookId = await this.resolveNotebookId(notebookIdOrName);
    this.assertNotebookAllowed(notebookId, `Destination notebook '${notebookIdOrName}'`);

    await this.request<any>(`/notes/${noteId}`, { method: "PUT" }, { parent_id: notebookId });
  }

  async createNote(options: {
    title: string;
    type: "note" | "todo";
    body?: string;
    notebookIdOrName?: string;
    tags?: string[];
  }): Promise<any> {
    if (this.allowedNotebookIds !== null && !options.notebookIdOrName) {
      throw new Error(
        `notebook is required when notebook scope is active. Effective scope: ${this.scopeSummary}`
      );
    }

    const payload: any = {
      title: options.title,
      is_todo: options.type === "todo" ? 1 : 0
    };
    if (options.body !== undefined) {
      payload.body = options.body;
    }
    if (options.notebookIdOrName) {
      const notebookId = await this.resolveNotebookId(options.notebookIdOrName);
      this.assertNotebookAllowed(notebookId, `Notebook '${options.notebookIdOrName}'`);
      payload.parent_id = notebookId;
    }
    const created = await this.request<any>("/notes", { method: "POST" }, payload);

    if (options.tags && options.tags.length > 0 && created?.id) {
      for (const tag of options.tags) {
        if (tag) {
          await this.addTagToNote(tag, created.id);
        }
      }
    }

    return created;
  }

  async editNote(noteIdOrName: string, options: { title?: string, body?: string, type?: "note" | "todo" }): Promise<void> {
    const resolved = await this.resolveNote(noteIdOrName);
    const noteId = resolved.id;
    
    const payload: any = {};
    if (options.title !== undefined) payload.title = options.title;
    if (options.body !== undefined) payload.body = options.body;
    if (options.type !== undefined) payload.is_todo = options.type === "todo" ? 1 : 0;
    
    if (Object.keys(payload).length === 0) return;
    
    await this.request<any>(`/notes/${noteId}`, { method: "PUT" }, payload);
  }

  async setTodoCompletion(noteIdOrName: string, completed: boolean): Promise<void> {
    const resolved = await this.resolveNote(noteIdOrName);
    const noteId = resolved.id;
    
    const payload = { todo_completed: completed ? Date.now() : 0 };
    await this.request<any>(`/notes/${noteId}`, { method: "PUT" }, payload);
  }
}
