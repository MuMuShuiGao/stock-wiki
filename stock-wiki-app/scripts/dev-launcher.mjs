/**
 * Tauri beforeDevCommand 启动器
 *
 * 1. 查端口占用 → 跳过自身/父进程 → 级联杀残留进程（signal → taskkill → powershell）
 * 2. 启动 vite + 退出清理
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 5173;

function log(msg) {
  console.log(msg);
}

// ---- helpers ----

function getParentPid(pid) {
  try {
    const out = execSync(`wmic process where ProcessId=${pid} get ParentProcessId`, {
      encoding: "utf-8", timeout: 5000,
    });
    const match = out.match(/^\d+$/m);
    return match ? match[0] : null;
  } catch { return null; }
}

function findPortPids(port) {
  const pids = new Set();
  try {
    const out = execSync("netstat -ano", { encoding: "utf-8", timeout: 5000 });
    const re = new RegExp(`:${port}(?=\\s|$)`);
    for (const line of out.split(/\r?\n/)) {
      if (!re.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== "0" && pid !== "4") pids.add(pid);
    }
  } catch {}
  return pids;
}

function pidAlive(pid) {
  try {
    return execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
      encoding: "utf-8", timeout: 5000,
    }).includes(pid);
  } catch { return false; }
}

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

// ---- step 1: clean port ----

log(`[dev-launcher] 检查端口 ${PORT}...`);

const skipPids = new Set([String(process.pid)]);
const ppid = getParentPid(process.pid);
if (ppid) skipPids.add(ppid);

const pids = findPortPids(PORT);

if (pids.size > 0) {
  log(`[dev-launcher] 端口 ${PORT} 占用: PID ${[...pids].join(", ")}`);

  for (const pid of pids) {
    if (skipPids.has(pid)) {
      log(`[dev-launcher]   ⏭ 跳过 PID ${pid}`);
      continue;
    }

    // 级联 kill: signal → taskkill → powershell
    try { process.kill(Number(pid), "SIGTERM"); } catch {}
    sleep(200);

    if (pidAlive(pid)) {
      spawnSync("taskkill", ["/F", "/PID", pid], { stdio: "ignore", timeout: 5000 });
      sleep(100);
    }
    if (pidAlive(pid)) {
      spawnSync("powershell", [
        "-NoProfile", "-Command",
        `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`,
      ], { stdio: "ignore", timeout: 8000 });
      sleep(200);
    }

    log(`[dev-launcher]   ${pidAlive(pid) ? "✗ 无法杀死" : "✓ killed"} PID ${pid}`);
  }

  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (findPortPids(PORT).size === 0) {
      log(`[dev-launcher] 端口 ${PORT} 已释放 (${Date.now() - start}ms)`);
      break;
    }
    sleep(100);
  }
} else {
  log(`[dev-launcher] 端口 ${PORT} 空闲`);
}

if (findPortPids(PORT).size > 0) {
  log(`[dev-launcher] 端口 ${PORT} 仍被占用，退出`);
  process.exit(1);
}

// ---- step 2: start vite ----

const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [viteBin], { stdio: "inherit" });

child.on("error", (err) => {
  log(`[dev-launcher] vite 启动失败: ${err.message}`);
  process.exit(1);
});

log(`[dev-launcher] vite PID ${child.pid}`);

// ---- step 3: cleanup ----

let exiting = false;

/** 可靠地终止 vite 子进程树（Windows 上 taskkill /T /F 最可靠） */
function killChild() {
  try {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
      stdio: "ignore", timeout: 5000,
    });
  } catch {}
}

function cleanup() {
  if (exiting) return;
  exiting = true;
  log("[dev-launcher] 退出中...");
  killChild();
}

// Ctrl+C / 终止信号 → 主动杀子进程后退出
["SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) =>
  process.on(sig, () => {
    if (exiting) return;
    // 先注销 child exit 监听，防止竞态
    child.removeAllListeners("exit");
    cleanup();
    process.exit(0);
  })
);

// 子进程自行退出（正常情况）→ 跟随退出
child.on("exit", (code) => {
  if (!exiting) {
    process.exit(code ?? 0);
  }
});
