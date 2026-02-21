import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import "./globals.css";
import { Dashboard } from "./pages/dashboard";
import { EpisodeDetail } from "./pages/episode-detail";
import { EpisodeList } from "./pages/episode-list";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename="/admin">
      <Routes>
        <Route element={<Dashboard />} path="/" />
        <Route element={<EpisodeList />} path="/:podcast" />
        <Route element={<EpisodeDetail />} path="/:podcast/episode/:id" />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
