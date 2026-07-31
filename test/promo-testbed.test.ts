import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  buildSvg,
  contrastRatio,
  loadSpec,
  parseSpec,
  resolveAssetPath,
  resolveAssetRealPath,
  validateCampaign,
} from '../experiments/company-promo-testbed/render.mjs'

describe('company promotion thumbnail testbed', () => {
  it('keeps every declared layout inside the canvas and away from the subject', async () => {
    const spec = await loadSpec()

    for (const campaign of spec.campaigns) {
      const checks = validateCampaign(campaign, spec.canvas)
      expect(checks, campaign.id).toSatisfy(
        (items: Array<{ pass: boolean }>) => items.every((item) => item.pass),
      )
    }
  })

  it('builds editable SVG with the exact Korean campaign copy', async () => {
    const spec = await loadSpec()

    for (const campaign of spec.campaigns) {
      const svg = await buildSvg(campaign, spec.canvas)
      expect(svg).toContain('<svg')
      expect(svg).toContain(campaign.headline[0])
      expect(svg).toContain(campaign.headline[1])
      expect(svg).toContain(campaign.subtitle)
      expect(svg).not.toMatch(/(?:=\"(?:undefined|null)\"|>(?:undefined|null)<)/)
    }
  })

  it('uses WCAG-readable contrast for core text layers', () => {
    expect(contrastRatio('#FFFFFF', '#061725')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#101B3D', '#FFFFFF')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio('#FFFFFF', '#07141D')).toBeGreaterThanOrEqual(4.5)
  })

  it('rejects lexical and symlink paths outside the testbed', async () => {
    expect(() => resolveAssetPath('../../../etc/passwd')).toThrow(/escapes testbed directory/)

    const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'teguma-v1-'))
    const outsideFile = path.join(outsideDirectory, 'outside.txt')
    const linkPath = fileURLToPath(
      new URL('../experiments/company-promo-testbed/output/.outside-link', import.meta.url),
    )
    await writeFile(outsideFile, 'outside testbed')
    await rm(linkPath, { force: true })
    await symlink(outsideFile, linkPath)
    try {
      await expect(resolveAssetRealPath('output/.outside-link'))
        .rejects.toThrow(/real path escapes testbed directory/)
    } finally {
      await rm(linkPath, { force: true })
      await rm(outsideDirectory, { recursive: true, force: true })
    }
  })

  it('rejects duplicate campaign ids before files can be overwritten', async () => {
    const spec = await loadSpec()
    const duplicate = structuredClone(spec)
    duplicate.campaigns.push(structuredClone(duplicate.campaigns[0]))

    expect(() => parseSpec(duplicate)).toThrow(/Duplicate campaign id/)
  })
})
