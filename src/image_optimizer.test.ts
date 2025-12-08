import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { createHandler, TrailingSlashBehavior } from "./handler.ts";
import { parseImageOptimizationOptions, isImage } from "./image_optimizer.ts";
import sharp from "sharp";

// Create a temporary test directory
const testDir = await Deno.makeTempDir();

// Create valid test images using sharp
const testPngData = await sharp({
  create: {
    width: 10,
    height: 10,
    channels: 3,
    background: { r: 255, g: 0, b: 0 },
  },
})
  .png()
  .toBuffer();

const testJpegData = await sharp({
  create: {
    width: 10,
    height: 10,
    channels: 3,
    background: { r: 0, g: 255, b: 0 },
  },
})
  .jpeg()
  .toBuffer();

await Deno.writeFile(join(testDir, "test.png"), testPngData);
await Deno.writeFile(join(testDir, "test.jpg"), testJpegData);

Deno.test("parseImageOptimizationOptions - parses width parameter", () => {
  const params = new URLSearchParams("w=100");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.width, 100);
});

Deno.test("parseImageOptimizationOptions - parses height parameter", () => {
  const params = new URLSearchParams("h=200");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.height, 200);
});

Deno.test("parseImageOptimizationOptions - parses format parameter", () => {
  const params = new URLSearchParams("f=webp");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.format, "webp");
});

Deno.test("parseImageOptimizationOptions - parses jpg as jpeg format", () => {
  const params = new URLSearchParams("f=jpg");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.format, "jpeg");
});

Deno.test("parseImageOptimizationOptions - parses quality parameter", () => {
  const params = new URLSearchParams("q=75");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.quality, 75);
});

Deno.test("parseImageOptimizationOptions - parses fit parameter", () => {
  const params = new URLSearchParams("fit=contain");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.fit, "contain");
});

Deno.test("parseImageOptimizationOptions - parses all parameters", () => {
  const params = new URLSearchParams("w=100&h=200&f=webp&q=85&fit=cover");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.width, 100);
  assertEquals(options.height, 200);
  assertEquals(options.format, "webp");
  assertEquals(options.quality, 85);
  assertEquals(options.fit, "cover");
});

Deno.test("parseImageOptimizationOptions - ignores invalid width", () => {
  const params = new URLSearchParams("w=invalid");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.width, undefined);
});

Deno.test("parseImageOptimizationOptions - ignores invalid height", () => {
  const params = new URLSearchParams("h=-100");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.height, undefined);
});

Deno.test("parseImageOptimizationOptions - ignores invalid format", () => {
  const params = new URLSearchParams("f=bmp");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.format, undefined);
});

Deno.test("parseImageOptimizationOptions - ignores invalid quality", () => {
  const params = new URLSearchParams("q=150");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.quality, undefined);
});

Deno.test("parseImageOptimizationOptions - ignores invalid fit", () => {
  const params = new URLSearchParams("fit=invalid");
  const options = parseImageOptimizationOptions(params);
  assertEquals(options.fit, undefined);
});

Deno.test("isImage - returns true for image MIME types", () => {
  assertEquals(isImage("image/jpeg"), true);
  assertEquals(isImage("image/png"), true);
  assertEquals(isImage("image/webp"), true);
  assertEquals(isImage("image/avif"), true);
});

Deno.test("isImage - returns false for non-image MIME types", () => {
  assertEquals(isImage("text/html"), false);
  assertEquals(isImage("application/json"), false);
  assertEquals(isImage("image/gif"), false); // Not supported for optimization
  assertEquals(isImage(""), false);
});

Deno.test("handler - serves image with optimization query params", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.png?o&w=50&h=50&f=webp&q=80");
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "image/webp");
  assertExists(response.headers.get("ETag"));
  assertExists(response.headers.get("Content-Length"));

  // Verify we got image data
  const body = await response.arrayBuffer();
  assertEquals(body.byteLength > 0, true);
});

Deno.test("handler - serves original image without optimization params", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.png");
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "image/png");

  // Verify we got the original image data
  const body = await response.arrayBuffer();
  assertEquals(body.byteLength, testPngData.byteLength);
});

Deno.test("handler - optimizes image to JPEG format", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.png?o&f=jpeg&q=90");
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "image/jpeg");

  await response.arrayBuffer();
});

Deno.test("handler - optimizes image to AVIF format", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.png?o&f=avif");
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "image/avif");

  await response.arrayBuffer();
});

Deno.test("handler - optimizes image with width only", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.png?o&w=100");
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertExists(response.headers.get("Content-Type"));

  await response.arrayBuffer();
});

Deno.test("handler - optimizes image with height only", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.png?o&h=100");
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertExists(response.headers.get("Content-Type"));

  await response.arrayBuffer();
});

Deno.test("handler - respects fit=contain parameter", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.png?o&w=50&h=50&fit=contain");
  const response = await handler(request);

  assertEquals(response.status, 200);

  await response.arrayBuffer();
});

Deno.test("handler - respects fit=cover parameter", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.png?o&w=50&h=50&fit=cover");
  const response = await handler(request);

  assertEquals(response.status, 200);

  await response.arrayBuffer();
});

Deno.test("handler - respects fit=fill parameter", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.png?o&w=50&h=50&fit=fill");
  const response = await handler(request);

  assertEquals(response.status, 200);

  await response.arrayBuffer();
});

Deno.test("handler - supports HEAD request with optimization", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.png?o&w=50&h=50&f=webp", {
    method: "HEAD",
  });
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "image/webp");
  assertEquals(response.body, null);
});

Deno.test("handler - does not optimize non-image files", async () => {
  // Create a text file
  await Deno.writeTextFile(join(testDir, "test.txt"), "Hello World");

  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.txt?o&w=100");
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type")?.toLowerCase(), "text/plain; charset=utf-8");

  const body = await response.text();
  assertEquals(body, "Hello World");
});

Deno.test("handler - defaults to webp when no format specified", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.png?o&w=50");
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "image/webp");

  await response.arrayBuffer();
});

Deno.test("handler - handles jpg extension with optimization", async () => {
  const handler = createHandler({
    root: testDir,
    spa: false,
    redirectRules: [],
    headerRules: [],
    trailingSlash: TrailingSlashBehavior.Ignore,
  });

  const request = new Request("http://localhost/test.jpg?o&w=50&f=webp");
  const response = await handler(request);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "image/webp");

  await response.arrayBuffer();
});

// Cleanup
Deno.test("cleanup", async () => {
  await Deno.remove(testDir, { recursive: true });
});
