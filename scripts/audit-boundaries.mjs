import { readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const productionRoots = ["GooseNotes/Sources", "Web/src"];
const textExtensions = new Set([".swift", ".ts", ".tsx", ".js", ".jsx", ".css", ".html"]);
const forbidden = [
  ["uTools", /\butools\b|window\.utools|__GOOSE_LITE__/i],
  ["Tauri", /__TAURI__|@tauri-apps|src-tauri/i],
  ["Electron", /require\(["']electron["']\)|electronAPI|BrowserWindow/i],
  ["生产浏览器存储", /\blocalStorage\b|showSaveFilePicker|showDirectoryPicker/],
  ["应用数据库存储", /library\.json|LibraryRepository|applicationSupportDirectory|\bCoreData\b|\bSwiftData\b|\bSQLite\b/i],
  ["AI 或 MCP", /@ai-sdk|\bMCP\b|notebook-ai|openInLLM/i],
];

async function walk(relative) {
  const absolute = resolve(root, relative);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else if (textExtensions.has(extname(entry.name))) files.push(child);
  }
  return files;
}

const violations = [];
for (const relative of productionRoots) {
  for (const file of await walk(relative)) {
    const content = await readFile(resolve(root, file), "utf8");
    for (const [label, pattern] of forbidden) {
      if (pattern.test(content)) violations.push(`${file}: 包含${label}`);
    }
  }
}

const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const allowedDependencies = new Set([
  "@blocknote/core",
  "@blocknote/mantine",
  "@blocknote/react",
  "lucide-react",
  "react",
  "react-dom",
]);
for (const dependency of Object.keys(pkg.dependencies ?? {})) {
  if (!allowedDependencies.has(dependency)) {
    violations.push(`package.json: 未列入白名单的运行时依赖 ${dependency}`);
  }
}

const entitlements = await readFile(resolve(root, "GooseNotes/GooseNotes.entitlements"), "utf8");
for (const capability of [
  "com.apple.security.network.client",
  "com.apple.security.automation.apple-events",
  "com.apple.security.temporary-exception.files.absolute-path.read-only",
]) {
  if (entitlements.includes(capability)) violations.push(`entitlements: 禁止的权限 ${capability}`);
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log("技术栈、运行时依赖与沙盒权限边界通过");
