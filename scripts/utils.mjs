/**
 * Standalone Cheerio-based utilities extracted from Firecrawl.
 * Pure ESM JavaScript — no TypeScript, no Firecrawl infrastructure deps.
 */

import { load } from "cheerio";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXCLUDE_NON_MAIN_TAGS = [
  "header", "footer", "nav", "aside",
  ".header", ".top", ".navbar", "#header",
  ".footer", ".bottom", "#footer",
  ".sidebar", ".side", ".aside", "#sidebar",
  ".modal", ".popup", "#modal", ".overlay",
  ".ad", ".ads", ".advert", "#ad",
  ".lang-selector", ".language", "#language-selector",
  ".social", ".social-media", ".social-links", "#social",
  ".menu", ".navigation", "#nav",
  ".breadcrumbs", "#breadcrumbs",
  ".share", "#share",
  ".widget", "#widget",
  ".cookie", "#cookie",
];

const FORCE_INCLUDE_MAIN_TAGS = [
  "#main",
  ".swoogo-cols", ".swoogo-text", ".swoogo-table-div", ".swoogo-space",
  ".swoogo-alert", ".swoogo-sponsors", ".swoogo-title", ".swoogo-tabs",
  ".swoogo-logo", ".swoogo-image", ".swoogo-button", ".swoogo-agenda",
];

// Metadata selectors keyed by output field name.
// Each entry maps to a CSS selector to look up a <meta> tag's "content" attribute.
const META_SELECTORS = {
  ogTitle:            'meta[property="og:title"]',
  ogDescription:      'meta[property="og:description"]',
  ogUrl:              'meta[property="og:url"]',
  ogImage:            'meta[property="og:image"]',
  ogAudio:            'meta[property="og:audio"]',
  ogDeterminer:       'meta[property="og:determiner"]',
  ogLocale:           'meta[property="og:locale"]',
  ogSiteName:         'meta[property="og:site_name"]',
  ogVideo:            'meta[property="og:video"]',
  articleSection:     'meta[name="article:section"]',
  articleTag:         'meta[name="article:tag"]',
  publishedTime:      'meta[property="article:published_time"]',
  modifiedTime:       'meta[property="article:modified_time"]',
  dcTermsKeywords:    'meta[name="dcterms.keywords"]',
  dcDescription:      'meta[name="dc.description"]',
  dcSubject:          'meta[name="dc.subject"]',
  dcTermsSubject:     'meta[name="dcterms.subject"]',
  dcTermsAudience:    'meta[name="dcterms.audience"]',
  dcType:             'meta[name="dc.type"]',
  dcTermsType:        'meta[name="dcterms.type"]',
  dcDate:             'meta[name="dc.date"]',
  dcDateCreated:      'meta[name="dc.date.created"]',
  dcTermsCreated:     'meta[name="dcterms.created"]',
};

// ---------------------------------------------------------------------------
// Shared URL resolution helper
// ---------------------------------------------------------------------------

/**
 * Resolve a relative URL against a base URL, optionally using a <base href>.
 * Returns an empty string if the URL cannot be resolved.
 *
 * @param {string} href     - The URL or path to resolve.
 * @param {string} baseUrl  - The page URL used as the default resolution base.
 * @param {string} [baseHref=""] - Optional <base href> value from the document.
 * @returns {string} Resolved absolute URL, or empty string on failure.
 */
function resolveUrl(href, baseUrl, baseHref = "") {
  let resolutionBase = baseUrl;

  if (baseHref) {
    try {
      new URL(baseHref);
      resolutionBase = baseHref;
    } catch {
      try {
        resolutionBase = new URL(baseHref, baseUrl).href;
      } catch {
        resolutionBase = baseUrl;
      }
    }
  }

  try {
    if (href.startsWith("data:") || href.startsWith("blob:")) return href;
    if (href.startsWith("http://") || href.startsWith("https://")) return href;
    if (href.startsWith("mailto:")) return href;
    if (href.startsWith("#")) return "";
    if (href.startsWith("//")) return new URL(baseUrl).protocol + href;
    return new URL(href, resolutionBase).href;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Srcset parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse URLs from a srcset attribute string, resolving each against the base.
 *
 * @param {string} srcset   - The srcset attribute value.
 * @param {string} baseUrl  - Page URL for resolution.
 * @param {string} baseHref - Optional <base href> value.
 * @returns {string[]} Array of resolved URLs.
 */
function parseSrcsetUrls(srcset, baseUrl, baseHref) {
  return srcset
    .split(",")
    .map(s => s.trim().split(/\s+/)[0])
    .filter(Boolean)
    .map(u => resolveUrl(u, baseUrl, baseHref))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// cleanHtml
// ---------------------------------------------------------------------------

/**
 * Remove unwanted elements from HTML, normalize links and images.
 * Cheerio-only port of Firecrawl's htmlTransform fallback path.
 *
 * @param {string} html        - Raw HTML string.
 * @param {string} url         - Page URL (used to absolutify links/images).
 * @param {object} [options]
 * @param {boolean}  [options.onlyMainContent=true]  - Strip headers/footers/navs/ads.
 * @param {string[]} [options.includeSelectors=[]]    - Keep only elements matching these selectors.
 * @param {string[]} [options.excludeSelectors=[]]    - Remove elements matching these selectors.
 * @returns {string} Cleaned HTML.
 */
export function cleanHtml(html, url, options = {}) {
  const {
    onlyMainContent = true,
    includeSelectors = [],
    excludeSelectors = [],
  } = options;

  let soup = load(html);

  // If includeSelectors are provided, keep only those elements
  const validIncludes = includeSelectors.filter(x => x.trim().length > 0);
  if (validIncludes.length > 0) {
    const newRoot = load("<div></div>")("div");
    for (const tag of validIncludes) {
      soup(tag).each((_, element) => {
        newRoot.append(soup(element).clone());
      });
    }
    soup = load(newRoot.html() ?? "");
  }

  soup("script, style, noscript, meta, head").remove();

  // Handle excludeSelectors (supports wildcard patterns like *pattern*)
  const validExcludes = excludeSelectors.filter(x => x.trim().length > 0);
  for (const tag of validExcludes) {
    let elementsToRemove;
    if (tag.startsWith("*") && tag.endsWith("*")) {
      const regexPattern = new RegExp(tag.slice(1, -1), "i");
      elementsToRemove = soup("*").filter((_, element) => {
        if (element.type !== "tag") return false;
        const attributes = element.attribs;
        const tagNameMatches = regexPattern.test(element.name);
        const attributesMatch = Object.keys(attributes).some(attr =>
          regexPattern.test(`${attr}="${attributes[attr]}"`)
        );
        let classMatch = false;
        if (tag.startsWith("*.")) {
          classMatch = Object.keys(attributes).some(attr =>
            regexPattern.test(`class="${attributes[attr]}"`)
          );
        }
        return tagNameMatches || attributesMatch || classMatch;
      });
    } else {
      elementsToRemove = soup(tag);
    }
    elementsToRemove.remove();
  }

  // Strip non-main-content elements
  if (onlyMainContent) {
    const keepFilter = FORCE_INCLUDE_MAIN_TAGS
      .map(x => `:not(:has(${x}))`)
      .join("");
    for (const tag of EXCLUDE_NON_MAIN_TAGS) {
      soup(tag).filter(keepFilter).remove();
    }
  }

  // Pick the biggest image from srcset
  soup("img[srcset]").each((_, el) => {
    const sizes = el.attribs.srcset.split(",").map(x => {
      const tok = x.trim().split(" ");
      return {
        url: tok[0],
        size: parseInt((tok[1] ?? "1x").slice(0, -1), 10),
        isX: (tok[1] ?? "").endsWith("x"),
      };
    });

    if (sizes.every(x => x.isX) && el.attribs.src) {
      sizes.push({ url: el.attribs.src, size: 1, isX: true });
    }

    sizes.sort((a, b) => b.size - a.size);
    el.attribs.src = sizes[0]?.url;
  });

  // Absolutify image sources
  soup("img[src]").each((_, el) => {
    try { el.attribs.src = new URL(el.attribs.src, url).href; } catch { /* skip invalid */ }
  });

  // Absolutify links
  soup("a[href]").each((_, el) => {
    try { el.attribs.href = new URL(el.attribs.href, url).href; } catch { /* skip invalid */ }
  });

  return soup.html();
}

// ---------------------------------------------------------------------------
// extractMetadata
// ---------------------------------------------------------------------------

/**
 * Extract metadata from HTML (title, description, OG, Twitter, Dublin Core, etc.).
 * Cheerio-only port of Firecrawl's extractMetadata fallback path.
 *
 * @param {string} html - Raw HTML string.
 * @param {string} url  - Page URL (used to resolve favicon).
 * @returns {object} Metadata object with all available fields.
 */
export function extractMetadata(html, url) {
  const soup = load(html);

  const title = soup("title").first().text().trim() || undefined;
  const description = soup('meta[name="description"]').attr("content") || undefined;

  // Favicon
  let favicon;
  const faviconLink =
    soup('link[rel="icon"]').attr("href") ||
    soup('link[rel*="icon"]').first().attr("href") ||
    undefined;
  if (faviconLink) {
    try {
      const baseOrigin = new URL(url).origin;
      favicon = faviconLink.startsWith("http") ? faviconLink : `${baseOrigin}${faviconLink}`;
    } catch { /* skip invalid */ }
  }

  const language = soup("html").attr("lang") || undefined;
  const keywords = soup('meta[name="keywords"]').attr("content") || undefined;
  const robots   = soup('meta[name="robots"]').attr("content") || undefined;

  // OG locale alternates (multi-value)
  const ogLocaleAlternate =
    soup('meta[property="og:locale:alternate"]')
      .map((_, el) => soup(el).attr("content"))
      .get() || undefined;

  // Collect all single-value meta fields from the selector table
  const metaFields = {};
  for (const [field, selector] of Object.entries(META_SELECTORS)) {
    const value = soup(selector).attr("content") || undefined;
    if (value !== undefined) {
      metaFields[field] = value;
    }
  }

  // Custom metadata: all <meta> tags
  const customMetadata = {};
  soup("meta").each((_, elem) => {
    const name = soup(elem).attr("name") || soup(elem).attr("property") || soup(elem).attr("itemprop");
    const content = soup(elem).attr("content");
    if (!name || !content) return;

    if (name === "description") {
      if (customMetadata[name] === undefined) {
        customMetadata[name] = content;
      } else {
        customMetadata[name] = Array.isArray(customMetadata[name])
          ? [...customMetadata[name], content].join(", ")
          : `${customMetadata[name]}, ${content}`;
      }
    } else if (customMetadata[name] === undefined) {
      customMetadata[name] = content;
    } else if (Array.isArray(customMetadata[name])) {
      customMetadata[name].push(content);
    } else {
      customMetadata[name] = [customMetadata[name], content];
    }
  });

  return {
    title, description, favicon, language, keywords, robots,
    ogLocaleAlternate,
    ...metaFields,
    ...customMetadata,
  };
}

// ---------------------------------------------------------------------------
// extractImages
// ---------------------------------------------------------------------------

/**
 * Extract all image URLs from HTML (img, srcset, picture, OG/Twitter, favicons,
 * CSS background-image, video poster). Resolves relative URLs.
 *
 * @param {string} html    - Raw HTML string.
 * @param {string} baseUrl - Page URL for resolving relative URLs.
 * @returns {string[]} Array of deduplicated absolute image URLs.
 */
export function extractImages(html, baseUrl) {
  const $ = load(html);
  const baseHref = $("base[href]").first().attr("href") || "";
  const images = new Set();

  function addResolved(src) {
    const resolved = resolveUrl(src.trim(), baseUrl, baseHref);
    if (resolved) images.add(resolved);
  }

  // <img> tags: src, data-src, srcset
  $("img").each((_, element) => {
    const src = $(element).attr("src");
    if (src) addResolved(src);

    const dataSrc = $(element).attr("data-src");
    if (dataSrc) addResolved(dataSrc);

    const srcset = $(element).attr("srcset");
    if (srcset) {
      for (const u of parseSrcsetUrls(srcset, baseUrl, baseHref)) {
        images.add(u);
      }
    }
  });

  // <picture> sources
  $("picture source").each((_, element) => {
    const srcset = $(element).attr("srcset");
    if (srcset) {
      for (const u of parseSrcsetUrls(srcset, baseUrl, baseHref)) {
        images.add(u);
      }
    }
  });

  // Meta images (OG, Twitter)
  const metaImageSelectors = [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'meta[itemprop="image"]',
  ];
  for (const sel of metaImageSelectors) {
    const src = $(sel).attr("content");
    if (src) addResolved(src);
  }

  // Link tags (icons, apple-touch-icon, image_src)
  $('link[rel*="icon"], link[rel*="apple-touch-icon"], link[rel*="image_src"]').each((_, element) => {
    const href = $(element).attr("href");
    if (href) addResolved(href);
  });

  // Inline CSS background-image
  $("[style*='background-image']").each((_, element) => {
    const style = $(element).attr("style") || "";
    const matches = style.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/gi);
    if (matches) {
      for (const match of matches) {
        const urlMatch = match.match(/url\(['"]?([^'")]+)['"]?\)/i);
        if (urlMatch?.[1]) addResolved(urlMatch[1]);
      }
    }
  });

  // Video poster
  $("video[poster]").each((_, element) => {
    const poster = $(element).attr("poster");
    if (poster) addResolved(poster);
  });

  // Filter out invalid/javascript URLs
  return Array.from(images).filter(u => {
    if (u.toLowerCase().startsWith("javascript:")) return false;
    try {
      new URL(u);
      return true;
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// extractLinks
// ---------------------------------------------------------------------------

/**
 * Extract all link URLs from <a> tags in HTML.
 * Resolves relative URLs using base href and page URL. Deduplicates.
 *
 * @param {string} html    - Raw HTML string.
 * @param {string} baseUrl - Page URL for resolving relative URLs.
 * @returns {string[]} Array of deduplicated absolute URLs.
 */
export function extractLinks(html, baseUrl) {
  const $ = load(html);
  const baseHref = $("base[href]").first().attr("href") || "";
  const links = [];

  $("a").each((_, element) => {
    const href = $(element).attr("href");
    if (href) {
      const resolvedUrl = resolveUrl(href.trim(), baseUrl, baseHref);
      if (resolvedUrl) links.push(resolvedUrl);
    }
  });

  return [...new Set(links)];
}

// ---------------------------------------------------------------------------
// rewriteUrl
// ---------------------------------------------------------------------------

/**
 * Rewrite Google Docs/Sheets/Slides/Drive URLs to their scrapable equivalents.
 * Returns the rewritten URL, or the original URL if no rewrite applies.
 *
 * @param {string} url - URL to potentially rewrite.
 * @returns {string} Rewritten URL or original URL.
 */
export function rewriteUrl(url) {
  if (
    url.startsWith("https://docs.google.com/document/d/") ||
    url.startsWith("http://docs.google.com/document/d/")
  ) {
    if (url.includes("/document/d/e/")) return url;
    const id = url.match(/\/document\/d\/([-\w]+)/)?.[1];
    if (id) return `https://docs.google.com/document/d/${id}/export?format=html`;
  } else if (
    url.startsWith("https://docs.google.com/presentation/d/") ||
    url.startsWith("http://docs.google.com/presentation/d/")
  ) {
    if (url.includes("/presentation/d/e/")) return url;
    const id = url.match(/\/presentation\/d\/([-\w]+)/)?.[1];
    if (id) return `https://docs.google.com/presentation/d/${id}/export?format=html`;
  } else if (
    url.startsWith("https://drive.google.com/file/d/") ||
    url.startsWith("http://drive.google.com/file/d/")
  ) {
    const id = url.match(/\/file\/d\/([-\w]+)/)?.[1];
    if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
  } else if (
    url.startsWith("https://docs.google.com/spreadsheets/d/") ||
    url.startsWith("http://docs.google.com/spreadsheets/d/")
  ) {
    if (url.includes("/spreadsheets/d/e/")) return url;
    const id = url.match(/\/spreadsheets\/d\/([-\w]+)/)?.[1];
    if (id) {
      const gidMatch = url.match(/[?&#]gid=(\d+)/);
      const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : "";
      return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:html${gidParam}`;
    }
  }

  return url;
}

// ---------------------------------------------------------------------------
// extractYouTubeData
// ---------------------------------------------------------------------------

/**
 * Extract YouTube video metadata and transcript from a YouTube watch page's HTML.
 * Returns null if the page is not a YouTube video or parsing fails.
 *
 * @param {string} html - Raw HTML of a YouTube watch page.
 * @returns {object|null} YouTube metadata or null.
 */
export function extractYouTubeData(html) {
  let initialData;
  try {
    initialData = JSON.parse(
      html.split("var ytInitialPlayerResponse = ")[1].split(";var meta =")[0]
    );
  } catch {
    return null;
  }

  const videoDetails = initialData.videoDetails;
  if (!videoDetails) return null;

  const microformat = initialData.microformat?.playerMicroformatRenderer;
  const largestThumbnail = videoDetails.thumbnail?.thumbnails?.slice(-1)[0];
  const lengthSeconds = parseFloat(videoDetails.lengthSeconds || "0");
  const lengthTrueSeconds = lengthSeconds % 60;
  const lengthMinutes = Math.floor(lengthSeconds / 60) % 60;
  const lengthHours = Math.floor(lengthSeconds / 3600);

  const endscreen = (
    initialData.endscreen?.endscreenRenderer?.elements || []
  ).filter(x => x.endscreenElementRenderer?.style === "VIDEO");

  const endscreenVideos = endscreen
    .map(element => ({
      title: element.endscreenElementRenderer?.title?.simpleText,
      url: element.endscreenElementRenderer?.endpoint?.commandMetadata?.webCommandMetadata?.url,
    }))
    .filter(x => x.title && x.url);

  const formattedLength =
    (lengthHours > 0 ? `${lengthHours.toString().padStart(2, "0")}:` : "") +
    `${lengthMinutes.toString().padStart(2, "0")}:${lengthTrueSeconds.toString().padStart(2, "0")}`;

  return {
    title: videoDetails.title,
    author: videoDetails.author,
    channelId: videoDetails.channelId,
    lengthSeconds,
    lengthFormatted: formattedLength,
    viewCount: videoDetails.viewCount,
    shortDescription: videoDetails.shortDescription,
    isPrivate: videoDetails.isPrivate,
    isUnlisted: microformat?.isUnlisted,
    thumbnail: largestThumbnail,
    uploadDate: microformat?.uploadDate,
    publishDate: microformat?.publishDate,
    likeCount: microformat?.likeCount,
    category: microformat?.category,
    canonicalUrl: microformat?.canonicalUrl,
    ownerProfileUrl: microformat?.ownerProfileUrl,
    endscreenVideos,
  };
}
