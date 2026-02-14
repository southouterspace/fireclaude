/**
 * Standalone Cheerio-based utilities extracted from Firecrawl.
 * Pure ESM JavaScript — no TypeScript, no Firecrawl infrastructure deps.
 */

import { load } from "cheerio";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const excludeNonMainTags = [
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

const forceIncludeMainTags = [
  "#main",
  ".swoogo-cols", ".swoogo-text", ".swoogo-table-div", ".swoogo-space",
  ".swoogo-alert", ".swoogo-sponsors", ".swoogo-title", ".swoogo-tabs",
  ".swoogo-logo", ".swoogo-image", ".swoogo-button", ".swoogo-agenda",
];

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
    validIncludes.forEach(tag => {
      soup(tag).each((_, element) => {
        newRoot.append(soup(element).clone());
      });
    });
    soup = load(newRoot.html() ?? "");
  }

  soup("script, style, noscript, meta, head").remove();

  // Handle excludeSelectors (supports wildcard patterns like *pattern*)
  const validExcludes = excludeSelectors.filter(x => x.trim().length > 0);
  if (validExcludes.length > 0) {
    validExcludes.forEach(tag => {
      let elementsToRemove;
      if (tag.startsWith("*") && tag.endsWith("*")) {
        let classMatch = false;
        const regexPattern = new RegExp(tag.slice(1, -1), "i");
        elementsToRemove = soup("*").filter((_i, element) => {
          if (element.type === "tag") {
            const attributes = element.attribs;
            const tagNameMatches = regexPattern.test(element.name);
            const attributesMatch = Object.keys(attributes).some(attr =>
              regexPattern.test(`${attr}="${attributes[attr]}"`)
            );
            if (tag.startsWith("*.")) {
              classMatch = Object.keys(attributes).some(attr =>
                regexPattern.test(`class="${attributes[attr]}"`)
              );
            }
            return tagNameMatches || attributesMatch || classMatch;
          }
          return false;
        });
      } else {
        elementsToRemove = soup(tag);
      }
      elementsToRemove.remove();
    });
  }

  // Strip non-main-content elements
  if (onlyMainContent) {
    excludeNonMainTags.forEach(tag => {
      const elementsToRemove = soup(tag).filter(
        forceIncludeMainTags.map(x => ":not(:has(" + x + "))").join("")
      );
      elementsToRemove.remove();
    });
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
    try { el.attribs.src = new URL(el.attribs.src, url).href; } catch (_) {}
  });

  // Absolutify links
  soup("a[href]").each((_, el) => {
    try { el.attribs.href = new URL(el.attribs.href, url).href; } catch (_) {}
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
      const baseUrl = new URL(url).origin;
      favicon = faviconLink.startsWith("http") ? faviconLink : `${baseUrl}${faviconLink}`;
    } catch (_) {}
  }

  const language      = soup("html").attr("lang") || undefined;
  const keywords      = soup('meta[name="keywords"]').attr("content") || undefined;
  const robots        = soup('meta[name="robots"]').attr("content") || undefined;
  const ogTitle       = soup('meta[property="og:title"]').attr("content") || undefined;
  const ogDescription = soup('meta[property="og:description"]').attr("content") || undefined;
  const ogUrl         = soup('meta[property="og:url"]').attr("content") || undefined;
  const ogImage       = soup('meta[property="og:image"]').attr("content") || undefined;
  const ogAudio       = soup('meta[property="og:audio"]').attr("content") || undefined;
  const ogDeterminer  = soup('meta[property="og:determiner"]').attr("content") || undefined;
  const ogLocale      = soup('meta[property="og:locale"]').attr("content") || undefined;
  const ogLocaleAlternate =
    soup('meta[property="og:locale:alternate"]')
      .map((_i, el) => soup(el).attr("content"))
      .get() || undefined;
  const ogSiteName    = soup('meta[property="og:site_name"]').attr("content") || undefined;
  const ogVideo       = soup('meta[property="og:video"]').attr("content") || undefined;
  const articleSection = soup('meta[name="article:section"]').attr("content") || undefined;
  const articleTag     = soup('meta[name="article:tag"]').attr("content") || undefined;
  const publishedTime  = soup('meta[property="article:published_time"]').attr("content") || undefined;
  const modifiedTime   = soup('meta[property="article:modified_time"]').attr("content") || undefined;
  const dcTermsKeywords  = soup('meta[name="dcterms.keywords"]').attr("content") || undefined;
  const dcDescription    = soup('meta[name="dc.description"]').attr("content") || undefined;
  const dcSubject        = soup('meta[name="dc.subject"]').attr("content") || undefined;
  const dcTermsSubject   = soup('meta[name="dcterms.subject"]').attr("content") || undefined;
  const dcTermsAudience  = soup('meta[name="dcterms.audience"]').attr("content") || undefined;
  const dcType           = soup('meta[name="dc.type"]').attr("content") || undefined;
  const dcTermsType      = soup('meta[name="dcterms.type"]').attr("content") || undefined;
  const dcDate           = soup('meta[name="dc.date"]').attr("content") || undefined;
  const dcDateCreated    = soup('meta[name="dc.date.created"]').attr("content") || undefined;
  const dcTermsCreated   = soup('meta[name="dcterms.created"]').attr("content") || undefined;

  // Custom metadata: all <meta> tags
  const customMetadata = {};
  soup("meta").each((_i, elem) => {
    const name = soup(elem).attr("name") || soup(elem).attr("property") || soup(elem).attr("itemprop");
    const content = soup(elem).attr("content");
    if (name && content) {
      if (name === "description") {
        if (customMetadata[name] === undefined) {
          customMetadata[name] = content;
        } else {
          customMetadata[name] = Array.isArray(customMetadata[name])
            ? [...customMetadata[name], content].join(", ")
            : `${customMetadata[name]}, ${content}`;
        }
      } else {
        if (customMetadata[name] === undefined) {
          customMetadata[name] = content;
        } else if (Array.isArray(customMetadata[name])) {
          customMetadata[name].push(content);
        } else {
          customMetadata[name] = [customMetadata[name], content];
        }
      }
    }
  });

  return {
    title, description, favicon, language, keywords, robots,
    ogTitle, ogDescription, ogUrl, ogImage, ogAudio, ogDeterminer,
    ogLocale, ogLocaleAlternate, ogSiteName, ogVideo,
    dcTermsCreated, dcDateCreated, dcDate, dcTermsType, dcType,
    dcTermsAudience, dcTermsSubject, dcSubject, dcDescription, dcTermsKeywords,
    modifiedTime, publishedTime, articleTag, articleSection,
    ...customMetadata,
  };
}

// ---------------------------------------------------------------------------
// extractImages (internal helper)
// ---------------------------------------------------------------------------

function resolveImageUrl(src, baseUrl, baseHref = "") {
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
    if (src.startsWith("data:") || src.startsWith("blob:")) return src;
    if (src.startsWith("http://") || src.startsWith("https://")) return src;
    if (src.startsWith("//")) return new URL(baseUrl).protocol + src;
    return new URL(src, resolutionBase).href;
  } catch {
    return "";
  }
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

  // <img> tags: src, data-src, srcset
  $("img").each((_, element) => {
    const src = $(element).attr("src");
    if (src) {
      const resolved = resolveImageUrl(src.trim(), baseUrl, baseHref);
      if (resolved) images.add(resolved);
    }

    const dataSrc = $(element).attr("data-src");
    if (dataSrc) {
      const resolved = resolveImageUrl(dataSrc.trim(), baseUrl, baseHref);
      if (resolved) images.add(resolved);
    }

    const srcset = $(element).attr("srcset");
    if (srcset) {
      srcset.split(",").map(s => s.trim().split(/\s+/)[0]).forEach(u => {
        if (u) {
          const resolved = resolveImageUrl(u, baseUrl, baseHref);
          if (resolved) images.add(resolved);
        }
      });
    }
  });

  // <picture> sources
  $("picture source").each((_, element) => {
    const srcset = $(element).attr("srcset");
    if (srcset) {
      srcset.split(",").map(s => s.trim().split(/\s+/)[0]).forEach(u => {
        if (u) {
          const resolved = resolveImageUrl(u, baseUrl, baseHref);
          if (resolved) images.add(resolved);
        }
      });
    }
  });

  // Meta images (OG, Twitter)
  [
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]',
    'meta[itemprop="image"]',
  ].forEach(sel => {
    const src = $(sel).attr("content");
    if (src) {
      const resolved = resolveImageUrl(src.trim(), baseUrl, baseHref);
      if (resolved) images.add(resolved);
    }
  });

  // Link tags (icons, apple-touch-icon, image_src)
  $('link[rel*="icon"], link[rel*="apple-touch-icon"], link[rel*="image_src"]').each((_, element) => {
    const href = $(element).attr("href");
    if (href) {
      const resolved = resolveImageUrl(href.trim(), baseUrl, baseHref);
      if (resolved) images.add(resolved);
    }
  });

  // Inline CSS background-image
  $("[style*='background-image']").each((_, element) => {
    const style = $(element).attr("style") || "";
    const matches = style.match(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/gi);
    if (matches) {
      matches.forEach(match => {
        const urlMatch = match.match(/url\(['"]?([^'")]+)['"]?\)/i);
        if (urlMatch && urlMatch[1]) {
          const resolved = resolveImageUrl(urlMatch[1].trim(), baseUrl, baseHref);
          if (resolved) images.add(resolved);
        }
      });
    }
  });

  // Video poster
  $("video[poster]").each((_, element) => {
    const poster = $(element).attr("poster");
    if (poster) {
      const resolved = resolveImageUrl(poster.trim(), baseUrl, baseHref);
      if (resolved) images.add(resolved);
    }
  });

  // Filter out invalid/javascript URLs
  return Array.from(images).filter(u => {
    try {
      if (u.toLowerCase().startsWith("javascript:")) return false;
      new URL(u);
      return true;
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// extractLinks (internal helper)
// ---------------------------------------------------------------------------

function resolveUrlWithBaseHref(href, baseUrl, baseHref) {
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
    if (href.startsWith("http://") || href.startsWith("https://")) return href;
    if (href.startsWith("mailto:")) return href;
    if (href.startsWith("#")) return "";
    return new URL(href, resolutionBase).href;
  } catch {
    return "";
  }
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
    let href = $(element).attr("href");
    if (href) {
      href = href.trim();
      const resolvedUrl = resolveUrlWithBaseHref(href, baseUrl, baseHref);
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

  const endscreenVideos = endscreen.map(element => ({
    title: element.endscreenElementRenderer?.title?.simpleText,
    url: element.endscreenElementRenderer?.endpoint?.commandMetadata?.webCommandMetadata?.url,
  })).filter(x => x.title && x.url);

  return {
    title: videoDetails.title,
    author: videoDetails.author,
    channelId: videoDetails.channelId,
    lengthSeconds,
    lengthFormatted:
      (lengthHours > 0 ? `${lengthHours.toString().padStart(2, "0")}:` : "") +
      `${lengthMinutes.toString().padStart(2, "0")}:${lengthTrueSeconds.toString().padStart(2, "0")}`,
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
