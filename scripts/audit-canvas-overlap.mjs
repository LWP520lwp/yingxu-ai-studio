import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const upstreamRoot = args.get("--upstream-root");
if (!upstreamRoot) {
  console.error(
    "Usage: node scripts/audit-canvas-overlap.mjs --upstream-root <checkout> [--upstream-subdir web/src] [--local-root apps/canvas-engine/src]",
  );
  process.exit(2);
}

const workspace = process.cwd();
const upstreamSource = path.resolve(
  upstreamRoot,
  args.get("--upstream-subdir") ?? "web/src",
);
const localSource = path.resolve(
  workspace,
  args.get("--local-root") ?? "apps/canvas-engine/src",
);
const upstreamRevision = execFileSync(
  "git",
  ["-C", upstreamRoot, "rev-parse", "HEAD"],
  { encoding: "utf8" },
).trim();
const requireFromCanvas = createRequire(
  path.resolve(workspace, "apps/canvas-engine/package.json"),
);
const ts = requireFromCanvas("typescript");
const extensions = new Set([".ts", ".tsx", ".js", ".jsx", ".css"]);

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    if (!extensions.has(path.extname(entry.name))) return [];
    return [fullPath];
  });
}

function relativePath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function normalizedLines(contents) {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function countLines(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

function sharedCount(leftCounts, rightCounts) {
  let count = 0;
  for (const [line, occurrences] of leftCounts) {
    count += Math.min(occurrences, rightCounts.get(line) ?? 0);
  }
  return count;
}

function digest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function pageCallbacks(root, sourcePath) {
  const file = path.resolve(root, sourcePath);
  const contents = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const callbacks = new Map();

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "InfiniteCanvasPage" &&
      node.body
    ) {
      for (const statement of node.body.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (
            !ts.isIdentifier(declaration.name) ||
            !declaration.initializer ||
            !ts.isCallExpression(declaration.initializer) ||
            declaration.initializer.expression.getText(source) !== "useCallback"
          ) {
            continue;
          }
          const start = source.getLineAndCharacterOfPosition(
            statement.getStart(source),
          ).line;
          const end = source.getLineAndCharacterOfPosition(statement.end).line;
          callbacks.set(
            declaration.name.text,
            normalizedLines(contents.split(/\r?\n/).slice(start, end + 1).join("\n")),
          );
        }
      }
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return callbacks;
}

const upstreamFiles = listSourceFiles(upstreamSource);
const localFiles = listSourceFiles(localSource).filter(
  (file) => !/\.(test|spec)\.[^.]+$/.test(file),
);
const upstreamByPath = new Map(
  upstreamFiles.map((file) => [relativePath(upstreamSource, file), file]),
);
const upstreamLineLists = new Map(
  upstreamFiles.map((file) => [
    relativePath(upstreamSource, file),
    normalizedLines(readFileSync(file, "utf8")),
  ]),
);
const upstreamCorpusLines = [...upstreamLineLists.values()].flat();
const upstreamCorpus = countLines(upstreamCorpusLines);
const upstreamUniqueLines = new Set(upstreamCorpusLines);

let exactMatches = 0;
let samePathPairs = 0;
let samePathShared = 0;
let samePathUnion = 0;
let samePathCurrentLines = 0;
let samePathUniqueShared = 0;
let samePathUniqueUnion = 0;
let samePathCurrentUniqueLines = 0;
let currentLines = 0;
let crossPathShared = 0;
const localUniqueLines = new Set();
const fileResults = [];

for (const localFile of localFiles) {
  const localBytes = readFileSync(localFile);
  const localCounts = countLines(normalizedLines(localBytes.toString("utf8")));
  const localUnique = new Set(localCounts.keys());
  for (const line of localUnique) localUniqueLines.add(line);
  const localLineCount = [...localCounts.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const upstreamFile = upstreamByPath.get(relativePath(localSource, localFile));
  currentLines += localLineCount;
  crossPathShared += sharedCount(localCounts, upstreamCorpus);

  if (!upstreamFile) continue;
  samePathPairs += 1;
  const upstreamBytes = readFileSync(upstreamFile);
  if (digest(localBytes) === digest(upstreamBytes)) exactMatches += 1;

  const upstreamCounts = countLines(
    upstreamLineLists.get(relativePath(localSource, localFile)),
  );
  const upstreamUnique = new Set(upstreamCounts.keys());
  const shared = sharedCount(localCounts, upstreamCounts);
  const upstreamLineCount = [...upstreamCounts.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  samePathShared += shared;
  samePathCurrentLines += localLineCount;
  samePathUnion += localLineCount + upstreamLineCount - shared;
  const uniqueShared = [...localUnique].filter((line) => upstreamUnique.has(line)).length;
  samePathUniqueShared += uniqueShared;
  samePathCurrentUniqueLines += localUnique.size;
  samePathUniqueUnion += localUnique.size + upstreamUnique.size - uniqueShared;
  fileResults.push({
    file: relativePath(localSource, localFile),
    sharedLines: shared,
    currentLines: localLineCount,
    currentCoveragePercent: Number(
      ((shared / Math.max(1, localLineCount)) * 100).toFixed(1),
    ),
  });
}

fileResults.sort((left, right) => right.sharedLines - left.sharedLines);
const localCanvasCallbacks = pageCallbacks(
  workspace,
  "apps/canvas-engine/src/pages/canvas/project.tsx",
);
const upstreamCanvasCallbacks = pageCallbacks(
  upstreamRoot,
  path.join(args.get("--upstream-subdir") ?? "web/src", "pages/canvas/project.tsx"),
);
const callbackResults = [];
for (const [name, localLines] of localCanvasCallbacks) {
  const upstreamLines = upstreamCanvasCallbacks.get(name);
  if (!upstreamLines) continue;
  const shared = sharedCount(countLines(localLines), countLines(upstreamLines));
  callbackResults.push({
    callback: name,
    sharedLines: shared,
    localLines: localLines.length,
    localCoveragePercent: Number(
      ((shared / Math.max(1, localLines.length)) * 100).toFixed(1),
    ),
  });
}
callbackResults.sort((left, right) => right.sharedLines - left.sharedLines);

console.log(
  JSON.stringify(
    {
      method:
        "Whitespace-normalized exact line multiset overlap. This is a source-comparison indicator, not a legal or plagiarism score.",
      upstreamRevision,
      upstreamProductionFiles: upstreamFiles.length,
      localProductionFiles: localFiles.length,
      samePathFilePairs: samePathPairs,
      byteIdenticalSamePathFiles: exactMatches,
      samePathSharedLines: samePathShared,
      samePathLocalLineCoveragePercent: Number(
        ((samePathShared / Math.max(1, samePathCurrentLines)) * 100).toFixed(2),
      ),
      samePathLineJaccardPercent: Number(
        ((samePathShared / Math.max(1, samePathUnion)) * 100).toFixed(2),
      ),
      samePathUniqueLineCoveragePercent: Number(
        ((samePathUniqueShared / Math.max(1, samePathCurrentUniqueLines)) * 100).toFixed(2),
      ),
      samePathUniqueLineJaccardPercent: Number(
        ((samePathUniqueShared / Math.max(1, samePathUniqueUnion)) * 100).toFixed(2),
      ),
      crossPathSharedLines: crossPathShared,
      allLocalProductionLineCoveragePercent: Number(
        ((crossPathShared / Math.max(1, currentLines)) * 100).toFixed(2),
      ),
      crossPathSharedUniqueLines: [...localUniqueLines].filter((line) => upstreamUniqueLines.has(line)).length,
      allLocalUniqueLineCoveragePercent: Number(
        ([...localUniqueLines].filter((line) => upstreamUniqueLines.has(line)).length / Math.max(1, localUniqueLines.size) * 100).toFixed(2),
      ),
      allSourceCorpusUniqueLineJaccardPercent: Number(
        ([...localUniqueLines].filter((line) => upstreamUniqueLines.has(line)).length / Math.max(1, new Set([...localUniqueLines, ...upstreamUniqueLines]).size) * 100).toFixed(2),
      ),
      highestSharedLineFiles: fileResults.slice(0, 25),
      highestSharedCanvasPageCallbacks: callbackResults.slice(0, 25),
    },
    null,
    2,
  ),
);
