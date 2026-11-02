import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import LeafletDrawLab from "./pages/LeafletDrawLab";

createRoot(document.getElementById("root")!).render(<StrictMode><LeafletDrawLab /></StrictMode>);
