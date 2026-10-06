/**
 * Очередь на чат (из движка Айман, runtime/chatQueue.ts): ход N+1 по одному чату ждёт, пока
 * ход N полностью отправлен. Иначе два быстрых сообщения подряд обрабатываются параллельно,
 * ответы приходят вперемешку, а история пишется наперегонки.
 */
const chains = new Map<string, Promise<unknown>>();

export async function withChatQueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const settled = run.then(
    () => {},
    () => {},
  );
  chains.set(key, settled);
  try {
    return await run;
  } finally {
    if (chains.get(key) === settled) chains.delete(key);
  }
}
