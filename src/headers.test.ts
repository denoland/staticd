import { assertEquals } from "@std/assert";
import { applyHeaders, type HeaderRule, matchHeaders, parseHeaders } from "./headers.ts";

// Helper function to assert header rules, extracting pathname from URLPattern
function assertHeaders(
  actual: HeaderRule[],
  expected: Array<{ pattern: string; headers: Array<[string, string]> }>,
) {
  assertEquals(
    actual.map((r) => ({ pattern: r.pattern.pathname, headers: r.headers })),
    expected,
  );
}

Deno.test("parseHeaders - single path with single header", () => {
  const content = `/static/*
  X-Content-Type-Options: nosniff`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/static/*",
      headers: [["X-Content-Type-Options", "nosniff"]],
    },
  ]);
});

Deno.test("parseHeaders - single path with multiple headers", () => {
  const content = `/static/*
  X-Content-Type-Options: nosniff
  Cache-Control: max-age=31536000`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/static/*",
      headers: [
        ["X-Content-Type-Options", "nosniff"],
        ["Cache-Control", "max-age=31536000"],
      ],
    },
  ]);
});

Deno.test("parseHeaders - multiple paths", () => {
  const content = `/static/*
  X-Content-Type-Options: nosniff

/api/*
  Cache-Control: no-cache`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/static/*",
      headers: [["X-Content-Type-Options", "nosniff"]],
    },
    {
      pattern: "/api/*",
      headers: [["Cache-Control", "no-cache"]],
    },
  ]);
});

Deno.test("parseHeaders - multiple values for same header", () => {
  const content = `/static/*
  X-Custom-Header: value1
  X-Custom-Header: value2`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/static/*",
      headers: [
        ["X-Custom-Header", "value1"],
        ["X-Custom-Header", "value2"],
      ],
    },
  ]);
});

Deno.test("parseHeaders - handles various whitespace", () => {
  const content = `/static/*
  X-Content-Type-Options:nosniff
    Cache-Control:  max-age=31536000  `;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/static/*",
      headers: [
        ["X-Content-Type-Options", "nosniff"],
        ["Cache-Control", "max-age=31536000"],
      ],
    },
  ]);
});

Deno.test("parseHeaders - empty lines between sections", () => {
  const content = `/static/*
  X-Content-Type-Options: nosniff


/api/*
  Cache-Control: no-cache`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/static/*",
      headers: [["X-Content-Type-Options", "nosniff"]],
    },
    {
      pattern: "/api/*",
      headers: [["Cache-Control", "no-cache"]],
    },
  ]);
});

Deno.test("parseHeaders - specific path patterns", () => {
  const content = `/index.html
  Cache-Control: no-cache

/static/css/*
  Cache-Control: max-age=31536000`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/index.html",
      headers: [["Cache-Control", "no-cache"]],
    },
    {
      pattern: "/static/css/*",
      headers: [["Cache-Control", "max-age=31536000"]],
    },
  ]);
});

Deno.test("parseHeaders - complex header values with colons", () => {
  const content = `/api/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.example.com`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/api/*",
      headers: [["Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.example.com"]],
    },
  ]);
});

Deno.test("parseHeaders - empty content", () => {
  const content = "";
  const rules = parseHeaders(content);
  assertEquals(rules, []);
});

Deno.test("parseHeaders - only whitespace", () => {
  const content = "   \n\n   \n";
  const rules = parseHeaders(content);
  assertEquals(rules, []);
});

Deno.test("parseHeaders - comments", () => {
  const content = `# This is a comment
/static/*
  # Comment in headers section
  Cache-Control: max-age=31536000
  # Another comment
  X-Content-Type-Options: nosniff

# Comment between sections
/api/*
  Cache-Control: no-cache`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/static/*",
      headers: [
        ["Cache-Control", "max-age=31536000"],
        ["X-Content-Type-Options", "nosniff"],
      ],
    },
    {
      pattern: "/api/*",
      headers: [["Cache-Control", "no-cache"]],
    },
  ]);
});

Deno.test("parseHeaders - disallowed headers are filtered out", () => {
  const content = `/static/*
  Cache-Control: max-age=31536000
  Alt-Svc: h2=":443"
  X-Custom-Header: allowed
  Content-Length: 1234
  Transfer-Encoding: chunked`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/static/*",
      headers: [
        ["Cache-Control", "max-age=31536000"],
        ["X-Custom-Header", "allowed"],
      ],
    },
  ]);
});

Deno.test("parseHeaders - disallowed headers case insensitive", () => {
  const content = `/api/*
  cache-control: no-cache
  ALT-SVC: h2=":443"
  X-Frame-Options: DENY`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/api/*",
      headers: [
        ["cache-control", "no-cache"],
        ["X-Frame-Options", "DENY"],
      ],
    },
  ]);
});

Deno.test("matchHeaders - simple wildcard match", () => {
  const rules: HeaderRule[] = [{
    pattern: new URLPattern({ pathname: "/static/*" }),
    headers: [["Cache-Control", "max-age=31536000"]],
  }];
  const matched = matchHeaders("/static/style.css", rules);
  assertEquals(matched, [["Cache-Control", "max-age=31536000"]]);
});

Deno.test("matchHeaders - exact path match", () => {
  const rules: HeaderRule[] = [{
    pattern: new URLPattern({ pathname: "/index.html" }),
    headers: [["Cache-Control", "no-cache"]],
  }];
  const matched = matchHeaders("/index.html", rules);
  assertEquals(matched, [["Cache-Control", "no-cache"]]);
});

Deno.test("matchHeaders - no match", () => {
  const rules: HeaderRule[] = [{
    pattern: new URLPattern({ pathname: "/static/*" }),
    headers: [["Cache-Control", "max-age=31536000"]],
  }];
  const matched = matchHeaders("/api/data", rules);
  assertEquals(matched, []);
});

Deno.test("matchHeaders - multiple matching rules", () => {
  const rules: HeaderRule[] = [
    { pattern: new URLPattern({ pathname: "/static/*" }), headers: [["Cache-Control", "max-age=31536000"]] },
    { pattern: new URLPattern({ pathname: "/static/css/*" }), headers: [["X-Content-Type-Options", "nosniff"]] },
  ];
  const matched = matchHeaders("/static/css/style.css", rules);
  assertEquals(matched, [
    ["Cache-Control", "max-age=31536000"],
    ["X-Content-Type-Options", "nosniff"],
  ]);
});

Deno.test("matchHeaders - multiple headers from one rule", () => {
  const rules: HeaderRule[] = [{
    pattern: new URLPattern({ pathname: "/api/*" }),
    headers: [["Cache-Control", "no-cache"], ["X-Content-Type-Options", "nosniff"]],
  }];
  const matched = matchHeaders("/api/users", rules);
  assertEquals(matched, [
    ["Cache-Control", "no-cache"],
    ["X-Content-Type-Options", "nosniff"],
  ]);
});

Deno.test("applyHeaders - adds headers to Headers object", () => {
  const headers = new Headers();
  const matchedHeaders: Array<[string, string]> = [
    ["Cache-Control", "max-age=31536000"],
    ["X-Content-Type-Options", "nosniff"],
  ];
  applyHeaders(headers, matchedHeaders);
  assertEquals(headers.get("Cache-Control"), "max-age=31536000");
  assertEquals(headers.get("X-Content-Type-Options"), "nosniff");
});

Deno.test("applyHeaders - appends duplicate headers", () => {
  const headers = new Headers();
  const matchedHeaders: Array<[string, string]> = [
    ["X-Custom-Header", "value1"],
    ["X-Custom-Header", "value2"],
  ];
  applyHeaders(headers, matchedHeaders);
  assertEquals(headers.get("X-Custom-Header"), "value1, value2");
});

Deno.test("applyHeaders - preserves existing headers", () => {
  const headers = new Headers({ "Content-Type": "text/html" });
  const matchedHeaders: Array<[string, string]> = [["Cache-Control", "no-cache"]];
  applyHeaders(headers, matchedHeaders);
  assertEquals(headers.get("Content-Type"), "text/html");
  assertEquals(headers.get("Cache-Control"), "no-cache");
});

Deno.test("parseHeaders - realistic example", () => {
  const content = `/
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff

/static/*
  Cache-Control: public, max-age=31536000, immutable

/api/*
  Cache-Control: no-store, no-cache, must-revalidate
  X-Content-Type-Options: nosniff

/*.html
  Cache-Control: no-cache`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/",
      headers: [
        ["X-Frame-Options", "DENY"],
        ["X-Content-Type-Options", "nosniff"],
      ],
    },
    {
      pattern: "/static/*",
      headers: [["Cache-Control", "public, max-age=31536000, immutable"]],
    },
    {
      pattern: "/api/*",
      headers: [
        ["Cache-Control", "no-store, no-cache, must-revalidate"],
        ["X-Content-Type-Options", "nosniff"],
      ],
    },
    {
      pattern: "/*.html",
      headers: [["Cache-Control", "no-cache"]],
    },
  ]);
});

Deno.test("parseHeaders - no whitespace between paths", () => {
  const content = `/
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
/static/*
  Cache-Control: public, max-age=31536000, immutable
/api/*
  Cache-Control: no-store, no-cache, must-revalidate
  X-Content-Type-Options: nosniff
/*.html
  Cache-Control: no-cache`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/",
      headers: [
        ["X-Frame-Options", "DENY"],
        ["X-Content-Type-Options", "nosniff"],
      ],
    },
    {
      pattern: "/static/*",
      headers: [["Cache-Control", "public, max-age=31536000, immutable"]],
    },
    {
      pattern: "/api/*",
      headers: [
        ["Cache-Control", "no-store, no-cache, must-revalidate"],
        ["X-Content-Type-Options", "nosniff"],
      ],
    },
    {
      pattern: "/*.html",
      headers: [["Cache-Control", "no-cache"]],
    },
  ]);
});

Deno.test("parseHeaders - disallows keep-alive header", () => {
  const content = `/api/*
  X-Custom-Header: allowed
  Keep-Alive: timeout=5
  Cache-Control: no-cache`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/api/*",
      headers: [
        ["X-Custom-Header", "allowed"],
        ["Cache-Control", "no-cache"],
      ],
    },
  ]);
});

Deno.test("parseHeaders - disallows proxy-connection header", () => {
  const content = `/static/*
  Cache-Control: max-age=31536000
  Proxy-Connection: keep-alive
  X-Content-Type-Options: nosniff`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/static/*",
      headers: [
        ["Cache-Control", "max-age=31536000"],
        ["X-Content-Type-Options", "nosniff"],
      ],
    },
  ]);
});

Deno.test("parseHeaders - disallows connection header", () => {
  const content = `/api/*
  Cache-Control: no-cache
  Connection: close
  X-Frame-Options: DENY`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/api/*",
      headers: [
        ["Cache-Control", "no-cache"],
        ["X-Frame-Options", "DENY"],
      ],
    },
  ]);
});

Deno.test("parseHeaders - disallows keep-alive and proxy-connection case insensitive", () => {
  const content = `/static/*
  KEEP-ALIVE: timeout=5
  keep-alive: timeout=10
  Proxy-Connection: keep-alive
  PROXY-CONNECTION: close
  Cache-Control: max-age=31536000`;
  const rules = parseHeaders(content);
  assertHeaders(rules, [
    {
      pattern: "/static/*",
      headers: [
        ["Cache-Control", "max-age=31536000"],
      ],
    },
  ]);
});
