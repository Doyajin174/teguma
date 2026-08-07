/**
 * Durable design-project storage.
 *
 * The design engine is otherwise intentionally stateless. This small, local
 * store lets an agent resume a multi-turn design without repeatedly sending a
 * complete document, while keeping persistence explicit and contained to a
 * caller-configured directory.
 */

import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BrandKitSchema, DesignDocumentSchema, type BrandKit, type DesignDocument } from "./document.js";

export const CURRENT_PROJECT_SCHEMA_VERSION = 1;
export const MAX_PROJECT_ID_LENGTH = 128;

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const ProjectIdSchema = z
  .string()
  .min(1, "Project id must not be empty")
  .max(MAX_PROJECT_ID_LENGTH, `Project id must be at most ${MAX_PROJECT_ID_LENGTH} characters`)
  .regex(PROJECT_ID_PATTERN, "Project id must start with an alphanumeric character and use only A-Z, a-z, 0-9, ., _, or -")
  .refine((id) => !id.includes(".."), "Project id must not contain '..'")
  .refine(
    (id) => !id.includes("/") && !id.includes("\\"),
    "Project id must not contain path separators",
  );

/** The on-disk envelope for one persistent design document. */
export const DesignProjectSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    id: ProjectIdSchema,
    title: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    document: DesignDocumentSchema,
    brandKit: BrandKitSchema.optional(),
  })
  .strict();

export interface DesignProjectStore {
  /** Directory containing one `<project-id>.json` file for each project. */
  root: string;
}

export type DesignProject = z.infer<typeof DesignProjectSchema>;

const ProjectVersionSchema = z
  .object({ schemaVersion: z.number().int().positive() })
  .passthrough();

function projectId(id: string): string {
  return ProjectIdSchema.parse(id);
}

function projectPath(root: string, id: string): string {
  const target = path.resolve(root, `${projectId(id)}.json`);
  if (path.dirname(target) !== root) {
    throw new Error(`Project path escapes the project store: ${id}`);
  }
  return target;
}

async function lstatIfExists(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Resolve the configured root once and reject a symlink at that boundary.
 * Individual project paths are direct children, so there is no unvalidated
 * component between this verified directory and a project file.
 */
async function resolveProjectStoreRoot(store: DesignProjectStore): Promise<string> {
  const root = path.resolve(store.root);
  await mkdir(root, { recursive: true });

  const status = await lstat(root);
  if (status.isSymbolicLink()) {
    throw new Error(`Project store root is a symlink, refusing to follow it: ${store.root}`);
  }
  if (!status.isDirectory()) {
    throw new Error(`Project store root is not a directory: ${store.root}`);
  }

  return realpath(root);
}

function parseStoredProject(value: unknown, id: string): DesignProject {
  const version = ProjectVersionSchema.parse(value).schemaVersion;
  if (version > CURRENT_PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Design project "${id}" uses schemaVersion ${version}, which is newer than this server supports (${CURRENT_PROJECT_SCHEMA_VERSION}). Upgrade teguma before loading it.`,
    );
  }

  const project = DesignProjectSchema.parse(value);
  if (project.schemaVersion < CURRENT_PROJECT_SCHEMA_VERSION) {
    return migrateOlderProject(project);
  }
  return project;
}

/**
 * Seam for explicit, version-by-version migrations. Older project versions
 * stay rejected until their migration is implemented; accepting them without
 * one would silently alter or discard persisted design data.
 */
function migrateOlderProject(project: DesignProject): DesignProject {
  throw new Error(
    `Design project "${project.id}" uses older schemaVersion ${project.schemaVersion}. A migration to ${CURRENT_PROJECT_SCHEMA_VERSION} is required before it can be loaded.`,
  );
}

async function writeProjectAtomically(target: string, project: DesignProject): Promise<void> {
  const existing = await lstatIfExists(target);
  if (existing?.isSymbolicLink()) {
    throw new Error(`Refusing to overwrite a symlink inside the project store: ${target}`);
  }
  if (existing && !existing.isFile()) {
    throw new Error(`Refusing to overwrite a non-regular project file: ${target}`);
  }

  const temporary = path.join(
    path.dirname(target),
    `.${project.id}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporary, "wx", 0o600);

  try {
    await handle.writeFile(`${JSON.stringify(project, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();

    // Rename replaces a regular file atomically. Re-checking immediately
    // before it also refuses a symlink or directory planted at the final path.
    const finalStatus = await lstatIfExists(target);
    if (finalStatus?.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite a symlink inside the project store: ${target}`);
    }
    if (finalStatus && !finalStatus.isFile()) {
      throw new Error(`Refusing to overwrite a non-regular project file: ${target}`);
    }
    await rename(temporary, target);
  } finally {
    await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

/** Validate, normalize, and durably save one project envelope. */
export async function saveProject(
  store: DesignProjectStore,
  project: unknown,
): Promise<DesignProject> {
  const parsed = parseStoredProject(project, "(save request)");
  const root = await resolveProjectStoreRoot(store);
  await writeProjectAtomically(projectPath(root, parsed.id), parsed);
  return parsed;
}

/** Load a project, including defaults supplied by the document and brand-kit schemas. */
export async function loadProject(store: DesignProjectStore, id: string): Promise<DesignProject> {
  const root = await resolveProjectStoreRoot(store);
  const target = projectPath(root, id);
  const status = await lstatIfExists(target);

  if (!status) throw new Error(`Design project not found: ${id}`);
  if (status.isSymbolicLink()) {
    throw new Error(`Refusing to read a symlink inside the project store: ${target}`);
  }
  if (!status.isFile()) {
    throw new Error(`Project path is not a regular file: ${target}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(await readFile(target, "utf8"));
  } catch (error) {
    throw new Error(
      `Design project "${id}" contains invalid JSON and may be truncated or corrupt: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    return parseStoredProject(value, id);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Design project "${id}" fails schema validation: ${error.message}`);
    }
    throw error;
  }
}

/** List all valid saved projects in filename order, never relying on readdir order. */
export async function listProjects(store: DesignProjectStore): Promise<DesignProject[]> {
  const root = await resolveProjectStoreRoot(store);
  const entries = await readdir(root, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .filter((id) => ProjectIdSchema.safeParse(id).success)
    .sort();

  const projects: DesignProject[] = [];
  for (const id of ids) projects.push(await loadProject({ root }, id));
  return projects;
}

/** Delete one regular project file without following a symlink at its name. */
export async function deleteProject(store: DesignProjectStore, id: string): Promise<void> {
  const root = await resolveProjectStoreRoot(store);
  const target = projectPath(root, id);
  const status = await lstatIfExists(target);

  if (!status) throw new Error(`Design project not found: ${id}`);
  if (status.isSymbolicLink()) {
    throw new Error(`Refusing to delete a symlink inside the project store: ${target}`);
  }
  if (!status.isFile()) {
    throw new Error(`Project path is not a regular file: ${target}`);
  }
  await unlink(target);
}

export type { BrandKit, DesignDocument };
