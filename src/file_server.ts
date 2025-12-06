import { contentType } from "@std/media-types";
import { extname } from "@std/path";
import { ifNoneMatch } from "@std/http/etag";
import type { FileHandle } from "./sys.ts";
import { isImage, optimizeImage, parseImageOptimizationOptions } from "./image_optimizer.ts";

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
  const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
  if (!match) {
    return null;
  }

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  if (isNaN(start) || isNaN(end) || start > end || end >= fileSize) {
    return null;
  }

  return { start, end };
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
 * Generate a content-based ETag for a file using SHA-256.
 */
export async function generateContentETag(content: Uint8Array<ArrayBuffer>): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", content.buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  // Use first 16 characters for a reasonable length ETag
  return `"${hashHex.slice(0, 16)}"`;
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
  searchParams: URLSearchParams,
  handle: FileHandle,
): Promise<Response> {
  // Only support GET and HEAD methods
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "GET, HEAD" } });
  }

  const ext = extname(handle.name);
  const mimeType = contentType(ext);

  const headers = new Headers({
    "server": "deno",
  });

  if (isImage(mimeType ?? "") && searchParams.has("o")) {
    const optimizationOptions = parseImageOptimizationOptions(searchParams);
    // We only optimize images smaller than 10MB
    if (handle.stat.size <= 10 * 1024 * 1024) {
      const stream = await handle.open();
      const bytes = await new Response(stream).bytes();
      const optimized = await optimizeImage(bytes, optimizationOptions);
      headers.set("Content-Length", optimized.data.byteLength.toString());
      headers.set("Content-Type", optimized.contentType);
      headers.set("ETag", optimized.etag);
      if (handle.stat.mtime) {
        headers.set("Last-Modified", handle.stat.mtime.toUTCString());
      }
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });
      return new Response(optimized.data, { status: 200, headers });
    }
  }

  // Initialize response headers
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

  // Handle Range requests
  headers.set("Accept-Ranges", "bytes");
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
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

    // For HEAD requests, don't read the file
    if (request.method === "HEAD") {
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
