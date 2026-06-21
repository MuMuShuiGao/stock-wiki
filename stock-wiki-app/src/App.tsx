import { useEffect, useState, lazy, Suspense } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import "./App.css";

// ── Lazy-load route pages to avoid pulling in Milkdown on startup ──
const ProjectListPage = lazy(() => import("./pages/ProjectListPage"));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

const THEME_KEY = "stock-wiki-theme";

function getSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getInitialTheme(): "dark" | "light" {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return getSystemTheme();
}

function applyTheme(theme: "dark" | "light") {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-sm text-[var(--color-text-muted)] animate-pulse">
        Loading...
      </p>
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">(getInitialTheme);
  const location = useLocation();

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // React to system theme changes when no explicit user preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      const stored = localStorage.getItem(THEME_KEY);
      if (!stored) {
        const sys = getSystemTheme();
        setTheme(sys);
      }
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  const toggleTheme = () => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  };

  const isDetailPage = location.pathname.startsWith("/project/");

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-sidebar)] shrink-0">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="font-bold text-sm text-[var(--color-accent)] hover:opacity-80 no-underline"
          >
            📈 Stock Wiki
          </Link>
          {isDetailPage && (
            <span className="text-xs text-[var(--color-text-muted)]">
              /
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-accent)]
                       px-2 py-1 rounded transition-colors no-underline"
          >
            ⚙️ 设置
          </Link>
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "切换亮色模式" : "切换暗色模式"}
            className="text-lg px-2 py-1 rounded cursor-pointer
                       hover:bg-[var(--color-bg-tertiary)] transition-colors
                       leading-none"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      {/* Page content */}
      <div className="flex-1 min-h-0">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<ProjectListPage />} />
            <Route path="/project/:projectName/*" element={<ProjectDetailPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}
