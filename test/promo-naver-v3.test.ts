import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import {
  buildSvg,
  contrastRatio,
  loadSpec,
  parseSpec,
  resolveAssetPath,
  resolveAssetRealPath,
  validateCampaign,
  validateSvgStyle,
} from '../experiments/company-promo-naver-v3/render.mjs'

const OUTPUT_DIRECTORY = fileURLToPath(
  new URL('../experiments/company-promo-naver-v3/output/', import.meta.url),
)

describe('Naver Blog company promotion thumbnail v3', () => {
  it('keeps one short hook readable in search and home-feed crops', async () => {
    const spec = await loadSpec()

    for (const campaign of spec.campaigns) {
      const checks = validateCampaign(campaign, spec)
      expect(checks, campaign.id).toSatisfy(
        (items: Array<{ pass: boolean }>) => items.every((item) => item.pass),
      )
    }

    expect(spec.visualPolicy.fontSize * 104 / spec.canvas.width).toBeGreaterThanOrEqual(11.5)
  })

  it('builds exactly one hook without effect-led visual grammar', async () => {
    const spec = await loadSpec()

    for (const campaign of spec.campaigns) {
      const svg = await buildSvg(campaign, spec)
      const styleChecks = validateSvgStyle(svg)

      expect(svg.match(/<text\b/g)).toHaveLength(1)
      expect(svg).toContain(campaign.hook)
      expect(svg).not.toContain(campaign.externalTitle[0])
      expect(svg).not.toMatch(/(?:="(?:undefined|null)"|>(?:undefined|null)<)/)
      expect(styleChecks, campaign.id).toSatisfy(
        (items: Array<{ pass: boolean }>) => items.every((item) => item.pass),
      )
    }
  })

  it('uses opaque surfaces with accessible hook and accent contrast', async () => {
    const spec = await loadSpec()

    for (const campaign of spec.campaigns) {
      expect(contrastRatio(campaign.palette.text, campaign.palette.overlay), campaign.id)
        .toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(campaign.palette.accent, campaign.palette.overlay), campaign.id)
        .toBeGreaterThanOrEqual(3)
    }
  })

  it('renders campaigns, exact 104px thumbnails, and exposure previews', async () => {
    const expected = [
      ['sevasa.png', 1080, 1080],
      ['supershorts.png', 1080, 1080],
      ['roadmap.png', 1080, 1080],
      ['sevasa-104.png', 104, 104],
      ['supershorts-104.png', 104, 104],
      ['roadmap-104.png', 104, 104],
      ['contact-sheet.png', 1780, 730],
      ['search-preview-104.png', 430, 780],
      ['homefeed-preview.png', 1780, 700],
      ['comparison-v2-v3-104.png', 1780, 690],
    ] as const

    for (const [file, width, height] of expected) {
      const png = PNG.sync.read(await readFile(`${OUTPUT_DIRECTORY}${file}`))
      expect({ width: png.width, height: png.height }, file).toEqual({ width, height })
    }
  })

  it('rejects lexical and symlink repository escapes and duplicate campaign ids', async () => {
    expect(() => resolveAssetPath('../../../etc/passwd')).toThrow(/escapes repository/)

    const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'teguma-v3-'))
    const outsideFile = path.join(outsideDirectory, 'outside.txt')
    const linkPath = fileURLToPath(
      new URL('../experiments/company-promo-naver-v3/output/.outside-link', import.meta.url),
    )
    await writeFile(outsideFile, 'outside repository')
    await rm(linkPath, { force: true })
    await symlink(outsideFile, linkPath)
    try {
      await expect(resolveAssetRealPath('output/.outside-link'))
        .rejects.toThrow(/real path escapes repository/)
    } finally {
      await rm(linkPath, { force: true })
      await rm(outsideDirectory, { recursive: true, force: true })
    }

    const spec = await loadSpec()
    const duplicate = structuredClone(spec)
    duplicate.campaigns[2].id = duplicate.campaigns[0].id
    expect(() => parseSpec(duplicate)).toThrow(/Duplicate campaign id/)
  })
})
