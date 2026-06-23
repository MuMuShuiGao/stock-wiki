/** 应用路由路径常量 */
export const PATHS = {
  HOME: "/",
  SETTINGS: "/settings",
  projectFiles: (name: string) => `/project/${encodeURIComponent(name)}`,
  projectGraph: (name: string) => `/project/${encodeURIComponent(name)}/graph`,
} as const;
