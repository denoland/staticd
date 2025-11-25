/**
 * Manifest system for pre-computing file information, ETags, and configuration.
 * This allows the server to skip filesystem scanning on startup.
 */

import { join } from "@std/path/posix/join";
import { relative } from "@std/path/posix/relative";
import { basename } from "@std/path/posix/basename";
import type { Fs, FsHandle } from "./sys.ts";
import { type HeaderRule, parseHeaders } from "./headers.ts";
import { parseRedirects, type RedirectRule } from "./redirects.ts";

/**
 * Information about a file in the manifest.
 */
export interface ManifestFile {
  /** File path relative to root */
  path: string;
  /** File size in bytes */
  size: number;
  /** Last modification time (ISO 8601 string) */
  mtime: string;
  /** Pre-computed ETag for the file */
  etag: string;
}

/**
 * Complete manifest containing all pre-computed information.
 */
export interface Manifest {
  /** Version of the manifest format */
  version: number;
  /** Timestamp when manifest was generated (ISO 8601) */
  generatedAt: string;
  /** Map of file paths to file information */
  files: Record<string, ManifestFile>;
  /** Set of directory paths (relative to root) */
  directories: string[];
  /** Parsed redirect rules from _redirects file */
  redirects: Array<{
    from: string; // pathname of URLPattern
    to: string;
    status: number;
    force: boolean;
    queryCaptures: Array<[string, string]>;
  }>;
  /** Parsed header rules from _headers file */
  headers: Array<{
    pattern: string;
    headers: Array<[string, string]>;
  }>;
}

/**
 * Generate a content-based ETag for a file using SHA-256.
 */
async function generateContentETag(filePath: string): Promise<string> {
  const fileContent = await Deno.readFile(filePath);
  const hashBuffer = await crypto.subtle.digest("SHA-256", fileContent);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  // Use first 16 characters for a reasonable length ETag
  return `"${hashHex.slice(0, 16)}"`;
}

/**
 * Recursively scan a directory and collect file and directory information.
 */
async function scanDirectory(
  root: string,
  currentPath: string,
  files: Record<string, ManifestFile>,
  directories: Set<string>,
): Promise<void> {
  const entries = [];
  for await (const entry of Deno.readDir(currentPath)) {
    entries.push(entry);
  }

  for (const entry of entries) {
    const fullPath = join(currentPath, entry.name);
    const relativePath = "/" + relative(root, fullPath);

    if (entry.isFile) {
      // Skip configuration files and manifest files
      if (
        entry.name === "_redirects" ||
        entry.name === "_headers"
      ) {
        continue;
      }

      const stat = await Deno.stat(fullPath);
      const etag = await generateContentETag(fullPath);

      files[relativePath] = {
        path: relativePath,
        size: stat.size,
        mtime: stat.mtime?.toISOString() ?? new Date(0).toISOString(),
        etag,
      };
    } else if (entry.isDirectory) {
      directories.add(relativePath);
      await scanDirectory(root, fullPath, files, directories);
    }
  }
}

/**
 * Generate a manifest for the given root directory.
 */
export async function generateManifest(root: string): Promise<Manifest> {
  const files: Record<string, ManifestFile> = {};
  const directories = new Set<string>();

  // Scan all files and directories
  await scanDirectory(root, root, files, directories);

  // Parse _redirects file if it exists
  const redirects: Manifest["redirects"] = [];
  const redirectsPath = join(root, "_redirects");
  try {
    const content = await Deno.readTextFile(redirectsPath);
    const rules = parseRedirects(content);
    for (const rule of rules) {
      redirects.push({
        from: rule.from.pathname,
        to: rule.to,
        status: rule.status,
        force: rule.force,
        queryCaptures: rule.queryCaptures,
      });
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      console.warn(`Error reading _redirects: ${err}`);
    }
  }

  // Parse _headers file if it exists
  const headers: Manifest["headers"] = [];
  const headersPath = join(root, "_headers");
  try {
    const content = await Deno.readTextFile(headersPath);
    const rules = parseHeaders(content);
    for (const rule of rules) {
      headers.push({
        pattern: rule.pattern.pathname,
        headers: rule.headers,
      });
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      console.warn(`Error reading _headers: ${err}`);
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    files,
    directories: Array.from(directories).sort(),
    redirects,
    headers,
  };
}

/**
 * Write a manifest to a JSON file.
 */
export async function writeManifest(manifest: Manifest, outputPath: string): Promise<void> {
  const json = JSON.stringify(manifest, null, 2);
  await Deno.writeTextFile(outputPath, json);
}

/**
 * Read a manifest from a JSON file.
 */
export async function readManifest(manifestPath: string): Promise<Manifest> {
  const json = await Deno.readTextFile(manifestPath);
  return JSON.parse(json);
}

/**
 * Filesystem implementation that uses a pre-generated manifest.
 * This avoids filesystem calls by using cached information.
 */
export class ManifestFs implements Fs {
  private manifest: Manifest;
  private root: string;

  constructor(manifest: Manifest, root: string) {
    this.manifest = manifest;
    this.root = root;
  }

  // deno-lint-ignore require-await
  async get(path: string): Promise<FsHandle | null> {
    // Normalize path to relative
    const relativePath = "/" + relative(this.root, path);

    // Check if it's a file in the manifest
    const file = this.manifest.files[relativePath];
    if (file) {
      const mtime = new Date(file.mtime);
      return {
        kind: "file",
        name: basename(path),
        stat: {
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: file.size,
          mtime,
          atime: null,
          birthtime: null,
          ctime: null,
          dev: 0,
          ino: null,
          mode: null,
          nlink: null,
          uid: null,
          gid: null,
          rdev: null,
          blksize: null,
          blocks: null,
          isBlockDevice: false,
          isCharDevice: false,
          isFifo: false,
          isSocket: false,
        },
        etag: file.etag,
        open: async (start?: number) => {
          // For manifest mode, we still need to open the actual file
          // but we can skip stat calls since we have the info cached
          const actualPath = join(this.root, file.path.slice(1));
          const fileHandle = await Deno.open(actualPath, { read: true });
          if (start) await fileHandle.seek(start, Deno.SeekMode.Start);
          return fileHandle.readable;
        },
      };
    }

    // Check if it's a directory in the manifest
    if (this.manifest.directories.includes(relativePath) || relativePath === "/") {
      return { kind: "dir" };
    }

    return null;
  }
}

/**
 * Convert manifest redirect rules back to RedirectRule objects with URLPattern.
 */
export function manifestRedirectsToRules(redirects: Manifest["redirects"]): RedirectRule[] {
  return redirects.map((r) => ({
    from: new URLPattern({ pathname: r.from }),
    to: r.to,
    status: r.status,
    force: r.force,
    queryCaptures: r.queryCaptures,
  }));
}

/**
 * Convert manifest header rules back to HeaderRule objects.
 */
export function manifestHeadersToRules(headers: Manifest["headers"]): HeaderRule[] {
  return headers.map((h) => ({
    pattern: new URLPattern({ pathname: h.pattern }),
    headers: h.headers,
  }));
}
