/**
 * Local head-truncation for tool output.
 * Kept in-package so the extension does not runtime-import
 * @earendil-works/pi-coding-agent (which jiti would fully re-load on startup).
 */

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

export interface TruncationResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  outputLines: number;
}

export interface TruncationOptions {
  maxLines?: number;
  maxBytes?: number;
}

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

/** Keep the first N lines / first maxBytes (complete lines only). */
export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const totalBytes = Buffer.byteLength(content, "utf-8");
  const lines = splitLines(content);
  const totalLines = lines.length;

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return { content, truncated: false, totalLines, outputLines: totalLines };
  }

  const out: string[] = [];
  let used = 0;

  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const line = lines[i];
    const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0);
    if (used + lineBytes > maxBytes) break;
    out.push(line);
    used += lineBytes;
  }

  return {
    content: out.join("\n"),
    truncated: true,
    totalLines,
    outputLines: out.length,
  };
}
