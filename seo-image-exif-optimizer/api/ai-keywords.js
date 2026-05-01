"use strict";

const marketplaceDomains = {
  amazon: ["amazon.com"],
  ebay: ["ebay.com"],
  walmart: ["walmart.com"],
  etsy: ["etsy.com"],
  sephora: ["sephora.com"],
  ulta: ["ulta.com"],
};

const stopwords = new Set([
  "and",
  "are",
  "best",
  "buy",
  "com",
  "for",
  "from",
  "free",
  "new",
  "official",
  "online",
  "sale",
  "seller",
  "shipping",
  "shop",
  "the",
  "top",
  "with",
  "www",
]);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  try {
    const body = await readBody(req);
    const domains = resolveDomains(body.marketplaces);
    const seed = chooseSearchSeed(body);
    const searchResults = await searchMarketplaceKeywords(seed, domains);
    const suggestion = buildSuggestion(body, searchResults, seed);

    sendJson(res, 200, {
      ...suggestion,
      sources: searchResults.sources,
      usedLocalAi: false,
      usedWebSearch: searchResults.sources.length > 0,
      note: searchResults.sources.length
        ? "Vercel free mode used marketplace search results. No paid AI was used."
        : "No marketplace results were found. Suggestions used your current text or filename.",
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Keyword research failed." });
  }
};

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function chooseSearchSeed(body) {
  return asText(body.currentKeyword) || asText(body.currentTitle) || wordsFromFilename(body.originalName) || "product";
}

async function searchMarketplaceKeywords(seed, domains) {
  const queries = domains.slice(0, 6).map((domain) => `${seed} site:${domain} bestseller best seller popular`);
  const pages = await Promise.allSettled(queries.map(fetchDuckDuckGo));
  const results = pages.flatMap((page) => (page.status === "fulfilled" ? page.value : []));
  const text = results.map((result) => `${result.title} ${result.snippet}`).join(" ");
  return {
    candidates: extractKeywordCandidates(text, seed),
    sources: uniqueSources(results).slice(0, 8),
  };
}

async function fetchDuckDuckGo(query) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 SEO-Image-EXIF-Optimizer/1.0",
      Accept: "text/html",
    },
  });
  if (!response.ok) return [];
  return parseDuckDuckGoResults(await response.text());
}

function parseDuckDuckGoResults(html) {
  const results = [];
  const blocks = html.split(/<div class="result[\s"]/i).slice(1, 6);
  for (const block of blocks) {
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
    if (!titleMatch) continue;
    const url = cleanResultUrl(decodeHtml(titleMatch[1]));
    const title = stripTags(decodeHtml(titleMatch[2]));
    const snippet = stripTags(decodeHtml(snippetMatch?.[1] || snippetMatch?.[2] || ""));
    if (url && title) results.push({ title, snippet, url });
  }
  return results;
}

function buildSuggestion(body, searchResults, seed) {
  const keywords = uniqueCleanKeywords([seed, ...searchResults.candidates]).slice(0, 12);
  const primaryKeyword = keywords[0] || seed;
  const title = titleCase(primaryKeyword);
  return {
    primaryKeyword,
    keywords,
    title,
    altText: compactSentence(`${title} product image`.slice(0, 135)),
    description: compactSentence(`${title} with ecommerce keywords including ${keywords.slice(0, 5).join(", ")}.`),
    subject: title,
    creator: "",
    copyright: "",
  };
}

function extractKeywordCandidates(text, seed) {
  const normalized = `${seed} ${text}`
    .toLowerCase()
    .replace(/&amp;/g, " and ")
    .replace(/[^a-z0-9.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter((token) => token.length > 1 && !stopwords.has(token));

  const scores = new Map();
  for (let size = 1; size <= 4; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const phrase = tokens.slice(index, index + size).join(" ");
      if (!isUsefulPhrase(phrase)) continue;
      scores.set(phrase, (scores.get(phrase) || 0) + size);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .map(([phrase]) => phrase)
    .slice(0, 20);
}

function isUsefulPhrase(phrase) {
  if (phrase.length < 3 || phrase.length > 70) return false;
  if (/^(amazon|ebay|walmart|etsy|sephora|ulta)$/.test(phrase)) return false;
  if (/^\d+$/.test(phrase)) return false;
  return true;
}

function uniqueCleanKeywords(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const clean = compactSentence(String(item || "").toLowerCase()).replace(/\s+/g, " ");
    if (!clean || seen.has(clean) || !isUsefulPhrase(clean)) continue;
    seen.add(clean);
    output.push(clean);
  }
  return output;
}

function resolveDomains(marketplaces) {
  const requested = Array.isArray(marketplaces) && marketplaces.length ? marketplaces : ["amazon", "ebay", "walmart"];
  const domains = requested.flatMap((name) => marketplaceDomains[String(name).toLowerCase()] || []);
  return [...new Set(domains)].slice(0, 20);
}

function cleanResultUrl(url) {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    return (parsed.searchParams.get("uddg") || parsed.href).replace(/^\/\//, "https://");
  } catch {
    return url;
  }
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function uniqueSources(sources) {
  const seen = new Set();
  const output = [];
  for (const source of sources) {
    const url = asText(source.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push({ title: asText(source.title) || url, url });
  }
  return output;
}

function asText(value) {
  return String(value || "").trim();
}

function wordsFromFilename(name) {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .trim();
}

function compactSentence(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
