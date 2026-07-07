import { expect, test } from "playwright/test";
import { resolveImageRefToUrl } from "../../src/lib/imageStorage/resolveUrl";

test.afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("resolveImageRefToUrl isolates relative asset cache by page path", async () => {
  const reads: string[] = [];
  const originalCreateObjectURL = URL.createObjectURL;
  let createdObjectUrlCount = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      gooseFs: {
        readFileBase64Async: async (path: string) => {
          reads.push(path);
          return path.includes("/b/") ? "YmJi" : "YQ==";
        },
      },
    },
  });

  URL.createObjectURL = (() => {
    createdObjectUrlCount += 1;
    return `blob:test-${createdObjectUrlCount}`;
  }) as typeof URL.createObjectURL;

  try {
    const firstUrl = await resolveImageRefToUrl(
      "./assets/shared.png",
      "C:/notes/a/page.md",
    );
    const secondUrl = await resolveImageRefToUrl(
      "./assets/shared.png",
      "C:/notes/b/page.md",
    );

    expect(firstUrl).toBe("blob:test-1");
    expect(secondUrl).toBe("blob:test-2");
    expect(reads).toEqual([
      "C:/notes/a/assets/shared.png",
      "C:/notes/b/assets/shared.png",
    ]);
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
  }
});
