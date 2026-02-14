---
name: firecrawl
description: Scrape a URL and extract structured data. Use when the user wants to crawl a website and extract information.
disable-model-invocation: true
allowed-tools: Bash, Read, Write, WebFetch, Glob, Grep
argument-hint: <url> [--params=params.json] [--browser] [--crawl] [--depth=N] [--output=file.json] [--block-media] [--mobile] [--proxy=url]
---

# Firecrawl — Scrape & Extract

You are a web scraping and data extraction agent. Your job is to scrape URLs and extract structured data using your own intelligence as the LLM — no external API keys needed.

## Parse Arguments

Parse `$ARGUMENTS` to extract:
- **url**: The target URL (required, first positional argument)
- **--params=<file>**: Path to a JSON file containing extraction schema and prompt (optional)
- **--browser**: Use browser automation via Chrome for JS-heavy/SPA pages (optional flag)
- **--crawl**: Follow links and scrape multiple pages from the site (optional flag)
- **--depth=N**: Max crawl depth when using --crawl (default: 2)
- **--output=<file>**: Write extracted JSON to this file (optional)
- **--no-adblock**: Disable ad/tracker blocking (enabled by default)
- **--block-media**: Block images/video/audio for faster scraping
- **--proxy=<url>**: Use HTTP/HTTPS proxy (e.g., `--proxy=http://host:port`)
- **--proxy-auth=<user:pass>**: Proxy authentication
- **--header="Key: Value"**: Custom HTTP headers (repeatable)
- **--skip-tls**: Skip TLS certificate verification
- **--mobile**: Emulate mobile device (iPhone viewport + mobile user agent)

If no URL is provided, ask the user for one.

## Step 1: Read Extraction Parameters

If `--params` is specified, read the JSON file. It should contain any combination of:
```json
{
  "schema": { "type": "object", "properties": { ... } },
  "prompt": "What to extract from the page",
  "fields": ["title", "price", "description"]
}
```

- `schema`: A JSON Schema defining the exact structure of extracted data
- `prompt`: Natural language instructions for what to extract
- `fields`: Simple list of field names to extract (shorthand for schema)

If no params file is given, ask the user what they want to extract, or provide a comprehensive summary of the page content.

## Step 2: Scrape the URL

Choose the scraping method based on flags and URL characteristics. Stealth features (ad/tracker blocking, fingerprint randomization) are enabled by default in Playwright-based methods.

### Method A: WebFetch (default)
Use the `WebFetch` tool to fetch the page. This works for most static/server-rendered sites. Stealth features do not apply.

### Method B: Browser Automation (--browser flag, or if WebFetch returns insufficient content)
Use `mcp__claude-in-chrome__` tools:
1. `tabs_create_mcp` to open a new tab with the URL
2. Wait for the page to load
3. `read_page` or `get_page_text` to get the full rendered content
4. Close the tab when done

### Method C: Playwright Script (fallback for complex scenarios)
Run the helper script if it exists. Pass any stealth flags directly:
```bash
node ~/.claude/scripts/scrape.mjs <url> [stealth flags]
```

### Crawl Mode (--crawl flag)
When crawling:
1. Scrape the starting URL first
2. Extract all links from the page
3. Filter links to same-domain, relevant paths
4. Scrape each linked page up to --depth levels deep
5. Collect all content, then extract data from the combined corpus

## Step 3: Extract Structured Data

Using the scraped content (markdown) and the extraction parameters:

1. If a **schema** is provided: Extract data matching the exact JSON Schema structure. Validate your output conforms to the schema.
2. If a **prompt** is provided: Follow the prompt instructions to extract the requested information.
3. If **fields** are provided: Extract each named field from the content.
4. If **no params**: Provide a structured summary with title, description, main content, links, and any notable data.

Output the extracted data as clean, formatted JSON.

## Step 4: Output Results

1. Display the extracted JSON to the user with a brief summary
2. If `--output` is specified, write the JSON to that file
3. Report any issues (missing data, pages that couldn't be loaded, etc.)

## Stealth Features

**On by default** (Playwright methods B and C):
- Ad/tracker blocking — disable with `--no-adblock`
- Browser fingerprint randomization

**Opt-in:**
- `--block-media` — Skip images/video/audio loads for speed
- `--proxy=<url>` / `--proxy-auth=<user:pass>` — Route through proxy
- `--header="Key: Value"` — Inject custom headers (can repeat)
- `--skip-tls` — Ignore certificate errors
- `--mobile` — Mobile device emulation (iPhone viewport + UA)

## Error Handling

- If a URL is unreachable, report the error and suggest alternatives (--browser flag, checking the URL)
- If WebFetch returns minimal content (< 100 chars of useful text), automatically retry with browser automation
- If extraction finds no matching data, report what was found and suggest adjusting the schema/prompt

## Example Usage

```
/firecrawl https://example.com/products --params=extract-products.json
/firecrawl https://news.ycombinator.com --params=hn-schema.json --output=hn-data.json
/firecrawl https://spa-app.com/dashboard --browser
/firecrawl https://docs.example.com --crawl --depth=3 --params=docs-schema.json
/firecrawl https://example.com --block-media --mobile
/firecrawl https://geo-locked.com --proxy=http://us-proxy:8080 --proxy-auth=user:pass
/firecrawl https://api.example.com --header="Authorization: Bearer tok" --skip-tls
```
