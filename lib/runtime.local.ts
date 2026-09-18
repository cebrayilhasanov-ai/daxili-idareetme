import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");
const filesDir = path.join(dataDir, "files");
mkdirSync(filesDir, { recursive: true });

const sqlite = new DatabaseSync(path.join(dataDir, "app.db"));
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");

type FileMeta = { contentType: string; originalName: string; size: number };
const filesMetaPath = path.join(dataDir, "files-meta.json");

function loadFilesMeta(): Record<string, FileMeta> {
  if (!existsSync(filesMetaPath)) return {};
  return JSON.parse(readFileSync(filesMetaPath, "utf8"));
}

function saveFilesMeta(meta: Record<string, FileMeta>) {
  writeFileSync(filesMetaPath, JSON.stringify(meta), "utf8");
}

function makeStatement(sql: string, args: unknown[] = []) {
  return {
    bind: (...newArgs: unknown[]) => makeStatement(sql, newArgs),
    run: async () => {
      const info = sqlite.prepare(sql).run(...(args as never[]));
      return { meta: { last_row_id: Number(info.lastInsertRowid) }, success: true };
    },
    first: async <T>(): Promise<T | null> => {
      const row = sqlite.prepare(sql).get(...(args as never[]));
      return (row ?? null) as T | null;
    },
    all: async <T>(): Promise<{ results: T[] }> => {
      const rows = sqlite.prepare(sql).all(...(args as never[]));
      return { results: rows as T[] };
    },
  };
}

type Stmt = ReturnType<typeof makeStatement>;

const dbShim = {
  prepare: (sql: string) => makeStatement(sql),
  batch: async (stmts: Stmt[]) => {
    const results = [];
    for (const stmt of stmts) results.push(await stmt.run());
    return results;
  },
};

function streamToBuffer(input: ReadableStream | ArrayBuffer | Uint8Array): Promise<Buffer> {
  if (input instanceof ReadableStream) return new Response(input).arrayBuffer().then((buf) => Buffer.from(buf));
  return Promise.resolve(Buffer.from(input as ArrayBuffer));
}

const filesShim = {
  put: async (
    key: string,
    stream: ReadableStream | ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ) => {
    const buf = await streamToBuffer(stream);
    writeFileSync(path.join(filesDir, key), buf);
    const meta = loadFilesMeta();
    meta[key] = {
      contentType: options?.httpMetadata?.contentType || "application/octet-stream",
      originalName: options?.customMetadata?.originalName || key,
      size: buf.length,
    };
    saveFilesMeta(meta);
  },
  get: async (key: string) => {
    const filePath = path.join(filesDir, key);
    if (!existsSync(filePath)) return null;
    const meta = loadFilesMeta()[key] || { contentType: "application/octet-stream", originalName: key, size: 0 };
    const buf = readFileSync(filePath);
    return {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(buf));
          controller.close();
        },
      }),
      size: buf.length,
      httpMetadata: { contentType: meta.contentType },
      customMetadata: { originalName: meta.originalName },
      writeHttpMetadata: (headers: Headers) => {
        headers.set("content-type", meta.contentType);
      },
    };
  },
  delete: async (key: string) => {
    const filePath = path.join(filesDir, key);
    if (existsSync(filePath)) unlinkSync(filePath);
    const meta = loadFilesMeta();
    delete meta[key];
    saveFilesMeta(meta);
  },
};

export const env = {
  DB: dbShim,
  FILES: filesShim,
  ADMIN_INITIAL_PASSWORD: process.env.ADMIN_INITIAL_PASSWORD,
  AYSUN_INITIAL_PASSWORD: process.env.AYSUN_INITIAL_PASSWORD,
};
