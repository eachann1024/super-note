import { expect, test } from "playwright/test";
import JSZip from "jszip";
import { generateExportZip, importNotebooksFromZip } from "../../src/lib/export";
import type { Page } from "../../src/types";

const notebookId = "notebook-export";
const imageRef = "att:goose-img/pixel.png";
const fileRef = "att-file:goose-file/report.pdf";

class TestFileReader {
  result: string | ArrayBuffer | null = null;
  error: unknown = null;
  onload: ((event?: unknown) => void) | null = null;
  onloadend: ((event?: unknown) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;

  private event() {
    return { target: this };
  }

  async readAsDataURL(blob: Blob) {
    try {
      const buffer = Buffer.from(await blob.arrayBuffer());
      this.result = `data:${blob.type};base64,${buffer.toString("base64")}`;
      this.onload?.(this.event());
      this.onloadend?.(this.event());
    } catch (error) {
      this.error = error;
      this.onerror?.(this.event());
    }
  }

  async readAsArrayBuffer(blob: Blob) {
    try {
      this.result = await blob.arrayBuffer();
      this.onload?.(this.event());
      this.onloadend?.(this.event());
    } catch (error) {
      this.error = error;
      this.onerror?.(this.event());
    }
  }
}

function installAttachmentRuntime() {
  const attachments = new Map<
    string,
    { data: Uint8Array; type: string }
  >([
    [
      "goose-img/pixel.png",
      {
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        type: "image/png",
      },
    ],
    [
      "goose-file/report.pdf",
      {
        data: new TextEncoder().encode("%PDF-1.4\n"),
        type: "application/pdf",
      },
    ],
  ]);

  const classes = new Set<string>();
  const documentElement = {
    classList: {
      add: (className: string) => classes.add(className),
      remove: (className: string) => classes.delete(className),
      contains: (className: string) => classes.has(className),
    },
    setAttribute: () => undefined,
    removeAttribute: () => undefined,
  };

  (globalThis as any).document = { documentElement };
  (globalThis as any).window = {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    utools: {
      db: {
        getAttachment: (id: string) => attachments.get(id)?.data ?? null,
        getAttachmentType: (id: string) => attachments.get(id)?.type ?? null,
      },
      dbStorage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
    },
  };
  (globalThis as any).FileReader = TestFileReader;
}

function buildPage(): Page {
  return {
    id: "page-export",
    workspaceId: notebookId,
    isFolder: false,
    isLocked: false,
    isFullWidth: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: 1,
    updatedAt: 1,
    content: [
      {
        type: "heading",
        props: { level: 1 },
        content: "Exported",
      },
      {
        type: "image",
        props: {
          url: imageRef,
          caption: "Pixel",
        },
      },
      {
        type: "file",
        props: {
          url: fileRef,
          name: "report.pdf",
        },
      },
    ],
  };
}

function buildLocalImagePage(
  id: string,
  localFilePath: string,
): Page {
  return {
    id,
    workspaceId: notebookId,
    isFolder: false,
    isLocked: false,
    isFullWidth: false,
    fontSize: "default",
    fontFamily: "default",
    createdAt: 1,
    updatedAt: 1,
    localFilePath,
    content: [
      {
        type: "image",
        props: {
          url: "./assets/shared.png",
          caption: id,
        },
      },
    ],
  };
}

async function buildZipBlob() {
  installAttachmentRuntime();
  return generateExportZip(
    { format: "md", notebookIds: [notebookId] },
    { [notebookId]: { name: "Notebook" } },
    [buildPage()],
  );
}

test.afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { FileReader?: unknown }).FileReader;
});

test("generateExportZip rewrites metadata asset refs for internal images and files", async () => {
  const zipBlob = await buildZipBlob();
  const zip = await JSZip.loadAsync(zipBlob);
  const metadataFile = zip.file("backup-metadata.json");
  expect(metadataFile).not.toBeNull();

  const metadata = JSON.parse(await metadataFile!.async("text"));
  const [page] = metadata.pages;
  const imageBlock = page.content[1];
  const fileBlock = page.content[2];

  expect(imageBlock.props.url).toContain("assets/");
  expect(imageBlock.props.url).not.toBe(imageRef);
  expect(fileBlock.props.url).toContain("assets/");
  expect(fileBlock.props.url).not.toBe(fileRef);

  const assetPaths = Object.keys(zip.files).filter((path) =>
    path.includes("/assets/"),
  );
  expect(assetPaths.some((path) => path.endsWith(".png"))).toBe(true);
  expect(assetPaths.some((path) => path.endsWith(".pdf"))).toBe(true);
});

test("importNotebooksFromZip restores metadata asset refs to portable data URLs", async () => {
  const zipBlob = await buildZipBlob();
  const importedPages: Array<Partial<Page>> = [];

  await importNotebooksFromZip(
    zipBlob,
    (_name, _icon, id) => id ?? notebookId,
    async (data) => {
      importedPages.push(data);
      return data.id ?? "page-imported";
    },
  );

  const importedContent = importedPages[0].content as any[];
  expect(importedContent[1].props.url).toMatch(/^data:image\/png;base64,/);
  expect(importedContent[2].props.url).toMatch(
    /^data:application\/pdf;base64,/,
  );
});

test("generateExportZip keeps same relative image names separate across local folders", async () => {
  const reads: string[] = [];
  const classes = new Set<string>();
  (globalThis as any).document = {
    documentElement: {
      classList: {
        add: (className: string) => classes.add(className),
        remove: (className: string) => classes.delete(className),
        contains: (className: string) => classes.has(className),
      },
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
    },
  };
  (globalThis as any).window = {
    matchMedia: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
    localStorage: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    },
    gooseFs: {
      readFileBase64: (path: string) => {
        reads.push(path);
        return path.includes("/b/") ? "YmJi" : "YQ==";
      },
    },
  };
  (globalThis as any).FileReader = TestFileReader;

  const zipBlob = await generateExportZip(
    { format: "md", notebookIds: [notebookId] },
    { [notebookId]: { name: "Notebook", localPath: "C:/notes" } },
    [
      buildLocalImagePage("page-a", "C:/notes/a/page.md"),
      buildLocalImagePage("page-b", "C:/notes/b/page.md"),
    ],
  );

  const zip = await JSZip.loadAsync(zipBlob);
  const metadataFile = zip.file("backup-metadata.json");
  expect(metadataFile).not.toBeNull();

  const metadata = JSON.parse(await metadataFile!.async("text"));
  const imageUrls = metadata.pages.map(
    (page: Page) => (page.content as any[])[0].props.url,
  );
  const assetPaths = Object.keys(zip.files).filter(
    (path) => path.includes("/assets/") && !zip.files[path].dir,
  );

  expect(new Set(imageUrls).size).toBe(2);
  expect(assetPaths).toHaveLength(2);
  expect(reads).toEqual([
    "C:/notes/a/assets/shared.png",
    "C:/notes/b/assets/shared.png",
  ]);
});
