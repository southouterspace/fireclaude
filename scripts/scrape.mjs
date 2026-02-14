#!/usr/bin/env node

/**
 * Lightweight standalone scraper for Claude Code's /firecrawl command.
 * Uses Playwright for JS-rendered pages with a full stealth suite.
 * Processes HTML with Cheerio utilities for rich metadata extraction.
 * Outputs structured JSON to stdout — Claude Code handles the LLM extraction.
 *
 * Usage:
 *   node scrape.mjs <url> [options]
 *
 * Options:
 *   --wait=<ms>           Extra wait time after page load (default: 3000)
 *   --selector=<css>      Wait for a specific CSS selector
 *   --full-page           Capture the full page
 *   --no-adblock          Disable ad/tracker blocking (enabled by default)
 *   --block-media         Block image/video/audio requests
 *   --proxy=<url>         HTTP/HTTPS proxy (e.g. http://host:port)
 *   --proxy-auth=<u:p>    Proxy credentials (user:pass)
 *   --header="K: V"       Custom HTTP header (repeatable)
 *   --skip-tls            Skip TLS certificate verification
 *   --mobile              Emulate mobile device (iPhone 14 Pro)
 */

import { chromium } from "playwright";
import UserAgent from "user-agents";
import { load } from "cheerio";
import {
  rewriteUrl,
  cleanHtml,
  extractMetadata,
  extractLinks,
  extractImages,
  extractYouTubeData,
} from "./utils.mjs";

// --- Flag parsing -----------------------------------------------------------

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));

// Collect repeatable flags (--header) separately, then build single-value map
const headers = {};
const singleArgs = [];

for (const a of args) {
  if (a.startsWith("--header=")) {
    const val = a.slice("--header=".length);
    const colon = val.indexOf(":");
    if (colon !== -1) {
      headers[val.slice(0, colon).trim()] = val.slice(colon + 1).trim();
    }
  } else {
    singleArgs.push(a);
  }
}

const flags = Object.fromEntries(
  singleArgs
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? "true"];
    })
);

if (!url) {
  console.error(
    'Usage: node scrape.mjs <url> [--wait=<ms>] [--selector=<css>] [--full-page] [--no-adblock] [--block-media] [--proxy=<url>] [--proxy-auth=<u:p>] [--header="K: V"] [--skip-tls] [--mobile]'
  );
  process.exit(1);
}

const waitMs = parseInt(flags.wait || "3000", 10);
const selector = flags.selector || null;
const adblockEnabled = !flags["no-adblock"];
const blockMedia = !!flags["block-media"];
const proxyServer = flags.proxy || null;
const proxyAuth = flags["proxy-auth"] || null;
const skipTls = !!flags["skip-tls"];
const mobileMode = !!flags["mobile"];

// --- Ad-serving domain blocklist (from Firecrawl playwright-service-ts) -----

const AD_SERVING_DOMAINS = [
  "doubleclick.net",
  "adservice.google.com",
  "googlesyndication.com",
  "googletagservices.com",
  "googletagmanager.com",
  "google-analytics.com",
  "adsystem.com",
  "adservice.com",
  "adnxs.com",
  "ads-twitter.com",
  "facebook.net",
  "fbcdn.net",
  "amazon-adsystem.com",
];

// --- Media file extensions to block -----------------------------------------

const BLOCKED_MEDIA_EXTENSIONS = [
  "png", "jpg", "jpeg", "gif", "svg",
  "mp3", "mp4", "avi", "flac", "ogg", "wav", "webm",
];

// --- Cheerio-based HTML to Markdown converter --------------------------------

function htmlToMarkdown(cleanedHtml) {
  const $ = load(cleanedHtml);

  function nodeToMd(el) {
    if (el.type === "text") {
      return (el.data || "").replace(/\s+/g, " ");
    }
    if (el.type !== "tag") return "";

    const tag = el.name;
    const children = (el.children || []).map(nodeToMd).join("");

    switch (tag) {
      case "script":
      case "style":
      case "noscript":
      case "svg":
      case "iframe":
        return "";
      case "h1":
        return `\n# ${children.trim()}\n`;
      case "h2":
        return `\n## ${children.trim()}\n`;
      case "h3":
        return `\n### ${children.trim()}\n`;
      case "h4":
        return `\n#### ${children.trim()}\n`;
      case "h5":
        return `\n##### ${children.trim()}\n`;
      case "h6":
        return `\n###### ${children.trim()}\n`;
      case "p":
        return `\n${children.trim()}\n`;
      case "br":
        return "\n";
      case "hr":
        return "\n---\n";
      case "strong":
      case "b":
        return children.trim() ? `**${children.trim()}**` : "";
      case "em":
      case "i":
        return children.trim() ? `*${children.trim()}*` : "";
      case "code":
        return children.trim() ? `\`${children.trim()}\`` : "";
      case "pre": {
        const text = $(el).text().trim();
        return text ? `\n\`\`\`\n${text}\n\`\`\`\n` : "";
      }
      case "a": {
        const href = el.attribs?.href;
        const text = children.trim();
        if (!text) return "";
        if (href && href !== "#" && !href.startsWith("javascript:")) {
          return `[${text}](${href})`;
        }
        return text;
      }
      case "img": {
        const alt = el.attribs?.alt || "";
        const src = el.attribs?.src || "";
        return alt ? `![${alt}](${src})` : "";
      }
      case "ul": {
        const items = $(el)
          .children("li")
          .map((_, li) => `- ${nodeToMd(li).trim()}`)
          .get();
        return "\n" + items.join("\n") + "\n";
      }
      case "ol": {
        const items = $(el)
          .children("li")
          .map((i, li) => `${i + 1}. ${nodeToMd(li).trim()}`)
          .get();
        return "\n" + items.join("\n") + "\n";
      }
      case "table": {
        const rows = $(el).find("tr");
        if (rows.length === 0) return "";
        const tableData = rows
          .map((_, row) =>
            $(row)
              .find("th, td")
              .map((_, cell) => $(cell).text().trim())
              .get()
          )
          .get();
        // tableData is flat — reshape into 2D
        const firstRowCols = $(rows.first()).find("th, td").length;
        if (firstRowCols === 0) return "";
        const rows2d = [];
        for (let i = 0; i < tableData.length; i += firstRowCols) {
          rows2d.push(tableData.slice(i, i + firstRowCols));
        }
        if (rows2d.length === 0) return "";
        const header = `| ${rows2d[0].join(" | ")} |`;
        const sep = `| ${rows2d[0].map(() => "---").join(" | ")} |`;
        const body = rows2d
          .slice(1)
          .map((row) => `| ${row.join(" | ")} |`)
          .join("\n");
        return `\n${header}\n${sep}\n${body}\n`;
      }
      case "blockquote":
        return children.trim() ? `\n> ${children.trim()}\n` : "";
      default:
        return children;
    }
  }

  // Find main content area, falling back to body
  const main =
    $("main").first().get(0) ||
    $("article").first().get(0) ||
    $('[role="main"]').first().get(0) ||
    $("#content").first().get(0) ||
    $(".content").first().get(0) ||
    $("body").first().get(0);

  if (!main) return "";

  const md = nodeToMd(main);
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

// --- Extract links with text (richer than utils.extractLinks) ---------------

function extractLinksWithText(html, baseUrl) {
  const $ = load(html);
  const seen = new Set();
  const links = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (!href || href.startsWith("javascript:") || href === "#") return;

    let resolved;
    try {
      resolved = new URL(href, baseUrl).href;
    } catch {
      return;
    }

    if (!seen.has(resolved)) {
      seen.add(resolved);
      links.push({ text: text || resolved, href: resolved });
    }
  });

  return links;
}

// --- Main scraper -----------------------------------------------------------

async function scrapeWithPlaywright(targetUrl) {
  // Rewrite special URLs (Google Docs, etc.)
  const rewrittenUrl = rewriteUrl(targetUrl);

  // Generate a random realistic user agent
  const ua = mobileMode
    ? new UserAgent({ deviceCategory: "mobile" })
    : new UserAgent({ deviceCategory: "desktop" });

  const viewport = mobileMode
    ? { width: 390, height: 844 }
    : { width: 1280, height: 800 };

  // Browser launch options
  const launchOptions = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
    ],
  };

  if (proxyServer) {
    launchOptions.args.push(`--proxy-server=${proxyServer}`);
  }

  const browser = await chromium.launch(launchOptions);

  // Context options
  const contextOptions = {
    userAgent: ua.toString(),
    viewport,
    ignoreHTTPSErrors: skipTls,
    isMobile: mobileMode,
    hasTouch: mobileMode,
  };

  if (proxyServer) {
    const proxy = { server: proxyServer };
    if (proxyAuth) {
      const [username, password] = proxyAuth.split(":");
      proxy.username = username;
      proxy.password = password;
    }
    contextOptions.proxy = proxy;
  }

  const context = await browser.newContext(contextOptions);

  // Set up route interception for ad blocking
  if (adblockEnabled) {
    await context.route("**/*", (route, request) => {
      const hostname = new URL(request.url()).hostname;
      if (AD_SERVING_DOMAINS.some((domain) => hostname.includes(domain))) {
        return route.abort();
      }
      return route.continue();
    });
  }

  // Set up route interception for media blocking
  if (blockMedia) {
    const pattern = `**/*.{${BLOCKED_MEDIA_EXTENSIONS.join(",")}}`;
    await context.route(pattern, (route) => route.abort());
  }

  const page = await context.newPage();

  // Set custom headers if provided
  if (Object.keys(headers).length > 0) {
    await page.setExtraHTTPHeaders(headers);
  }

  try {
    await page.goto(rewrittenUrl, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Extra wait for dynamic content
    await page.waitForTimeout(waitMs);

    // If a specific selector is requested, wait for it
    if (selector) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
      } catch {
        console.error(`Warning: selector "${selector}" not found, continuing anyway`);
      }
    }

    // Get raw HTML and final URL from the browser
    const rawHtml = await page.content();
    const finalUrl = page.url();

    return { rawHtml, finalUrl };
  } finally {
    await browser.close();
  }
}

try {
  const { rawHtml, finalUrl } = await scrapeWithPlaywright(url);

  // Process HTML with Cheerio utilities in Node.js
  const cleaned = cleanHtml(rawHtml, finalUrl);
  const metadata = extractMetadata(rawHtml, finalUrl);
  const links = extractLinksWithText(cleaned, finalUrl);
  const images = extractImages(rawHtml, finalUrl);
  const youtube = extractYouTubeData(rawHtml);
  const markdown = htmlToMarkdown(cleaned);

  // Output as structured JSON
  const output = {
    url: finalUrl,
    title: metadata.title || "",
    metadata,
    content: markdown,
    links,
    images,
    ...(youtube ? { youtube } : {}),
    linkCount: links.length,
    imageCount: images.length,
  };

  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  console.error(`Scrape failed: ${error.message}`);
  process.exit(1);
}
