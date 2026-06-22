import { info as tauriInfo, warn as tauriWarn, error as tauriError } from "@tauri-apps/plugin-log";

/**
 * 统一日志工具 —— 同时输出到：
 * 1. 浏览器 DevTools（console.log）
 * 2. 终端控制台（通过 tauri-plugin-log → Rust log crate）
 */

function formatMsg(tag: string, msg: string): string {
  return `[${tag}] ${msg}`;
}

export function logInfo(tag: string, msg: string): void {
  const formatted = formatMsg(tag, msg);
  console.log(formatted);
  tauriInfo(formatted).catch(() => {}); // fire-and-forget
}

export function logWarn(tag: string, msg: string): void {
  const formatted = formatMsg(tag, msg);
  console.warn(formatted);
  tauriWarn(formatted).catch(() => {});
}

export function logError(tag: string, msg: string): void {
  const formatted = formatMsg(tag, msg);
  console.error(formatted);
  tauriError(formatted).catch(() => {});
}
