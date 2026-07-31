import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MANIFEST,
  loadStockManifest,
  parseStockManifest,
  resolveContainedPath,
  resolveRepositoryPath,
  verifyStockCollection,
} from '../scripts/verify-stock.mjs'

describe('generated stock library', () => {
  it('preserves every original with matching bytes, hash, and dimensions', async () => {
    const report = await verifyStockCollection()

    expect(report.passed).toBe(true)
    expect(report.assets).toHaveLength(3)
    expect(report.assets.every((asset) => asset.checks.every((check) => check.pass))).toBe(true)
  })

  it('records AI provenance without claiming a signed Content Credential', async () => {
    const manifest = await loadStockManifest()

    expect(manifest.provenance.c2paStatus).toBe('unsigned')
    expect(manifest.provenance.digitalSourceType).toContain('trainedAlgorithmicMedia')
    expect(manifest.assets.every((asset) => asset.action.name === 'c2pa.created')).toBe(true)
    expect(manifest.assets.every((asset) => asset.rights.ownershipClaim === 'not-asserted')).toBe(true)
  })

  it('rejects duplicate source files and hashes', async () => {
    const manifest = await loadStockManifest()
    const duplicate = structuredClone(manifest)
    duplicate.assets.push(structuredClone(duplicate.assets[0]))

    expect(() => parseStockManifest(duplicate)).toThrow(/Duplicate asset/)
  })

  it('rejects an original path outside its collection', () => {
    const collectionDirectory = path.dirname(DEFAULT_MANIFEST)

    expect(() => resolveContainedPath(collectionDirectory, '../../../../etc/passwd'))
      .toThrow(/escapes allowed directory/)
  })

  it('rejects a derivative path outside the repository', () => {
    const collectionDirectory = path.dirname(DEFAULT_MANIFEST)

    expect(() => resolveRepositoryPath(collectionDirectory, '../../../../outside.png'))
      .toThrow(/escapes repository/)
  })
})
