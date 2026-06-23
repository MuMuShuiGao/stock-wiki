import { useNavigate, useLocation } from "react-router-dom";
import { Home, FolderOpen, GitGraph, Settings, Sun, Moon } from "lucide-react";
import { PATHS } from "./path-list";

interface LeftIconRailProps {
  effectiveTheme: "dark" | "light";
  themePreference: "dark" | "light" | "system";
  onToggleTheme: () => void;
}

/** 全局左侧图标导航栏，宽 52px，固定在布局最左侧 */
export default function LeftIconRail({
  effectiveTheme,
  themePreference,
  onToggleTheme,
}: LeftIconRailProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // 从 URL 解析项目名（LeftIconRail 在 <Routes> 外部，useParams 不可用）
  const projectMatch = location.pathname.match(/^\/project\/([^/]+)/);
  const decodedName = projectMatch ? decodeURIComponent(projectMatch[1]) : null;

  const isActive = (path: string) => {
    // 精确匹配（忽略尾部斜杠和 query string）
    const loc = location.pathname.replace(/\/$/, "");
    const p = path.replace(/\/$/, "");
    return loc === p;
  };

  const isGraphActive = decodedName
    ? location.pathname.endsWith("/graph")
    : false;

  const navItems = [
    {
      icon: Home,
      label: "主页",
      path: PATHS.HOME,
      active: isActive(PATHS.HOME),
      alwaysEnabled: true,
    },
    {
      icon: FolderOpen,
      label: "文件",
      path: decodedName ? PATHS.projectFiles(decodedName) : PATHS.HOME,
      active: decodedName ? isActive(PATHS.projectFiles(decodedName)) && !isGraphActive : false,
      alwaysEnabled: false,
    },
    {
      icon: GitGraph,
      label: "图谱",
      path: decodedName ? PATHS.projectGraph(decodedName) : PATHS.HOME,
      active: decodedName ? isGraphActive : false,
      alwaysEnabled: false,
    },
    {
      icon: Settings,
      label: "设置",
      path: PATHS.SETTINGS,
      active: isActive(PATHS.SETTINGS),
      alwaysEnabled: true,
    },
  ];

  return (
    <nav
      className="w-[52px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-sidebar)]
                 flex flex-col items-center py-3 gap-1 select-none"
    >
      {navItems.map((item) => {
        const enabled = item.alwaysEnabled || !!decodedName;
        return (
          <button
            key={item.label}
            onClick={() => enabled && navigate(item.path)}
            disabled={!enabled}
            title={item.label}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors
              ${
                item.active
                  ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-tertiary)]"
              }
              ${!enabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
            `}
          >
            <item.icon size={18} />
          </button>
        );
      })}

      {/* 弹性空间，把主题按钮推到底部 */}
      <div className="flex-1" />

      <button
        onClick={onToggleTheme}
        title={
          themePreference === "system"
            ? "当前跟随系统，点击切换"
            : effectiveTheme === "dark"
              ? "切换亮色模式"
              : "切换暗色模式"
        }
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors
                   text-[var(--color-text-muted)] hover:text-[var(--color-text)]
                   hover:bg-[var(--color-bg-tertiary)] cursor-pointer"
      >
        {effectiveTheme === "dark" ? (
          <Sun size={18} />
        ) : (
          <Moon size={18} />
        )}
      </button>
    </nav>
  );
}
