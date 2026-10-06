/**
 * Публичный HTTPS-адрес для локального API через Cloudflare quick tunnel (бинарник cloudflared из
 * одноимённого npm-пакета). Адрес случайный и меняется при каждом запуске — бот подставляет его в
 * кнопку меню сам. Падение туннеля → перезапуск с паузой; без туннеля бот работает как раньше.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { log, errMsg } from "../runtime/log.ts";

export interface TunnelHandle {
  /** Текущий публичный адрес или null, пока не поднялся. */
  current(): string | null;
  onUrl(cb: (url: string) => void): void;
  stop(): void;
}

async function cloudflaredBin(): Promise<string | null> {
  try {
    const mod = (await import("cloudflared")) as { bin: string; install: (p: string) => Promise<unknown> };
    if (!fs.existsSync(mod.bin)) {
      log.info("tunnel", "cloudflared не скачан — скачиваю официальный бинарник");
      await mod.install(mod.bin);
    }
    return fs.existsSync(mod.bin) ? mod.bin : null;
  } catch (e) {
    log.warn("tunnel", `cloudflared недоступен: ${errMsg(e)}`);
    return null;
  }
}

export function startTunnel(localUrl: string): TunnelHandle {
  let url: string | null = null;
  let child: ChildProcess | null = null;
  let stopped = false;
  let restarts = 0;
  const listeners: Array<(url: string) => void> = [];

  const launch = async (): Promise<void> => {
    if (stopped) return;
    const bin = await cloudflaredBin();
    if (!bin) return;
    child = spawn(bin, ["tunnel", "--url", localUrl, "--no-autoupdate"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const onLine = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && m[0] !== url) {
        url = m[0];
        restarts = 0;
        log.info("tunnel", `публичный адрес API: ${url}`);
        for (const cb of listeners) cb(url);
      }
      if (/ERR/.test(text) && !/Cannot determine default configuration/.test(text)) log.warn("tunnel", text.trim().split("\n").pop() ?? "");
    };
    child.stdout?.on("data", onLine);
    child.stderr?.on("data", onLine);
    child.on("exit", (code) => {
      child = null;
      if (stopped) return;
      url = null;
      restarts += 1;
      const delay = Math.min(60_000, 3_000 * restarts);
      log.warn("tunnel", `cloudflared завершился (код ${code}) — перезапуск через ${Math.round(delay / 1000)} с`);
      setTimeout(() => void launch(), delay).unref();
    });
  };
  void launch();

  return {
    current: () => url,
    onUrl: (cb) => {
      listeners.push(cb);
      if (url) cb(url);
    },
    stop: () => {
      stopped = true;
      try {
        child?.kill();
      } catch {
        /* уже умер */
      }
    },
  };
}
