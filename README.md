# Fireclaude

A `/firecrawl` slash command for [Claude Code](https://claude.ai/code) that turns any URL into structured, LLM-ready data. No API keys needed — Claude Code is the LLM.

Built by reverse-engineering [Firecrawl](https://github.com/mendableai/firecrawl)'s scraping utilities and adapting them for local use with Playwright.

## Install

```bash
git clone https://github.com/justinalvarado/fireclaude.git
cd fireclaude
./install.sh
```

## Usage

In any Claude Code session:

```
/firecrawl https://example.com
/firecrawl https://example.com/products --params=schema.json
/firecrawl https://example.com/products --fields=title,price,description
/firecrawl https://example.com/products --prompt="Extract all product details"
/firecrawl https://example.com --mobile --block-media
/firecrawl https://news.ycombinator.com --output=hn.json
```

## Features

### Scraping (via Playwright)
- Stealth user-agent rotation (random realistic UA per request)
- Ad/tracker blocking (13 domains, on by default)
- Media blocking (images/video/audio)
- HTTP/HTTPS proxy support with auth
- Custom headers
- TLS certificate skip
- Mobile device emulation (iPhone 14 Pro)
- Smart wait strategies (time-based, selector-based, network idle)

### Content Processing (via Cheerio, adapted from Firecrawl)
- Smart HTML cleaning (removes headers, footers, navs, sidebars, ads, cookie banners, modals)
- 40+ metadata fields (Open Graph, Twitter Cards, Dublin Core, custom meta)
- Comprehensive image extraction (img, srcset, lazy-load, picture, OG, CSS backgrounds)
- Link extraction with base href resolution and deduplication
- Google Docs/Sheets/Drive URL rewriting
- YouTube metadata and transcript extraction
- HTML-to-Markdown conversion

### Extraction (via Claude Code)
- Claude Code itself handles structured data extraction — no external LLM API keys
- JSON Schema-based extraction
- Natural language prompt-based extraction
- Works with Claude Code Max plan

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--params=<file>` | — | JSON file with extraction schema/prompt |
| `--schema='<json>'` | — | Inline JSON Schema for extraction |
| `--prompt="<text>"` | — | Inline extraction instructions |
| `--fields=<a,b,c>` | — | Comma-separated field names to extract |
| `--output=<file>` | — | Write extracted JSON to file |
| `--browser` | off | Use Chrome automation instead of Playwright |
| `--crawl` | off | Follow links across pages |
| `--depth=N` | 2 | Max crawl depth |
| `--no-adblock` | — | Disable ad/tracker blocking |
| `--block-media` | off | Block images/video/audio |
| `--proxy=<url>` | — | HTTP/HTTPS proxy |
| `--proxy-auth=<u:p>` | — | Proxy credentials |
| `--header="K: V"` | — | Custom HTTP header (repeatable) |
| `--skip-tls` | off | Skip TLS certificate verification |
| `--mobile` | off | Mobile device emulation |
| `--wait=<ms>` | 3000 | Extra wait after page load |
| `--selector=<css>` | — | Wait for specific element |

## Extraction Parameters

Extraction parameters can be provided via a **file** or **inline flags**.

### Params file (`--params=<file>`)

```json
{
  "schema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "price": { "type": "number" },
      "description": { "type": "string" }
    }
  },
  "prompt": "Extract the main product details"
}
```

### Inline flags (no file needed)

```
# Simple field extraction
/firecrawl https://example.com --fields=title,price,description

# Natural language prompt
/firecrawl https://example.com --prompt="Extract all product details and prices"

# Full JSON Schema inline
/firecrawl https://example.com --schema='{"type":"object","properties":{"title":{"type":"string"},"price":{"type":"number"}}}'
```

Inline flags override values from a params file when both are provided.

## How It Works

1. **Playwright** fetches the page with stealth features (random UA, ad blocking, etc.)
2. **Cheerio** processes the raw HTML — cleans it, extracts metadata/links/images
3. **Claude Code** reads the structured output and extracts data according to your schema

No Firecrawl API server, no external LLM keys, no Docker. Just Playwright + Cheerio + Claude.

## Architecture

```
~/.claude/
├── commands/
│   └── firecrawl.md        # Slash command definition
└── scripts/
    ├── scrape.mjs           # Playwright stealth scraper
    ├── utils.mjs            # Cheerio utilities (from Firecrawl)
    ├── package.json         # playwright, cheerio, user-agents
    └── example-params.json  # Example extraction schema
```

## License

MIT
