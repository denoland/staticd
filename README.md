# staticd - A comprehensive static site server for Deno

staticd is a powerful and easy-to-use static site server built with Deno. It allows you to serve static files from a
local directory, with advanced features like caching, redirects, rewrite rules, and custom error pages.

- Serve static files from a specified directory
- Redirect and rewrite rules using `_redirects` file
- Headers configuration using `_headers` file
- SPA mode for single-page applications
- Custom error pages
- Automatic MIME type detection
- Automatic ETag and If-None-Match support

## Usage

```bash
deno run --allow-net --allow-read jsr:@deno/staticd@1 ./public
```

To enable SPA mode, add the `--spa` flag:

```bash
deno run --allow-net --allow-read jsr:@deno/staticd@1 --spa ./public
```

You can also specify a custom port using the `--port` flag (default is 8080):

```bash
deno run --allow-net --allow-read jsr:@deno/staticd@1 --port=3000 ./public
```

To install staticd as a global command, use:

```bash
deno install -grf --allow-net --allow-read staticd jsr:@deno/staticd@1
staticd ./public
```

## Manifest Generation (Performance Optimization)

For faster server startup, especially with large sites, you can pre-generate a manifest file that contains:

- Directory tree with all file paths
- File statistics (size, modification time)
- Pre-computed ETags for all files
- Parsed `_redirects` and `_headers` rules

### Generate a manifest

```bash
deno run --allow-read --allow-write jsr:@deno/staticd@1 manifest --output=dist.manifest.json ./dist
```

### Serve using a manifest

```bash
deno run --allow-net --allow-read jsr:@deno/staticd@1 --manifest=dist.manifest.json ./dist
```

When using a manifest, the server:

- Skips filesystem scanning on startup
- Uses pre-computed ETags (no stat calls per request)
- Loads redirect and header rules instantly
- Significantly reduces startup time for large sites

The manifest is a JSON file that should be generated as part of your build process.

## Configuration

### Options

`--spa`: Enable SPA mode. In this mode, all requests that do not match a static file will be served the closest matching
`index.html` file.

`--port=<number>`: Specify the port on which the server will listen (default is 8080).

`--trailing-slash=<force|never|ignore>`: Control how trailing slashes are handled in URLs.

- `force`: Always add a trailing slash to URLs.
- `never`: Remove all trailing slashes from URLs.
- `ignore`: Leave URLs as they are (default behavior).

`--manifest=<path>`: Load a pre-generated manifest file instead of scanning the filesystem. Use the `manifest` command
to generate one.

### `_redirects`

The `_redirects` file allows you to define redirect and rewrite rules. Each line should contain a source path and a
destination URL, separated by whitespace. For example:

```
/old-path /new-path 302
```

The default status code is 302, but you can specify a different one at the end of the line.

Wildcard matches are also supported:

```
/blog/* /new-blog/:splat 301
```

Parameters can be captured using `:param` syntax:

```
/user/:id /profile/:id 302
```

Query parameters are preserved during redirects, but you can capture them and use them in the destination URL too:

```
/product id=:id /item/:id 302
```

If you want to redirect all requests to a URL, even if a static file exists at the source path, you can suffix the
status code with `!`:

```
/contact /support 301!
```

In addition to redirects, you can also define rewrites (where the URL in the user's address bar does not change) by
setting the status code to `200` or `404`: This is what the SPA mode uses internally. The following example rewrites all
paths to `index.html` (so all requests that do not match a static file will serve the `index.html` file):

```
/* /index.html 200
```

Outside of SPA use-cases, this can be used to serve a 404 page for all unknown paths:

```
/* /404.html 404
```

You can add comments in the `_redirects` file by starting a line with `#`.

Each rule is processed in order, and the first matching rule is applied.

### `_headers`

The `_headers` file allows you to define custom HTTP headers for specific paths. Each line should contain a path
followed by one or more header definitions. For example:

```
/static/*
  X-Content-Type-Options: nosniff

/api/*
  Cache-Control: no-cache
```

You may specify the same header multiple times for a given path, in which case all values will be included in the
response.

```
/static/*
  X-Custom-Header: value1
  X-Custom-Header: value2
```

You can add comments in the `_headers` file by starting a line with `#`.

```
# Cache static assets aggressively
/static/*
  Cache-Control: public, max-age=31536000, immutable
  # Prevent MIME type sniffing
  X-Content-Type-Options: nosniff
```

**Note:** The following headers cannot be set via `_headers` as they are controlled by the server or could cause
security issues:

- `Accept-Ranges`
- `Age`
- `Allow`
- `Alt-Svc`
- `Connection`
- `Content-Encoding`
- `Content-Length`
- `Content-Range`
- `Date`
- `Location`
- `Trailer`
- `Transfer-Encoding`
- `Upgrade`

## License

staticd is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Acknowledgements

The syntax for the `_redirects` and `_headers` files is inspired by Netlify's syntax for similar configuration files.
