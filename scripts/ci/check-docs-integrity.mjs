#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../..");

const ROOT_DOCUMENTS = ["README.md", "SECURITY.md", "CONTRIBUTING.md"];
const MARKDOWN_TREES = ["local-k8s", "examples"];
const README_TREES = ["backend", "packages"];

// These directories contain website copy, translations, dependencies, or generated
// artifacts. They are intentionally outside the non-website documentation contract.
const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".dart_tool",
  ".expo",
  ".git",
  ".gradle",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "docs",
  "generated",
  "i18n",
  "node_modules",
  "out",
  "output",
  "pods",
  "third_party",
  "vendor",
  "vendors",
]);

const README_FILE_NAME = /^README(?:[-_.].*)?\.md$/i;
const MARKDOWN_FILE_NAME = /\.md$/i;

const documents = collectDocuments();
const issues = [];
let checkedDocuments = 0;
let checkedLocalTargets = 0;
let checkedReferenceUses = 0;

for (const documentPath of documents) {
  checkDocument(documentPath);
}

issues.sort((left, right) =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.message.localeCompare(right.message),
);

if (issues.length > 0) {
  console.error("Broken documentation links found:");
  for (const issue of issues) {
    console.error(`  ${issue.file}:${issue.line}: ${issue.message}`);
  }
  console.error(
    `Checked ${checkedDocuments} Markdown files and ${checkedLocalTargets} local targets.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Documentation links OK (${checkedDocuments} files, ${checkedLocalTargets} local targets, ${checkedReferenceUses} reference uses).`,
  );
}

function collectDocuments() {
  const found = new Set();

  for (const relativePath of ROOT_DOCUMENTS) {
    addExistingFile(path.join(REPOSITORY_ROOT, relativePath), found);
  }

  for (const relativePath of MARKDOWN_TREES) {
    walkMarkdownTree(path.join(REPOSITORY_ROOT, relativePath), MARKDOWN_FILE_NAME, found);
  }

  for (const relativePath of README_TREES) {
    walkMarkdownTree(path.join(REPOSITORY_ROOT, relativePath), README_FILE_NAME, found);
  }

  return [...found].sort((left, right) => left.localeCompare(right));
}

function addExistingFile(absolutePath, found) {
  try {
    if (
      fs.statSync(absolutePath).isFile() &&
      !isIgnoredUntrackedPath(path.relative(REPOSITORY_ROOT, absolutePath))
    ) {
      found.add(absolutePath);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function walkMarkdownTree(directoryPath, acceptedFileName, found) {
  let entries;
  try {
    entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name.toLocaleLowerCase("en-US"))) {
        walkMarkdownTree(entryPath, acceptedFileName, found);
      }
      continue;
    }

    // Do not follow directory symlinks into dependency or generated trees. A
    // symlinked Markdown file is still a real, reviewable document and is included.
    if ((entry.isFile() || entry.isSymbolicLink()) && acceptedFileName.test(entry.name)) {
      addExistingFile(entryPath, found);
    }
  }
}

function checkDocument(documentPath) {
  let source;
  try {
    source = fs.readFileSync(documentPath, "utf8");
  } catch (error) {
    // A concurrently removed file is no longer part of the documentation set.
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
  checkedDocuments += 1;
  const relativeDocumentPath = toRepositoryPath(documentPath);
  const maskedMarkdown = maskNonProse(source);
  const lineStarts = getLineStarts(maskedMarkdown);
  const { definitions, definitionRanges, targets } = parseReferenceDefinitions(
    maskedMarkdown,
    lineStarts,
  );

  for (const target of targets) {
    checkTarget(documentPath, relativeDocumentPath, target.value, target.line);
  }

  const markdownWithoutDefinitions = maskRanges(maskedMarkdown, definitionRanges);
  scanInlineLinksAndReferences(
    markdownWithoutDefinitions,
    (target, index) => {
      checkTarget(
        documentPath,
        relativeDocumentPath,
        target,
        lineNumberAt(lineStarts, index),
      );
    },
    (label, index) => {
      checkedReferenceUses += 1;
      const normalizedLabel = normalizeReferenceLabel(label);
      if (normalizedLabel && !definitions.has(normalizedLabel) && !isTemplate(label)) {
        addIssue(
          relativeDocumentPath,
          lineNumberAt(lineStarts, index),
          `undefined reference link [${collapseWhitespace(label)}]`,
        );
      }
    },
  );
}

function maskNonProse(source) {
  let masked = maskFencedCode(source);
  masked = maskHtmlComments(masked);
  masked = maskInlineCode(masked);
  return masked;
}

function maskFencedCode(source) {
  const characters = source.split("");
  const lines = getLines(source);
  let fence = null;

  for (const line of lines) {
    const lineText = source.slice(line.start, line.contentEnd);
    if (fence === null) {
      const opening = lineText.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!opening) {
        continue;
      }
      fence = { character: opening[1][0], length: opening[1].length };
      maskCharacterRange(characters, line.start, line.end);
      continue;
    }

    const trimmed = lineText.replace(/^ {0,3}/, "");
    const run = countRun(trimmed, fence.character);
    maskCharacterRange(characters, line.start, line.end);
    if (run >= fence.length && trimmed.slice(run).trim() === "") {
      fence = null;
    }
  }

  return characters.join("");
}

function maskHtmlComments(source) {
  const characters = source.split("");
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const start = source.indexOf("<!--", searchFrom);
    if (start === -1) {
      break;
    }
    const closing = source.indexOf("-->", start + 4);
    const end = closing === -1 ? source.length : closing + 3;
    maskCharacterRange(characters, start, end);
    searchFrom = end;
  }
  return characters.join("");
}

function maskInlineCode(source) {
  const characters = source.split("");
  let index = 0;

  while (index < source.length) {
    if (source[index] !== "`") {
      index += 1;
      continue;
    }

    const delimiterLength = countRun(source.slice(index), "`");
    let closing = index + delimiterLength;
    while (closing < source.length) {
      closing = source.indexOf("`", closing);
      if (closing === -1) {
        break;
      }
      const closingLength = countRun(source.slice(closing), "`");
      if (closingLength === delimiterLength) {
        const end = closing + closingLength;
        maskCharacterRange(characters, index, end);
        index = end;
        break;
      }
      closing += closingLength;
    }

    if (closing === -1 || closing >= source.length) {
      index += delimiterLength;
    }
  }

  return characters.join("");
}

function parseReferenceDefinitions(markdown, lineStarts) {
  const definitions = new Map();
  const definitionRanges = [];
  const targets = [];
  const lines = getLines(markdown);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineText = markdown.slice(line.start, line.contentEnd);
    const match = lineText.match(/^ {0,3}\[((?:\\.|[^\\\]])+)\]:[ \t]*(.*)$/);
    if (!match || match[1].trimStart().startsWith("^")) {
      continue;
    }

    let destinationText = match[2];
    let finalLine = line;
    if (destinationText.trim() === "" && index + 1 < lines.length) {
      const continuation = lines[index + 1];
      const continuationText = markdown.slice(continuation.start, continuation.contentEnd);
      if (/^ {0,3}\S/.test(continuationText)) {
        destinationText = continuationText.replace(/^ {0,3}/, "");
        finalLine = continuation;
        index += 1;
      }
    }

    const target = extractDestination(destinationText);
    if (target === null) {
      continue;
    }

    const label = normalizeReferenceLabel(unescapeMarkdown(match[1]));
    if (label && !definitions.has(label)) {
      definitions.set(label, target);
    }
    targets.push({ value: target, line: lineNumberAt(lineStarts, line.start) });

    if (index + 1 < lines.length) {
      const possibleTitle = lines[index + 1];
      const possibleTitleText = markdown.slice(possibleTitle.start, possibleTitle.contentEnd);
      if (isStandaloneReferenceTitle(possibleTitleText)) {
        finalLine = possibleTitle;
        index += 1;
      }
    }
    definitionRanges.push({ start: line.start, end: finalLine.end });
  }

  return { definitions, definitionRanges, targets };
}

function isStandaloneReferenceTitle(line) {
  const trimmed = line.trim();
  if (trimmed.length < 2) {
    return false;
  }
  return (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("(") && trimmed.endsWith(")"))
  );
}

function scanInlineLinksAndReferences(
  markdown,
  onInlineTarget,
  onReference,
) {
  let index = 0;
  while (index < markdown.length) {
    if (markdown[index] !== "[" || isEscaped(markdown, index)) {
      index += 1;
      continue;
    }

    const labelEnd = findMatchingSquareBracket(markdown, index);
    if (labelEnd === -1) {
      index += 1;
      continue;
    }

    const label = markdown.slice(index + 1, labelEnd);
    const nextCharacter = markdown[labelEnd + 1];
    if (nextCharacter === "(") {
      const destinationEnd = findMatchingLinkParenthesis(markdown, labelEnd + 1);
      if (destinationEnd !== -1) {
        const rawDestination = markdown.slice(labelEnd + 2, destinationEnd);
        const destination = extractDestination(rawDestination);
        if (destination !== null) {
          onInlineTarget(destination, index);
        }
        index = destinationEnd + 1;
        continue;
      }
    } else if (nextCharacter === "[") {
      const referenceEnd = findClosingUnescapedBracket(markdown, labelEnd + 2);
      if (referenceEnd !== -1) {
        const explicitLabel = markdown.slice(labelEnd + 2, referenceEnd);
        const referenceLabel = explicitLabel === "" ? label : explicitLabel;
        onReference(unescapeMarkdown(referenceLabel), index);
        index = referenceEnd + 1;
        continue;
      }
    }

    // Shortcut references are deliberately not diagnosed: ordinary prose, task
    // checkboxes, citations, and framework syntax all use bare square brackets.
    // Full and collapsed references above are unambiguous and are checked.
    index = labelEnd + 1;
  }
}

function findMatchingSquareBracket(text, openingIndex) {
  let depth = 1;
  for (let index = openingIndex + 1; index < text.length; index += 1) {
    if (isEscaped(text, index)) {
      continue;
    }
    if (text[index] === "[") {
      depth += 1;
    } else if (text[index] === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function findClosingUnescapedBracket(text, startIndex) {
  for (let index = startIndex; index < text.length; index += 1) {
    if (text[index] === "]" && !isEscaped(text, index)) {
      return index;
    }
    if (text[index] === "\n" && text[index + 1] === "\n") {
      return -1;
    }
  }
  return -1;
}

function findMatchingLinkParenthesis(text, openingIndex) {
  let depth = 1;
  let inAngleDestination = false;
  let titleQuote = null;
  let afterDestination = false;

  for (let index = openingIndex + 1; index < text.length; index += 1) {
    const character = text[index];
    if (isEscaped(text, index)) {
      continue;
    }

    if (inAngleDestination) {
      if (character === ">") {
        inAngleDestination = false;
      }
      continue;
    }
    if (titleQuote !== null) {
      if (character === titleQuote) {
        titleQuote = null;
      }
      continue;
    }
    if (depth === 1 && !afterDestination && character === "<") {
      inAngleDestination = true;
      continue;
    }
    if (depth === 1 && /\s/.test(character)) {
      afterDestination = true;
      continue;
    }
    if (depth === 1 && afterDestination && (character === '"' || character === "'")) {
      titleQuote = character;
      continue;
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function extractDestination(rawDestination) {
  const value = rawDestination.trimStart();
  if (value === "") {
    return "";
  }

  if (value.startsWith("<")) {
    for (let index = 1; index < value.length; index += 1) {
      if (value[index] === ">" && !isEscaped(value, index)) {
        return value.slice(1, index);
      }
      if (value[index] === "\n") {
        return null;
      }
    }
    return null;
  }

  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (isEscaped(value, index)) {
      continue;
    }
    if (/\s/.test(character) && depth === 0) {
      return value.slice(0, index);
    }
    if (character === "(") {
      depth += 1;
    } else if (character === ")" && depth > 0) {
      depth -= 1;
    }
  }
  return value;
}

function checkTarget(documentPath, relativeDocumentPath, rawTarget, line) {
  const targetWithoutDecorators = stripQueryAndFragment(rawTarget.trim());
  if (shouldIgnoreTarget(targetWithoutDecorators)) {
    return;
  }

  let decodedTarget;
  try {
    decodedTarget = decodeURIComponent(
      decodeHtmlEntities(unescapeMarkdown(targetWithoutDecorators)),
    );
  } catch {
    addIssue(
      relativeDocumentPath,
      line,
      `invalid percent-encoding in local target ${JSON.stringify(rawTarget)}`,
    );
    return;
  }

  if (shouldIgnoreTarget(decodedTarget)) {
    return;
  }

  checkedLocalTargets += 1;
  const resolvedPath = path.resolve(path.dirname(documentPath), decodedTarget);
  const repositoryRelativePath = path.relative(REPOSITORY_ROOT, resolvedPath);
  if (
    repositoryRelativePath === ".." ||
    repositoryRelativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(repositoryRelativePath)
  ) {
    addIssue(
      relativeDocumentPath,
      line,
      `local target escapes the repository: ${JSON.stringify(rawTarget)}`,
    );
    return;
  }

  const pathProblem = inspectExactPath(repositoryRelativePath);
  if (pathProblem !== null) {
    addIssue(
      relativeDocumentPath,
      line,
      `${pathProblem}: ${JSON.stringify(rawTarget)}`,
    );
  }
}

function shouldIgnoreTarget(target) {
  if (target === "" || target.startsWith("#") || target.startsWith("?") || target.startsWith("/")) {
    return true;
  }
  if (target.startsWith("//") || /^www\./i.test(target)) {
    return true;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(target)) {
    return true;
  }
  return isTemplate(target);
}

function isTemplate(target) {
  return (
    /\{\{|\}\}|\$\{|<%|%>|<[^>]+>/.test(target) ||
    /(^|[/\\]):[A-Za-z_][\w-]*/.test(target) ||
    /\{[^{}]+\}/.test(target) ||
    /(^|[/\\])(?:\*{1,2}|\.\.\.)(?:[/\\]|$)/.test(target) ||
    /\[(?:[A-Z_][A-Z\d_-]*)\]/.test(target) ||
    /(^|[/\\])(?:YOUR|REPLACE_ME|PLACEHOLDER)[-_A-Z\d]*/i.test(target) ||
    /%[A-Za-z_][A-Za-z\d_]*%/.test(target)
  );
}

function stripQueryAndFragment(target) {
  for (let index = 0; index < target.length; index += 1) {
    if ((target[index] === "?" || target[index] === "#") && !isEscaped(target, index)) {
      return target.slice(0, index);
    }
  }
  return target;
}

function inspectExactPath(repositoryRelativePath) {
  if (repositoryRelativePath === "") {
    return null;
  }

  let currentPath = REPOSITORY_ROOT;
  for (const component of repositoryRelativePath.split(path.sep).filter(Boolean)) {
    let names;
    try {
      names = fs.readdirSync(currentPath);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        return `missing local target (resolved to ${toRepositoryPath(
          path.join(currentPath, component),
        )})`;
      }
      throw error;
    }

    if (!names.includes(component)) {
      const differentlyCasedName = names.find(
        (name) => name.toLocaleLowerCase("en-US") === component.toLocaleLowerCase("en-US"),
      );
      if (differentlyCasedName) {
        return `local target has incorrect case; expected ${JSON.stringify(
          differentlyCasedName,
        )} instead of ${JSON.stringify(component)}`;
      }
      return `missing local target (resolved to ${toRepositoryPath(
        path.join(currentPath, component),
      )})`;
    }
    currentPath = path.join(currentPath, component);
  }

  try {
    fs.statSync(currentPath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return `missing local target (resolved to ${toRepositoryPath(currentPath)})`;
    }
    throw error;
  }

  if (isIgnoredUntrackedPath(repositoryRelativePath)) {
    return `local target is ignored and will be missing from a clean checkout (resolved to ${toRepositoryPath(
      currentPath,
    )})`;
  }
  return null;
}

function isIgnoredUntrackedPath(repositoryRelativePath) {
  if (repositoryRelativePath === "") {
    return false;
  }

  const result = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--", repositoryRelativePath],
    {
      cwd: REPOSITORY_ROOT,
      stdio: "ignore",
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `git check-ignore failed for ${JSON.stringify(repositoryRelativePath)} with status ${result.status}`,
    );
  }
  return result.status === 0;
}

function parseLineEnd(source, start) {
  const newline = source.indexOf("\n", start);
  return newline === -1 ? source.length : newline + 1;
}

function getLines(source) {
  const lines = [];
  let start = 0;
  while (start < source.length) {
    const end = parseLineEnd(source, start);
    let contentEnd = end;
    if (source[contentEnd - 1] === "\n") {
      contentEnd -= 1;
    }
    if (source[contentEnd - 1] === "\r") {
      contentEnd -= 1;
    }
    lines.push({ start, contentEnd, end });
    start = end;
  }
  if (source.length === 0) {
    lines.push({ start: 0, contentEnd: 0, end: 0 });
  }
  return lines;
}

function getLineStarts(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineNumberAt(lineStarts, index) {
  let low = 0;
  let high = lineStarts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= index) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return Math.max(1, low);
}

function maskRanges(source, ranges) {
  const characters = source.split("");
  for (const range of ranges) {
    maskCharacterRange(characters, range.start, range.end);
  }
  return characters.join("");
}

function maskCharacterRange(characters, start, end) {
  for (let index = start; index < end; index += 1) {
    if (characters[index] !== "\n" && characters[index] !== "\r") {
      characters[index] = " ";
    }
  }
}

function countRun(value, character) {
  let count = 0;
  while (value[count] === character) {
    count += 1;
  }
  return count;
}

function isEscaped(value, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function unescapeMarkdown(value) {
  return value.replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
    "$1",
  );
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([\da-f]+);/gi, (_, hexadecimal) =>
      String.fromCodePoint(Number.parseInt(hexadecimal, 16)),
    );
}

function normalizeReferenceLabel(label) {
  return collapseWhitespace(label).toLocaleLowerCase("en-US");
}

function collapseWhitespace(value) {
  return value.trim().replace(/\s+/g, " ");
}

function addIssue(file, line, message) {
  issues.push({ file, line, message });
}

function toRepositoryPath(absolutePath) {
  return path.relative(REPOSITORY_ROOT, absolutePath).split(path.sep).join("/") || ".";
}
