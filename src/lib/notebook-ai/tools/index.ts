import { listNotebooks, listPages, searchNotes, readPage } from "./notes";
import { createPage, updatePage, replaceInPage } from "./write";
import { showTable, showChart, showDiagram, showSvg } from "./visual";

export const notebookAiTools = {
  listNotebooks,
  listPages,
  searchNotes,
  readPage,
  createPage,
  updatePage,
  replaceInPage,
  showTable,
  showChart,
  showDiagram,
  showSvg,
} as const;

export type NotebookAiTools = typeof notebookAiTools;

export { listNotebooks, listPages, searchNotes, readPage };
export { createPage, updatePage, replaceInPage };
export { showTable, showChart, showDiagram, showSvg };
