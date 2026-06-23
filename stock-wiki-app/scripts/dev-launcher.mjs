import { spawn, spawnSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 5173;

function getParentPid(pid) {
  try {
    const buf = execSync(`wmic process where ProcessId=${pid} get ParentProcessId /VALUE 2>nul`, { timeout: 5000 });
    const match = buf.toString("utf-8").match(/ParentProcessId=(\d+)/i);
    return match ? match[1] : null;
  } catch { return null; }
}

function findPortPids(port) {
  const pids = new Set();
  try {
    const out = execSync("netstat -ano", { timeout: 5000 }).toString("utf-8");
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
    return execSync(`tasklist /FI "PID eq ${pid}" /NH`, { timeout: 5000 }).toString("utf-8").includes(pid);
  } catch { return false; }
}

function getAncestorPids(startPid) {
  const ancestors = new Set();
  let pid = String(startPid);
  while (true) {
    const ppid = getParentPid(pid);
    if (!ppid || ppid === "0" || ancestors.has(ppid)) break;
    ancestors.add(ppid);
    pid = ppid;
  }
  return ancestors;
}

function getProcessName(pid) {
  try {
    const text = execSync(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`, { timeout: 5000 }).toString("utf-8");
    const match = text.match(/^"([^"]+)"/m);
    return match ? match[1] : "unknown";
  } catch { return "unknown"; }
}

const sleep = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };

console.log(`[dev-launcher] 检查端口 ${PORT}...`);

const skipPids = new Set([String(process.pid)]);
for (const apid of getAncestorPids(process.pid)) skipPids.add(apid);
console.log(`[dev-launcher] 自身 PID ${process.pid}，跳过 ${skipPids.size - 1} 个祖先进程`);

for (let attempt = 1; attempt <= 3; attempt++) {
  const pids = findPortPids(PORT);

  if (pids.size === 0) {
    if (attempt === 1) console.log(`[dev-launcher] 端口 ${PORT} 空闲`);
    break;
  }

  if (attempt === 1) {
    console.log(`[dev-launcher] 端口 ${PORT} 占用: ${[...pids].map(p => `PID ${p} (${getProcessName(p)})`).join(", ")}`);
  } else {
    console.log(`[dev-launcher] 重试清理 (第${attempt}次)...`);
  }

  for (const pid of pids) {
    if (skipPids.has(pid)) {
      console.log(`[dev-launcher]   ⏭ 跳过 PID ${pid} (${getProcessName(pid)}) [祖先/自身]`);
      continue;
    }

    try { spawnSync("taskkill", ["/F", "/PID", pid], { stdio: "ignore", timeout: 5000 }); } catch {}
    sleep(200);

    if (pidAlive(pid)) {
      try {
        spawnSync("powershell", ["-NoProfile", "-Command", `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], { stdio: "ignore", timeout: 8000 });
      } catch {}
      sleep(200);
    }

    console.log(`[dev-launcher]   ${pidAlive(pid) ? "✗ 无法杀死" : "✓ killed"} PID ${pid}`);
  }

  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (findPortPids(PORT).size === 0) {
      console.log(`[dev-launcher] 端口 ${PORT} 已释放 (${Date.now() - start}ms)`);
      break;
    }
    sleep(200);
  }

  if (findPortPids(PORT).size === 0) break;

  if (attempt < 3) {
    console.log("[dev-launcher] 端口仍占用，等待 1 秒后重试...");
    sleep(1000);
  }
}

if (findPortPids(PORT).size > 0) {
  console.log(`[dev-launcher] 端口 ${PORT} 仍被占用（已重试 3 次），退出`);
  process.exit(1);
}

const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const child = spawn(process.execPath, [viteBin], { stdio: "inherit" });

child.on("error", (err) => {
  console.log(`[dev-launcher] vite 启动失败: ${err.message}`);
  process.exit(1);
});

console.log(`[dev-launcher] vite PID ${child.pid}`);

let exiting = false;

process.on("SIGINT", () => {
  if (exiting) return;
  exiting = true;
  try { spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore", timeout: 3000 }); } catch {}
  process.exit(0);
});

child.on("exit", () => {
  if (!exiting) process.exit(0);
});
