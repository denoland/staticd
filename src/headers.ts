/**
 * Represents a header rule with a path pattern and associated headers.
 */
export interface HeaderRule {
  /** The path pattern (may contain wildcards). */
  pattern: string;
  /** Array of header key-value pairs. */
  headers: Array<[string, string]>;
}

/**
 * Headers that are disallowed in _headers files because they are controlled by the server or could
 * cause security issues.
 */
const DISALLOWED_HEADERS = new Set([
  "accept-ranges",
  "age",
  "allow",
  "alt-svc",
  "connection",
  "content-encoding",
  "content-length",
  "content-range",
  "date",
  "location",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Parse a _headers file into an array of header rules.
 *
 * Format:
 * ```
 * /static/*
 *   X-Content-Type-Options: nosniff
 *   Cache-Control: max-age=31536000
 *
 * /api/*
 *   Cache-Control: no-cache
 * ```
 *
 * @param content - The content of the _headers file
 * @returns Array of parsed header rules
 */
export function parseHeaders(content: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  const lines = content.split("\n");

  let currentRule: HeaderRule | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine.length === 0) continue;

    if (trimmedLine.startsWith("#")) continue; // Skip comment lines

    // Check if this is a path pattern (doesn't start with whitespace)
    if (!line.match(/^\s/)) {
      // Save the previous rule if it exists, and start a new rule
      if (currentRule && currentRule.headers.length > 0) rules.push(currentRule);
      currentRule = { pattern: trimmedLine, headers: [] };
    } else {
      // This is a header line (starts with whitespace)
      if (!currentRule) {
        console.warn(`Header without path pattern at line ${i + 1}: ${line}`);
        continue;
      }

      // Parse header: "Key: Value"
      const colonIndex = trimmedLine.indexOf(":");
      if (colonIndex === -1) {
        console.warn(`Invalid header format at line ${i + 1}: ${line}`);
        continue;
      }

      const key = trimmedLine.slice(0, colonIndex).trim();
      const value = trimmedLine.slice(colonIndex + 1).trim();

      // Skip disallowed headers
      if (key && DISALLOWED_HEADERS.has(key.toLowerCase())) {
        console.warn(`Disallowed header '${key}' at line ${i + 1} will be ignored`);
        continue;
      }

      if (key && value) currentRule.headers.push([key, value]);
      else if (!key) console.warn(`Empty header key at line ${i + 1}`);
      else if (!value) console.warn(`Empty header value for '${key}' at line ${i + 1}`);
    }
  }

  if (currentRule && currentRule.headers.length > 0) rules.push(currentRule);

  return rules;
}

/**
 * Convert a header pattern to a URLPattern string.
 * Converts * to :splat for URLPattern matching.
 *
 * @param pattern - The header pattern (e.g., "/static/*")
 * @returns URLPattern-compatible pathname pattern
 */
export function headerPatternToURLPattern(pattern: string): string {
  // Replace * with :splat* for URLPattern
  return pattern.replace(/\*/g, ":splat*");
}

/**
 * Match a request path against header rules and return all matching headers.
 * Multiple rules can match, and their headers are combined.
 *
 * @param pathname - The request pathname
 * @param rules - Array of header rules to match against
 * @returns Array of all matching headers
 */
export function matchHeaders(
  pathname: string,
  rules: HeaderRule[],
): Array<[string, string]> {
  const matchedHeaders: Array<[string, string]> = [];

  for (const rule of rules) {
    try {
      // Create URLPattern for the pattern
      const patternString = headerPatternToURLPattern(rule.pattern);
      const pattern = new URLPattern({ pathname: patternString });

      // Try to match
      const match = pattern.exec({ pathname });

      if (match) {
        // Add all headers from this rule
        matchedHeaders.push(...rule.headers);
      }
    } catch (error) {
      console.warn(`Error matching header pattern ${rule.pattern}:`, error);
    }
  }

  return matchedHeaders;
}

/**
 * Apply header rules to a Headers object.
 *
 * @param headers - The Headers object to modify
 * @param matchedHeaders - Array of header key-value pairs to apply
 */
export function applyHeaders(
  headers: Headers,
  matchedHeaders: Array<[string, string]>,
): void {
  for (const [key, value] of matchedHeaders) {
    // Use append to allow multiple values for the same header (e.g., Set-Cookie)
    headers.append(key, value);
  }
}
