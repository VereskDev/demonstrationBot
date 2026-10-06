/**
 * Счётчик живых ходов + graceful shutdown (из движка Айман: runtime/inflight.ts и
 * runtime/shutdown.ts). На SIGTERM/SIGINT процесс не умирает посреди ответа: ждёт, пока
 * идущие ходы допишут и отправят, и только потом выходит.
 */
let active = 0;
const waiters: Array<() => void> = [];
let draining = false;

export function track<T>(p: Promise<T>): Promise<T> {
  active += 1;
  return p.finally(() => {
    active -= 1;
    if (active <= 0) {
      active = 0;
      for (const w of waiters.splice(0)) w();
    }
  });
}

export function inFlightCount(): number {
  return active;
}

export function isDraining(): boolean {
  return draining;
}

/** true — дождались тишины; false — вышел таймаут, ходы ещё идут. */
export function whenIdle(timeoutMs: number): Promise<boolean> {
  if (active <= 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
    waiters.push(() => {
      clearTimeout(t);
      resolve(true);
    });
  });
}

export function installGracefulShutdown(graceMs: number, onStop: () => void | Promise<void>): void {
  const onSignal = (sig: string) => {
    if (draining) return;
    draining = true;
    const t0 = Date.now();
    console.log(`[shutdown] ${sig}: живых ходов ${active} — жду до ${Math.round(graceMs / 1000)}с`);
    void (async () => {
      try {
        await onStop();
        const idle = await whenIdle(graceMs - (Date.now() - t0));
        console.log(`[shutdown] ${idle ? "все ходы завершены" : `таймаут, незавершённых ходов ${active}`} за ${Date.now() - t0}мс — выхожу`);
      } catch (e) {
        console.warn("[shutdown] ошибка при остановке:", e instanceof Error ? e.message : e);
      } finally {
        process.exit(0);
      }
    })();
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}
