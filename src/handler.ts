import { normalize } from "@std/path/posix/normalize";
import { dirname } from "@std/path/posix/dirname";
import { join } from "@std/path/posix/join";
import { serveFile } from "./file_server.ts";
import { applyHeaders, type HeaderRule, matchHeaders } from "./headers.ts";
import { matchRedirect, type RedirectRule } from "./redirects.ts";
import { type Fs, SystemFs } from "./sys.ts";

export enum TrailingSlashBehavior {
  Force = "force",
  Never = "never",
  Ignore = "ignore",
}

/**
 * Options for the static file server.
 */
export interface ServerOptions {
  /** The root directory to serve files from. */
  root: string;
  /** Enable SPA mode (rewrite all non-file requests to index.html) */
  spa: boolean;
  /** Redirect rules */
  redirectRules: RedirectRule[];
  /** Header rules */
  headerRules: HeaderRule[];
  /** Trailing slash behavior: "force", "never", or "ignore" */
  trailingSlash: TrailingSlashBehavior;
  /** Optional filesystem implementation (defaults to SystemFs) */
  fs?: Fs;
  /** Add s-maxage to Cache-Control headers (value in seconds) */
  cacheControlMaxAge?: number;
}

/**
 * Handle trailing slash redirects based on the configured behavior.
 *
 * @param url - The request URL
 * @param trailingSlash - The trailing slash behavior
 * @returns A redirect response if needed, null otherwise
 */
function handleTrailingSlash(
  url: URL,
  trailingSlash: TrailingSlashBehavior,
): Response | null {
  if (trailingSlash === TrailingSlashBehavior.Ignore) return null;

  const pathname = url.pathname;

  if (trailingSlash === TrailingSlashBehavior.Force && !pathname.endsWith("/")) {
    url.pathname = pathname + "/";
    return Response.redirect(url.toString(), 301);
  }

  if (trailingSlash === TrailingSlashBehavior.Never && pathname.endsWith("/") && pathname !== "/") {
    url.pathname = pathname.replace(/\/+$/, "");
    return Response.redirect(url.toString(), 301);
  }

  return null;
}

/**
 * Resolve a path within the root directory, ensuring it doesn't escape.
 *
 * @param root - The root directory
 * @param requestPath - The requested path
 * @returns The resolved file path, or null if it would escape the root
 */
function resolvePath(root: string, requestPath: string): string | null {
  try {
    // Normalize and join paths
    const normalizedPath = normalize(decodeURIComponent(requestPath));
    const fullPath = join(root, normalizedPath);

    // Ensure the path doesn't escape the root directory
    const normalizedRoot = normalize(root);
    if (!fullPath.startsWith(normalizedRoot)) return null;

    return fullPath;
  } catch {
    return null;
  }
}

/**
 * Create a request handler for the static file server.
 *
 * @param options - Server options
 * @returns A request handler function
 */
export function createHandler(options: ServerOptions) {
  const { root, spa, redirectRules, headerRules, trailingSlash, cacheControlMaxAge } = options;

  const fs = options.fs ?? new SystemFs();

  function applyCacheControl(response: Response) {
    if (cacheControlMaxAge !== undefined) {
      const existingCacheControl = response.headers.get("Cache-Control");
      if (existingCacheControl && !existingCacheControl.includes("s-maxage")) {
        response.headers.set("Cache-Control", `${existingCacheControl}, s-maxage=${cacheControlMaxAge}`);
      } else if (!existingCacheControl) {
        response.headers.set("Cache-Control", `s-maxage=${cacheControlMaxAge}`);
      }
    }
  }

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const trailingSlashResponse = handleTrailingSlash(url, trailingSlash);
    if (trailingSlashResponse) return trailingSlashResponse;

    let resolvedPath = resolvePath(root, pathname);
    let handle = resolvedPath ? await fs.get(resolvedPath) : null;
    if (resolvedPath && handle && handle.kind === "dir") {
      // If it's a directory, check whether index.html exists
      const indexPath = join(resolvedPath, "index.html");
      handle = await fs.get(indexPath);
      if (handle && handle.kind === "file") {
        resolvedPath = indexPath;
      } else {
        handle = null;
      }
    }
    if (resolvedPath && handle === null && spa) {
      // In SPA mode, try to find the closest index.html
      for (let dir = dirname(resolvedPath); dir.startsWith(root); dir = dirname(dir)) {
        const indexPath = join(dir, "index.html");
        const indexHandle = await fs.get(indexPath);
        if (indexHandle && indexHandle.kind === "file") {
          resolvedPath = indexPath;
          handle = indexHandle;
          break;
        }
      }
    }

    const redirectMatch = matchRedirect(pathname, url.searchParams, redirectRules, handle !== null);
    if (redirectMatch) {
      const { rule, destination } = redirectMatch;
      if (rule.status === 200 || rule.status === 404) {
        // Rewrite: serve the destination file but keep the original URL
        const destinationPath = resolvePath(root, destination);
        handle = destinationPath ? await fs.get(destinationPath) : null;
        if (handle && handle.kind === "file") {
          resolvedPath = destinationPath;
        } else {
          handle = null;
        }
      } else {
        // Redirect: send a redirect response
        const redirectUrl = new URL(destination, url.origin);

        // Preserve original query parameters unless they were captured
        for (const [queryKey] of rule.queryCaptures) url.searchParams.delete(queryKey);
        redirectUrl.search = url.search;

        const response = new Response("", {
          status: rule.status,
          headers: { Location: redirectUrl.toString() },
        });
        const matchedHeaders = matchHeaders(pathname, headerRules);
        applyHeaders(response.headers, matchedHeaders);
        applyCacheControl(response);
        return response;
      }
    }

    if (handle && handle.kind === "file") {
      const response = await serveFile(request, handle);
      const matchedHeaders = matchHeaders(pathname, headerRules);
      applyHeaders(response.headers, matchedHeaders);
      applyCacheControl(response);

      return response;
    }

    return new Response("Not Found", { status: 404 });
  };
}
