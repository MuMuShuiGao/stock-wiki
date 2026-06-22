/**
 * Tauri beforeDevCommand 启动器
 *
 * 解决 Windows 上 Ctrl+C 后 vite 进程残留的问题：
 * 1. 启动前先精确匹配并杀掉占用目标端口的残留进程，等待端口真正释放
 * 2. 启动 vite，注册 exit/SIGINT 钩子确保退出时整棵进程树被杀死
 */
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 5173;

// --------------- step 1: 杀掉端口上的残留进程 ---------------
function killPort(port) {
  const killed = killPortWindows(port);
  if (killed > 0) {
    waitForPortFree(port, 5000);
  } else {
    console.log(`[dev-launcher] 端口 ${port} 未发现残留进程`);
    sleepSync(200);
  }
}

killPort(PORT);

/** 从 netstat 输出中提取精确匹配指定端口的 PID 集合 */
function findPortPids(port) {
  const out = execSync("netstat -ano", {
    encoding: "utf-8",
    windowsHide: true,
  });
  const re = new RegExp(`:${port}(?=\\s|$)`);
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!re.test(line)) continue;
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && pid !== "0" && pid !== "4") {
      pids.add(pid);
    }
  }
  return pids;
}

/** 杀掉占用指定端口的 Windows 进程，返回杀掉的进程数 */
function killPortWindows(port) {
  const pids = findPortPids(port);
  if (pids.size === 0) return 0;

  console.log(`[dev-launcher] 发现端口 ${port} 占用: PID ${[...pids].join(", ")}`);
  let killed = 0;
  for (const pid of pids) {
    try {
      execSync(`taskkill /T /F /PID ${pid}`, {
        encoding: "utf-8",
        windowsHide: true,
      });
      console.log(`[dev-launcher] killed残留进程 PID ${pid} (端口 ${port})`);
      killed++;
    } catch {
      // 进程可能已经不存在了
    }
  }
  return killed;
}

/** 简单的同步 sleep（仅用于启动脚本的短延迟） */
function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait */ }
}

/** 轮询等待端口释放，超时后打印警告 */
function waitForPortFree(port, timeoutMs) {
  const start = Date.now();
  if (!isPortInUse(port)) {
    console.log(`[dev-launcher] 端口 ${port} 已释放 (等待 ${Date.now() - start}ms)`);
    return;
  }
  while (Date.now() - start < timeoutMs) {
    sleepSync(80);
    if (!isPortInUse(port)) {
      console.log(`[dev-launcher] 端口 ${port} 已释放 (等待 ${Date.now() - start}ms)`);
      return;
    }
  }
  console.log(`[dev-launcher] ⚠ 端口 ${port} 在 ${timeoutMs}ms 内未释放，继续启动`);
}

/** 检查端口是否被占用（返回 true=占用中） */
function isPortInUse(port) {
  return findPortPids(port).size > 0;
}

// --------------- step 2: 启动 vite ---------------
// 直接用已知路径启动 vite，绕过 pnpm 减少进程层级
// Vite package.json: "bin": { "vite": "bin/vite.js" }
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));

const child = spawn(process.execPath, [viteBin], {
  stdio: "inherit",
  windowsHide: true,
});

console.log(`[dev-launcher] 启动 vite (PID ${child.pid})`);

// --------------- step 3: 清理钩子 ---------------
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  // 先杀 vite 进程树
  try {
    execSync(`taskkill /T /F /PID ${child.pid}`, {
      encoding: "utf-8",
      windowsHide: true,
    });
  } catch { /* 进程可能已经死了 */ }
  // 再直接清端口（taskkill /T 可能漏掉孤儿子进程）
  killPort(PORT);
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
