import { contentType } from "@std/media-types";
import { extname } from "@std/path";
import { ifNoneMatch } from "@std/http/etag";
import type { FileHandle } from "./sys.ts";

/**
 * Parse the Range header from a request.
 *
 * @param rangeHeader - The Range header value
 * @param fileSize - The total size of the file
 * @returns The start and end byte positions, or null if invalid
 */
function parseRangeHeader(
  rangeHeader: string,
  fileSize: number,
): { start: number; end: number } | null {
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || !(match[1] || match[2])) {
    return null;
  }

  if (!match[1]) {
    const suffixLength = parseInt(match[2], 10);
    const start = Math.max(0, fileSize - suffixLength);
    return isNaN(suffixLength) ? null : { start, end: fileSize - 1 };
  }

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  if (isNaN(start) || isNaN(end) || start > end || end >= fileSize) {
    return null;
  }

  return { start, end };
}

/**
 * Check if a resource has been modified since the given date.
 *
 * @param header - The If-Modified-Since header value
 * @param mtime - The file's modification time (Date object, ISO 8601 string, or undefined)
 * @returns true if modified, false if not modified (304 should be returned)
 */
function IfModifiedSince(
  header: string,
  mtime: null | string | Date,
): boolean {
  // No mtime available, consider it modified
  if (!mtime) return true;

  try {
    const ifModifiedSince = new Date(header);
    const lastModified = mtime instanceof Date ? mtime : new Date(mtime);

    // HTTP date headers have 1-second precision, so we floor to seconds
    const ifModifiedSinceSeconds = Math.floor(ifModifiedSince.getTime() / 1000);
    const lastModifiedSeconds = Math.floor(lastModified.getTime() / 1000);
    return isNaN(ifModifiedSinceSeconds) || isNaN(lastModifiedSeconds) ||
      lastModifiedSeconds > ifModifiedSinceSeconds;
  } catch {
    // If parsing fails, consider it modified
    return true;
  }
}

/**
 * Generate an ETag for a file.
 *
 * @param fileInfo - The file information
 * @returns The ETag value
 */
function generateETag(fileInfo: Deno.FileInfo): string {
  const mtime = fileInfo.mtime?.getTime() ?? 0;
  const size = fileInfo.size;

  let hash = 2166136261;
  const data = `${mtime}-${size}`;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `"${(hash >>> 0).toString(36)}"`;
}

/**
 * Serve a file as an HTTP response.
 *
 * @param request - The HTTP request
 * @param handle - The file handle to serve
 * @returns The HTTP response
 */
export async function serveFile(
  request: Request,
  handle: FileHandle,
): Promise<Response> {
  // Only support GET and HEAD methods
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "GET, HEAD" } });
  }

  // Initialize response headers
  const headers = new Headers({
    "server": "deno",
    "accept-ranges": "bytes",
  });

  // Set Content-Type based on file extension
  const ext = extname(handle.name);
  const mimeType = contentType(ext);
  if (mimeType) headers.set("Content-Type", mimeType);

  // Get ETag, or generate if not present
  const etag = handle.etag ?? generateETag(handle.stat);
  headers.set("ETag", etag);

  // Set Last-Modified
  if (handle.stat.mtime) {
    headers.set("Last-Modified", handle.stat.mtime.toUTCString());
  }

  // Check If-None-Match (ETag validation)
  const ifNoneMatchHeader = request.headers.get("If-None-Match");
  if (ifNoneMatchHeader && !ifNoneMatch(ifNoneMatchHeader, etag)) return new Response(null, { status: 304, headers });

  // Check If-Modified-Since (Time based validation)
  const ifModifiedSinceHeader = request.headers.get("If-Modified-Since");
  if (ifModifiedSinceHeader && !IfModifiedSince(ifModifiedSinceHeader, handle.stat.mtime)) {
    return new Response(null, { status: 304, headers });
  }

  // Handle Range requests
  const rangeHeader = request.headers.get("Range")?.trim();
  if (rangeHeader && rangeHeader.startsWith("bytes=")) {
    const range = parseRangeHeader(rangeHeader, handle.stat.size);
    if (!range) {
      return new Response("Range Not Satisfiable", {
        status: 416,
        headers: {
          "Content-Range": `bytes */${handle.stat.size}`,
        },
      });
    }

    const { start, end } = range;
    const contentLength = end - start + 1;

    headers.set("Content-Range", `bytes ${start}-${end}/${handle.stat.size}`);
    headers.set("Content-Length", contentLength.toString());

    // For zero-length response don't open the file
    if (request.method == "HEAD" || contentLength === 0) {
      return new Response(null, { status: 206, headers });
    }

    const file = await handle.open(start);

    const stream = file.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          const remaining = end - start + 1 - controller.desiredSize!;
          if (chunk.byteLength <= remaining) {
            controller.enqueue(chunk);
          } else {
            controller.enqueue(chunk.slice(0, remaining));
            controller.terminate();
          }
        },
      }),
    );

    return new Response(stream, { status: 206, headers });
  }

  // Standard response
  headers.set("Content-Length", handle.stat.size.toString());

  // For HEAD requests, don't read the file
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });

  // Open and stream the file
  const file = await handle.open();
  return new Response(file, { status: 200, headers });
}
