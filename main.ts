#!/usr/bin/env -S deno run --allow-net --allow-read

import { parseArgs } from "@std/cli/parse-args";
import { join, resolve } from "@std/path";
import { createHandler, TrailingSlashBehavior } from "./src/handler.ts";
import { parseHeaders } from "./src/headers.ts";
import { parseRedirects } from "./src/redirects.ts";

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

OPTIONS:
    --port=<number>              Port to listen on (default: 8080)
    --spa                        Enable SPA mode
    --trailing-slash=<mode>      Handle trailing slashes: force, never, or ignore (default: ignore)
    --help                       Show this help message

EXAMPLES:
    # Serve the current directory
    deno run --allow-net --allow-read jsr:@deno/staticd@1 .

    # Serve with SPA mode on port 3000
    deno run --allow-net --allow-read jsr:@deno/staticd@1 --spa --port=3000 ./dist

    # Force trailing slashes
    deno run --allow-net --allow-read jsr:@deno/staticd@1 --trailing-slash=force ./public
`);
}

/**
 * Main function to start the server.
 */
export async function main(args: string[]) {
  const parsed = parseArgs(args, {
    boolean: ["spa", "help"],
    string: ["port", "trailing-slash"],
    default: {
      port: "8080",
      "trailing-slash": "ignore",
    },
    alias: {
      h: "help",
      p: "port",
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

  // Load configuration files
  console.log(`Loading configuration from ${root}...`);
  const redirectRules = await loadRedirects(root);
  const headerRules = await loadHeaders(root);

  console.log(`  - Loaded ${redirectRules.length} redirect rules`);
  console.log(`  - Loaded ${headerRules.length} header rules`);

  // Create the request handler
  const handler = createHandler({ root, spa, redirectRules, headerRules, trailingSlash });

  // Start the server
  console.log(`\nStarting server...`);
  console.log(`  - Root directory: ${root}`);
  console.log(`  - Port: ${port}`);
  console.log(`  - SPA mode: ${spa ? "enabled" : "disabled"}`);
  console.log(`  - Trailing slash: ${trailingSlash}`);
  console.log(`\nListening on http://localhost:${port}/`);

  Deno.serve({
    port,
    onListen: () => {
      // Already logged above
    },
  }, handler);
}

// Run the main function if this is the main module
if (import.meta.main) {
  await main(Deno.args);
}
