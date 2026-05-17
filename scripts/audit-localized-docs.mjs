import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const docsRoot = path.join(repoRoot, "docs");
const i18nRoot = path.join(docsRoot, "i18n");

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

async function listLocales() {
  const entries = await fs.readdir(i18nRoot, { withFileTypes: true });
  const localeFilter = new Set(
    (process.env.LOCALES ?? "")
      .split(",")
      .map((locale) => locale.trim())
      .filter(Boolean),
  );

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((locale) => localeFilter.size === 0 || localeFilter.has(locale))
    .sort();
}

function stripRawMarkdown(value) {
  return value
    .replace(/^[ \t>]*```[\s\S]*?^[ \t>]*```[ \t]*$/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*-{3,}\s*$/gm, "");
}

function codeFences(value) {
  return [...value.matchAll(/^[ \t>]*```[\s\S]*?^[ \t>]*```[ \t]*$/gm)].map((match) => match[0]);
}

function htmlComments(value) {
  return [...value.matchAll(/<!--[\s\S]*?-->/g)].map((match) => match[0]);
}

function headingLevels(value) {
  return stripRawMarkdown(value)
    .split("\n")
    .map((line) => line.match(/^\s*(#{1,6})\s+/)?.[1].length)
    .filter(Boolean);
}

function linkTargets(value) {
  return [...stripRawMarkdown(value).matchAll(/\[[^\]\n]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
    .map((match) => match[1])
    .sort();
}

function inlineCodes(value) {
  return [...new Set([...stripRawMarkdown(value).matchAll(/`([^`\n]+)`/g)].map((match) => match[1]))].sort();
}

function tableSeparatorCount(value) {
  return stripRawMarkdown(value)
    .split("\n")
    .filter((line) => /^\s*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)+\|?\s*$/.test(line))
    .length;
}

function hasBadBoldEdgeSpace(value) {
  for (const line of stripRawMarkdown(value).split("\n")) {
    let open = false;
    for (let index = 0; index < line.length - 1; index += 1) {
      if (line[index] !== "*" || line[index + 1] !== "*") continue;

      if (!open) {
        if (/\s/.test(line[index + 2] ?? "")) return true;
        open = true;
      } else {
        if (/\s/.test(line[index - 1] ?? "")) return true;
        open = false;
      }

      index += 1;
    }
  }

  return false;
}

function sameList(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function collectIssues(source, localized) {
  const sourceClean = stripRawMarkdown(source);
  const localizedClean = stripRawMarkdown(localized);
  const issues = [];

  if (/ZXQJ|RJLBRK|आरजेएलबीआरके|РДЖЛБРК/.test(localized)) {
    issues.push("placeholder leak");
  }
  if (/\]\s+\(/.test(localizedClean)) {
    issues.push("broken markdown link spacing");
  }
  if (/^\s*#\s+#/m.test(localizedClean) || /^\s*##\s+#/m.test(localizedClean)) {
    issues.push("double heading marker");
  }
  if (/^(#{1,6})(?!#)\S/m.test(localizedClean)) {
    issues.push("heading missing space");
  }
  if (/^\s*(?:[-+]\S|\d+\.\S|\*(?!\*)\S)/m.test(localizedClean)) {
    issues.push("list marker missing space");
  }
  if (
    /\[\s*!\s*(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\s*\]/i.test(localizedClean)
    && !/\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/.test(localizedClean)
  ) {
    issues.push("alert marker spacing changed");
  }
  if (hasBadBoldEdgeSpace(localized)) {
    issues.push("bold marker has inner edge space");
  }
  if (!sameList(codeFences(source), codeFences(localized))) {
    issues.push("code fence changed");
  }
  if (!sameList(htmlComments(source), htmlComments(localized))) {
    issues.push("html comment changed");
  }
  if (!sameList(headingLevels(source), headingLevels(localized))) {
    issues.push("heading levels differ");
  }
  if (!sameList(linkTargets(source), linkTargets(localized))) {
    issues.push("link targets differ");
  }
  if (!sameList(inlineCodes(source), inlineCodes(localized))) {
    issues.push("inline code differs");
  }
  if (tableSeparatorCount(sourceClean) !== tableSeparatorCount(localizedClean)) {
    issues.push("table separator count differs");
  }

  return issues;
}

async function main() {
  const markdownFiles = filterMarkdownFiles(await walkMarkdownFiles(docsRoot));
  const locales = await listLocales();
  const issues = [];

  for (const locale of locales) {
    for (const sourcePath of markdownFiles) {
      const relativePath = path.relative(docsRoot, sourcePath);
      const localizedPath = path.join(i18nRoot, locale, relativePath);
      let localized;

      try {
        localized = await fs.readFile(localizedPath, "utf8");
      } catch {
        issues.push(`${locale}/${relativePath}: missing localized file`);
        continue;
      }

      const source = await fs.readFile(sourcePath, "utf8");
      for (const issue of collectIssues(source, localized)) {
        issues.push(`${locale}/${relativePath}: ${issue}`);
      }
    }
  }

  if (issues.length > 0) {
    console.error(issues.join("\n"));
    process.exit(1);
  }

  console.log(`Localized docs audit passed for ${locales.length} locales and ${markdownFiles.length} docs.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
