import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "Design/tokens.json");
const swiftPath = resolve(root, "GooseNotes/Sources/Generated/DesignTokens.generated.swift");
const cssPath = resolve(root, "Web/src/styles/tokens.generated.css");
const check = process.argv.includes("--check");
const tokens = JSON.parse(await readFile(sourcePath, "utf8"));

const kebab = (value) => value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const swiftNumber = (value) => (Number.isInteger(value) ? `${value}` : `${value}`);

const lightColors = Object.entries(tokens.color)
  .map(([name, value]) => `  --color-${kebab(name)}: ${value.light};`)
  .join("\n");
const darkColors = Object.entries(tokens.color)
  .map(([name, value]) => `  --color-${kebab(name)}: ${value.dark};`)
  .join("\n");
const scalarCss = [
  ...Object.entries(tokens.space).map(([name, value]) => `  --space-${kebab(name)}: ${value}px;`),
  ...Object.entries(tokens.radius).map(([name, value]) => `  --radius-${kebab(name)}: ${value}px;`),
  ...Object.entries(tokens.motion).map(([name, value]) => `  --motion-${kebab(name)}: ${value}ms;`),
  ...Object.entries(tokens.typography).map(([name, value]) => {
    const unitless = name === "lineHeight";
    const unit = unitless ? "" : name === "measure" ? "ch" : "px";
    return `  --type-${kebab(name)}: ${value}${unit};`;
  }),
].join("\n");

const css = `/* Generated from Design/tokens.json. Do not edit. */
:root,
[data-theme="light"] {
${lightColors}
${scalarCss}
}

[data-theme="dark"] {
${darkColors}
}
`;

const swiftColors = Object.entries(tokens.color)
  .map(
    ([name, value]) =>
      `        static let ${name} = dynamic(light: "${value.light}", dark: "${value.dark}")`,
  )
  .join("\n");
const swiftScalars = (group, type = "CGFloat") =>
  Object.entries(tokens[group])
    .map(([name, value]) => `        static let ${name}: ${type} = ${swiftNumber(value)}`)
    .join("\n");

const swift = `// Generated from Design/tokens.json. Do not edit.
import AppKit

enum DesignTokens {
    enum Color {
${swiftColors}

        private static func dynamic(light: String, dark: String) -> NSColor {
            NSColor(name: nil) { appearance in
                let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                return NSColor(hex: isDark ? dark : light) ?? .controlTextColor
            }
        }
    }

    enum Space {
${swiftScalars("space")}
    }

    enum Radius {
${swiftScalars("radius")}
    }

    enum Motion {
${swiftScalars("motion", "TimeInterval")}
    }

    enum Typography {
${swiftScalars("typography")}
    }
}

private extension NSColor {
    convenience init?(hex: String) {
        let value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard value.count == 6, let number = Int(value, radix: 16) else { return nil }
        self.init(
            srgbRed: CGFloat((number >> 16) & 0xFF) / 255,
            green: CGFloat((number >> 8) & 0xFF) / 255,
            blue: CGFloat(number & 0xFF) / 255,
            alpha: 1
        )
    }
}
`;

async function assertOrWrite(path, value) {
  if (check) {
    const current = await readFile(path, "utf8").catch(() => "");
    if (current !== value) {
      throw new Error(`${path} 不是 Design/tokens.json 的最新生成结果`);
    }
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}

await Promise.all([assertOrWrite(swiftPath, swift), assertOrWrite(cssPath, css)]);
console.log(check ? "设计令牌已同步" : "已生成 Swift 与 CSS 设计令牌");
