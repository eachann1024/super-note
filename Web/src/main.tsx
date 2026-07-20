import { createRoot } from "react-dom/client";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { EditorSurface } from "./components/EditorSurface";
import "./styles/editor.css";

createRoot(document.getElementById("root")!).render(
  <EditorSurface />,
);
