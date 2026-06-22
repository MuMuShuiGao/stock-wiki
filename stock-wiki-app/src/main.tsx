import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { attachConsole } from "@tauri-apps/plugin-log";
import App from "./App";
import "./index.css";

// 将 Rust 后端日志转发到浏览器开发者工具控制台
attachConsole().catch((e) => console.error("日志管道连接失败:", e));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
