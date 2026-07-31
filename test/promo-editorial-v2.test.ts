import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import {
  buildSvg,
  contrastRatio,
  loadSpec,
  parseSpec,
  resolveAssetPath,
  validateCampaign,
  validateSvgStyle,
} from '../experiments/company-promo-editorial-v2/render.mjs'

const OUTPUT_DIRECTORY = fileURLToPath(
  new URL('../experiments/company-promo-editorial-v2/output/', import.meta.url),
)

describe('human editorial company promotion v2', () => {
  it('keeps copy and logos inside the safe area and away from the subject', async () => {
    const spec = await loadSpec()

    for (const campaign of spec.campaigns) {
      const checks = validateCampaign(campaign, spec.canvas, spec.visualPolicy)
      expect(checks, campaign.id).toSatisfy(
        (items: Array<{ pass: boolean }>) => items.every((item) => item.pass),
      )
    }
  })

  it('builds exact campaign copy without the banned effect grammar', async () => {
    const spec = await loadSpec()

    for (const campaign of spec.campaigns) {
      const svg = await buildSvg(campaign, spec.canvas)
      const styleChecks = validateSvgStyle(svg)

      expect(svg).toContain(campaign.headline[0])
      expect(svg).toContain(campaign.headline[1])
      expect(svg).toContain(campaign.body[0])
      expect(svg).not.toMatch(/(?:="(?:undefined|null)"|>(?:undefined|null)<)/)
      expect(styleChecks, campaign.id).toSatisfy(
        (items: Array<{ pass: boolean }>) => items.every((item) => item.pass),
      )
    }
  })

  it('declares a deliberately empty visual-effects policy', async () => {
    const spec = await loadSpec()

    expect(spec.visualPolicy).toEqual({
      fontFamilies: ['IBM Plex Sans KR'],
      usesGradient: false,
      usesFilter: false,
      usesTextStroke: false,
      usesRoundedPills: false,
      effects: [],
    })
  })

  it('uses readable contrast for all opaque copy surfaces', async () => {
    const spec = await loadSpec()

    for (const campaign of spec.campaigns) {
      expect(contrastRatio(campaign.palette.ink, campaign.palette.surface), campaign.id)
        .toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(campaign.palette.muted, campaign.palette.surface), campaign.id)
        .toBeGreaterThanOrEqual(4.5)
    }
  })

  it('renders all campaign and comparison PNGs at their declared sizes', async () => {
    const expected = [
      ['sevasa.png', 1080, 1080],
      ['supershorts.png', 1080, 1080],
      ['roadmap.png', 1080, 1080],
      ['contact-sheet.png', 1780, 730],
      ['comparison-v1-v2.png', 1780, 1320],
    ] as const

    for (const [file, width, height] of expected) {
      const png = PNG.sync.read(await readFile(`${OUTPUT_DIRECTORY}${file}`))
      expect({ width: png.width, height: png.height }, file).toEqual({ width, height })
    }
  })

  it('rejects repository escapes and duplicate campaign ids', async () => {
    expect(() => resolveAssetPath('../../../etc/passwd')).toThrow(/escapes repository/)

    const spec = await loadSpec()
    const duplicate = structuredClone(spec)
    duplicate.campaigns.push(structuredClone(duplicate.campaigns[0]))
    expect(() => parseSpec(duplicate)).toThrow()
  })
})
