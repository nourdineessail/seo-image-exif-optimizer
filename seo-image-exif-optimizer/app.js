"use strict";

const state = {
  file: null,
  bytes: null,
  outputBlob: null,
  outputName: "",
};

const els = {
  imageInput: document.getElementById("imageInput"),
  dropZone: document.getElementById("dropZone"),
  previewFrame: document.getElementById("previewFrame"),
  previewImage: document.getElementById("previewImage"),
  factName: document.getElementById("factName"),
  factType: document.getElementById("factType"),
  factSize: document.getElementById("factSize"),
  form: document.getElementById("metadataForm"),
  primaryKeyword: document.getElementById("primaryKeyword"),
  keywords: document.getElementById("keywords"),
  title: document.getElementById("title"),
  creator: document.getElementById("creator"),
  altText: document.getElementById("altText"),
  description: document.getElementById("description"),
  subject: document.getElementById("subject"),
  copyright: document.getElementById("copyright"),
  generateBtn: document.getElementById("generateBtn"),
  aiResearchBtn: document.getElementById("aiResearchBtn"),
  aiStatus: document.getElementById("aiStatus"),
  optimizeBtn: document.getElementById("optimizeBtn"),
  scorePill: document.getElementById("scorePill"),
  scoreDetail: document.getElementById("scoreDetail"),
  outputStatus: document.getElementById("outputStatus"),
  filenameOutput: document.getElementById("filenameOutput"),
  embeddedOutput: document.getElementById("embeddedOutput"),
  altOutput: document.getElementById("altOutput"),
  sourcesOutput: document.getElementById("sourcesOutput"),
  downloadBtn: document.getElementById("downloadBtn"),
  copyAltBtn: document.getElementById("copyAltBtn"),
};

const tagTypeSize = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  7: 1,
};

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

els.imageInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) loadFile(file);
});

["dragenter", "dragover"].forEach((name) => {
  els.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((name) => {
  els.dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("dragging");
  });
});

els.dropZone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file) loadFile(file);
});

els.generateBtn.addEventListener("click", () => {
  const meta = collectMetadata();
  const base = meta.primaryKeyword || wordsFromFilename(state.file?.name || "");
  if (!base) {
    showToast("Add a primary keyword first.");
    return;
  }

  const readable = titleCase(base);
  els.title.value = els.title.value || readable;
  els.subject.value = els.subject.value || readable;
  els.altText.value =
    els.altText.value || compactSentence(`${readable} image showing ${firstKeyword(meta.keywords) || base}`);
  els.description.value =
    els.description.value ||
    compactSentence(`${readable} with ${meta.keywords.join(", ") || "relevant visual details"} for search-friendly image indexing.`);

  updateScore();
  updateOutputs();
});

els.aiResearchBtn.addEventListener("click", async () => {
  await runAiResearch();
});

els.form.addEventListener("input", () => {
  updateScore();
  updateOutputs();
});

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await optimizeImage();
});

els.downloadBtn.addEventListener("click", () => {
  if (!state.outputBlob) return;
  const url = URL.createObjectURL(state.outputBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = state.outputName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

els.copyAltBtn.addEventListener("click", async () => {
  const altText = els.altText.value.trim();
  if (!altText) return;
  try {
    await navigator.clipboard.writeText(altText);
    showToast("Alt text copied.");
  } catch {
    showToast("Clipboard access is blocked in this browser.");
  }
});

async function loadFile(file) {
  state.file = file;
  state.bytes = new Uint8Array(await file.arrayBuffer());
  state.outputBlob = null;
  state.outputName = "";

  const objectUrl = URL.createObjectURL(file);
  els.previewImage.src = objectUrl;
  els.previewImage.onload = () => URL.revokeObjectURL(objectUrl);
  els.previewFrame.classList.add("has-image");

  els.factName.textContent = file.name;
  els.factType.textContent = file.type || "Unknown";
  els.factSize.textContent = formatBytes(file.size);

  if (!els.primaryKeyword.value.trim()) {
    els.primaryKeyword.value = wordsFromFilename(file.name);
  }

  els.downloadBtn.disabled = true;
  els.copyAltBtn.disabled = true;
  els.outputStatus.textContent = "Ready";
  updateScore();
  updateOutputs();
}

async function optimizeImage() {
  if (!state.file || !state.bytes) {
    showToast("Choose a JPEG or PNG first.");
    return;
  }

  const meta = collectMetadata();
  if (!meta.primaryKeyword && meta.keywords.length === 0) {
    showToast("Add at least one keyword.");
    return;
  }

  const type = detectImageType(state.bytes, state.file.type);
  let optimized;
  try {
    if (type === "jpeg") {
      optimized = injectJpegExif(state.bytes, meta);
    } else if (type === "png") {
      const jpegBytes = await convertFileToJpegBytes(state.file);
      optimized = injectJpegExif(jpegBytes, meta);
    } else {
      showToast("Only JPEG and PNG input is supported.");
      return;
    }
  } catch (error) {
    showToast(error.message || "Could not write image metadata.");
    return;
  }

  state.outputBlob = new Blob([optimized], { type: "image/jpeg" });
  state.outputName = buildSeoFilename(state.file.name, meta);

  els.downloadBtn.disabled = false;
  els.copyAltBtn.disabled = !meta.altText;
  els.outputStatus.textContent = "Optimized";
  els.filenameOutput.textContent = state.outputName;
  els.embeddedOutput.textContent = type === "png" ? "Converted PNG to JPEG EXIF" : "JPEG EXIF";
  els.altOutput.textContent = meta.altText || "-";
  showToast("Metadata embedded without changing image pixels.");
}

async function runAiResearch() {
  if (!state.file) {
    showToast("Choose an image first.");
    return;
  }

  const marketplaces = Array.from(document.querySelectorAll('input[name="marketplace"]:checked')).map((input) => input.value);
  if (marketplaces.length === 0) {
    showToast("Choose at least one marketplace.");
    return;
  }

  els.aiResearchBtn.disabled = true;
  els.aiStatus.textContent = "Analyzing image and searching marketplaces...";

  try {
    const imageDataUrl = await fileToJpegDataUrl(state.file, 1024, 0.86);
    const response = await fetch("/api/ai-keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageDataUrl,
        marketplaces,
        currentKeyword: els.primaryKeyword.value.trim(),
        currentTitle: els.title.value.trim(),
        originalName: state.file.name,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "AI research failed.");
    }

    applyAiSuggestions(result);
    renderSources(result.sources || []);
    els.aiStatus.textContent = result.note || (result.usedWebSearch ? "Marketplace keywords applied." : "Keyword suggestions applied.");
    showToast("AI keyword suggestions applied.");
  } catch (error) {
    els.aiStatus.textContent = error.message || "AI research failed.";
    showToast(error.message || "AI research failed.");
  } finally {
    els.aiResearchBtn.disabled = false;
  }
}

function applyAiSuggestions(result) {
  setField(els.primaryKeyword, result.primaryKeyword);
  setField(els.keywords, Array.isArray(result.keywords) ? result.keywords.join(", ") : result.keywords);
  setField(els.title, result.title);
  setField(els.altText, result.altText);
  setField(els.description, result.description);
  setField(els.subject, result.subject);
  setField(els.creator, result.creator);
  setField(els.copyright, result.copyright);
  updateScore();
  updateOutputs();
}

function setField(element, value) {
  const clean = String(value || "").trim();
  if (clean) element.value = clean;
}

function renderSources(sources) {
  els.sourcesOutput.innerHTML = "";
  if (!sources.length) {
    const item = document.createElement("li");
    item.textContent = "-";
    els.sourcesOutput.appendChild(item);
    return;
  }

  for (const source of sources.slice(0, 6)) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = source.title || source.url;
    item.appendChild(link);
    els.sourcesOutput.appendChild(item);
  }
}

function collectMetadata() {
  const primaryKeyword = els.primaryKeyword.value.trim();
  const keywordList = parseKeywords(els.keywords.value);
  const keywords = unique([primaryKeyword, ...keywordList].filter(Boolean));

  return {
    primaryKeyword,
    keywords,
    title: els.title.value.trim() || titleCase(primaryKeyword),
    altText: els.altText.value.trim(),
    description: els.description.value.trim(),
    subject: els.subject.value.trim() || primaryKeyword,
    creator: els.creator.value.trim(),
    copyright: els.copyright.value.trim(),
    software: "seo-image-exif-optimizer",
  };
}

function updateScore() {
  const meta = collectMetadata();
  const checks = [
    { label: "image", passed: Boolean(state.file) },
    { label: "keyword", passed: meta.keywords.length > 0 },
    { label: "title", passed: Boolean(meta.title) },
    { label: "alt text", passed: Boolean(meta.altText) },
    { label: "alt text 30-140 characters", passed: meta.altText.length >= 30 && meta.altText.length <= 140 },
    { label: "description", passed: Boolean(meta.description) },
    { label: "subject", passed: Boolean(meta.subject) },
    { label: "creator or brand", passed: Boolean(meta.creator) },
    { label: "12 or fewer keywords", passed: meta.keywords.length <= 12 },
  ];
  const passed = checks.filter((check) => check.passed).length;
  const missing = checks.filter((check) => !check.passed).map((check) => check.label);
  const score = Math.round((passed / checks.length) * 100);
  els.scorePill.textContent = `SEO score ${score}%`;
  els.scorePill.style.color = score >= 75 ? "var(--accent-strong)" : "var(--warning)";
  els.scoreDetail.textContent = missing.length ? `Missing: ${missing.join(", ")}` : "All recommended metadata fields are complete.";
  els.scoreDetail.classList.toggle("complete", missing.length === 0);
}

function updateOutputs() {
  const meta = collectMetadata();
  els.filenameOutput.textContent = state.file ? buildSeoFilename(state.file.name, meta) : "-";
  els.altOutput.textContent = meta.altText || "-";
  els.embeddedOutput.textContent = meta.keywords.length ? `${meta.keywords.length} keyword${meta.keywords.length === 1 ? "" : "s"} prepared` : "-";
}

function injectJpegExif(bytes, meta) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Invalid JPEG file.");
  }

  const exif = buildExifPayload(meta);
  if (exif.length + 2 > 0xffff) {
    throw new Error("Metadata is too large for a single JPEG EXIF segment.");
  }

  const segments = [];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = readUint16(bytes, offset + 2);
    const end = offset + 2 + length;
    if (end > bytes.length) break;

    const isExif = marker === 0xe1 && hasAscii(bytes, offset + 4, "Exif\0\0");
    if (!isExif) {
      segments.push(bytes.slice(offset, end));
    }
    offset = end;
  }

  const app1 = new Uint8Array(exif.length + 4);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  writeUint16(app1, 2, exif.length + 2);
  app1.set(exif, 4);

  return concatUint8([bytes.slice(0, 2), app1, ...segments, bytes.slice(offset)]);
}

async function convertFileToJpegBytes(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  if (typeof bitmap.close === "function") bitmap.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error("Could not convert this image to JPEG."));
      },
      "image/jpeg",
      0.92,
    );
  });

  return new Uint8Array(await blob.arrayBuffer());
}

async function fileToJpegDataUrl(file, maxSide, quality) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === "function") bitmap.close();

  return canvas.toDataURL("image/jpeg", quality);
}

function buildExifPayload(meta) {
  const entries = [
    asciiEntry(0x010e, meta.description || meta.altText || meta.title),
    asciiEntry(0x0131, meta.software),
    asciiEntry(0x0132, exifDate(new Date())),
    asciiEntry(0x013b, meta.creator),
    asciiEntry(0x8298, meta.copyright),
    xpEntry(0x9c9b, meta.title),
    xpEntry(0x9c9c, meta.description || meta.altText),
    xpEntry(0x9c9d, meta.creator),
    xpEntry(0x9c9e, meta.keywords.join("; ")),
    xpEntry(0x9c9f, meta.subject || meta.primaryKeyword),
  ].filter((entry) => entry.value.length > 0);

  entries.sort((a, b) => a.tag - b.tag);

  const ifdStart = 8;
  const entryCount = entries.length;
  const valuesStart = ifdStart + 2 + entryCount * 12 + 4;
  let valueOffset = valuesStart;

  for (const entry of entries) {
    const byteLength = entry.value.length;
    entry.count = byteLength / tagTypeSize[entry.type];
    if (byteLength > 4) {
      entry.offset = valueOffset;
      valueOffset += byteLength;
      if (valueOffset % 2) valueOffset += 1;
    }
  }

  const tiffLength = valueOffset;
  const tiff = new Uint8Array(tiffLength);
  tiff[0] = 0x49;
  tiff[1] = 0x49;
  writeUint16LE(tiff, 2, 42);
  writeUint32LE(tiff, 4, ifdStart);
  writeUint16LE(tiff, ifdStart, entryCount);

  let cursor = ifdStart + 2;
  for (const entry of entries) {
    writeUint16LE(tiff, cursor, entry.tag);
    writeUint16LE(tiff, cursor + 2, entry.type);
    writeUint32LE(tiff, cursor + 4, entry.count);
    if (entry.value.length <= 4) {
      tiff.set(entry.value, cursor + 8);
    } else {
      writeUint32LE(tiff, cursor + 8, entry.offset);
      tiff.set(entry.value, entry.offset);
    }
    cursor += 12;
  }
  writeUint32LE(tiff, cursor, 0);

  return concatUint8([asciiBytes("Exif\0\0"), tiff]);
}

function asciiEntry(tag, value) {
  const text = String(value || "").trim();
  return {
    tag,
    type: 2,
    value: text ? concatUint8([asciiBytes(text), new Uint8Array([0])]) : new Uint8Array(),
  };
}

function xpEntry(tag, value) {
  const text = String(value || "").trim();
  return {
    tag,
    type: 1,
    value: text ? utf16LeBytes(`${text}\0`) : new Uint8Array(),
  };
}

function injectPngText(bytes, meta) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) {
    throw new Error("Invalid PNG file.");
  }

  const chunks = [
    pngTextChunk("Title", meta.title),
    pngTextChunk("Subject", meta.subject || meta.primaryKeyword),
    pngTextChunk("Keywords", meta.keywords.join(", ")),
    pngTextChunk("Description", meta.description || meta.altText),
    pngTextChunk("Author", meta.creator),
    pngTextChunk("Copyright", meta.copyright),
    pngTextChunk("Software", meta.software),
  ].filter(Boolean);

  let offset = 8;
  if (offset + 8 > bytes.length) throw new Error("Invalid PNG chunks.");
  const ihdrLength = readUint32(bytes, offset);
  const ihdrEnd = offset + 12 + ihdrLength;
  if (!hasAscii(bytes, offset + 4, "IHDR") || ihdrEnd > bytes.length) {
    throw new Error("PNG missing IHDR chunk.");
  }

  return concatUint8([bytes.slice(0, ihdrEnd), ...chunks, bytes.slice(ihdrEnd)]);
}

function pngTextChunk(keyword, value) {
  const clean = String(value || "").trim();
  if (!clean) return null;

  const type = asciiBytes("tEXt");
  const data = concatUint8([latin1Bytes(keyword), new Uint8Array([0]), latin1Bytes(clean)]);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(concatUint8([type, data])));
  return chunk;
}

function detectImageType(bytes, mime) {
  if (bytes && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "png";
  if (mime === "image/jpeg") return "jpeg";
  if (mime === "image/png") return "png";
  return "unknown";
}

function buildSeoFilename(originalName, meta) {
  const source = [meta.primaryKeyword, meta.title, meta.subject, wordsFromFilename(originalName)].find(Boolean) || "optimized-image";
  const slug = slugify(source).slice(0, 80) || "optimized-image";
  return `${slug}.jpg`;
}

function parseKeywords(value) {
  return unique(
    String(value || "")
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function unique(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      output.push(item);
    }
  }
  return output;
}

function wordsFromFilename(name) {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstKeyword(keywords) {
  return keywords.find(Boolean) || "";
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

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function exifDate(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function asciiBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0x7f;
  }
  return bytes;
}

function latin1Bytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    bytes[index] = code <= 255 ? code : 63;
  }
  return bytes;
}

function utf16LeBytes(value) {
  const bytes = new Uint8Array(value.length * 2);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >>> 8;
  }
  return bytes;
}

function readUint16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function writeUint16(bytes, offset, value) {
  bytes[offset] = (value >>> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeUint16LE(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32LE(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function hasAscii(bytes, offset, text) {
  if (offset + text.length > bytes.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function concatUint8(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function showToast(message) {
  const oldToast = document.querySelector(".toast");
  if (oldToast) oldToast.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

updateScore();
updateOutputs();
