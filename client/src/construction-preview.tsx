import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import ConstructionPreview from "./pages/ConstructionPreview";

createRoot(document.getElementById("root")!).render(
  <StrictMode><ConstructionPreview /></StrictMode>,
);
