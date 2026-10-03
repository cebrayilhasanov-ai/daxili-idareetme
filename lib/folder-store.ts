// Writing documents straight into folders on the machine the app runs on. Only the on-prem build (lib/runtime.local.ts)
// provides one; on Cloudflare `folderStore` is null and documents stay in the FILES bucket instead.
// Versiya 2.83: the admin picks each template's folder on the server (no common root); the app never creates folders itself.
export type FolderStore = {
  // Whether `dir` is a full path to a folder that exists on the server.
  isDir(dir: string): boolean;
  // The starting points of the folder picker: the server's drives (or "/").
  roots(): string[];
  // The sub-folders of a folder, for the folder picker (hidden and system folders left out).
  listDirs(dir: string): { path: string; parent: string | null; dirs: string[] };
  // Writes "<dir>/<baseName><ext>", adding " (2)", " (3)"... when another file already has that name.
  // `ownPath` is the record's current file: it never counts as a clash, so a re-upload can take its name back.
  saveUnique(dir: string, baseName: string, ext: string, data: Uint8Array, ownPath?: string | null): Promise<string>;
  read(filePath: string): Promise<Uint8Array | null>;
  exists(filePath: string): boolean;
  remove(filePath: string): Promise<void>;
  baseName(filePath: string): string;
};
