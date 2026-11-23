import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const skillDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(root, ".env") });

const base = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";
const forbidden = ["/api/v1/videos", "/api/v1/images", "openrouter.ai"];
const mode = process.argv.includes("doctor") ? "doctor" : "verify";

if (process.argv.includes("--generate")) {
  console.error("verify-studio refuses generate. Do not submit a prompt or call OpenRouter.");
  process.exit(2);
}

function browserPath() {
  const candidates = [
    process.env.VERIFY_BROWSER,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const found = candidates.find((item) => fs.existsSync(item));
  if (!found) throw new Error("Chrome or Edge was not found. Set VERIFY_BROWSER.");
  return found;
}

function credentials() {
  const username = process.env.VERIFY_USERNAME || process.env.SUPERADMIN_USERNAME || "";
  const password = process.env.VERIFY_PASSWORD || process.env.SUPERADMIN_PASSWORD || "";
  return { username, password };
}

async function serverUp() {
  try {
    const response = await fetch(`${base}/login`, { redirect: "manual" });
    return response.status === 200;
  } catch {
    return false;
  }
}

async function loginBody() {
  const response = await fetch(`${base}/login`, { redirect: "manual" });
  const text = await response.text();
  return { status: response.status, text };
}

async function ensureServer() {
  if (await serverUp()) return null;
  const child = spawn("cmd.exe", ["/d", "/s", "/c", "pnpm dev"], {
    cwd: root,
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await serverUp()) return child;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Dev server did not answer ${base}/login. Start it with pnpm dev.`);
}

function runTypecheck() {
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsc, "--noEmit"], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tsc --noEmit exited ${code ?? "unknown"}`));
    });
  });
}

function makeRunDir() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(skillDir, "artifacts", runId);
  fs.mkdirSync(dir, { recursive: true });
  return { runId, dir };
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.hits = [];
    this.logs = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.consoleAPICalled") {
        const text = (message.params?.args ?? [])
          .map((item) => item.value ?? item.description ?? "")
          .join(" ");
        if (text) this.logs.push(text.slice(0, 180));
      }
      if (message.method === "Runtime.exceptionThrown") {
        const text = message.params?.exceptionDetails?.text ?? "";
        if (text) this.logs.push(text);
      }
      if (message.method === "Network.responseReceived") {
        const status = message.params?.response?.status;
        const url = message.params?.response?.url ?? "";
        if (status >= 400) this.logs.push(`${status} ${url}`);
      }
      if (message.method === "Network.requestWillBeSent") {
        const url = message.params?.request?.url ?? "";
        if (forbidden.some((part) => url.includes(part))) this.hits.push(url);
      }
      if (message.id === undefined) return;
      const waiter = this.pending.get(`${message.sessionId ?? ""}:${message.id}`);
      if (!waiter) return;
      this.pending.delete(`${message.sessionId ?? ""}:${message.id}`);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.next++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(`${sessionId ?? ""}:${id}`, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

async function connectBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "verify-studio-"));
  const chrome = spawn(
    browserPath(),
    [
      "--headless=new",
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const wsUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not open a DevTools port")), 20_000);
    chrome.stderr.on("data", (chunk) => {
      const match = String(chunk).match(/ws:\/\/[^\s]+/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[0]);
    });
    chrome.on("exit", () => reject(new Error("Chrome exited before DevTools was ready")));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("DevTools socket failed")));
  });
  return { chrome, profile, cdp: new Cdp(ws) };
}

async function pageSession(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const keep = (kind) => (...args) => {
        const text = args.map((item) => String(item && item.message ? item.message : item)).join(' ');
        window.__verifyLogs = (window.__verifyLogs || []).concat(kind + ': ' + text);
      };
      for (const kind of ['error', 'warn']) {
        const orig = console[kind].bind(console);
        console[kind] = (...args) => { keep(kind)(...args); orig(...args); };
      }
      window.addEventListener('error', (event) => keep('window')(event.message));
    })();`,
  });
  return { send, logs: cdp.logs };
}

async function goto(page, url) {
  await page.send("Page.navigate", { url });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await page.send("Runtime.evaluate", {
      expression: "document.readyState",
      returnByValue: true,
    });
    if (state.result.value === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out opening ${url}`);
}

async function text(page) {
  const result = await page.send("Runtime.evaluate", {
    expression: "document.body ? document.body.innerText : ''",
    returnByValue: true,
  });
  return result.result.value ?? "";
}

async function captureEvidence(page, dir, name) {
  const body = await text(page);
  fs.writeFileSync(path.join(dir, `${name}.txt`), body, "utf8");
  const shot = await page.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(shot.data, "base64"));
  return body;
}

async function focusAndType(page, selector, value) {
  const focused = await page.send("Runtime.evaluate", {
    expression: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.focus();
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`,
    returnByValue: true,
  });
  if (!focused.result.value) throw new Error(`Missing ${selector}`);
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: focused.result.value.x,
    y: focused.result.value.y,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: focused.result.value.x,
    y: focused.result.value.y,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.insertText", { text: value });
}

async function login(page) {
  const { username, password } = credentials();
  if (!username || !password) {
    throw new Error("Set VERIFY_USERNAME and VERIFY_PASSWORD, or SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD in .env");
  }
  const deadlineHydration = Date.now() + 20_000;
  while (Date.now() < deadlineHydration) {
    if ((page.logs ?? []).some((line) => line.includes("React DevTools"))) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await focusAndType(page, "input[name=username]", username);
  await focusAndType(page, "input[type=password]", password);
  const lengths = await page.send("Runtime.evaluate", {
    expression: `(() => {
      const user = document.querySelector('input[name=username]');
      const pass = document.querySelector('input[type=password]');
      return [user ? user.value.length : -1, pass ? pass.value.length : -1];
    })()`,
    returnByValue: true,
  });
  const [userLength, passLength] = lengths.result.value;
  if (userLength < 1 || passLength < 8) {
    throw new Error(`Typed values did not stick (username ${userLength}, password ${passLength})`);
  }
  const button = await page.send("Runtime.evaluate", {
    expression: `(() => {
      const el = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Sign in');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`,
    returnByValue: true,
  });
  if (!button.result.value) throw new Error("Sign in button was not on /login");
  const point = button.result.value;
  await page.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await page.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const body = await text(page);
    const where = await page.send("Runtime.evaluate", {
      expression: "location.pathname",
      returnByValue: true,
    });
    if (where.result.value === "/") return;
    if (body.includes("Login failed") || body.includes("Invalid")) {
      throw new Error("Login was rejected");
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const logs = (page.logs ?? []).join(" | ");
  const extra = await page.send("Runtime.evaluate", {
    expression: "JSON.stringify(window.__verifyLogs || [])",
    returnByValue: true,
  });
  throw new Error(
    `Login did not leave the sign-in form. Page said: ${(await text(page)).slice(0, 180)} ${extra.result.value} ${logs}`,
  );
}

function assertIncludes(body, needles, where) {
  const missing = needles.filter((needle) => !body.includes(needle));
  if (missing.length > 0) {
    throw new Error(`${where} is missing: ${missing.join(", ")}`);
  }
}

async function doctor() {
  const { username, password } = credentials();
  const checks = {
    base,
    loginStatus: null,
    loginLabels: false,
    browser: null,
    credentials: Boolean(username && password),
  };
  try {
    checks.browser = browserPath();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }
  if (!checks.credentials) {
    throw new Error("Doctor: VERIFY_* or SUPERADMIN_* credentials are not set");
  }
  let page;
  try {
    page = await loginBody();
  } catch (error) {
    throw new Error(
      `Doctor: ${base}/login is unreachable (${error instanceof Error ? error.message : error}). Run pnpm verify:studio or pnpm dev first.`,
    );
  }
  checks.loginStatus = page.status;
  if (page.status !== 200) {
    throw new Error(`Doctor: ${base}/login returned ${page.status}`);
  }
  const needles = ["Sign in", "Username", "Password"];
  const missing = needles.filter((needle) => !page.text.includes(needle));
  checks.loginLabels = missing.length === 0;
  if (!checks.loginLabels) {
    throw new Error(`Doctor: /login is missing ${missing.join(", ")}`);
  }
  console.log(JSON.stringify({ ok: true, mode: "doctor", ...checks }, null, 2));
}

async function verify() {
  await runTypecheck();
  const { runId, dir } = makeRunDir();
  const started = await ensureServer();
  const browser = await connectBrowser();
  try {
    const page = await pageSession(browser.cdp);
    await goto(page, `${base}/login`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const blocked = (page.logs ?? []).filter((line) => line.startsWith("403"));
    if (blocked.length > 0) {
      throw new Error(`Login scripts were forbidden: ${(page.logs ?? []).join(" | ")}`);
    }
    const loginText = await captureEvidence(page, dir, "login");
    assertIncludes(loginText, ["Sign in", "Username", "Password"], "/login");
    await login(page);
    await goto(page, `${base}/`);
    const studio = await captureEvidence(page, dir, "studio");
    assertIncludes(studio, ["Image", "Video", "Assets", "Favorites"], "/");
    const composer = await page.send("Runtime.evaluate", {
      expression: "Boolean(document.querySelector('.ohf-composer'))",
      returnByValue: true,
    });
    if (!composer.result.value) throw new Error("/ is missing the composer");
    await goto(page, `${base}/account`);
    const account = await captureEvidence(page, dir, "account");
    assertIncludes(account, ["Change password"], "/account");
    if (browser.cdp.hits.length > 0) {
      throw new Error(`Blocked a generate call: ${browser.cdp.hits.join(" ")}`);
    }
    const summary = {
      ok: true,
      mode: "verify",
      base,
      runId,
      artifacts: dir,
      checked: ["/login", "/", "/account"],
      features: ["sign-in", "studio-home", "account-password"],
      generate: false,
    };
    fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
    console.log(JSON.stringify(summary));
  } finally {
    browser.chrome.kill();
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      fs.rmSync(browser.profile, { recursive: true, force: true });
    } catch {
      /* Chrome can keep the profile lock for a moment after exit. */
    }
    if (started) started.kill();
  }
}

async function main() {
  if (mode === "doctor") await doctor();
  else await verify();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
