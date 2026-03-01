/**
 * Lightweight HTML scraper — extracts company info from meta tags, OG tags,
 * JSON-LD structured data, and common page elements.  Uses only Node built-in
 * `fetch` so it adds zero dependencies.
 *
 * Returns the same shape as the AI crawler output with "" / [] for unfound fields.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pull attribute value from a tag: `<meta property="og:title" content="X">` */
function meta(html: string, property: string): string {
  // Match both property="..." and name="..." attributes
  const re = new RegExp(
    `<meta[^>]*(?:property|name)=["']${escRe(property)}["'][^>]*content=["']([^"']*)["']` +
    `|<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${escRe(property)}["']`,
    "i",
  );
  const m = html.match(re);
  return (m?.[1] ?? m?.[2] ?? "").trim();
}

function escRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tag(html: string, tagName: string): string {
  const re = new RegExp(`<${tagName}[^>]*>([^<]+)</${tagName}>`, "i");
  return (html.match(re)?.[1] ?? "").trim();
}

/** Absolute-ify a URL relative to a base */
function abs(url: string, base: string): string {
  if (!url) return "";
  try {
    return new URL(url, base).href;
  } catch {
    return "";
  }
}

/** Extract <head>…</head> */
function head(html: string): string {
  const m = html.match(/<head[\s>]([\s\S]*?)<\/head>/i);
  return m?.[1] ?? "";
}

/** Extract <body>…</body> */
function body(html: string): string {
  const m = html.match(/<body[\s>]([\s\S]*?)<\/body>/i);
  return m?.[1] ?? html;
}

// ── JSON-LD parsing ─────────────────────────────────────────────────────────

interface JsonLdData {
  name?: string;
  description?: string;
  logo?: string | { url?: string };
  image?: string | string[];
  sameAs?: string[];
  address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string };
  industry?: string;
  numberOfEmployees?: { value?: number };
  foundingDate?: string;
  brand?: { name?: string };
  "@type"?: string;
}

function parseJsonLd(html: string): JsonLdData[] {
  const results: JsonLdData[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1]);
      // Handle @graph arrays
      const items = Array.isArray(data["@graph"]) ? data["@graph"] : [data];
      for (const item of items) {
        if (item && typeof item === "object") results.push(item as JsonLdData);
      }
    } catch { /* skip malformed JSON-LD */ }
  }
  return results;
}

// ── Social link extraction ──────────────────────────────────────────────────

const SOCIAL_PATTERNS: Record<string, RegExp> = {
  linkedin: /linkedin\.com\/(?:company|in)\//i,
  twitter: /(?:twitter\.com|x\.com)\//i,
  facebook: /facebook\.com\//i,
  instagram: /instagram\.com\//i,
};

function extractSocials(html: string, jsonLd: JsonLdData[]): Record<string, string> {
  const socials: Record<string, string> = { linkedin: "", twitter: "", facebook: "", instagram: "" };

  // First: from JSON-LD sameAs
  for (const item of jsonLd) {
    for (const url of item.sameAs ?? []) {
      for (const [key, re] of Object.entries(SOCIAL_PATTERNS)) {
        if (!socials[key] && re.test(url)) socials[key] = url;
      }
    }
  }

  // Second: from <a href="..."> in HTML
  const linkRe = /<a[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(html))) {
    const href = lm[1];
    for (const [key, re] of Object.entries(SOCIAL_PATTERNS)) {
      if (!socials[key] && re.test(href)) socials[key] = href;
    }
  }

  // Third: twitter from meta tag
  if (!socials.twitter) {
    const handle = meta(html, "twitter:site");
    if (handle) socials.twitter = `https://x.com/${handle.replace(/^@/, "")}`;
  }

  return socials;
}

// ── Image extraction ────────────────────────────────────────────────────────

function extractLogo(bodyHtml: string, baseUrl: string, jsonLd: JsonLdData[]): string {
  // JSON-LD logo
  for (const item of jsonLd) {
    const logo = typeof item.logo === "string" ? item.logo : item.logo?.url;
    if (logo) return abs(logo, baseUrl);
  }

  // <img> with alt/class/src containing "logo" (most reliable signal)
  const logoImg = bodyHtml.match(/<img[^>]*(?:alt|class)=["'][^"']*logo[^"']*["'][^>]*src=["']([^"']+)["']|<img[^>]*src=["']([^"']+)["'][^>]*(?:alt|class)=["'][^"']*logo[^"']*["']/i);
  if (logoImg) return abs(logoImg[1] ?? logoImg[2], baseUrl);

  // src path containing "logo"
  const logoSrc = bodyHtml.match(/<img[^>]*src=["']([^"']*logo[^"']*)["'][^>]*>/i);
  if (logoSrc) return abs(logoSrc[1], baseUrl);

  // First <img> inside <header> that is SVG or PNG (likely the site logo, not a random icon)
  const headerNav = bodyHtml.match(/<(?:header|nav)[\s>][\s\S]*?<\/(?:header|nav)>/gi) ?? [];
  for (const block of headerNav) {
    const imgM = block.match(/<img[^>]*src=["']([^"']+\.(?:svg|png)[^"']*)["'][^>]*>/i);
    if (imgM) return abs(imgM[1], baseUrl);
  }

  return "";
}

function extractHero(headHtml: string, bodyHtml: string, baseUrl: string): string {
  // og:image
  const ogImage = meta(headHtml, "og:image");
  if (ogImage) return abs(ogImage, baseUrl);

  // First large-ish image in body (heuristic: in a hero/banner section or first section)
  const heroSection = bodyHtml.match(/<(?:section|div)[^>]*(?:class|id)=["'][^"']*(?:hero|banner|jumbotron)[^"']*["'][\s\S]*?<\/(?:section|div)>/i);
  if (heroSection) {
    const imgM = heroSection[0].match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
    if (imgM) return abs(imgM[1], baseUrl);
  }

  return "";
}

/** Patterns that indicate an image is a tiny icon, UI element, or tracking pixel — not real content */
const JUNK_IMAGE_RE = /(?:icon|sprite|favicon|badge|avatar|arrow|chevron|caret|close|menu|hamburger|search|spinner|loader|placeholder|pixel|spacer|blank|1x1|tracking|analytics|beacon|button|widget|emoji|smiley)/i;
const JUNK_EXT_RE = /\.(?:svg|gif|ico|webp)(?:\?|$)/i; // SVGs/GIFs are almost always UI icons

function isRealContentImage(imgTag: string, url: string): boolean {
  if (!url || url.startsWith("data:")) return false;

  // Skip tracking / spacer images
  if (/1x1|pixel|spacer|blank|tracking|beacon/i.test(url)) return false;

  // Skip common icon file paths
  if (/\/icons?\//i.test(url) || /\/assets\/(?:icons?|ui|svg)\//i.test(url)) return false;

  // Skip SVGs, GIFs, ICOs — almost always UI elements, not content photos
  if (JUNK_EXT_RE.test(url)) return false;

  // Skip images with icon/UI keywords in the full tag (alt, class, id, src)
  if (JUNK_IMAGE_RE.test(imgTag)) return false;

  // Skip images with tiny explicit dimensions (width/height under 100px)
  const widthM = imgTag.match(/width=["']?(\d+)/i);
  const heightM = imgTag.match(/height=["']?(\d+)/i);
  if (widthM && parseInt(widthM[1]) < 100) return false;
  if (heightM && parseInt(heightM[1]) < 100) return false;

  // Must be jpg/jpeg/png/webp with a reasonable path, or a CDN image URL
  const looksLikePhoto = /\.(?:jpe?g|png)(?:\?|$)/i.test(url) ||
    /(?:images|photos|media|uploads|cdn|cloudinary|imgix|unsplash)/i.test(url);
  if (!looksLikePhoto) return false;

  return true;
}

function extractAdditionalImages(bodyHtml: string, baseUrl: string, exclude: Set<string>): string[] {
  const images: string[] = [];
  const seen = new Set<string>();
  const re = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyHtml))) {
    const url = abs(m[1], baseUrl);
    if (url && !exclude.has(url) && !seen.has(url) && isRealContentImage(m[0], url) && images.length < 8) {
      seen.add(url);
      images.push(url);
    }
  }
  return images;
}

// ── Main scraper ────────────────────────────────────────────────────────────

export interface ScrapedData {
  company_name: string;
  industry: string;
  founded: string;
  location: string;
  employee_count: string;
  description: string;
  value_proposition: string;
  target_audience: string;
  products_services: string[];
  competitors: string[];
  social_media: { linkedin: string; twitter: string; facebook: string; instagram: string };
  reviews_summary: {
    average_rating: number;
    total_reviews: number;
    positive_themes: string[];
    negative_themes: string[];
  };
  brand_voice: string;
  visual_identity: string;
  key_differentiators: string[];
  weaknesses: string[];
  recent_news: string[];
  seo_keywords: string[];
  images: {
    logo: string;
    hero: string;
    products: string[];
    team: string;
    social_cover: string;
    additional: string[];
  };
}

const EMPTY_RESULT: ScrapedData = {
  company_name: "",
  industry: "",
  founded: "",
  location: "",
  employee_count: "",
  description: "",
  value_proposition: "",
  target_audience: "",
  products_services: [],
  competitors: [],
  social_media: { linkedin: "", twitter: "", facebook: "", instagram: "" },
  reviews_summary: { average_rating: 0, total_reviews: 0, positive_themes: [], negative_themes: [] },
  brand_voice: "",
  visual_identity: "",
  key_differentiators: [],
  weaknesses: [],
  recent_news: [],
  seo_keywords: [],
  images: { logo: "", hero: "", products: [], team: "", social_cover: "", additional: [] },
};

export async function scrapeWebsite(url: string): Promise<ScrapedData> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WebBuilderBot/1.0)",
        Accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ...EMPTY_RESULT };
    html = await res.text();
  } catch {
    return { ...EMPTY_RESULT };
  }

  const headHtml = head(html);
  const bodyHtml = body(html);
  const jsonLd = parseJsonLd(html);

  // Find the most relevant JSON-LD entity
  const orgLd = jsonLd.find((d) => /Organization|LocalBusiness|Corporation/i.test(d["@type"] ?? ""));
  const productLd = jsonLd.find((d) => /Product|Service|SoftwareApplication/i.test(d["@type"] ?? ""));

  // ── Company name ──
  const company_name =
    orgLd?.name ||
    meta(headHtml, "og:site_name") ||
    meta(headHtml, "og:title") ||
    meta(headHtml, "application-name") ||
    tag(headHtml, "title") ||
    "";

  // ── Description ──
  const description =
    orgLd?.description ||
    meta(headHtml, "og:description") ||
    meta(headHtml, "description") ||
    "";

  // ── Location ──
  const addr = orgLd?.address;
  const location = addr
    ? [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(", ")
    : "";

  // ── Industry ──
  const industry = orgLd?.industry ?? "";

  // ── Founded / employees ──
  const founded = orgLd?.foundingDate ?? "";
  const employee_count = orgLd?.numberOfEmployees?.value?.toString() ?? "";

  // ── SEO keywords ──
  const kwRaw = meta(headHtml, "keywords");
  const seo_keywords = kwRaw ? kwRaw.split(",").map((k) => k.trim()).filter(Boolean) : [];

  // ── Products / services ──
  const products_services: string[] = [];
  if (productLd?.name) products_services.push(typeof productLd.name === "string" ? productLd.name : "");

  // ── Social media ──
  const social_media = extractSocials(html, jsonLd);

  // ── Images ──
  const logo = extractLogo(bodyHtml, url, jsonLd);
  const hero = extractHero(headHtml, bodyHtml, url);
  const excludeUrls = new Set([logo, hero].filter(Boolean));
  const additional = extractAdditionalImages(bodyHtml, url, excludeUrls);

  return {
    company_name,
    industry,
    founded,
    location,
    employee_count,
    description,
    value_proposition: "",
    target_audience: "",
    products_services,
    competitors: [],
    social_media: social_media as ScrapedData["social_media"],
    reviews_summary: { average_rating: 0, total_reviews: 0, positive_themes: [], negative_themes: [] },
    brand_voice: "",
    visual_identity: "",
    key_differentiators: [],
    weaknesses: [],
    recent_news: [],
    seo_keywords,
    images: {
      logo,
      hero,
      products: [],
      team: "",
      social_cover: "",
      additional,
    },
  };
}

/**
 * Check if scraped data has enough fields to skip the AI crawler.
 * Requires company_name + at least 2 of: description, industry, logo, hero.
 */
export function isScrapeSufficient(data: ScrapedData): boolean {
  if (!data.company_name) return false;

  let score = 0;
  if (data.description) score++;
  if (data.industry) score++;
  if (data.images.logo) score++;
  if (data.images.hero) score++;

  return score >= 2;
}
