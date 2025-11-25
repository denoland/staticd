import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createHandler, TrailingSlashBehavior } from "./handler.ts";
import { parseHeaders } from "./headers.ts";
import { parseRedirects } from "./redirects.ts";

// Create a temporary test directory
const testDir = await Deno.makeTempDir();

// Create test files
await Deno.writeTextFile(
  join(testDir, "index.html"),
  "<html><body>Index</body></html>",
);
await Deno.writeTextFile(
  join(testDir, "about.html"),
  "<html><body>About</body></html>",
);
await Deno.mkdir(join(testDir, "static"));
await Deno.writeTextFile(
  join(testDir, "static", "style.css"),
  "body { color: red; }",
);

// Create _redirects file
const redirectsContent = `
/old-path /new-path 302
/user/:id /profile/:id 302
/* /index.html 200
`;
await Deno.writeTextFile(join(testDir, "_redirects"), redirectsContent);

// Create _headers file
const headersContent = `
/static/*
  Cache-Control: max-age=31536000
  X-Content-Type-Options: nosniff
`;
await Deno.writeTextFile(join(testDir, "_headers"), headersContent);

const redirectRules = parseRedirects(redirectsContent);
const headerRules = parseHeaders(headersContent);

Deno.test("handler - serves index.html", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/index.html");
  const response = await handler(request);

  assertEquals(response.status, 200);
  const contentType = response.headers.get("Content-Type");
  assertEquals(contentType?.toLowerCase(), "text/html; charset=utf-8");

  const body = await response.text();
  assertEquals(body.includes("Index"), true);
});

Deno.test("handler - serves static files", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/static/style.css");
  const response = await handler(request);

  assertEquals(response.status, 200);
  const contentType = response.headers.get("Content-Type");
  assertEquals(contentType?.toLowerCase(), "text/css; charset=utf-8");

  const body = await response.text();
  assertEquals(body.includes("color: red"), true);
});

Deno.test("handler - 404 for missing files", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/missing.html");
  const response = await handler(request);

  assertEquals(response.status, 404);
});

Deno.test("handler - handles redirects", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules,
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/old-path");
  const response = await handler(request);

  assertEquals(response.status, 302);
  assertEquals(response.headers.get("Location"), "http://localhost/new-path");
});

Deno.test("handler - handles parameter redirects", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules,
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/user/123");
  const response = await handler(request);

  assertEquals(response.status, 302);
  assertEquals(response.headers.get("Location"), "http://localhost/profile/123");
});

Deno.test("handler - handles rewrites", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules,
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/some-spa-route");
  const response = await handler(request);

  assertEquals(response.status, 200);
  const body = await response.text();
  assertEquals(body.includes("Index"), true);
});

Deno.test("handler - applies custom headers", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules,
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/static/style.css");
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Cache-Control"), "max-age=31536000");
  assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");

  // Consume the response body to avoid file leaks
  await response.text();
});

Deno.test("handler - SPA mode serves index.html for missing files", async () => {
  const handler = createHandler({
    root: testDir,
    spa: true,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/some-spa-route");
  const response = await handler(request);

  assertEquals(response.status, 200);
  const body = await response.text();
  assertEquals(body.includes("Index"), true);
});

Deno.test("handler - trailing slash force", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Force,
  });

  const request = new Request("http://localhost/about.html");
  const response = await handler(request);

  assertEquals(response.status, 301);
  assertEquals(response.headers.get("Location"), "http://localhost/about.html/");
});

Deno.test("handler - trailing slash never", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Never,
  });

  const request = new Request("http://localhost/static/");
  const response = await handler(request);

  assertEquals(response.status, 301);
  assertEquals(response.headers.get("Location"), "http://localhost/static");
});

Deno.test("handler - supports ETag", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/index.html");
  const response = await handler(request);

  assertEquals(response.status, 200);
  const etag = response.headers.get("ETag");
  assertEquals(etag !== null, true);

  // Consume the response body to avoid file leaks
  await response.text();

  // Make a request with If-None-Match
  const request2 = new Request("http://localhost/index.html", {
    headers: { "If-None-Match": etag! },
  });
  const response2 = await handler(request2);

  assertEquals(response2.status, 304);
});

Deno.test("handler - supports HEAD requests", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/index.html", { method: "HEAD" });
  const response = await handler(request);

  assertEquals(response.status, 200);
  const contentType = response.headers.get("Content-Type");
  assertEquals(contentType?.toLowerCase(), "text/html; charset=utf-8");
  assertEquals(response.body, null);
});

Deno.test("handler - adds s-maxage to Cache-Control", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
    cacheControlMaxAge: 31536000,
  });

  const request = new Request("http://localhost/index.html");
  const response = await handler(request);

  assertEquals(response.status, 200);
  const cacheControl = response.headers.get("Cache-Control");
  assertEquals(cacheControl, "s-maxage=31536000");

  await response.text();
});

Deno.test("handler - appends s-maxage to existing Cache-Control", async () => {
  const headerRules = parseHeaders("/static/*\n  Cache-Control: max-age=3600");

  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules,
    trailingSlash: TrailingSlashBehavior.Ignore,
    cacheControlMaxAge: 31536000,
  });

  const request = new Request("http://localhost/static/style.css");
  const response = await handler(request);

  assertEquals(response.status, 200);
  const cacheControl = response.headers.get("Cache-Control");
  assertEquals(cacheControl, "max-age=3600, s-maxage=31536000");

  await response.text();
});

// Cleanup
Deno.test("cleanup", async () => {
  await Deno.remove(testDir, { recursive: true });
});
