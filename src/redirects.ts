/**
 * Represents a redirect or rewrite rule.
 */
export interface RedirectRule {
  /** The source path pattern (may contain :param or * wildcards) */
  from: URLPattern;
  /** The destination path (may contain :param or :splat replacements) */
  to: string;
  /** HTTP status code (200=rewrite, 301/302=redirect, 404=not found) */
  status: number;
  /** If true, apply redirect even if a static file exists at the source path */
  force: boolean;
  /** Query parameter captures (e.g., "id=:id" -> ["id", "id"]) */
  queryCaptures: Array<[string, string]>;
}

/**
 * Parse a _redirects file into an array of redirect rules.
 *
 * Format:
 * ```
 * /old-path /new-path 302
 * /blog/* /new-blog/:splat 301
 * /user/:id /profile/:id 302
 * /product id=:id /item/:id 302
 * /contact /support 301!
 * /* /index.html 200
 * ```
 *
 * @param content - The content of the _redirects file
 * @returns Array of parsed redirect rules
 */
export function parseRedirects(content: string): RedirectRule[] {
  const rules: RedirectRule[] = [];
  const lines = content.split("\n");

  outer: for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (!line || line.startsWith("#")) continue;

    // Parse the line: <from> [query_params] <to> <status>[!]
    const parts = line.split(/\s+/);

    if (parts.length < 3) {
      console.warn(`Invalid redirect rule at line ${i + 1}: ${line}`);
      continue;
    }

    const fromStr = parts[0];
    let from: URLPattern;
    try {
      from = new URLPattern({ pathname: fromStr });
      if (from.hasRegExpGroups) {
        console.warn(`'from' pattern with RegExp groups is not supported at line ${i + 1}: ${fromStr}`);
        continue;
      }
    } catch {
      console.warn(`Invalid 'from' pattern in redirect rule at line ${i + 1}: ${fromStr}`);
      continue;
    }

    const queryCaptures: Array<[string, string]> = [];

    // Check if there are query parameter captures
    // Format: /product id=:id /item/:id 302
    let currentIndex = 1;
    while (currentIndex < parts.length && parts[currentIndex].includes("=")) {
      const queryPart = parts[currentIndex];
      const [key, value] = queryPart.split("=");
      if (key && value) queryCaptures.push([key, value]);
      else {
        console.warn(`Invalid query parameter capture at line ${i + 1}: ${queryPart}`);
        continue outer;
      }
      currentIndex++;
    }

    if (currentIndex >= parts.length) {
      console.warn(`Invalid redirect rule at line ${i + 1} (missing <to>): ${line}`);
      continue;
    }

    const to = parts[currentIndex];
    currentIndex++;
    if (!to) {
      console.warn(`Invalid redirect rule at line ${i + 1} (empty <to>): ${line}`);
      continue;
    }

    if (currentIndex >= parts.length) {
      console.warn(`Invalid redirect rule at line ${i + 1} (missing <status>): ${line}`);
      continue;
    }

    const statusPart = parts[currentIndex];
    currentIndex++;
    if (!statusPart.match(/^\d{3}!?$/)) {
      console.warn(`Invalid redirect rule at line ${i + 1} (invalid <status>): ${line}`);
      continue;
    }

    if (currentIndex < parts.length) {
      console.warn(`Extra tokens in redirect rule at line ${i + 1}: ${line}`);
      continue;
    }

    const force = statusPart.endsWith("!");
    const status = force ? Number(statusPart.slice(0, -1)) : Number(statusPart);

    if (![200, 301, 302, 307, 404].includes(status)) {
      console.warn(`Unsupported status code in redirect rule at line ${i + 1}: ${line}`);
      continue;
    }

    rules.push({ from, to, status, force, queryCaptures });
  }

  return rules;
}

/**
 * Apply parameter substitutions to a destination path.
 *
 * @param to - The destination pattern (e.g., "/profile/:id")
 * @param params - The captured parameters from URLPattern, joined with query captures
 * @returns The final destination path with substitutions applied
 */
export function applySubstitutions(to: string, params: Record<string, string | undefined>): string {
  let result = to;
  let offset = 0;

  const replacements = /:[a-z]+/g;
  const matches = to.matchAll(replacements);
  for (const match of matches) {
    let placeholder = match[0].slice(1); // remove leading ':'
    if (placeholder === "splat") placeholder = "0"; // special case for splat
    const value = params[placeholder] ?? "";
    result = result.slice(0, match.index + offset) + value +
      result.slice(match.index + match[0].length + offset);
    offset += value.length - match[0].length;
  }

  return result;
}

/**
 * Match a request path against redirect rules and return the matching rule.
 *
 * @param pathname - The request pathname
 * @param searchParams - The request search parameters
 * @param rules - Array of redirect rules to match against
 * @param forceOnly - If true, only consider rules with force=true
 * @returns The matching rule and captured parameters, or null if no match
 */
export function matchRedirect(
  pathname: string,
  searchParams: URLSearchParams,
  rules: RedirectRule[],
  forceOnly: boolean = false,
): { rule: RedirectRule; destination: string; params: Record<string, string | undefined> } | null {
  outer: for (const rule of rules) {
    if (forceOnly && !rule.force) continue;
    const match = rule.from.exec({ pathname });

    if (match) {
      const params: Record<string, string | undefined> = { ...match.pathname.groups };

      for (const [queryKey, capturePattern] of rule.queryCaptures) {
        const queryValue = searchParams.get(queryKey);
        if (!queryValue) continue outer; // Required query param missing
        const paramName = capturePattern.slice(1);
        params[paramName] = queryValue;
      }

      const destination = applySubstitutions(rule.to, params);

      return { rule, destination, params };
    }
  }

  return null;
}
