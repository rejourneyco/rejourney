import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const docsRoot = path.join(repoRoot, "docs");

const locales = [
  ["ar", "ar"],
  ["es", "es"],
  ["tr", "tr"],
  ["pt-br", "pt"],
  ["de", "de"],
  ["fr", "fr"],
  ["hi", "hi"],
  ["id", "id"],
  ["ja", "ja"],
  ["ko", "ko"],
  ["zh-cn", "zh-CN"],
  ["it", "it"],
  ["nl", "nl"],
  ["pl", "pl"],
  ["pt", "pt"],
  ["ru", "ru"],
  ["vi", "vi"],
];

const glossary = [
  "Rejourney",
  "React Native",
  "React Navigation",
  "NavigationContainer",
  "Expo Router",
  "Expo",
  "SwiftUI",
  "Swift Package Manager",
  "Swift Package",
  "Swift",
  "iOS",
  "Android",
  "SDK",
  "API",
  "ANR",
  "ANRs",
  "GDPR",
  "PII",
  "Docker Desktop",
  "Docker Compose",
  "Compose",
  "Docker",
  "Kubernetes",
  "K3s",
  "k8s",
  "local-k8s",
  "PostgreSQL",
  "Postgres",
  "ClickHouse",
  "Redis",
  "MinIO",
  "S3-compatible",
  "S3",
  "AWS",
  "Stripe",
  "GitHub Actions",
  "GitHub",
  "CI/CD",
  "Cursor",
  "Claude",
  "ChatGPT",
  "AI",
  "Xcode",
  "Node.js",
  "npm",
  "pnpm",
  "Yarn",
  "yarn",
  "kubectl",
  "k3d",
  "Android Studio",
  "JDK",
  "Cloudflare Turnstile",
  "Cloudflare",
  "Turnstile",
  "Better Auth",
  "Traefik",
  "Prometheus",
  "Grafana",
  "OpenTelemetry",
  "TypeScript",
  "JavaScript",
  "Objective-C",
  "Let's Encrypt",
  "Let’s Encrypt",
  "WebSocket",
  "TLS",
  "DNS",
  "HTTP",
  "HTTPS",
  "VPS",
  "Ubuntu",
  "Debian",
  "Linux",
  "bash",
  "UserDefaults",
  "SPM",
  "CocoaPods",
];

const tokenPrefix = "ZXQJPH";
const tokenSuffix = "QXZ";
const translationCache = new Map();

function tokenForIndex(index) {
  return `${tokenPrefix}${String(index).padStart(5, "0")}${tokenSuffix}`;
}

function tokenPatternForIndex(index) {
  return new RegExp(`Z\\s*X\\s*Q\\s*J\\s*P+\\s*H\\s*0*${index}\\s*Q\\s*X\\s*Z?`, "gi");
}

function restoreIndexedToken(value, index, replacement) {
  return value.replaceAll(tokenForIndex(index), replacement).replace(tokenPatternForIndex(index), replacement);
}

async function walkMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(docsRoot, fullPath);
    if (relativePath.startsWith(`i18n${path.sep}`)) continue;
    if (entry.isDirectory()) {
      files.push(...await walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function normalizeDocPath(value) {
  return value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^docs\//, "")
    .replace(/^\/+/, "");
}

function envList(name) {
  return (process.env[name] ?? "")
    .split(",")
    .map(normalizeDocPath)
    .filter(Boolean);
}

function filterMarkdownFiles(markdownFiles) {
  const docFilter = new Set(envList("DOCS"));
  if (docFilter.size === 0) {
    return markdownFiles;
  }

  const filtered = markdownFiles.filter((file) => {
    const relativePath = path.relative(docsRoot, file).split(path.sep).join("/");
    return docFilter.has(relativePath);
  });

  const found = new Set(filtered.map((file) => path.relative(docsRoot, file).split(path.sep).join("/")));
  const missing = [...docFilter].filter((docPath) => !found.has(docPath));
  if (missing.length > 0) {
    throw new Error(`DOCS filter did not match: ${missing.join(", ")}`);
  }

  return filtered;
}

function makeProtector() {
  const protectedValues = [];
  const protect = (value) => {
    const token = tokenForIndex(protectedValues.length);
    protectedValues.push(value);
    return token;
  };

  const restore = (value) => protectedValues.reduce((result, original, index) => {
    return restoreIndexedToken(result, index, original);
  }, value);

  return { protect, restore };
}

function protectMarkdown(content) {
  const { protect, restore } = makeProtector();
  let next = content;

  next = next.replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/g, (match) => protect(match));
  next = next.replace(/`[^`\n]+`/g, (match) => protect(match));
  next = next.replace(/https?:\/\/[^\s)>"']+/g, (match) => protect(match));
  next = next.replace(/mailto:[^\s)>"']+/g, (match) => protect(match));
  next = next.replace(/(\]\()([^)\s]+)(\))/g, (_match, before, url, after) => `${before}${protect(url)}${after}`);

  for (const term of [...glossary].sort((a, b) => b.length - a.length)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "g"), (match) => protect(match));
  }

  return { protectedContent: next, restore };
}

function splitRawMarkdownBlocks(content) {
  const rawBlockPattern = /(^[ \t>]*```[\s\S]*?^[ \t>]*```[ \t]*$|<!--[\s\S]*?-->|^[ \t]*(?:\|?[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$)/gm;
  const segments = [];
  let lastIndex = 0;

  for (const match of content.matchAll(rawBlockPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: content.slice(lastIndex, index) });
    }
    segments.push({ type: "raw", value: match[0] });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }

  return segments;
}

function splitLinesIntoChunks(content, maxLength = 3600) {
  const newlineToken = "ZXQJBRKZXQ";
  const blocks = content.split("\n");
  const chunks = [];
  let current = [];
  let currentLength = 0;

  for (const block of blocks) {
    const blockLength = block.length + (current.length > 0 ? newlineToken.length + 2 : 0);
    if (current.length > 0 && currentLength + blockLength > maxLength) {
      chunks.push(current.join(`\n${newlineToken}\n`));
      current = [];
      currentLength = 0;
    }

    if (block.length > maxLength) {
      for (let index = 0; index < block.length; index += maxLength) {
        const slice = block.slice(index, index + maxLength);
        if (current.length > 0) {
          chunks.push(current.join(`\n${newlineToken}\n`));
          current = [];
          currentLength = 0;
        }
        chunks.push(slice);
      }
    } else {
      current.push(block);
      currentLength += blockLength;
    }
  }

  if (current.length > 0) chunks.push(current.join(`\n${newlineToken}\n`));
  return { chunks, newlineToken };
}

async function translateChunk(text, targetLanguage, attempt = 1) {
  const cacheKey = `${targetLanguage}\n${text}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "en");
  url.searchParams.set("tl", targetLanguage);
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);

  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      return translateChunk(text, targetLanguage, attempt + 1);
    }
    throw error;
  }

  if (!response.ok) {
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      return translateChunk(text, targetLanguage, attempt + 1);
    }
    throw new Error(`Translate failed (${response.status}) for ${targetLanguage}`);
  }

  const payload = await response.json();
  const translated = payload[0].map((part) => part[0]).join("");
  translationCache.set(cacheKey, translated);
  return translated;
}

async function translateInlineText(text, targetLanguage) {
  if (!text.trim()) return text;
  const { protectedContent, restore } = protectMarkdown(text);
  return repairMarkdownFormatting(restore(await translateChunk(protectedContent, targetLanguage)));
}

function lastChar(value) {
  const chars = Array.from(value);
  return chars[chars.length - 1] ?? "";
}

function normalizeBoldMarkdown(value) {
  return value.split("\n").map((line) => {
    const segments = [];
    let lastIndex = 0;
    for (const match of line.matchAll(/\*\*([^*\n]+)\*\*/g)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        segments.push({ type: "text", value: line.slice(lastIndex, index) });
      }
      segments.push({ type: "bold", value: `**${match[1].trim()}**` });
      lastIndex = index + match[0].length;
    }
    if (lastIndex < line.length) {
      segments.push({ type: "text", value: line.slice(lastIndex) });
    }
    if (segments.length === 0) return line;

    let result = "";
    let previousType = "";
    for (const segment of segments) {
      const nextValue = segment.value;
      const previousChar = lastChar(result);
      const nextChar = Array.from(nextValue)[0] ?? "";
      const shouldSeparate = result.length > 0
        && nextValue.length > 0
        && !/\s/.test(previousChar)
        && !/\s/.test(nextChar)
        && !/^[.,;:!?،؛)\]}]/u.test(nextChar)
        && !/[(\[{/]$/.test(previousChar)
        && (segment.type === "bold" || (previousType === "bold" && /^[\p{L}\p{N}_]/u.test(nextChar)));

      result += `${shouldSeparate ? " " : ""}${nextValue}`;
      previousType = segment.type;
    }

    return result;
  }).join("\n");
}

function inlineCodeValues(value) {
  return [...value.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

function restoreMissingInlineCodes(translated, source, targetLanguage) {
  const sourceCodes = inlineCodeValues(source);
  if (sourceCodes.length === 0) return translated;

  const translatedCodes = new Set(inlineCodeValues(translated));
  const missingCodes = sourceCodes.filter((code) => !translatedCodes.has(code));
  if (missingCodes.length === 0) return translated;

  const separator = targetLanguage === "ar" ? "، " : ", ";
  const missingText = missingCodes.map((code) => `\`${code}\``).join(separator);
  const trimmed = translated
    .trimEnd()
    .replace(/([:：])[,،]\s*$/u, "$1")
    .replace(/(:\*\*)[,،]\s*$/u, "$1")
    .replace(/[,،]\s*$/u, "");
  const joiner = /(?:[:：]\s*|[:：]\*\*)$/u.test(trimmed) ? " " : separator;
  return `${trimmed}${joiner}${missingText}`;
}

function repairMarkdownFormatting(value) {
  const repaired = value
    .replace(/([^\n])(\s*> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])/g, "$1\n$2")
    .replace(/^(#{1,6}(?:[ \t]+#)+)[ \t]*/gm, (_match, marker) => `${marker.replace(/[ \t]+/g, "")} `)
    .replace(/^(#{1,6})(?!#)(?=\S)/gm, "$1 ")
    .replace(/^([ \t>]*[-+])(?=\S)/gm, "$1 ")
    .replace(/^([ \t>]*\*)(?!\*)(?=\S)/gm, "$1 ")
    .replace(/^([ \t>]*\d+\.)(?=\S)/gm, "$1 ")
    .replace(/^([ \t>]*>)(?=\S)/gm, "$1 ")
    .replace(/^([ \t>]*(?:(?:[-*+]|\d+\.)\s+)?)(?:\*\s+\*)(?=\S)/gm, "$1**")
    .replace(/\]\s+\(/g, "](");

  return normalizeBoldMarkdown(repaired);
}

function repairMarkdownTextSegments(content) {
  return splitRawMarkdownBlocks(content)
    .map((segment) => segment.type === "raw" ? segment.value : repairMarkdownFormatting(segment.value))
    .join("");
}

async function translateTextSegment(content, targetLanguage) {
  if (!content.trim()) return content;

  const lineEntries = content.split("\n").map((line) => {
    let prefix = "";
    let body = line;
    const quotePrefix = body.match(/^((?:[ \t]*>\s*)+)/);
    if (quotePrefix) {
      prefix += quotePrefix[1];
      body = body.slice(quotePrefix[1].length);
    }

    const structuralPrefix = body.match(/^([ \t]*(?:#{1,6}|[-*+]|\d+\.)\s+)(.*)$/);
    if (structuralPrefix) {
      prefix += structuralPrefix[1];
      body = structuralPrefix[2];
    }

    return { prefix, body };
  });
  const translatableIndexes = lineEntries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.body.trim().length > 0);

  if (translatableIndexes.length === 0) return content;

  const translateLine = async (line) => {
    const boldSpans = [];
    const lineWithBoldTokens = line.replace(/\*\*([^*\n]+)\*\*/g, (_match, inner) => {
      const index = 90000 + boldSpans.length;
      boldSpans.push({ index, inner });
      return tokenForIndex(index);
    });
    let translated = await translateInlineText(lineWithBoldTokens, targetLanguage);

    const translatedBoldSpans = await Promise.all(boldSpans.map(async ({ index, inner }) => ({
      index,
      value: `**${(await translateInlineText(inner, targetLanguage)).trim()}**`,
    })));

    for (const { index, value } of translatedBoldSpans) {
      translated = restoreIndexedToken(translated, index, value);
    }

    return repairMarkdownFormatting(restoreMissingInlineCodes(translated, line, targetLanguage));
  };

  const translatedLines = [];
  const concurrency = 4;
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, translatableIndexes.length) }, async () => {
    while (nextIndex < translatableIndexes.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      translatedLines[currentIndex] = await translateLine(translatableIndexes[currentIndex].entry.body);
    }
  }));

  translatableIndexes.forEach(({ index }, translatedIndex) => {
    lineEntries[index].body = translatedLines[translatedIndex] ?? lineEntries[index].body;
  });

  return repairMarkdownFormatting(lineEntries.map(({ prefix, body }) => `${prefix}${body}`).join("\n"));
}

async function translateMarkdown(content, targetLanguage) {
  const segments = splitRawMarkdownBlocks(content);
  const translatedSegments = [];

  for (const segment of segments) {
    translatedSegments.push(
      segment.type === "raw"
        ? segment.value
        : await translateTextSegment(segment.value, targetLanguage),
    );
  }

  return repairMarkdownTextSegments(translatedSegments.join(""));
}

async function main() {
  const markdownFiles = filterMarkdownFiles(await walkMarkdownFiles(docsRoot));
  const localeFilter = new Set(
    (process.env.LOCALES ?? "")
      .split(",")
      .map((locale) => locale.trim())
      .filter(Boolean),
  );
  const selectedLocales = localeFilter.size > 0
    ? locales.filter(([locale]) => localeFilter.has(locale))
    : locales;

  console.log(`Localizing ${markdownFiles.length} markdown docs into ${selectedLocales.length} locales.`);
  if (process.env.DOCS) {
    console.log(`DOCS=${markdownFiles.map((file) => path.relative(docsRoot, file).split(path.sep).join("/")).join(",")}`);
  }

  for (const [locale, targetLanguage] of selectedLocales) {
    for (const sourcePath of markdownFiles) {
      const relativePath = path.relative(docsRoot, sourcePath);
      const targetPath = path.join(docsRoot, "i18n", locale, relativePath);
      const source = await fs.readFile(sourcePath, "utf8");
      const translated = repairMarkdownTextSegments(await translateMarkdown(source, targetLanguage));
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, translated, "utf8");
      console.log(`${locale}: ${relativePath}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
