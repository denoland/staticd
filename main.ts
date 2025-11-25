#!/usr/bin/env -S deno run --allow-net --allow-read

import { parseArgs } from "@std/cli/parse-args";
import { join, resolve } from "@std/path";
import { createHandler, TrailingSlashBehavior } from "./src/handler.ts";
import { parseHeaders } from "./src/headers.ts";
import { parseRedirects } from "./src/redirects.ts";
import { SystemFs } from "./src/sys.ts";
import {
  generateManifest,
  ManifestFs,
  manifestHeadersToRules,
  manifestRedirectsToRules,
  readManifest,
  writeManifest,
} from "./src/manifest.ts";

/**
 * Load and parse the _redirects file from the root directory.
 */
async function loadRedirects(root: string) {
  const redirectsPath = join(root, "_redirects");
  try {
    const content = await Deno.readTextFile(redirectsPath);
    return parseRedirects(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
}

/**
 * Load and parse the _headers file from the root directory.
 */
async function loadHeaders(root: string) {
  const headersPath = join(root, "_headers");
  try {
    const content = await Deno.readTextFile(headersPath);
    return parseHeaders(content);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }
}

/**
 * Print usage information.
 */
function printUsage() {
  console.log(`staticd - A comprehensive static site server for Deno

USAGE:
    deno run --allow-net --allow-read jsr:@deno/staticd@1 [OPTIONS] <directory>

COMMANDS:
    serve                        Start the server (default command)
    manifest                     Generate a manifest file

SERVE OPTIONS:
    --port=<number>              Port to listen on (default: 8080)
    --spa                        Enable SPA mode
    --trailing-slash=<mode>      Handle trailing slashes: force, never, or ignore (default: ignore)
    --manifest=<path>            Load pre-generated manifest file instead of scanning filesystem
    --cache-control-max-age=<s>  Add s-maxage to Cache-Control headers (in seconds, e.g., 31536000 for 1 year)
    --quiet, -q                  Suppress all startup log output except "Listening on" message
    --help                       Show this help message

MANIFEST OPTIONS:
    --output=<path>              Output path for manifest file (default: staticd.manifest.json)

EXAMPLES:
    # Serve the current directory
    deno run --allow-net --allow-read jsr:@deno/staticd@1 .

    # Serve with SPA mode on port 3000
    deno run --allow-net --allow-read jsr:@deno/staticd@1 --spa --port=3000 ./dist

    # Generate a manifest file
    deno run --allow-read --allow-write jsr:@deno/staticd@1 manifest --output=dist.manifest.json ./dist

    # Serve using a pre-generated manifest (faster startup)
    deno run --allow-net --allow-read jsr:@deno/staticd@1 --manifest=dist.manifest.json ./dist
`);
}

/**
 * Generate a manifest file for the given directory.
 */
async function generateManifestCommand(args: string[]) {
  const parsed = parseArgs(args, {
    boolean: ["help"],
    string: ["output"],
    default: {
      output: "staticd.manifest.json",
    },
    alias: {
      h: "help",
      o: "output",
    },
  });

  if (parsed.help) {
    printUsage();
    return;
  }

  const directory = parsed._[0];
  if (!directory) {
    console.error("Error: No directory specified\n");
    printUsage();
    Deno.exit(1);
  }

  const root = resolve(String(directory));

  // Validate the directory exists
  try {
    const stat = await Deno.stat(root);
    if (!stat.isDirectory) {
      console.error(`Error: ${root} is not a directory`);
      Deno.exit(1);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error(`Error: Directory ${root} does not exist`);
      Deno.exit(1);
    }
    throw error;
  }

  const outputPath = String(parsed.output);

  console.log(`Generating manifest for ${root}...`);
  const startTime = performance.now();

  const manifest = await generateManifest(root);

  const fileCount = Object.keys(manifest.files).length;
  const redirectCount = manifest.redirects.length;
  const headerCount = manifest.headers.length;

  await writeManifest(manifest, outputPath);

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);

  console.log(`\nManifest generated successfully in ${duration}s`);
  console.log(`  - Files: ${fileCount}`);
  console.log(`  - Redirects: ${redirectCount}`);
  console.log(`  - Headers: ${headerCount}`);
  console.log(`  - Output: ${outputPath}`);
}

/**
 * Main function to start the server.
 */
export async function main(args: string[]) {
  // Check if first argument is a command
  const command = args[0];
  if (command === "manifest") {
    await generateManifestCommand(args.slice(1));
    return;
  }

  const parsed = parseArgs(args, {
    boolean: ["spa", "help", "quiet"],
    string: ["port", "trailing-slash", "manifest", "cache-control-max-age"],
    default: {
      port: "8080",
      "trailing-slash": "ignore",
    },
    alias: {
      h: "help",
      p: "port",
      q: "quiet",
    },
  });

  // Show help
  if (parsed.help) {
    printUsage();
    return;
  }

  // Get the directory to serve
  const directory = parsed._[0];
  if (!directory) {
    console.error("Error: No directory specified\n");
    printUsage();
    Deno.exit(1);
  }

  // Resolve the directory path
  const root = resolve(String(directory));

  // Validate the directory exists
  try {
    const stat = await Deno.stat(root);
    if (!stat.isDirectory) {
      console.error(`Error: ${root} is not a directory`);
      Deno.exit(1);
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      console.error(`Error: Directory ${root} does not exist`);
      Deno.exit(1);
    }
    throw error;
  }

  // Parse options
  const port = parseInt(String(parsed.port), 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Error: Invalid port number: ${parsed.port}`);
    Deno.exit(1);
  }

  const spa = Boolean(parsed.spa);
  const quiet = Boolean(parsed.quiet);

  const trailingSlash = String(parsed["trailing-slash"]) as TrailingSlashBehavior;
  if (
    trailingSlash !== TrailingSlashBehavior.Force &&
    trailingSlash !== TrailingSlashBehavior.Never &&
    trailingSlash !== TrailingSlashBehavior.Ignore
  ) {
    console.error(
      `Error: Invalid trailing-slash mode: ${trailingSlash}. Must be one of: force, never, ignore`,
    );
    Deno.exit(1);
  }

  // Parse cache-control-max-age
  let cacheControlMaxAge: number | undefined;
  if (parsed["cache-control-max-age"]) {
    cacheControlMaxAge = parseInt(String(parsed["cache-control-max-age"]), 10);
    if (isNaN(cacheControlMaxAge) || cacheControlMaxAge < 0) {
      console.error(`Error: Invalid cache-control-max-age: ${parsed["cache-control-max-age"]}`);
      Deno.exit(1);
    }
  }

  // Load configuration files - either from manifest or by scanning filesystem
  let redirectRules;
  let headerRules;
  let fs;

  const manifestPath = parsed.manifest ? String(parsed.manifest) : null;

  if (manifestPath) {
    const startTime = performance.now();

    const manifest = await readManifest(manifestPath);

    redirectRules = manifestRedirectsToRules(manifest.redirects);
    headerRules = manifestHeadersToRules(manifest.headers);
    fs = new ManifestFs(manifest, root);

    if (!quiet) {
      const fileCount = Object.keys(manifest.files).length;
      const duration = ((performance.now() - startTime) / 1000).toFixed(2);

      console.log(
        `Loaded manifest (${fileCount} files, ${redirectRules.length} redirects, ${headerRules.length} headers) in ${duration}s`,
      );
    }
  } else {
    if (!quiet) {
      console.log(`Loading configuration from ${root}...`);
    }
    redirectRules = await loadRedirects(root);
    headerRules = await loadHeaders(root);
    fs = new SystemFs();

    if (!quiet) {
      console.log(`  - Loaded ${redirectRules.length} redirect rules`);
      console.log(`  - Loaded ${headerRules.length} header rules`);
    }
  }

  // Create the request handler
  const handler = createHandler({ root, spa, redirectRules, headerRules, trailingSlash, fs, cacheControlMaxAge });

  // Start the server
  if (!quiet) {
    console.log(`\nStarting server...`);
    console.log(`  - Root directory: ${root}`);
    console.log(`  - Port: ${port}`);
    console.log(`  - SPA mode: ${spa ? "enabled" : "disabled"}`);
    console.log(`  - Trailing slash: ${trailingSlash}`);
    if (cacheControlMaxAge !== undefined) {
      console.log(`  - Cache-Control s-maxage: ${cacheControlMaxAge} seconds`);
    }
  }

  Deno.serve({ port }, handler);
}

// Run the main function if this is the main module
if (import.meta.main) {
  await main(Deno.args);
}
