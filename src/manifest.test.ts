import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  generateManifest,
  ManifestFs,
  manifestHeadersToRules,
  manifestRedirectsToRules,
  readManifest,
  writeManifest,
} from "./manifest.ts";

// Create a temporary test directory
const testDir = await Deno.makeTempDir();

// Create test files
await Deno.writeTextFile(join(testDir, "index.html"), "<h1>Index</h1>");
await Deno.writeTextFile(join(testDir, "about.html"), "<h1>About</h1>");
await Deno.mkdir(join(testDir, "static"));
await Deno.writeTextFile(join(testDir, "static", "style.css"), "body { margin: 0; }");

// Create _redirects file
await Deno.writeTextFile(
  join(testDir, "_redirects"),
  "/old-path /new-path 302\n/user/:id /profile/:id 302",
);

// Create _headers file
await Deno.writeTextFile(
  join(testDir, "_headers"),
  "/static/*\n  Cache-Control: max-age=31536000\n  X-Content-Type-Options: nosniff",
);

Deno.test("generateManifest - creates manifest with all files", async () => {
  const manifest = await generateManifest(testDir);

  assertEquals(manifest.version, 1);
  assertEquals(typeof manifest.generatedAt, "string");

  // Check files
  const filePaths = Object.keys(manifest.files).sort();
  assertEquals(filePaths, ["/about.html", "/index.html", "/static/style.css"]);

  // Check directories
  assertEquals(manifest.directories, ["/static"]);

  // Check file info
  const indexFile = manifest.files["/index.html"];
  assertEquals(indexFile.path, "/index.html");
  assertEquals(indexFile.size > 0, true);
  assertEquals(typeof indexFile.etag, "string");
  assertEquals(indexFile.etag.startsWith('"'), true);
  assertEquals(typeof indexFile.mtime, "string");
});

Deno.test("generateManifest - parses _redirects file", async () => {
  const manifest = await generateManifest(testDir);

  assertEquals(manifest.redirects.length, 2);
  assertEquals(manifest.redirects[0], {
    from: "/old-path",
    to: "/new-path",
    status: 302,
    force: false,
    queryCaptures: [],
  });
  assertEquals(manifest.redirects[1], {
    from: "/user/:id",
    to: "/profile/:id",
    status: 302,
    force: false,
    queryCaptures: [],
  });
});

Deno.test("generateManifest - parses _headers file", async () => {
  const manifest = await generateManifest(testDir);

  assertEquals(manifest.headers.length, 1);
  assertEquals(manifest.headers[0], {
    pattern: "/static/*",
    headers: [
      ["Cache-Control", "max-age=31536000"],
      ["X-Content-Type-Options", "nosniff"],
    ],
  });
});

Deno.test("writeManifest and readManifest - round trip", async () => {
  const manifest = await generateManifest(testDir);
  const manifestPath = join(testDir, "test.manifest.json");

  await writeManifest(manifest, manifestPath);

  const loaded = await readManifest(manifestPath);

  assertEquals(loaded.version, manifest.version);
  assertEquals(Object.keys(loaded.files).length, Object.keys(manifest.files).length);
  assertEquals(loaded.redirects.length, manifest.redirects.length);
  assertEquals(loaded.headers.length, manifest.headers.length);

  await Deno.remove(manifestPath);
});

Deno.test("ManifestFs - get() returns file handle for existing file", async () => {
  const manifest = await generateManifest(testDir);
  const fs = new ManifestFs(manifest, testDir);

  const handle = await fs.get(join(testDir, "index.html"));

  assertEquals(handle !== null, true);
  assertEquals(handle?.kind, "file");
  if (handle && handle.kind === "file") {
    assertEquals(handle.name, "index.html");
    assertEquals(handle.stat.size > 0, true);
    assertEquals(handle.etag, manifest.files["/index.html"].etag);
  }
});

Deno.test("ManifestFs - get() returns null for non-existent file", async () => {
  const manifest = await generateManifest(testDir);
  const fs = new ManifestFs(manifest, testDir);

  const handle = await fs.get(join(testDir, "nonexistent.html"));

  assertEquals(handle, null);
});

Deno.test("ManifestFs - get() returns dir handle for directory", async () => {
  const manifest = await generateManifest(testDir);
  const fs = new ManifestFs(manifest, testDir);

  const handle = await fs.get(join(testDir, "static"));

  assertEquals(handle !== null, true);
  assertEquals(handle?.kind, "dir");
});

Deno.test("ManifestFs - can open and read file", async () => {
  const manifest = await generateManifest(testDir);
  const fs = new ManifestFs(manifest, testDir);

  const handle = await fs.get(join(testDir, "index.html"));

  assertEquals(handle !== null, true);
  if (handle && handle.kind === "file") {
    const stream = await handle.open();

    const content = await new Response(stream).text();

    assertEquals(content, "<h1>Index</h1>");
  }
});

Deno.test("manifestRedirectsToRules - converts to RedirectRule objects", async () => {
  const manifest = await generateManifest(testDir);
  const rules = manifestRedirectsToRules(manifest.redirects);

  assertEquals(rules.length, 2);
  assertEquals(rules[0].from instanceof URLPattern, true);
  assertEquals(rules[0].from.pathname, "/old-path");
  assertEquals(rules[0].to, "/new-path");
  assertEquals(rules[0].status, 302);
});

Deno.test("manifestHeadersToRules - converts to HeaderRule objects", async () => {
  const manifest = await generateManifest(testDir);
  const rules = manifestHeadersToRules(manifest.headers);

  assertEquals(rules.length, 1);
  assertEquals(rules[0].pattern.pathname, "/static/*");
  assertEquals(rules[0].headers.length, 2);
});

Deno.test("cleanup", async () => {
  await Deno.remove(testDir, { recursive: true });
});
