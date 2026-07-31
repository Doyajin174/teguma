import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PNG } from 'pngjs'
import { z } from 'zod'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
export const DEFAULT_MANIFEST = path.join(
  REPO_ROOT,
  'stock/generated/company-promo/manifest.json',
)
const TRAINED_ALGORITHMIC_MEDIA =
  'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'

const RelativePathSchema = z.string().min(1).refine(
  (value) => !path.isAbsolute(value),
  'Path must be relative',
)

const DerivativeSchema = z.object({
  file: RelativePathSchema,
  relation: z.enum(['compressed-render-fixture', 'composed-campaign-thumbnail']),
})

const AssetSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  file: RelativePathSchema.refine(
    (value) => value.startsWith('originals/') && value.endsWith('.png'),
    'Original must be a PNG under originals/',
  ),
  sourceArtifactId: z.string().regex(/^exec-[a-f0-9-]+$/),
  createdAt: z.string().datetime({ offset: true }),
  mimeType: z.literal('image/png'),
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().min(1),
  description: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(3),
  promptSource: z.string().min(1),
  prompt: z.object({
    language: z.string().min(2),
    text: z.array(z.string().min(1)).min(6),
  }),
  action: z.object({
    name: z.literal('c2pa.created'),
    digitalSourceType: z.literal(TRAINED_ALGORITHMIC_MEDIA),
    softwareAgent: z.string().min(1),
  }),
  derivatives: z.array(DerivativeSchema).min(1),
  rights: z.object({
    ownershipClaim: z.literal('not-asserted'),
    usageTerms: z.string().min(1),
    thirdPartyReview: z.string().min(1),
  }),
})

const ManifestSchema = z.object({
  schemaVersion: z.literal(1),
  collectionId: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  provenance: z.object({
    recordType: z.literal('repository-sidecar'),
    c2paStatus: z.literal('unsigned'),
    c2paNote: z.string().min(1),
    digitalSourceType: z.literal(TRAINED_ALGORITHMIC_MEDIA),
    sourceSessionId: z.string().uuid(),
    generator: z.object({
      name: z.string().min(1),
      surface: z.string().min(1),
      model: z.string().min(1).nullable(),
    }),
  }),
  assets: z.array(AssetSchema).min(1),
}).superRefine((manifest, context) => {
  const seen = {
    id: new Set(),
    file: new Set(),
    sha256: new Set(),
    sourceArtifactId: new Set(),
  }

  for (const [index, asset] of manifest.assets.entries()) {
    for (const key of Object.keys(seen)) {
      const value = asset[key]
      if (seen[key].has(value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate asset ${key}: ${value}`,
          path: ['assets', index, key],
        })
      }
      seen[key].add(value)
    }
  }
})

export function parseStockManifest(value) {
  return ManifestSchema.parse(value)
}

export function resolveContainedPath(baseDirectory, relativePath) {
  const base = path.resolve(baseDirectory)
  const resolved = path.resolve(base, relativePath)
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Path escapes allowed directory: ${relativePath}`)
  }
  return resolved
}

export function resolveRepositoryPath(baseDirectory, relativePath) {
  const resolved = path.resolve(baseDirectory, relativePath)
  if (resolved !== REPO_ROOT && !resolved.startsWith(`${REPO_ROOT}${path.sep}`)) {
    throw new Error(`Path escapes repository: ${relativePath}`)
  }
  return resolved
}

function assertRealPathContained(baseDirectory, resolvedPath, label) {
  if (
    resolvedPath !== baseDirectory
    && !resolvedPath.startsWith(`${baseDirectory}${path.sep}`)
  ) {
    throw new Error(`${label} resolves outside allowed directory: ${resolvedPath}`)
  }
}

export async function loadStockManifest(manifestPath = DEFAULT_MANIFEST) {
  const value = JSON.parse(await readFile(manifestPath, 'utf8'))
  return parseStockManifest(value)
}

function check(name, pass, value) {
  return { name, pass, ...(value === undefined ? {} : { value }) }
}

export async function verifyStockCollection(manifestPath = DEFAULT_MANIFEST) {
  const manifest = await loadStockManifest(manifestPath)
  const collectionDirectory = path.dirname(path.resolve(manifestPath))
  const realCollectionDirectory = await realpath(collectionDirectory)
  const realRepositoryRoot = await realpath(REPO_ROOT)
  const assets = []

  for (const asset of manifest.assets) {
    const originalPath = resolveContainedPath(collectionDirectory, asset.file)
    const realOriginalPath = await realpath(originalPath)
    assertRealPathContained(realCollectionDirectory, realOriginalPath, 'Original')
    const data = await readFile(originalPath)
    const digest = createHash('sha256').update(data).digest('hex')
    const png = PNG.sync.read(data)
    const checks = [
      check('mime-type', asset.mimeType === 'image/png', asset.mimeType),
      check('byte-length', data.length === asset.bytes, data.length),
      check('sha256', digest === asset.sha256, digest),
      check(
        'dimensions',
        png.width === asset.width && png.height === asset.height,
        { width: png.width, height: png.height },
      ),
      check(
        'trained-algorithmic-media',
        asset.action.digitalSourceType === manifest.provenance.digitalSourceType,
        asset.action.digitalSourceType,
      ),
    ]

    for (const derivative of asset.derivatives) {
      const derivativePath = resolveRepositoryPath(collectionDirectory, derivative.file)
      const realDerivativePath = await realpath(derivativePath)
      assertRealPathContained(realRepositoryRoot, realDerivativePath, 'Derivative')
      const derivativeStat = await stat(derivativePath)
      checks.push(check(
        `derivative:${derivative.relation}`,
        derivativeStat.isFile(),
        path.relative(REPO_ROOT, derivativePath),
      ))
    }

    assets.push({
      id: asset.id,
      file: path.relative(REPO_ROOT, originalPath),
      passed: checks.every((item) => item.pass),
      checks,
    })
  }

  return {
    schemaVersion: manifest.schemaVersion,
    collectionId: manifest.collectionId,
    c2paStatus: manifest.provenance.c2paStatus,
    passed: assets.every((asset) => asset.passed),
    assets,
  }
}

export async function main() {
  const report = await verifyStockCollection(process.argv[2] || DEFAULT_MANIFEST)
  if (!report.passed) {
    throw new Error('One or more stock assets failed verification')
  }
  console.log(
    `Verified ${report.assets.length} original stock assets in ${report.collectionId}`,
  )
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main()
}
