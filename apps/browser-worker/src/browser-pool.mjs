import { mkdir, lstat, readFile, readdir, rename, rm, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { WorkerError } from "./errors.mjs";
import { accountId, accountPath, generationInput, mediaMime, SITES } from "./validation.mjs";

const MUSE_MEDIA_SCRIPT = `() => {
  const out = [];
  const seen = new Set();
  const add = (element, kind) => {
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    if (bounds.width < 96 || bounds.height < 64 || element.closest('[aria-hidden="true"]')) return;
    const url = element.currentSrc || element.src || "";
    if (!url || seen.has(kind + url)) return;
    if (/avatar|emoji|logo|icon/i.test(element.alt || "")) return;
    seen.add(kind + url);
    out.push({ kind, url });
  };
  document.querySelectorAll("video").forEach((video) => add(video, "video"));
  document.querySelectorAll("img").forEach((image) => add(image, "image"));
  return out;
}`;

function privateDirectory(pathname) {
  if (process.platform === "win32") {
    const who = spawnSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
    const sid = who.status === 0 ? who.stdout.match(/S-\d-\d+(?:-\d+)+/)?.[0] : null;
    if (!sid) throw new WorkerError(500, "PROFILE_ACL_FAILED", "无法确认当前 Windows 服务账户 SID，拒绝建立会话目录");
    const acl = spawnSync("icacls.exe", [pathname, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"], { encoding: "utf8", windowsHide: true });
    if (acl.status !== 0) throw new WorkerError(500, "PROFILE_ACL_FAILED", "无法限制浏览器会话目录的 Windows ACL");
    return;
  }
  return chmod(pathname, 0o700);
}

export class BrowserPool {
  #config;
  #playwright;
  #accounts = new Map();
  #locks = new Set();
  #startingContexts = 0;
  #loading;

  constructor(config, playwrightLoader = () => import("playwright")) {
    this.#config = config;
    this.#loading = playwrightLoader;
  }

  async #ensurePlaywright() {
    if (!this.#playwright) this.#playwright = await this.#loading();
    return this.#playwright;
  }

  async #root(create = true) {
    if (create) await mkdir(this.#config.profileRoot, { recursive: true, mode: 0o700 });
    let root;
    try { root = await lstat(this.#config.profileRoot); }
    catch (error) {
      if (!create && error.code === "ENOENT") return null;
      throw error;
    }
    if (root.isSymbolicLink() || !root.isDirectory()) throw new WorkerError(500, "PROFILE_ROOT_INVALID", "浏览器会话根目录必须是实际目录");
    if (create) await privateDirectory(this.#config.profileRoot);
    return path.resolve(this.#config.profileRoot);
  }

  async #metadata(id) {
    const root = await this.#root(false);
    if (!root) return null;
    const folder = accountPath(root, id);
    try {
      const stat = await lstat(folder);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new WorkerError(400, "INVALID_ACCOUNT_PATH", "账号 profile 不是受控目录");
      const marker = path.join(folder, "worker.json");
      const markerStat = await lstat(marker);
      if (markerStat.isSymbolicLink() || !markerStat.isFile()) throw new Error("invalid metadata file");
      const data = JSON.parse(await readFile(marker, "utf8"));
      if (data.id !== id || !["muse", "doubao"].includes(data.provider)) throw new Error("metadata mismatch");
      return data;
    } catch (error) {
      if (error instanceof WorkerError) throw error;
      if (error.code === "ENOENT") return null;
      throw new WorkerError(500, "PROFILE_METADATA_INVALID", "无法核实已有会话目录，请由管理员检查本机 E 盘数据");
    }
  }

  #providerFor(id) { return this.#accounts.get(id)?.provider; }

  async status(id) {
    id = accountId(id);
    const provider = this.#providerFor(id) || (await this.#metadata(id))?.provider;
    if (!provider) return { state: "login_required", message: "先打开登录窗口并选择 Muse 或豆包；新账号尚无会话", capabilities: { image: false, video: false } };
    const capabilities = provider === "muse" ? { image: true, video: true } : { image: false, video: false };
    const active = this.#accounts.get(id);
    if (!active?.context || !active.page) return { state: "login_required", message: "浏览器已关闭或 worker 重启；打开登录窗口后重新检查本机保存的会话", capabilities };
    const result = await this.#inspect(active.page, provider);
    return { ...result, capabilities };
  }

  async login(id, body) {
    id = accountId(id);
    if (!this.#config.interactiveLogin) throw new WorkerError(403, "INTERACTIVE_LOGIN_DISABLED", "本机交互式登录未由部署者显式启用");
    const provider = body?.provider;
    if (!Object.hasOwn(SITES, provider)) throw new WorkerError(400, "INVALID_PROVIDER", "提供方必须是 muse 或 doubao");
    return this.#withLock(id, async () => {
      const existing = this.#accounts.get(id);
      if (existing && existing.provider !== provider)
        throw new WorkerError(409, "ACCOUNT_PROVIDER_MISMATCH", "该账号 UUID 已绑定另一网页登录提供方");
      if (existing?.context && !existing.page.isClosed()) return this.#inspect(existing.page, provider);
      if (existing?.context) await existing.context.close().catch(() => {});
      this.#accounts.delete(id);
      if (this.#accounts.size + this.#startingContexts >= this.#config.maxContexts) throw new WorkerError(429, "BROWSER_CAPACITY", "本机可见浏览器窗口已达部署者设置的上限");
      this.#startingContexts++;
      let context;
      try {
        const folder = accountPath(await this.#root(), id);
        const existingMetadata = await this.#metadata(id);
        if (existingMetadata && existingMetadata.provider !== provider)
          throw new WorkerError(409, "ACCOUNT_PROVIDER_MISMATCH", "该账号 UUID 已绑定另一网页登录提供方");
        await mkdir(folder, { recursive: false, mode: 0o700 }).catch((error) => {
          if (error.code !== "EEXIST") throw error;
        });
        const folderStat = await lstat(folder);
        if (folderStat.isSymbolicLink() || !folderStat.isDirectory()) throw new WorkerError(400, "INVALID_ACCOUNT_PATH", "账号 profile 不是受控目录");
        await privateDirectory(folder);
        if (!existingMetadata) {
          if ((await readdir(folder)).length > 0)
            throw new WorkerError(409, "PROFILE_NOT_OWNED", "现有目录缺少 worker 所有权标记，拒绝接管");
          await this.#writeMetadata(id, provider, folder);
        }
        const playwright = await this.#ensurePlaywright();
        context = await playwright.chromium.launchPersistentContext(folder, {
          headless: false,
          ...(this.#config.executablePath ? { executablePath: this.#config.executablePath } : {}),
          ...(!this.#config.executablePath && this.#config.browserChannel ? { channel: this.#config.browserChannel } : {}),
          acceptDownloads: true,
          downloadsPath: path.join(folder, "downloads"),
          viewport: { width: 1360, height: 900 },
          timeout: 30000,
        });
        const page = context.pages()[0] || await context.newPage();
        const entry = { id, provider, context, page };
        this.#accounts.set(id, entry);
        await page.goto(SITES[provider], { waitUntil: "domcontentloaded", timeout: 45000 });
        return { state: "login_required", message: "请在打开的本机窗口中自行登录，并亲自完成验证码；完成后可点击检查状态", capabilities: provider === "muse" ? { image: true, video: true } : { image: false, video: false } };
      } catch (error) {
        if (context) await context.close().catch(() => {});
        this.#accounts.delete(id);
        if (error instanceof WorkerError) throw error;
        throw new WorkerError(502, "BROWSER_LAUNCH_FAILED", "无法打开本机浏览器。检查部署者配置的 Edge/Chrome 路径与桌面会话");
      } finally {
        this.#startingContexts--;
      }
    });
  }

  async #writeMetadata(id, provider, folder) {
    const target = path.join(folder, "worker.json");
    const temp = path.join(folder, `.worker-${process.pid}-${Date.now()}.tmp`);
    await writeFile(temp, JSON.stringify({ id, provider, version: 1 }), { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temp, target);
  }

  async close(id) {
    id = accountId(id);
    return this.#withLock(id, async () => {
      const current = this.#accounts.get(id);
      if (current?.context) await current.context.close().catch(() => {});
      this.#accounts.delete(id);
      return { closed: true };
    });
  }

  async remove(id) {
    id = accountId(id);
    return this.#withLock(id, async () => {
      const current = this.#accounts.get(id);
      if (current?.context) await current.context.close().catch(() => {});
      this.#accounts.delete(id);
      const root = await this.#root(false);
      if (!root) throw new WorkerError(404, "PROFILE_NOT_FOUND", "找不到本机浏览器会话目录");
      const folder = accountPath(root, id);
      try {
        const stat = await lstat(folder);
        if (stat.isSymbolicLink() || !stat.isDirectory() || path.dirname(folder) !== root)
          throw new WorkerError(400, "INVALID_ACCOUNT_PATH", "拒绝删除未验证的账号 profile 目录");
        const data = await this.#metadata(id);
        if (!data || data.id !== id) throw new WorkerError(404, "PROFILE_NOT_FOUND", "找不到与该账号 UUID 匹配的会话目录");
        await rm(folder, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 });
        return { deleted: true };
      } catch (error) {
        if (error instanceof WorkerError) throw error;
        if (error.code === "ENOENT") throw new WorkerError(404, "PROFILE_NOT_FOUND", "找不到本机浏览器会话目录");
        throw error;
      }
    });
  }

  async generate(id, body) {
    id = accountId(id);
    const input = generationInput(body);
    if (input.provider === "doubao") throw new WorkerError(501, "UNSUPPORTED_CAPABILITY", "豆包网页登录生成尚未完成当前版本的人工校准；本 worker 只支持本人登录状态检查");
    if (!this.#config.interactiveLogin) throw new WorkerError(403, "INTERACTIVE_LOGIN_DISABLED", "本机浏览器任务未由部署者显式启用");
    return this.#withLock(id, async () => {
      const active = this.#accounts.get(id);
      if (!active?.context || active.provider !== input.provider) throw new WorkerError(409, "LOGIN_REQUIRED", "先打开此 Muse 账号的本机窗口并检查登录状态");
      const status = await this.#inspect(active.page, input.provider);
      if (status.state !== "ready") throw new WorkerError(409, "LOGIN_REQUIRED", status.message);
      return this.#generateMuse(active, input);
    });
  }

  async #generateMuse(active, input) {
    const { page, context } = active;
    const deadline = Date.now() + this.#config.generationTimeoutMs;
    let submitted = false;
    const timeout = setTimeout(() => { void page.evaluate(() => window.stop()).catch(() => {}); }, this.#config.generationTimeoutMs);
    try {
      await page.goto("https://muse.ai/thread/new", { waitUntil: "domcontentloaded", timeout: Math.min(45000, this.#config.generationTimeoutMs) });
      if (input.referenceImages.length) {
        const file = page.locator('input[type="file"]').first();
        if (!(await file.count())) throw new WorkerError(501, "REFERENCE_UPLOAD_UNAVAILABLE", "当前 Muse 页面未验证参考图输入控件，已在发送任务前停止");
        await file.setInputFiles(input.referenceImages.map((image) => ({ name: image.name, mimeType: image.mimeType, buffer: image.buffer })), { timeout: 10000 });
      }
      const composer = page.getByRole("textbox").last();
      if (!(await composer.count())) throw new WorkerError(409, "LOGIN_REQUIRED", "Muse 聊天输入区不可用，请重新登录或检查本机页面");
      const baseline = await page.evaluate(MUSE_MEDIA_SCRIPT);
      const before = new Set(baseline.filter((item) => item.kind === input.kind).map((item) => item.url));
      await composer.fill(input.prompt, { timeout: 10000 });
      const send = page.getByRole("button", { name: /send|发送|生成|提交|create/i }).last();
      if (!(await send.count()) || !(await send.isEnabled({ timeout: 10000 }).catch(() => false))) {
        await composer.fill("").catch(() => {});
        throw new WorkerError(409, "SEND_NOT_READY", "Muse 尚未确认提示词已进入可发送状态，任务没有提交");
      }
      submitted = true;
      await send.click({ timeout: 10000 });
      while (Date.now() < deadline) {
        const pageStatus = await this.#inspect(page, "muse");
        if (pageStatus.state === "verification_required")
          throw new WorkerError(409, "VERIFICATION_REQUIRED", "Muse 要求本人完成验证；任务可能已提交，检查生成记录后再决定下一步", true);
        const candidates = await page.evaluate(MUSE_MEDIA_SCRIPT);
        const match = candidates.find((item) => item.kind === input.kind && !before.has(item.url));
        if (match) {
          const media = await this.#materialize(context, page, match.url, input.kind);
          if (Date.now() < deadline) return media;
        }
        await page.waitForTimeout(750);
      }
      throw new WorkerError(504, "GENERATION_TIMEOUT", "等待 Muse 新生成媒体超时；该任务可能已受理，请勿自动重试", true);
    } catch (error) {
      if (error instanceof WorkerError) {
        if (submitted && !error.submissionUncertain)
          throw new WorkerError(error.status, error.code, error.message, true);
        throw error;
      }
      throw new WorkerError(502, "GENERATION_FAILED", "Muse 浏览器任务失败；请在本机页面检查是否已受理，不要自动重试", submitted);
    } finally {
      clearTimeout(timeout);
    }
  }

  async #materialize(context, page, source, kind) {
    let bytes;
    if (source.startsWith("data:")) {
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
      if (!match) throw new WorkerError(502, "INVALID_GENERATED_MEDIA", "Muse 结果不是有效 base64 媒体");
      bytes = Buffer.from(match[2], "base64");
    } else if (source.startsWith("blob:")) {
      let value;
      try {
        value = await page.evaluate(async ({ url, limit }) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error("blob unavailable");
          const blob = await response.blob();
          if (blob.size > limit) throw new Error("blob too large");
          const array = new Uint8Array(await blob.arrayBuffer());
          let binary = "";
          for (let i = 0; i < array.length; i += 0x8000) binary += String.fromCharCode(...array.subarray(i, i + 0x8000));
          return { base64: btoa(binary), mimeType: blob.type };
        }, { url: source, limit: this.#config.maxMediaBytes });
      } catch {
        throw new WorkerError(502, "MEDIA_DOWNLOAD_FAILED", "Muse 临时媒体无法安全读取");
      }
      bytes = Buffer.from(value.base64, "base64");
    } else {
      bytes = await this.#download(source);
    }
    if (!bytes.length || bytes.length > this.#config.maxMediaBytes) throw new WorkerError(502, "MEDIA_SIZE_INVALID", "生成媒体为空或超过部署者设置的大小限制");
    const mimeType = mediaMime(bytes, kind);
    return { base64: bytes.toString("base64"), mimeType };
  }

  async #download(source) {
    let current = source;
    for (let attempt = 0; attempt <= 4; attempt++) {
      current = this.#safeMediaUrl(current);
      let response;
      try { response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(20000), headers: { Accept: "image/*,video/mp4,video/webm" } }); }
      catch { throw new WorkerError(502, "MEDIA_DOWNLOAD_FAILED", "Muse 结果媒体下载失败"); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || attempt === 4) throw new WorkerError(502, "MEDIA_REDIRECT_REJECTED", "Muse 媒体跳转次数超出限制");
        current = new URL(location, current).href;
        continue;
      }
      if (!response.ok) throw new WorkerError(502, "MEDIA_DOWNLOAD_FAILED", "Muse 结果媒体请求失败");
      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > this.#config.maxMediaBytes) throw new WorkerError(502, "MEDIA_SIZE_INVALID", "生成媒体超过部署者设置的大小限制");
      if (!response.body) throw new WorkerError(502, "MEDIA_DOWNLOAD_FAILED", "Muse 未返回媒体内容");
      const reader = response.body.getReader();
      const parts = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > this.#config.maxMediaBytes) {
            await reader.cancel();
            throw new WorkerError(502, "MEDIA_SIZE_INVALID", "生成媒体超过部署者设置的大小限制");
          }
          parts.push(Buffer.from(value));
        }
      } catch (error) {
        if (error instanceof WorkerError) throw error;
        throw new WorkerError(502, "MEDIA_DOWNLOAD_FAILED", "读取 Muse 结果媒体失败");
      }
      return Buffer.concat(parts, size);
    }
    throw new WorkerError(502, "MEDIA_REDIRECT_REJECTED", "Muse 媒体跳转次数超出限制");
  }

  #safeMediaUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new WorkerError(502, "INVALID_MEDIA_URL", "Muse 结果媒体地址无效"); }
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443"
        || !this.#config.mediaAllowedHosts.has(hostname))
      throw new WorkerError(502, "UNTRUSTED_MEDIA_HOST", "Muse 媒体地址未经过部署者的 HTTPS 主机白名单验证");
    return url.href;
  }

  async #inspect(page, provider) {
    try {
      if (page.isClosed()) return { state: "login_required", message: "账号浏览器已关闭，请重新打开并检查登录", capabilities: { image: provider === "muse", video: provider === "muse" } };
      const location = new URL(page.url());
      if (provider === "doubao" && !(location.hostname === "doubao.com" || location.hostname.endsWith(".doubao.com")))
        return { state: "error", message: "豆包页面不在受支持的网站域名", capabilities: { image: false, video: false } };
      if (provider === "muse" && !(location.hostname === "muse.ai" || location.hostname.endsWith(".muse.ai")))
        return { state: "error", message: "Muse 页面不在受支持的网站域名", capabilities: { image: true, video: true } };
      const view = await page.evaluate(() => ({
        body: (document.body?.innerText || "").slice(0, 5000),
        hasComposer: !!document.querySelector("textarea:not([disabled]), [contenteditable=true][role=textbox]:not([aria-disabled=true])"),
        hasLogin: [...document.querySelectorAll("button,a")].some((el) => /登录|登录\/注册|sign in|log in/i.test(el.innerText || el.getAttribute("aria-label") || "")),
        captcha: !!document.querySelector('iframe[src*="captcha" i], iframe[src*="verify" i], [class*="captcha" i], [class*="verify-slider" i]'),
      }));
      if (view.captcha || /验证码|安全验证|人机验证|captcha|verification required|verify you are human/i.test(view.body))
        return { state: "verification_required", message: "页面正在等待本人完成验证码或安全验证", capabilities: { image: provider === "muse", video: provider === "muse" } };
      if (view.hasComposer && !view.hasLogin)
        return { state: provider === "muse" ? "ready" : "unsupported", message: provider === "muse" ? "Muse 会话输入区已就绪；本机账号和模态的真实生成仍需分别验收" : "豆包已登录；本版本尚未开放经过校准的豆包生成", capabilities: { image: provider === "muse", video: provider === "muse" } };
      return { state: "login_required", message: "当前页面尚无已确认的登录输入区，请本人完成登录后检查", capabilities: { image: provider === "muse", video: provider === "muse" } };
    } catch {
      return { state: "error", message: "无法读取本机浏览器页面状态", capabilities: { image: provider === "muse", video: provider === "muse" } };
    }
  }

  async #withLock(id, action) {
    if (this.#locks.has(id)) throw new WorkerError(409, "ACCOUNT_BUSY", "该账号正在登录、检查、生成或关闭");
    this.#locks.add(id);
    try { return await action(); } finally { this.#locks.delete(id); }
  }

  async closeAll() {
    for (const entry of this.#accounts.values()) await entry.context?.close().catch(() => {});
    this.#accounts.clear();
  }
}
