import { describe, expect, it } from 'vitest'
import {
  buildSvg,
  contrastRatio,
  loadSpec,
  parseSpec,
  resolveAssetPath,
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

  it('rejects asset paths outside the testbed', () => {
    expect(() => resolveAssetPath('../../../etc/passwd')).toThrow(/escapes testbed directory/)
  })

  it('rejects duplicate campaign ids before files can be overwritten', async () => {
    const spec = await loadSpec()
    const duplicate = structuredClone(spec)
    duplicate.campaigns.push(structuredClone(duplicate.campaigns[0]))

    expect(() => parseSpec(duplicate)).toThrow(/Duplicate campaign id/)
  })
})
