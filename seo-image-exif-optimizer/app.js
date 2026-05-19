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
  factFormat: document.getElementById("factFormat"),
  factDimensions: document.getElementById("factDimensions"),
  factPixels: document.getElementById("factPixels"),
  factAspect: document.getElementById("factAspect"),
  existingMetadata: document.getElementById("existingMetadata"),
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

document.querySelectorAll('input[name="outputFormat"]').forEach((input) => {
  input.addEventListener("change", () => {
    state.outputBlob = null;
    state.outputName = "";
    els.downloadBtn.disabled = true;
    els.outputStatus.textContent = state.file ? "Ready" : "Waiting";
    updateOutputs();
  });
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
  if (!file.type.startsWith("image/") && !looksLikeImageName(file.name)) {
    showToast("Choose an image file.");
    return;
  }

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
  els.factFormat.textContent = imageTypeLabel(detectImageType(state.bytes, file.type, file.name), file.type, file.name);

  try {
    const info = await getImageInfo(file);
    els.factDimensions.textContent = `${info.width} x ${info.height}`;
    els.factPixels.textContent = `${(info.width * info.height / 1000000).toFixed(2)} MP`;
    els.factAspect.textContent = aspectRatio(info.width, info.height);
  } catch {
    els.factDimensions.textContent = "Browser decode failed";
    els.factPixels.textContent = "-";
    els.factAspect.textContent = "-";
  }

  renderExistingMetadata(readExistingMetadata(state.bytes, file.type, file.name));

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
    showToast("Choose an image first.");
    return;
  }

  const meta = collectMetadata();
  if (!meta.primaryKeyword && meta.keywords.length === 0) {
    showToast("Add at least one keyword.");
    return;
  }

  const outputFormat = getOutputFormat();
  const type = detectImageType(state.bytes, state.file.type, state.file.name);
  const sourceLabel = imageTypeLabel(type, state.file.type, state.file.name);
  let optimized;
  try {
    if (outputFormat === "webp") {
      optimized = await convertFileToImageBlob(state.file, "image/webp", 0.86);
    } else {
      if (type === "jpeg") {
        optimized = injectJpegExif(state.bytes, meta);
      } else if (type !== "unknown") {
        const jpegBytes = await convertFileToJpegBytes(state.file);
        optimized = injectJpegExif(jpegBytes, meta);
      } else {
        showToast("This image format is not supported by your browser.");
        return;
      }
    }
  } catch (error) {
    showToast(error.message || "Could not write image metadata.");
    return;
  }

  state.outputBlob = outputFormat === "webp" ? optimized : new Blob([optimized], { type: "image/jpeg" });
  state.outputName = buildSeoFilename(state.file.name, meta, outputFormat === "webp" ? "webp" : "jpg");

  els.downloadBtn.disabled = false;
  els.copyAltBtn.disabled = !meta.altText;
  els.outputStatus.textContent = "Optimized";
  els.filenameOutput.textContent = state.outputName;
  els.embeddedOutput.textContent =
    outputFormat === "webp"
      ? `Converted ${sourceLabel} to WebP`
      : type === "jpeg"
        ? "JPEG EXIF"
        : `Converted ${sourceLabel} to JPEG EXIF`;
  els.altOutput.textContent = meta.altText || "-";
  showToast(outputFormat === "webp" ? "WebP image created." : "Metadata embedded without changing image pixels.");
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
  els.filenameOutput.textContent = state.file ? buildSeoFilename(state.file.name, meta, getOutputFormat() === "webp" ? "webp" : "jpg") : "-";
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
  const blob = await convertFileToImageBlob(file, "image/jpeg", 0.92);
  return new Uint8Array(await blob.arrayBuffer());
}

async function convertFileToImageBlob(file, mimeType, quality) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  if (typeof bitmap.close === "function") bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error(`Could not convert this image to ${mimeType}.`));
      },
      mimeType,
      quality,
    );
  });
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

function detectImageType(bytes, mime, name = "") {
  if (bytes && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "png";
  if (bytes && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && hasAscii(bytes, 8, "WEBP")) return "webp";
  if (bytes && hasAscii(bytes, 4, "ftypavif")) return "avif";
  if (mime === "image/jpeg") return "jpeg";
  if (mime && mime.startsWith("image/")) return "image";
  if (looksLikeImageName(name)) return "image";
  return "unknown";
}

function imageTypeLabel(type, mime, name = "") {
  if (type === "jpeg") return "JPEG";
  if (type === "png") return "PNG";
  if (type === "webp") return "WebP";
  if (type === "avif") return "AVIF";
  if (mime?.startsWith("image/")) return mime.replace("image/", "").toUpperCase();
  const extension = String(name || "").match(/\.([a-z0-9]+)$/i)?.[1];
  if (extension) return extension.toUpperCase();
  return "image";
}

function readExistingMetadata(bytes, mime, name) {
  const type = detectImageType(bytes, mime, name);
  try {
    if (type === "jpeg") return readJpegMetadata(bytes);
    if (type === "png") return readPngMetadata(bytes);
    if (type === "webp") return readWebpMetadata(bytes);
  } catch {
    return [{ key: "Status", value: "Could not read metadata" }];
  }
  return [{ key: "Status", value: "No readable metadata parser for this format" }];
}

function renderExistingMetadata(items) {
  els.existingMetadata.innerHTML = "";
  const cleanItems = items.filter((item) => item.value);
  const rows = cleanItems.length ? cleanItems : [{ key: "Status", value: "No readable metadata found" }];

  for (const item of rows.slice(0, 18)) {
    const row = document.createElement("div");
    const key = document.createElement("dt");
    const value = document.createElement("dd");
    key.textContent = item.key;
    value.textContent = item.value;
    row.append(key, value);
    els.existingMetadata.appendChild(row);
  }
}

function readJpegMetadata(bytes) {
  const items = [];
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = readUint16(bytes, offset + 2);
    const start = offset + 4;
    const end = offset + 2 + length;
    if (end > bytes.length) break;

    if (marker === 0xe1 && hasAscii(bytes, start, "Exif\0\0")) {
      items.push(...readExifItems(bytes.slice(start + 6, end)));
    } else if (marker === 0xe1 && hasAscii(bytes, start, "http://ns.adobe.com/xap/1.0/\0")) {
      const xmpStart = start + "http://ns.adobe.com/xap/1.0/\0".length;
      items.push({ key: "XMP", value: compactSentence(latin1String(bytes, xmpStart, end)).slice(0, 260) });
    } else if (marker === 0xfe) {
      items.push({ key: "Comment", value: compactSentence(latin1String(bytes, start, end)) });
    }
    offset = end;
  }
  return uniqueMetadata(items);
}

function readExifItems(tiff) {
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return [];

  const read16 = (offset) => (little ? tiff[offset] | (tiff[offset + 1] << 8) : (tiff[offset] << 8) | tiff[offset + 1]);
  const read32 = (offset) =>
    little
      ? (tiff[offset] | (tiff[offset + 1] << 8) | (tiff[offset + 2] << 16) | (tiff[offset + 3] << 24)) >>> 0
      : ((tiff[offset] << 24) | (tiff[offset + 1] << 16) | (tiff[offset + 2] << 8) | tiff[offset + 3]) >>> 0;

  const tagNames = {
    0x010e: "Description",
    0x010f: "Camera",
    0x0110: "Model",
    0x0131: "Software",
    0x0132: "Date",
    0x013b: "Artist",
    0x8298: "Copyright",
    0x9c9b: "Title",
    0x9c9c: "Comment",
    0x9c9d: "Author",
    0x9c9e: "Keywords",
    0x9c9f: "Subject",
  };

  const items = [];
  const firstIfd = read32(4);
  readIfd(firstIfd, items);
  return items;

  function readIfd(ifdOffset, output) {
    if (!ifdOffset || ifdOffset + 2 > tiff.length) return;
    const count = read16(ifdOffset);
    for (let index = 0; index < count; index += 1) {
      const entry = ifdOffset + 2 + index * 12;
      if (entry + 12 > tiff.length) break;
      const tag = read16(entry);
      const type = read16(entry + 2);
      const countValue = read32(entry + 4);
      const totalSize = (tagTypeSize[type] || 1) * countValue;
      const valueOffset = totalSize <= 4 ? entry + 8 : read32(entry + 8);
      if (tagNames[tag]) {
        const value = readExifValue(tiff, valueOffset, totalSize, type, tag);
        if (value) output.push({ key: tagNames[tag], value });
      }
    }
  }
}

function readExifValue(tiff, offset, totalSize, type, tag) {
  if (offset < 0 || offset + totalSize > tiff.length) return "";
  const slice = tiff.slice(offset, offset + totalSize);
  if (tag >= 0x9c9b && tag <= 0x9c9f) return compactSentence(utf16LeString(slice).replace(/\0+$/g, ""));
  if (type === 2) return compactSentence(latin1String(slice, 0, slice.length).replace(/\0+$/g, ""));
  if (type === 1 || type === 7) return compactSentence(latin1String(slice, 0, slice.length).replace(/\0+$/g, ""));
  return "";
}

function readPngMetadata(bytes) {
  const items = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = latin1String(bytes, offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) break;

    if (type === "tEXt") {
      const zero = bytes.indexOf(0, start);
      if (zero > start && zero < end) {
        items.push({ key: latin1String(bytes, start, zero), value: compactSentence(latin1String(bytes, zero + 1, end)) });
      }
    } else if (type === "iTXt" || type === "zTXt") {
      items.push({ key: type, value: "Compressed or international text metadata present" });
    }

    offset = end + 4;
  }
  return uniqueMetadata(items);
}

function readWebpMetadata(bytes) {
  const items = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = latin1String(bytes, offset, offset + 4);
    const size = readUint32LE(bytes, offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > bytes.length) break;
    if (chunkType === "EXIF") items.push(...readExifItems(bytes.slice(start, end)));
    if (chunkType === "XMP ") items.push({ key: "XMP", value: compactSentence(latin1String(bytes, start, end)).slice(0, 260) });
    offset = end + (size % 2);
  }
  return uniqueMetadata(items);
}

function uniqueMetadata(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.key}:${item.value}`;
    if (!item.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function looksLikeImageName(name) {
  return /\.(avif|webp|heic|heif|bmp|gif|jpe?g|png|tiff?)$/i.test(String(name || ""));
}

function buildSeoFilename(originalName, meta, extension = "jpg") {
  const source = [meta.primaryKeyword, meta.title, meta.subject, wordsFromFilename(originalName)].find(Boolean) || "optimized-image";
  const slug = slugify(source).slice(0, 80) || "optimized-image";
  return `${slug}.${extension}`;
}

function getOutputFormat() {
  return document.querySelector('input[name="outputFormat"]:checked')?.value || "jpeg";
}

async function getImageInfo(file) {
  const bitmap = await createImageBitmap(file);
  const info = { width: bitmap.width, height: bitmap.height };
  if (typeof bitmap.close === "function") bitmap.close();
  return info;
}

function aspectRatio(width, height) {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
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

function readUint32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
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

function latin1String(bytes, start, end) {
  let value = "";
  for (let index = start; index < end; index += 1) {
    value += String.fromCharCode(bytes[index]);
  }
  return value;
}

function utf16LeString(bytes) {
  let value = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    value += String.fromCharCode(bytes[index] | (bytes[index + 1] << 8));
  }
  return value;
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
