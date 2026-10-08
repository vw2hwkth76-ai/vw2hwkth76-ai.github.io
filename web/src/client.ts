import type { Request, Response, ResultOf, WorkerError } from "./protocol.ts";

export class AnalysisError extends Error {
  readonly code: string;

  constructor(error: WorkerError) {
    super(error.message);
    this.code = error.code;
  }
}

/** Verpackt den Worker als Promise-Schnittstelle; Antworten werden ueber die Id zugeordnet. */
export class AnalysisClient {
  readonly #worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  readonly #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: AnalysisError) => void }>();
  #next = 1;

  constructor() {
    this.#worker.addEventListener("message", (event: MessageEvent<Response>) => {
      const pending = this.#pending.get(event.data.id);
      if (!pending) return;
      this.#pending.delete(event.data.id);
      if (event.data.ok) pending.resolve(event.data.result);
      else pending.reject(new AnalysisError(event.data.error));
    });
    this.#worker.addEventListener("error", (event) => {
      for (const pending of this.#pending.values()) pending.reject(new AnalysisError({ code: "worker", message: event.message || "Analyse abgebrochen." }));
      this.#pending.clear();
    });
  }

  call<T extends Request>(request: T, transfer: Transferable[] = []): Promise<ResultOf[T["type"]]> {
    const id = this.#next++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.#worker.postMessage({ id, request }, transfer);
    });
  }
}
