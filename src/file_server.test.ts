import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { serveFile } from "./file_server.ts";
import type { FileHandle } from "./sys.ts";

// Create a temporary test directory
const testDir = await Deno.makeTempDir();

// Create test file with known content
const testContent = "0123456789abcdefghijklmnopqrstuvwxyz"; // 36 bytes
const testFilePath = join(testDir, "test.txt");
await Deno.writeTextFile(testFilePath, testContent);

// Helper to create a FileHandle
async function createFileHandle(path: string): Promise<FileHandle> {
  const stat = await Deno.stat(path);
  return {
    kind: "file",
    name: path,
    stat,
    etag: undefined,
    open: async (start?: number) => {
      const file = await Deno.open(path);
      if (start) {
        await file.seek(start, Deno.SeekMode.Start);
      }
      return file.readable;
    },
  };
}

Deno.test("serveFile - basic GET request", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt");
  const response = await serveFile(request, handle);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type")?.toLowerCase(), "text/plain; charset=utf-8");
  assertEquals(response.headers.get("Content-Length"), "36");
  assertEquals(response.headers.get("Accept-Ranges"), "bytes");

  const body = await response.text();
  assertEquals(body, testContent);
});

Deno.test("serveFile - HEAD request", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", { method: "HEAD" });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type")?.toLowerCase(), "text/plain; charset=utf-8");
  assertEquals(response.headers.get("Content-Length"), "36");
  assertEquals(response.body, null);
});

Deno.test("serveFile - range request bytes=0-9", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "bytes=0-9" },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 206);
  assertEquals(response.headers.get("Content-Range"), "bytes 0-9/36");
  assertEquals(response.headers.get("Content-Length"), "10");

  const body = await response.text();
  assertEquals(body, "0123456789");
});

Deno.test("serveFile - range request bytes=10-19", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "bytes=10-19" },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 206);
  assertEquals(response.headers.get("Content-Range"), "bytes 10-19/36");
  assertEquals(response.headers.get("Content-Length"), "10");

  const body = await response.text();
  assertEquals(body, "abcdefghij");
});

Deno.test("serveFile - range request bytes=10- (open-ended)", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "bytes=10-" },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 206);
  assertEquals(response.headers.get("Content-Range"), "bytes 10-35/36");
  assertEquals(response.headers.get("Content-Length"), "26");

  const body = await response.text();
  assertEquals(body, "abcdefghijklmnopqrstuvwxyz");
});

Deno.test("serveFile - suffix range bytes=-10 (last 10 bytes)", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "bytes=-10" },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 206);
  assertEquals(response.headers.get("Content-Range"), "bytes 26-35/36");
  assertEquals(response.headers.get("Content-Length"), "10");

  const body = await response.text();
  assertEquals(body, "qrstuvwxyz");
});

Deno.test("serveFile - suffix range bytes=-5 (last 5 bytes)", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "bytes=-5" },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 206);
  assertEquals(response.headers.get("Content-Range"), "bytes 31-35/36");
  assertEquals(response.headers.get("Content-Length"), "5");

  const body = await response.text();
  assertEquals(body, "vwxyz");
});

Deno.test("serveFile - suffix range bytes=-100 (larger than file)", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "bytes=-100" },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 206);
  assertEquals(response.headers.get("Content-Range"), "bytes 0-35/36");
  assertEquals(response.headers.get("Content-Length"), "36");

  const body = await response.text();
  assertEquals(body, testContent);
});

Deno.test("serveFile - suffix range HEAD request", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    method: "HEAD",
    headers: { "Range": "bytes=-10" },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 206);
  assertEquals(response.headers.get("Content-Range"), "bytes 26-35/36");
  assertEquals(response.headers.get("Content-Length"), "10");
  assertEquals(response.body, null);
});

Deno.test("serveFile - invalid range (no start or end)", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "bytes=-" },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 416);
  assertEquals(response.headers.get("Content-Range"), "bytes */36");
});

Deno.test("serveFile - invalid range (start > end)", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "bytes=20-10" },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 416);
  assertEquals(response.headers.get("Content-Range"), "bytes */36");
});

Deno.test("serveFile - invalid range (out of bounds)", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "bytes=0-100" },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 416);
  assertEquals(response.headers.get("Content-Range"), "bytes */36");
});

Deno.test("serveFile - non-bytes range unit is ignored", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "items=0-9" },
  });
  const response = await serveFile(request, handle);

  // Should serve full file, not a range
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Length"), "36");

  const body = await response.text();
  assertEquals(body, testContent);
});

Deno.test("serveFile - malformed range is ignored", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "invalid" },
  });
  const response = await serveFile(request, handle);

  // Should serve full file, not a range
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Length"), "36");

  const body = await response.text();
  assertEquals(body, testContent);
});

Deno.test("serveFile - range with whitespace is trimmed", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "Range": "  bytes=0-9  " },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 206);
  assertEquals(response.headers.get("Content-Range"), "bytes 0-9/36");
  assertEquals(response.headers.get("Content-Length"), "10");

  const body = await response.text();
  assertEquals(body, "0123456789");
});

Deno.test("serveFile - ETag support", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt");
  const response = await serveFile(request, handle);

  assertEquals(response.status, 200);
  const etag = response.headers.get("ETag");
  assertEquals(etag !== null, true);

  await response.text();
});

Deno.test("serveFile - If-None-Match with matching ETag", async () => {
  const handle = await createFileHandle(testFilePath);

  // First request to get ETag
  const request1 = new Request("http://localhost/test.txt");
  const response1 = await serveFile(request1, handle);
  const etag = response1.headers.get("ETag");
  await response1.text();

  // Second request with If-None-Match
  const handle2 = await createFileHandle(testFilePath);
  const request2 = new Request("http://localhost/test.txt", {
    headers: { "If-None-Match": etag! },
  });
  const response2 = await serveFile(request2, handle2);

  assertEquals(response2.status, 304);
  assertEquals(response2.body, null);
});

Deno.test("serveFile - If-None-Match with non-matching ETag", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", {
    headers: { "If-None-Match": '"different-etag"' },
  });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 200);
  const body = await response.text();
  assertEquals(body, testContent);
});

Deno.test("serveFile - Last-Modified header", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt");
  const response = await serveFile(request, handle);

  assertEquals(response.status, 200);
  const lastModified = response.headers.get("Last-Modified");
  assertEquals(lastModified !== null, true);

  await response.text();
});

Deno.test("serveFile - unsupported method returns 405", async () => {
  const handle = await createFileHandle(testFilePath);
  const request = new Request("http://localhost/test.txt", { method: "POST" });
  const response = await serveFile(request, handle);

  assertEquals(response.status, 405);
  assertEquals(response.headers.get("Allow"), "GET, HEAD");
});

// Cleanup
Deno.test("cleanup", async () => {
  await Deno.remove(testDir, { recursive: true });
});
