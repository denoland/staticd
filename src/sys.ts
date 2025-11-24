import { basename } from "@std/path/posix/basename";

export type FsHandle = FileHandle | DirHandle;

export interface FileHandle {
  kind: "file";
  name: string;
  stat: Deno.FileInfo;
  etag?: string;
  open(start?: number): Promise<ReadableStream<Uint8Array>>;
}

export interface DirHandle {
  kind: "dir";
}

export interface Fs {
  get(path: string): Promise<FsHandle | null>;
}

export class SystemFs implements Fs {
  async get(path: string): Promise<FsHandle | null> {
    const stat = await Deno.lstat(path).catch((err) => {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    });
    if (!stat) return null;
    if (stat.isFile) {
      return {
        kind: "file",
        name: basename(path),
        stat,
        open: async (start) => {
          const file = await Deno.open(path, { read: true });
          if (start) await file.seek(start, Deno.SeekMode.Start);
          return file.readable;
        },
      };
    } else if (stat.isDirectory) {
      return { kind: "dir" };
    } else {
      return null;
    }
  }
}
