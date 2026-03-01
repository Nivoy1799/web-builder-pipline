/**
 * Unsplash image fetcher — finds relevant stock photos when the scraper/crawler
 * can't find usable images from the target site. Uses the free Unsplash API
 * (50 req/hour). Gracefully skips if UNSPLASH_ACCESS_KEY is not set.
 */

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const SEARCH_URL = "https://api.unsplash.com/search/photos";
const TIMEOUT_MS = 8_000;

interface UnsplashPhoto {
  urls: { regular: string; small: string };
  alt_description: string | null;
  user: { name: string; links: { html: string } };
}

interface UnsplashResult {
  results: UnsplashPhoto[];
}

export interface UnsplashImages {
  hero: string;
  products: string[];
  attribution: { photo_url: string; photographer: string; profile_url: string }[];
}

async function searchPhotos(
  query: string,
  perPage: number,
  orientation: "landscape" | "squarish" = "landscape",
): Promise<UnsplashPhoto[]> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", orientation);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    console.log(`Unsplash API error: ${res.status} ${res.statusText}`);
    return [];
  }

  const data: UnsplashResult = await res.json();
  return data.results ?? [];
}

function photoUrl(photo: UnsplashPhoto, w = 1080, h = 720): string {
  // Use regular URL with crop params for consistent sizing
  const base = photo.urls.regular;
  return `${base}&w=${w}&h=${h}&fit=crop`;
}

export async function fetchUnsplashImages(context: {
  companyName: string;
  industry: string;
  productsServices: string[];
  description: string;
}): Promise<UnsplashImages | null> {
  if (!UNSPLASH_ACCESS_KEY) {
    console.log("Unsplash: UNSPLASH_ACCESS_KEY not set — skipping");
    return null;
  }

  const { companyName, industry, productsServices, description } = context;
  const attribution: UnsplashImages["attribution"] = [];

  try {
    // Build search queries from company context
    const heroQuery = [industry, description.slice(0, 50)].filter(Boolean).join(" ") || companyName;
    const productQuery = productsServices.slice(0, 2).join(" ") || industry || companyName;

    // Fetch hero + product images in parallel
    const [heroResults, productResults] = await Promise.all([
      searchPhotos(heroQuery, 1, "landscape"),
      searchPhotos(productQuery, 3, "landscape"),
    ]);

    let hero = "";
    if (heroResults.length > 0) {
      const h = heroResults[0];
      hero = photoUrl(h, 1920, 1080);
      attribution.push({
        photo_url: hero,
        photographer: h.user.name,
        profile_url: h.user.links.html,
      });
    }

    const products: string[] = [];
    for (const p of productResults.slice(0, 3)) {
      const url = photoUrl(p);
      products.push(url);
      attribution.push({
        photo_url: url,
        photographer: p.user.name,
        profile_url: p.user.links.html,
      });
    }

    if (!hero && products.length === 0) {
      console.log("Unsplash: no results found for queries");
      return null;
    }

    return { hero, products, attribution };
  } catch (err) {
    console.log(`Unsplash: fetch failed — ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
