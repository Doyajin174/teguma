import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  loadStockManifest,
  verifyStockCollection,
} from '../scripts/verify-stock.mjs'

const MANIFEST = fileURLToPath(
  new URL('../stock/generated/company-promo-v2/manifest.json', import.meta.url),
)

describe('human editorial v2 generated stock library', () => {
  it('preserves all three generated originals and their derivatives', async () => {
    const report = await verifyStockCollection(MANIFEST)

    expect(report.collectionId).toBe('company-promo-editorial-v2-2026-07')
    expect(report.passed).toBe(true)
    expect(report.assets).toHaveLength(3)
    expect(report.assets.every((asset) => asset.checks.every((check) => check.pass))).toBe(true)
  })

  it('discloses trained-algorithmic media without claiming signed credentials', async () => {
    const manifest = await loadStockManifest(MANIFEST)

    expect(manifest.provenance.c2paStatus).toBe('unsigned')
    expect(manifest.provenance.digitalSourceType).toContain('trainedAlgorithmicMedia')
    expect(manifest.assets.every((asset) => asset.action.name === 'c2pa.created')).toBe(true)
    expect(manifest.assets.every((asset) => asset.rights.ownershipClaim === 'not-asserted')).toBe(true)
    expect(manifest.assets.every((asset) => asset.prompt.text.length >= 10)).toBe(true)
  })
})
