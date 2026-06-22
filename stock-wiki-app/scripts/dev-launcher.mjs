/**
 * Tauri beforeDevCommand 启动器
 *
 * 解决 Windows 上 Ctrl+C 后 vite 进程残留的问题：
 * 1. 启动前先杀掉占用目标端口的残留进程
 * 2. 启动 vite，注册 exit/SIGINT 钩子确保退出时整棵进程树被杀死
 */
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 5173;

// --------------- step 1: 杀掉端口上的残留进程 ---------------
function killPort(port) {
  try {
    if (process.platform === "win32") {
      // Windows: netstat 找到 PID → taskkill /T 杀整棵树
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf-8",
        windowsHide: true,
      });
      const lines = out.trim().split(/\r?\n/);
      const killed = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0" && !killed.has(pid)) {
          killed.add(pid);
          try {
            execSync(`taskkill /T /F /PID ${pid}`, {
              encoding: "utf-8",
              windowsHide: true,
            });
            console.log(`[dev-launcher] killed残留进程 PID ${pid}`);
          } catch {
            // 进程可能已经不存在了
          }
        }
      }
    } else {
      // Unix: lsof + kill
      try {
        const out = execSync(`lsof -ti tcp:${port}`, { encoding: "utf-8" });
        const pids = out.trim().split("\n");
        for (const pid of pids) {
          try {
            process.kill(Number(pid), "SIGKILL");
            console.log(`[dev-launcher] killed残留进程 PID ${pid}`);
          } catch {
            // ignore
          }
        }
      } catch {
        // 没有进程占用该端口
      }
    }
  } catch {
    // netstat/lsof 失败或端口空闲，忽略
  }
}

// --------------- step 2: 启动 vite ---------------
// 直接用已知路径启动 vite，绕过 pnpm 减少进程层级
// Vite package.json: "bin": { "vite": "bin/vite.js" }
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));

console.log(`[dev-launcher] 启动 vite (PID ${process.pid})`);

const child = spawn(process.execPath, [viteBin], {
  stdio: "inherit",
  windowsHide: true,
});

// --------------- step 3: 清理钩子 ---------------
function cleanup() {
  if (child.exitCode !== null) return; // 已经退出了
  if (process.platform === "win32") {
    // Windows 上用 taskkill /T 确保整棵进程树被杀
    try {
      execSync(`taskkill /T /F /PID ${child.pid}`, {
        encoding: "utf-8",
        windowsHide: true,
      });
    } catch {
      // 可能已经死了
    }
  } else {
    // Unix: 负 pid 表示杀整个进程组
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

// 自身退出时清理
process.on("exit", () => cleanup());

// 收到信号时清理（注意 Windows 上 SIGINT 可能不可靠，但 SIGHUP/SIGTERM 可被 tauri 转发）
["SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) => {
  process.on(sig, () => {
    cleanup();
    process.exit(0);
  });
});

// vite 自己退出了，我们也退出
child.on("exit", (code) => {
  process.exit(code ?? 0);
});
