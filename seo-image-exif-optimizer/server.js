"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const preferredPort = Number(process.env.PORT || 4173);
const maxBodyBytes = 16 * 1024 * 1024;
const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
const ollamaModel = process.env.OLLAMA_MODEL || "llava";
let activePort = preferredPort;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/ai-keywords") {
      await handleKeywordResearch(req, res);
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error." });
  }
});

startServer(preferredPort);

function startServer(port, attempts = 0) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && !process.env.PORT && attempts < 10) {
      startServer(port + 1, attempts + 1);
      return;
    }

    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use.`);
      console.error("Use the existing server tab, stop the old process, or run with another port:");
      console.error("$env:PORT=4174; npm start");
      process.exit(1);
    }

    throw error;
  });

  activePort = port;
  server.listen(port, () => {
    console.log(`SEO Image EXIF Optimizer running at http://localhost:${port}`);
    console.log(`Free local AI mode: Ollama ${ollamaModel} at ${ollamaUrl}`);
  });
}

async function handleKeywordResearch(req, res) {
  const body = await readJsonBody(req);
  if (!body.imageDataUrl || !body.imageDataUrl.startsWith("data:image/")) {
    sendJson(res, 400, { error: "A JPEG/PNG image data URL is required." });
    return;
  }

  const domains = resolveDomains(body.marketplaces);
  const imageBase64 = body.imageDataUrl.split(",")[1] || "";
  const imageAnalysis = await identifyWithLocalAi(imageBase64).catch(() => null);
  const seed = chooseSearchSeed(body, imageAnalysis);
  const searchResults = await searchMarketplaceKeywords(seed, domains);
  const suggestion = buildSuggestion(body, imageAnalysis, searchResults, seed);

  sendJson(res, 200, {
    ...suggestion,
    sources: searchResults.sources,
    usedLocalAi: Boolean(imageAnalysis),
    usedWebSearch: searchResults.sources.length > 0,
    note: imageAnalysis
      ? `Used local Ollama model ${ollamaModel}.`
      : `Ollama was not available, so keywords were based on your current text and marketplace search.`,
  });
}

async function identifyWithLocalAi(imageBase64) {
  const response = await fetch(`${ollamaUrl.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      stream: false,
      format: "json",
      prompt:
        "Identify the retail product in this image. Return only JSON with keys: brand, productType, color, shade, visibleText, primaryKeyword, keywords. Keep keywords short ecommerce phrases.",
      images: [imageBase64],
    }),
  });

  if (!response.ok) {
    throw new Error("Local AI model is not available.");
  }

  const payload = await response.json();
  return parseJsonObject(payload.response || "{}");
}

function chooseSearchSeed(body, imageAnalysis) {
  return (
    asText(imageAnalysis?.primaryKeyword) ||
    [imageAnalysis?.brand, imageAnalysis?.productType, imageAnalysis?.shade].map(asText).filter(Boolean).join(" ") ||
    asText(body.currentKeyword) ||
    asText(body.currentTitle) ||
    wordsFromFilename(body.originalName) ||
    "product"
  );
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
  const html = await response.text();
  return parseDuckDuckGoResults(html);
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

function buildSuggestion(body, imageAnalysis, searchResults, seed) {
  const aiKeywords = asStringArray(imageAnalysis?.keywords);
  const baseTerms = [
    seed,
    imageAnalysis?.brand,
    imageAnalysis?.productType,
    imageAnalysis?.shade,
    imageAnalysis?.color,
    ...aiKeywords,
    ...searchResults.candidates,
  ];
  const keywords = uniqueCleanKeywords(baseTerms).slice(0, 12);
  const primaryKeyword = keywords[0] || seed;
  const brand = asText(imageAnalysis?.brand);
  const productType = asText(imageAnalysis?.productType) || primaryKeyword;
  const shade = asText(imageAnalysis?.shade || imageAnalysis?.color);
  const title = titleCase([brand, shade, productType].filter(Boolean).join(" ") || primaryKeyword);
  const altText = compactSentence(`${title} product image`.slice(0, 135));
  const description = compactSentence(`${title} with ecommerce keywords including ${keywords.slice(0, 5).join(", ")}.`);

  return {
    primaryKeyword,
    keywords,
    title,
    altText,
    description,
    subject: titleCase(productType),
    creator: brand,
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

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://localhost:${activePort}`).pathname);
  const safePath = path
    .normalize(urlPath)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");
  const filePath = path.join(root, safePath || "index.html");

  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON request body."));
      }
    });
    req.on("error", reject);
  });
}

function parseJsonObject(text) {
  const clean = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  return JSON.parse(clean.slice(start, end + 1));
}

function parseDuckDuckGoRedirect(url) {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    return parsed.searchParams.get("uddg") || parsed.href;
  } catch {
    return url;
  }
}

function cleanResultUrl(url) {
  return parseDuckDuckGoRedirect(url).replace(/^\/\//, "https://");
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

function asStringArray(value) {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean);
  return String(value || "")
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
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
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}
