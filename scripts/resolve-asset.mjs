import { realpath } from 'node:fs/promises'
import path from 'node:path'

export function resolveContainedAssetPath(baseDirectory, allowedRoot, assetPath, scopeName) {
  const root = path.resolve(allowedRoot)
  const absolutePath = path.resolve(baseDirectory, assetPath)
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Asset path escapes ${scopeName}: ${assetPath}`)
  }
  return absolutePath
}

export async function resolveContainedAssetRealPath(
  baseDirectory,
  allowedRoot,
  assetPath,
  scopeName,
) {
  const absolutePath = resolveContainedAssetPath(
    baseDirectory,
    allowedRoot,
    assetPath,
    scopeName,
  )
  const [realRoot, realAssetPath] = await Promise.all([
    realpath(allowedRoot),
    realpath(absolutePath),
  ])
  if (realAssetPath !== realRoot && !realAssetPath.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error(`Asset real path escapes ${scopeName}: ${assetPath}`)
  }
  return realAssetPath
}
