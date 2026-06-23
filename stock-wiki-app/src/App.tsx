import { useEffect, useState, lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { useAppStore } from "./stores/appStore";
import LeftIconRail from "./components/LeftIconRail";
import "./App.css";

// ── Lazy-load route pages for faster startup ──
const ProjectListPage = lazy(() => import("./pages/ProjectListPage"));
const ProjectDetailPage = lazy(() => import("./pages/ProjectDetailPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

function getSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
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
  const themePreference = useAppStore((s) => s.themePreference);
  const setThemePreference = useAppStore.getState().setThemePreference;

  const [effectiveTheme, setEffectiveTheme] = useState<"dark" | "light">(() => {
    if (themePreference === "system") return getSystemTheme();
    return themePreference;
  });

  // Compute effective theme from preference + system query
  useEffect(() => {
    if (themePreference === "system") {
      setEffectiveTheme(getSystemTheme());
    } else {
      setEffectiveTheme(themePreference);
    }
  }, [themePreference]);

  // Apply theme to DOM
  useEffect(() => {
    applyTheme(effectiveTheme);
  }, [effectiveTheme]);

  // React to system theme changes when preference is "system"
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function handleChange() {
      if (useAppStore.getState().themePreference === "system") {
        setEffectiveTheme(getSystemTheme());
      }
    }
    mq.addEventListener("change", handleChange);
    return () => mq.removeEventListener("change", handleChange);
  }, []);

  const toggleTheme = () => {
    const pref = useAppStore.getState().themePreference;
    if (pref === "system") {
      // If currently following system, switch to opposite of current effective
      setThemePreference(effectiveTheme === "dark" ? "light" : "dark");
    } else {
      setThemePreference(pref === "dark" ? "light" : "dark");
    }
  };

  return (
    <div className="h-screen w-screen flex bg-[var(--color-bg)] text-[var(--color-text)]">
      {/* 全局左侧图标导航栏 */}
      <LeftIconRail
        effectiveTheme={effectiveTheme}
        themePreference={themePreference}
        onToggleTheme={toggleTheme}
      />

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
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
    </div>
  );
}
