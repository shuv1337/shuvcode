import { Log } from "./log";
import path from "path";
import fs from "fs/promises";

const log = Log.create({ service: "asset-copy" });

export const ASSET_EXTENSIONS = [
  ".html",
  ".css",
  ".json",
  ".txt",
  ".svg",
  ".png",
  ".jpg",
  ".gif",
  ".wav",
  ".mp3",
  ".ogg",
  ".flac",
  ".m4a",
  ".aac",
  ".mp4",
  ".webm",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
];

export async function copyPluginAssets(pluginDir: string, targetDir: string) {
  const entries = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: pluginDir, dot: false }));

  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (ASSET_EXTENSIONS.includes(ext)) {
      const srcPath = path.join(pluginDir, entry);
      const destPath = path.join(targetDir, entry);

      try {
        const stats = await fs.lstat(srcPath);
        if (stats.isSymbolicLink()) {
          log.info("skipping symlink", { src: entry });
          continue;
        }

        // Ensure real path is within pluginDir to prevent path traversal
        const realSrcPath = await fs.realpath(srcPath);
        const realPluginDir = await fs.realpath(pluginDir);
        if (!realSrcPath.startsWith(realPluginDir)) {
          log.warn("skipping out-of-bounds asset", { src: entry, realPath: realSrcPath });
          continue;
        }

        const destDir = path.dirname(destPath);
        await fs.mkdir(destDir, { recursive: true });

        const exists = await Bun.file(destPath).exists();
        if (exists) {
          log.info("overwriting plugin asset", { src: entry, dest: destPath });
        }

        const content = await Bun.file(srcPath).arrayBuffer();
        await Bun.write(destPath, content);
        log.info("copied plugin asset", { src: entry, dest: destPath });
      } catch (e) {
        log.error("failed to copy plugin asset", {
          src: srcPath,
          dest: destPath,
          error: (e as Error).message,
        });
      }
    }
  }
}

export async function resolvePluginRoot(entryFilePath: string): Promise<string> {
  let currentDir = path.dirname(entryFilePath);

  while (currentDir !== path.parse(currentDir).root) {
    if (await Bun.file(path.join(currentDir, "package.json")).exists()) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return path.dirname(entryFilePath);
}
