import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportDesignDocumentTool } from "../src/tools/design-engine.js";

/**
 * Regression tests for export-root containment.
 *
 * An AI review demonstrated two working escapes: a symlink at the final file
 * name let `writeFile` clobber a file outside the root, and `mkdir -p` through a
 * symlinked path component created directories outside the root before the
 * real-path check ran. Both must stay closed.
 */

let exportRoot: string;
let outside: string;

const document = {
  id: "probe",
  title: "probe",
  canvas: { width: 100, height: 100 },
  pages: [{ id: "p1", name: "P1", layers: [] }],
};

const imageDocument = {
  ...document,
  pages: [
    {
      id: "p1",
      name: "P1",
      layers: [
        {
          id: "image",
          type: "image",
          source: "interleaving.png",
          frame: { x: 0, y: 0, width: 100, height: 100 },
        },
      ],
    },
  ],
};

beforeEach(async () => {
  exportRoot = await mkdtemp(path.join(tmpdir(), "teguma-root-"));
  outside = await mkdtemp(path.join(tmpdir(), "teguma-outside-"));
});

afterEach(async () => {
  await rm(exportRoot, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("export root containment", () => {
  it("refuses to follow a symlink planted at the output file name", async () => {
    const victim = path.join(outside, "victim.svg");
    await writeFile(victim, "ORIGINAL");
    await mkdir(path.join(exportRoot, "ok"), { recursive: true });
    await symlink(victim, path.join(exportRoot, "ok", "probe-01-p1.svg"));

    await expect(
      exportDesignDocumentTool(
        { document, format: "svg", outputDirectory: "ok" },
        { outputRoot: exportRoot },
      ),
    ).rejects.toThrow(/Refusing to overwrite a symlink/);

    expect(await readFile(victim, "utf8")).toBe("ORIGINAL");
  });

  it("never creates directories outside the root through a symlinked component", async () => {
    await symlink(outside, path.join(exportRoot, "linked"));

    await expect(
      exportDesignDocumentTool(
        { document, format: "svg", outputDirectory: "linked/new-directory" },
        { outputRoot: exportRoot },
      ),
    ).rejects.toThrow(/symlink, refusing to follow it/);

    await expect(lstat(path.join(outside, "new-directory"))).rejects.toThrow();
  });

  it("rejects lexical traversal and absolute output directories", async () => {
    for (const outputDirectory of ["../escape", "a/../../escape"]) {
      await expect(
        exportDesignDocumentTool(
          { document, format: "svg", outputDirectory },
          { outputRoot: exportRoot },
        ),
      ).rejects.toThrow(/escapes the export root/);
    }

    await expect(
      exportDesignDocumentTool(
        { document, format: "svg", outputDirectory: outside },
        { outputRoot: exportRoot },
      ),
    ).rejects.toThrow(/must be relative to the export root/);
  });

  it("refuses to overwrite a non-file path and a non-directory component", async () => {
    await mkdir(path.join(exportRoot, "collide"), { recursive: true });
    await mkdir(path.join(exportRoot, "collide", "probe-01-p1.svg"), { recursive: true });

    await expect(
      exportDesignDocumentTool(
        { document, format: "svg", outputDirectory: "collide" },
        { outputRoot: exportRoot },
      ),
    ).rejects.toThrow(/non-file export path/);

    await writeFile(path.join(exportRoot, "file-not-dir"), "x");
    await expect(
      exportDesignDocumentTool(
        { document, format: "svg", outputDirectory: "file-not-dir" },
        { outputRoot: exportRoot },
      ),
    ).rejects.toThrow(/not a directory/);
  });

  it("still writes nested output inside the root and overwrites its own files", async () => {
    const args = {
      document,
      format: "svg" as const,
      outputDirectory: "nested/deeper",
    };

    const first = JSON.parse(
      await exportDesignDocumentTool(args, { outputRoot: exportRoot }),
    );
    expect(first.files).toHaveLength(1);

    // A second export must succeed by replacing the regular file it created.
    const second = JSON.parse(
      await exportDesignDocumentTool(args, { outputRoot: exportRoot }),
    );
    expect(second.files).toHaveLength(1);

    expect(await readdir(path.join(exportRoot, "nested", "deeper"))).toEqual([
      "probe-01-p1.svg",
    ]);
  });

  it("refuses a directory replaced after validation while rendering", async () => {
    const directory = path.join(exportRoot, "validated");
    await mkdir(directory);

    await expect(
      exportDesignDocumentTool(
        { document: imageDocument, format: "svg", outputDirectory: "validated" },
        {
          outputRoot: exportRoot,
          resolveImage: async () => {
            await rm(directory, { recursive: true });
            await symlink(outside, directory);
            return "data:image/png;base64,AA==";
          },
        },
      ),
    ).rejects.toThrow("Export directory changed after validation");

    expect(await readdir(outside)).toEqual([]);
  });

  it("does not follow a final-path symlink planted after directory validation", async () => {
    const directory = path.join(exportRoot, "ok");
    const target = path.join(directory, "probe-01-p1.svg");
    const victim = path.join(outside, "victim.svg");
    await mkdir(directory);
    await writeFile(target, "previous export");
    await writeFile(victim, "ORIGINAL");

    await expect(
      exportDesignDocumentTool(
        { document: imageDocument, format: "svg", outputDirectory: "ok" },
        {
          outputRoot: exportRoot,
          resolveImage: async () => {
            await unlink(target);
            await symlink(victim, target);
            return "data:image/png;base64,AA==";
          },
        },
      ),
    ).rejects.toThrow(/Refusing to overwrite a symlink/);

    expect(await readFile(victim, "utf8")).toBe("ORIGINAL");
  });

  it("replaces a destination hardlink without writing through it", async () => {
    const directory = path.join(exportRoot, "ok");
    const target = path.join(directory, "probe-01-p1.svg");
    const victim = path.join(outside, "victim.svg");
    await mkdir(directory);
    await writeFile(victim, "ORIGINAL");
    await link(victim, target);

    await expect(
      exportDesignDocumentTool(
        { document, format: "svg", outputDirectory: "ok" },
        { outputRoot: exportRoot },
      ),
    ).resolves.toContain('"files"');

    expect(await readFile(victim, "utf8")).toBe("ORIGINAL");
    expect(await readFile(target, "utf8")).toContain("<svg");
  });

  it("treats empty and dot output directories as the export root", async () => {
    for (const outputDirectory of ["", "."]) {
      await expect(
        exportDesignDocumentTool(
          { document, format: "svg", outputDirectory },
          { outputRoot: exportRoot },
        ),
      ).resolves.toContain('"directory"');
    }

    expect((await lstat(path.join(exportRoot, "probe-01-p1.svg"))).isFile()).toBe(true);
  });
});
