import { useNavigate, useLocation } from "react-router-dom";
import { Home, FolderOpen, GitGraph, Settings, Sun, Moon } from "lucide-react";
import { PATHS } from "./path-list";
import { useAppStore } from "../stores/appStore";

interface LeftIconRailProps {
  effectiveTheme: "dark" | "light";
  themePreference: "dark" | "light" | "system";
  onToggleTheme: () => void;
}

interface NavItem {
  icon: typeof Home;
  label: string;
  tooltip: string;
  path: string;
  active: boolean;
}

/** 全局左侧图标导航栏，宽 52px，固定在布局最左侧 */
export default function LeftIconRail({
  effectiveTheme,
  themePreference,
  onToggleTheme,
}: LeftIconRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const lastVisitedProject = useAppStore((s) => s.lastVisitedProject);

  // 从 URL 解析项目名（LeftIconRail 在 <Routes> 外部，useParams 不可用）
  const projectMatch = location.pathname.match(/^\/project\/([^/]+)/);
  const decodedName = projectMatch ? decodeURIComponent(projectMatch[1]) : null;

  // 有效项目名：URL 中的优先，否则 fallback 到最后访问的项目
  const effectiveProject = decodedName || lastVisitedProject;
  // 当前是否在某个项目页面内（URL 中有项目名）
  const inProject = !!decodedName;

  const isActive = (path: string) => {
    const loc = location.pathname.replace(/\/$/, "");
    const p = path.replace(/\/$/, "");
    return loc === p;
  };

  const isGraphActive = decodedName
    ? location.pathname.endsWith("/graph")
    : false;

  const filesActive = decodedName
    ? isActive(PATHS.projectFiles(decodedName)) && !isGraphActive
    : false;

  // ═══════════════════════════════════════════
  //  根层级
  // ═══════════════════════════════════════════
  const rootItems: NavItem[] = [
    {
      icon: Home,
      label: "主页",
      tooltip: inProject ? "返回项目列表" : "项目列表",
      path: PATHS.HOME,
      active: isActive(PATHS.HOME),
    },
  ];

  // ═══════════════════════════════════════════
  //  项目上下文（仅在有效项目存在时显示）
  // ═══════════════════════════════════════════
  const projectItems: NavItem[] = [
    {
      icon: FolderOpen,
      label: "文件",
      tooltip: effectiveProject
        ? `浏览 ${effectiveProject} 文件`
        : "浏览文件",
      path: effectiveProject
        ? PATHS.projectFiles(effectiveProject)
        : PATHS.HOME,
      active: filesActive,
    },
    {
      icon: GitGraph,
      label: "图谱",
      tooltip: effectiveProject
        ? `${effectiveProject} 知识图谱`
        : "知识图谱",
      path: effectiveProject
        ? PATHS.projectGraph(effectiveProject)
        : PATHS.HOME,
      active: isGraphActive,
    },
  ];

  // ═══════════════════════════════════════════
  //  全局工具
  // ═══════════════════════════════════════════
  const utilityItems: NavItem[] = [
    {
      icon: Settings,
      label: "设置",
      tooltip: "应用设置",
      path: PATHS.SETTINGS,
      active: isActive(PATHS.SETTINGS),
    },
  ];

  function renderItem(item: NavItem) {
    return (
      <button
        key={item.label}
        onClick={() => navigate(item.path)}
        title={item.tooltip}
        className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors
          ${
            item.active
              ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-tertiary)]"
          }
          cursor-pointer`}
      >
        <item.icon size={18} />
      </button>
    );
  }

  return (
    <nav
      className="w-[52px] shrink-0 border-r border-[var(--color-border)] bg-[var(--color-sidebar)]
                 flex flex-col items-center py-3 select-none"
    >
      {/* ── 根层级 ── */}
      <div className="flex flex-col items-center gap-1">
        {rootItems.map(renderItem)}
      </div>

      {/* ── 项目上下文 ── */}
      {!!effectiveProject && (
        <>
          <div className="w-6 h-px bg-[var(--color-border)] my-2" />
          <div className="flex flex-col items-center gap-1">
            {projectItems.map(renderItem)}
          </div>
        </>
      )}

      {/* ── 弹性空间 ── */}
      <div className="flex-1" />

      {/* ── 全局工具 ── */}
      <div className="w-6 h-px bg-[var(--color-border)] mb-2" />
      <div className="flex flex-col items-center gap-1">
        {utilityItems.map(renderItem)}
      </div>

      {/* ── 主题切换 ── */}
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
                   hover:bg-[var(--color-bg-tertiary)] cursor-pointer mt-1"
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
