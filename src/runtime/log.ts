/** Лог с меткой времени. Секреты (токены, ключи) сюда не пишем. */
function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  info: (tag: string, msg: string, ...rest: unknown[]) => console.log(`${stamp()} [${tag}] ${msg}`, ...rest),
  warn: (tag: string, msg: string, ...rest: unknown[]) => console.warn(`${stamp()} [${tag}] ${msg}`, ...rest),
  error: (tag: string, msg: string, ...rest: unknown[]) => console.error(`${stamp()} [${tag}] ${msg}`, ...rest),
};

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
