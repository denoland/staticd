import { assertEquals } from "@std/assert";
import {
  applySubstitutions,
  matchRedirect,
  parseRedirects,
  type RedirectRule,
} from "./redirects.ts";

// Helper function to assert redirect rules, extracting pathname from URLPattern
function assertRedirects(
  actual: RedirectRule[],
  expected: Array<{ from: string; to: string; status: number; force: boolean; queryCaptures: Array<[string, string]> }>,
) {
  assertEquals(
    actual.map((r) => ({ from: r.from.pathname, to: r.to, status: r.status, force: r.force, queryCaptures: r.queryCaptures })),
    expected,
  );
}

Deno.test("parseRedirects - simple redirect", () => {
  const content = "/old-path /new-path 302";
  const rules = parseRedirects(content);
  assertRedirects(rules, [
    {
      from: "/old-path",
      to: "/new-path",
      status: 302,
      force: false,
      queryCaptures: [],
    },
  ]);
});

Deno.test("parseRedirects - redirect with default status", () => {
  const content = "/old-path /new-path";
  const rules = parseRedirects(content);
  assertRedirects(rules, []);
});

Deno.test("parseRedirects - redirect with custom status", () => {
  const content = "/old-path /new-path 301";
  const rules = parseRedirects(content);
  assertRedirects(rules, [
    {
      from: "/old-path",
      to: "/new-path",
      status: 301,
      force: false,
      queryCaptures: [],
    },
  ]);
});

Deno.test("parseRedirects - forced redirect", () => {
  const content = "/contact /support 301!";
  const rules = parseRedirects(content);
  assertRedirects(rules, [
    {
      from: "/contact",
      to: "/support",
      status: 301,
      force: true,
      queryCaptures: [],
    },
  ]);
});

Deno.test("parseRedirects - wildcard pattern", () => {
  const content = "/blog/* /new-blog/:splat 301";
  const rules = parseRedirects(content);
  assertRedirects(rules, [
    {
      from: "/blog/*",
      to: "/new-blog/:splat",
      status: 301,
      force: false,
      queryCaptures: [],
    },
  ]);
});

Deno.test("parseRedirects - parameter capture", () => {
  const content = "/user/:id /profile/:id 302";
  const rules = parseRedirects(content);
  assertRedirects(rules, [
    {
      from: "/user/:id",
      to: "/profile/:id",
      status: 302,
      force: false,
      queryCaptures: [],
    },
  ]);
});

Deno.test("parseRedirects - query parameter capture", () => {
  const content = "/product id=:id /item/:id 302";
  const rules = parseRedirects(content);
  assertRedirects(rules, [
    {
      from: "/product",
      to: "/item/:id",
      status: 302,
      force: false,
      queryCaptures: [["id", ":id"]],
    },
  ]);
});

Deno.test("parseRedirects - multiple query parameters", () => {
  const content = "/search q=:query page=:page /results/:query/:page 302";
  const rules = parseRedirects(content);
  assertRedirects(rules, [
    {
      from: "/search",
      to: "/results/:query/:page",
      status: 302,
      force: false,
      queryCaptures: [["q", ":query"], ["page", ":page"]],
    },
  ]);
});

Deno.test("parseRedirects - rewrite with status 200", () => {
  const content = "/* /index.html 200";
  const rules = parseRedirects(content);
  assertRedirects(rules, [
    {
      from: "/*",
      to: "/index.html",
      status: 200,
      force: false,
      queryCaptures: [],
    },
  ]);
});

Deno.test("parseRedirects - 404 page", () => {
  const content = "/* /404.html 404";
  const rules = parseRedirects(content);
  assertRedirects(rules, [
    {
      from: "/*",
      to: "/404.html",
      status: 404,
      force: false,
      queryCaptures: [],
    },
  ]);
});

Deno.test("parseRedirects - comments and empty lines", () => {
  const content = `
# This is a comment
/old-path /new-path 302

# Another comment
/another-path /destination 301
  `;
  const rules = parseRedirects(content);
  assertRedirects(rules, [
    {
      from: "/old-path",
      to: "/new-path",
      status: 302,
      force: false,
      queryCaptures: [],
    },
    {
      from: "/another-path",
      to: "/destination",
      status: 301,
      force: false,
      queryCaptures: [],
    },
  ]);
});

Deno.test("parseRedirects - multiple rules", () => {
  const content = `
/old-path /new-path 302
/blog/* /new-blog/:splat 301
/user/:id /profile/:id 302
/* /index.html 200
  `;
  const rules = parseRedirects(content);
  assertRedirects(rules, [
    {
      from: "/old-path",
      to: "/new-path",
      status: 302,
      force: false,
      queryCaptures: [],
    },
    {
      from: "/blog/*",
      to: "/new-blog/:splat",
      status: 301,
      force: false,
      queryCaptures: [],
    },
    {
      from: "/user/:id",
      to: "/profile/:id",
      status: 302,
      force: false,
      queryCaptures: [],
    },
    {
      from: "/*",
      to: "/index.html",
      status: 200,
      force: false,
      queryCaptures: [],
    },
  ]);
});

Deno.test("applySubstitutions - path parameters", () => {
  const to = "/profile/:id";
  const params = { id: "123" };
  const result = applySubstitutions(to, params);
  assertEquals(result, "/profile/123");
});

Deno.test("applySubstitutions - splat parameter", () => {
  const to = "/new-blog/:splat";
  const params = { "0": "posts/hello-world" };
  const result = applySubstitutions(to, params);
  assertEquals(result, "/new-blog/posts/hello-world");
});

Deno.test("applySubstitutions - query parameter capture", () => {
  const to = "/item/:id";
  const params = { id: "123" };
  const result = applySubstitutions(to, params);
  assertEquals(result, "/item/123");
});

Deno.test("applySubstitutions - multiple parameters", () => {
  const to = "/results/:query/:page";
  const params = { query: "deno", page: "2" };
  const result = applySubstitutions(to, params);
  assertEquals(result, "/results/deno/2");
});

Deno.test("matchRedirect - simple path", () => {
  const rules: RedirectRule[] = [{
    from: new URLPattern({ pathname: "/old-path" }),
    to: "/new-path",
    status: 302,
    force: false,
    queryCaptures: [],
  }];
  const match = matchRedirect("/old-path", new URLSearchParams(), rules);
  assertEquals(match, {
    rule: rules[0],
    destination: "/new-path",
    params: {},
  });
});

Deno.test("matchRedirect - path with parameter", () => {
  const rules: RedirectRule[] = [{
    from: new URLPattern({ pathname: "/user/:id" }),
    to: "/profile/:id",
    status: 302,
    force: false,
    queryCaptures: [],
  }];
  const match = matchRedirect("/user/123", new URLSearchParams(), rules);
  assertEquals(match, {
    rule: rules[0],
    destination: "/profile/123",
    params: { id: "123" },
  });
});

Deno.test("matchRedirect - wildcard pattern", () => {
  const rules: RedirectRule[] = [{
    from: new URLPattern({ pathname: "/blog/*" }),
    to: "/new-blog/:splat",
    status: 301,
    force: false,
    queryCaptures: [],
  }];
  const match = matchRedirect("/blog/posts/hello-world", new URLSearchParams(), rules);
  assertEquals(match, {
    rule: rules[0],
    destination: "/new-blog/posts/hello-world",
    params: { "0": "posts/hello-world" },
  });
});

Deno.test("matchRedirect - query parameter capture", () => {
  const rules: RedirectRule[] = [{
    from: new URLPattern({ pathname: "/product" }),
    to: "/item/:id",
    status: 302,
    force: false,
    queryCaptures: [["id", ":id"]],
  }];
  const match = matchRedirect("/product", new URLSearchParams("id=123"), rules);
  assertEquals(match, {
    rule: rules[0],
    destination: "/item/123",
    params: { id: "123" },
  });
});

Deno.test("matchRedirect - no match", () => {
  const rules: RedirectRule[] = [{
    from: new URLPattern({ pathname: "/old-path" }),
    to: "/new-path",
    status: 302,
    force: false,
    queryCaptures: [],
  }];
  const match = matchRedirect("/other-path", new URLSearchParams(), rules);
  assertEquals(match, null);
});

Deno.test("matchRedirect - first matching rule wins", () => {
  const rules: RedirectRule[] = [
    {
      from: new URLPattern({ pathname: "/user/:id" }),
      to: "/profile/:id",
      status: 302,
      force: false,
      queryCaptures: [],
    },
    {
      from: new URLPattern({ pathname: "/user/*" }),
      to: "/users/:splat",
      status: 301,
      force: false,
      queryCaptures: [],
    },
  ];
  const match = matchRedirect("/user/123", new URLSearchParams(), rules);
  assertEquals(match, {
    rule: rules[0],
    destination: "/profile/123",
    params: { id: "123" },
  });
});

Deno.test("matchRedirect - catch-all pattern", () => {
  const rules: RedirectRule[] = [{
    from: new URLPattern({ pathname: "/*" }),
    to: "/index.html",
    status: 200,
    force: false,
    queryCaptures: [],
  }];
  const match = matchRedirect("/any/path/here", new URLSearchParams(), rules);
  assertEquals(match, {
    rule: rules[0],
    destination: "/index.html",
    params: { "0": "any/path/here" },
  });
});
