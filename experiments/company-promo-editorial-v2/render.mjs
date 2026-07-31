import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { PNG } from 'pngjs'
import { z } from 'zod'

const TESTBED_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TESTBED_DIR, '../..')
const OUTPUT_DIR = path.join(TESTBED_DIR, 'output')
const FONT_FILES = [
  path.join(TESTBED_DIR, 'assets/fonts/IBMPlexSansKR-Regular.ttf'),
  path.join(TESTBED_DIR, 'assets/fonts/IBMPlexSansKR-SemiBold.ttf'),
]
const FONT_FAMILY = 'IBM Plex Sans KR'

const BoundsSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
})

const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

const CampaignSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  company: z.string().min(1),
  template: z.enum(['field-split', 'workspace-note', 'site-report']),
  background: z.string().min(1),
  logo: z.string().min(1),
  sourceUrl: z.string().url(),
  eyebrow: z.string().min(1),
  headline: z.tuple([z.string().min(1).max(13), z.string().min(1).max(13)]),
  body: z.tuple([z.string().min(1), z.string().min(1)]),
  details: z.array(z.string().min(1)).length(3),
  footer: z.string().min(1),
  palette: z.object({
    surface: HexColorSchema,
    ink: HexColorSchema,
    muted: HexColorSchema,
    accent: HexColorSchema,
  }),
  layout: z.object({
    textBounds: BoundsSchema,
    subjectBounds: BoundsSchema,
    logoBounds: BoundsSchema,
  }),
})

const TestbedSpecSchema = z.object({
  version: z.literal('v2'),
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    safeMargin: z.number().nonnegative(),
  }),
  visualPolicy: z.object({
    fontFamilies: z.tuple([z.literal(FONT_FAMILY)]),
    usesGradient: z.literal(false),
    usesFilter: z.literal(false),
    usesTextStroke: z.literal(false),
    usesRoundedPills: z.literal(false),
    effects: z.tuple([]),
  }),
  campaigns: z.array(CampaignSchema).length(3),
}).superRefine((spec, context) => {
  const ids = new Set()
  for (const [index, campaign] of spec.campaigns.entries()) {
    if (ids.has(campaign.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate campaign id: ${campaign.id}`,
        path: ['campaigns', index, 'id'],
      })
    }
    ids.add(campaign.id)
  }
})

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function mimeType(filePath) {
  if (filePath.endsWith('.svg')) return 'image/svg+xml'
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/png'
}

export function resolveAssetPath(relativePath) {
  const absolutePath = path.resolve(TESTBED_DIR, relativePath)
  if (
    absolutePath !== REPO_ROOT
    && !absolutePath.startsWith(`${REPO_ROOT}${path.sep}`)
  ) {
    throw new Error(`Asset path escapes repository: ${relativePath}`)
  }
  return absolutePath
}

async function dataUri(relativePath) {
  const absolutePath = resolveAssetPath(relativePath)
  const data = await readFile(absolutePath)
  return `data:${mimeType(absolutePath)};base64,${data.toString('base64')}`
}

function rectsIntersect(a, b) {
  return !(
    a.x + a.width <= b.x
    || b.x + b.width <= a.x
    || a.y + a.height <= b.y
    || b.y + b.height <= a.y
  )
}

function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function luminance(hex) {
  const channels = hexToRgb(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}

export function contrastRatio(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function check(name, pass, value) {
  return { name, pass, ...(value === undefined ? {} : { value }) }
}

export function validateCampaign(campaign, canvas, visualPolicy) {
  const { textBounds, subjectBounds, logoBounds } = campaign.layout
  const bounds = [
    ['textBounds', textBounds],
    ['subjectBounds', subjectBounds],
    ['logoBounds', logoBounds],
  ]
  const checks = bounds.map(([name, box]) => check(
    `${name}-inside-canvas`,
    box.x >= 0
      && box.y >= 0
      && box.x + box.width <= canvas.width
      && box.y + box.height <= canvas.height,
  ))

  checks.push(
    check('headline-avoids-subject', !rectsIntersect(textBounds, subjectBounds)),
    check('logo-avoids-subject', !rectsIntersect(logoBounds, subjectBounds)),
    check('logo-avoids-copy', !rectsIntersect(logoBounds, textBounds)),
    check(
      'content-respects-safe-area',
      [textBounds, logoBounds].every((box) => (
        box.x >= canvas.safeMargin
        && box.y >= canvas.safeMargin
        && box.x + box.width <= canvas.width - canvas.safeMargin
        && box.y + box.height <= canvas.height - canvas.safeMargin
      )),
    ),
    check(
      'copy-is-bounded',
      campaign.headline.length === 2
        && campaign.headline.every((line) => line.length > 0 && line.length <= 13),
    ),
    check(
      'core-text-contrast',
      contrastRatio(campaign.palette.ink, campaign.palette.surface) >= 4.5,
      Number(contrastRatio(campaign.palette.ink, campaign.palette.surface).toFixed(2)),
    ),
    check(
      'supporting-text-contrast',
      contrastRatio(campaign.palette.muted, campaign.palette.surface) >= 4.5,
      Number(contrastRatio(campaign.palette.muted, campaign.palette.surface).toFixed(2)),
    ),
    check(
      'accent-contrast',
      contrastRatio(campaign.palette.accent, campaign.palette.surface) >= 3,
      Number(contrastRatio(campaign.palette.accent, campaign.palette.surface).toFixed(2)),
    ),
    check(
      'effects-policy-is-empty',
      visualPolicy.effects.length === 0
        && !visualPolicy.usesGradient
        && !visualPolicy.usesFilter
        && !visualPolicy.usesTextStroke
        && !visualPolicy.usesRoundedPills,
    ),
  )

  return checks
}

export function validateSvgStyle(svg) {
  const withoutEmbeddedAssets = svg.replace(/href="data:[^"]+"/g, 'href="data:"')
  const textNodes = withoutEmbeddedAssets.match(/<text\b[^>]*>/g) ?? []
  return [
    check('svg-has-no-gradient', !/<(?:linear|radial)Gradient\b/i.test(withoutEmbeddedAssets)),
    check('svg-has-no-filter', !/\bfilter\s*=/i.test(withoutEmbeddedAssets)),
    check('svg-has-no-drop-shadow', !/<feDropShadow\b/i.test(withoutEmbeddedAssets)),
    check('svg-has-no-text-stroke', !/<text\b[^>]*\bstroke\s*=/i.test(withoutEmbeddedAssets)),
    check('svg-has-no-rounded-pills', !/\brx\s*=/i.test(withoutEmbeddedAssets)),
    check(
      'svg-uses-only-approved-text-font',
      textNodes.length > 0
        && textNodes.every((node) => node.includes(`font-family="${FONT_FAMILY}"`)),
    ),
  ]
}

export function parseSpec(value) {
  return TestbedSpecSchema.parse(value)
}

export async function loadSpec() {
  const value = JSON.parse(await readFile(path.join(TESTBED_DIR, 'campaigns.json'), 'utf8'))
  return parseSpec(value)
}

function text({
  x,
  y,
  value,
  size,
  fill,
  weight = 400,
  anchor = 'start',
  opacity = 1,
  letterSpacing = 0,
}) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${weight}" letter-spacing="${letterSpacing}" fill="${fill}" opacity="${opacity}">${escapeXml(value)}</text>`
}

async function renderSevasa(campaign, canvas) {
  const background = await dataUri(campaign.background)
  const logo = await dataUri(campaign.logo)
  const [first, second] = campaign.headline
  const [bodyFirst, bodySecond] = campaign.body
  const { surface, ink, muted, accent } = campaign.palette
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    <image href="${background}" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>
    <rect x="0" y="0" width="464" height="1080" fill="${surface}"/>
    <path d="M464 0V1080" stroke="#D6D3CB" stroke-width="1"/>
    <image href="${logo}" x="56" y="58" width="217" height="55" preserveAspectRatio="xMinYMid meet"/>
    ${text({ x: 56, y: 178, value: campaign.eyebrow, size: 17, fill: muted, weight: 600, letterSpacing: 1.2 })}
    <path d="M56 204H124" stroke="${accent}" stroke-width="4"/>
    ${text({ x: 56, y: 316, value: first, size: 43, fill: ink, weight: 600, letterSpacing: -1.6 })}
    ${text({ x: 56, y: 380, value: second, size: 43, fill: ink, weight: 600, letterSpacing: -1.6 })}
    ${text({ x: 56, y: 470, value: bodyFirst, size: 20, fill: muted, letterSpacing: -0.4 })}
    ${text({ x: 56, y: 504, value: bodySecond, size: 20, fill: muted, letterSpacing: -0.4 })}
    <path d="M56 574H408" stroke="#B9B7B0" stroke-width="1"/>
    ${campaign.details.map((detail, index) => {
      const y = 632 + (index * 76)
      return `
        ${text({ x: 56, y, value: `0${index + 1}`, size: 15, fill: accent, weight: 600, letterSpacing: 1 })}
        ${text({ x: 104, y, value: detail, size: 21, fill: ink, weight: 600, letterSpacing: -0.3 })}
        <path d="M104 ${y + 18}H408" stroke="#D0CDC5" stroke-width="1"/>
      `
    }).join('')}
    ${text({ x: 56, y: 1002, value: campaign.footer, size: 15, fill: muted, letterSpacing: 0.3 })}
  </svg>`
}

async function renderSupershorts(campaign, canvas) {
  const background = await dataUri(campaign.background)
  const logo = await dataUri(campaign.logo)
  const [first, second] = campaign.headline
  const [bodyFirst, bodySecond] = campaign.body
  const { ink, muted, accent } = campaign.palette
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    <image href="${background}" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>
    <image href="${logo}" x="48" y="48" width="52" height="52"/>
    ${text({ x: 116, y: 84, value: campaign.company, size: 27, fill: ink, weight: 600, letterSpacing: -0.6 })}
    <path d="M48 154V184" stroke="${accent}" stroke-width="4"/>
    ${text({ x: 64, y: 176, value: campaign.eyebrow, size: 16, fill: muted, weight: 600, letterSpacing: 1.2 })}
    ${text({ x: 48, y: 282, value: first, size: 39, fill: ink, weight: 600, letterSpacing: -1.5 })}
    ${text({ x: 48, y: 342, value: second, size: 46, fill: accent, weight: 600, letterSpacing: -1.8 })}
    ${text({ x: 48, y: 424, value: bodyFirst, size: 19, fill: muted, letterSpacing: -0.4 })}
    ${text({ x: 48, y: 456, value: bodySecond, size: 19, fill: muted, letterSpacing: -0.4 })}
    <rect x="0" y="900" width="1080" height="180" fill="${ink}"/>
    ${campaign.details.map((detail, index) => text({
      x: 48 + (index * 248),
      y: 958,
      value: `0${index + 1}  ${detail}`,
      size: 17,
      fill: index === 0 ? '#FFFFFF' : '#BFC5CE',
      weight: index === 0 ? 600 : 400,
      letterSpacing: -0.2,
    })).join('')}
    <path d="M48 986H1032" stroke="#48515A" stroke-width="1"/>
    ${text({ x: 48, y: 1032, value: 'BLOG  /  SCRIPT  /  SHORTS', size: 16, fill: '#AEB6C0', weight: 600, letterSpacing: 1.2 })}
    ${text({ x: 1032, y: 1032, value: `${campaign.footer}  →`, size: 19, fill: '#FFFFFF', weight: 600, anchor: 'end', letterSpacing: -0.2 })}
    <rect x="0" y="1076" width="1080" height="4" fill="${accent}"/>
  </svg>`
}

async function renderRoadmap(campaign, canvas) {
  const background = await dataUri(campaign.background)
  const logo = await dataUri(campaign.logo)
  const [first, second] = campaign.headline
  const [bodyFirst, bodySecond] = campaign.body
  const { surface, ink, muted, accent } = campaign.palette
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    <image href="${background}" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>
    <rect x="48" y="48" width="448" height="880" fill="${surface}"/>
    <image href="${logo}" x="76" y="76" width="234" height="53" preserveAspectRatio="xMinYMid meet"/>
    <path d="M76 164H132" stroke="${accent}" stroke-width="4"/>
    ${text({ x: 76, y: 204, value: campaign.eyebrow, size: 15, fill: muted, weight: 600, letterSpacing: 1 })}
    ${text({ x: 76, y: 312, value: first, size: 34, fill: ink, weight: 600, letterSpacing: -1.4 })}
    ${text({ x: 76, y: 396, value: second, size: 61, fill: ink, weight: 600, letterSpacing: -2 })}
    ${text({ x: 76, y: 478, value: bodyFirst, size: 20, fill: muted, letterSpacing: -0.4 })}
    ${text({ x: 76, y: 512, value: bodySecond, size: 20, fill: muted, letterSpacing: -0.4 })}
    <path d="M76 574H452" stroke="#445056" stroke-width="1"/>
    ${campaign.details.map((detail, index) => {
      const y = 630 + (index * 68)
      return `
        ${text({ x: 76, y, value: `0${index + 1}`, size: 14, fill: accent, weight: 600, letterSpacing: 1 })}
        ${text({ x: 126, y, value: detail, size: 20, fill: ink, weight: 600, letterSpacing: -0.2 })}
      `
    }).join('')}
    <path d="M76 828H452" stroke="#445056" stroke-width="1"/>
    ${text({ x: 76, y: 874, value: campaign.footer, size: 14, fill: muted, letterSpacing: 0.7 })}
    <rect x="48" y="924" width="448" height="4" fill="${accent}"/>
  </svg>`
}

const TEMPLATE_RENDERERS = {
  'field-split': renderSevasa,
  'workspace-note': renderSupershorts,
  'site-report': renderRoadmap,
}

export async function buildSvg(campaign, canvas) {
  const renderer = TEMPLATE_RENDERERS[campaign.template]
  if (!renderer) throw new Error(`Unknown template: ${campaign.template}`)
  return renderer(campaign, canvas)
}

function renderPng(svg, fitTo = { mode: 'original' }) {
  const renderer = new Resvg(svg, {
    fitTo,
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: FONT_FAMILY,
    },
  })
  return renderer.render().asPng()
}

async function pngDimensions(filePath) {
  const png = PNG.sync.read(await readFile(filePath))
  return { width: png.width, height: png.height }
}

async function buildContactSheet(campaigns) {
  const cards = await Promise.all(campaigns.map(async (campaign, index) => {
    const png = await readFile(path.join(OUTPUT_DIR, `${campaign.id}.png`))
    const href = `data:image/png;base64,${png.toString('base64')}`
    const x = 40 + (index * 580)
    return `
      <g transform="translate(${x} 108)">
        <rect x="0" y="0" width="520" height="520" fill="#FFFFFF"/>
        <image href="${href}" width="520" height="520"/>
        ${text({ x: 0, y: 568, value: `0${index + 1}`, size: 15, fill: '#737A7E', weight: 600, letterSpacing: 1 })}
        ${text({ x: 42, y: 568, value: campaign.company, size: 24, fill: '#171C1F', weight: 600, letterSpacing: -0.4 })}
      </g>`
  }))

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1780" height="730" viewBox="0 0 1780 730">
    <rect width="1780" height="730" fill="#EEECE6"/>
    ${text({ x: 40, y: 58, value: 'TEGUMA / HUMAN EDITORIAL DIRECTION V2', size: 25, fill: '#171C1F', weight: 600, letterSpacing: 0.4 })}
    <path d="M40 76H1740" stroke="#C9C6BE" stroke-width="1"/>
    ${cards.join('')}
  </svg>`
}

async function buildComparisonSheet(campaigns) {
  const cards = await Promise.all(campaigns.flatMap((campaign, index) => [
    { campaign, index, version: 'v1', y: 128 },
    { campaign, index, version: 'v2', y: 734 },
  ]).map(async ({ campaign, index, version, y }) => {
    const source = version === 'v1'
      ? `../company-promo-testbed/output/${campaign.id}.png`
      : `output/${campaign.id}.png`
    const png = await readFile(resolveAssetPath(source))
    const href = `data:image/png;base64,${png.toString('base64')}`
    const x = 40 + (index * 580)
    return `<image href="${href}" x="${x}" y="${y}" width="520" height="520"/>`
  }))

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1780" height="1320" viewBox="0 0 1780 1320">
    <rect width="1780" height="1320" fill="#EEECE6"/>
    ${text({ x: 40, y: 58, value: 'COMPANY PROMOTION / DIRECTION COMPARISON', size: 25, fill: '#171C1F', weight: 600, letterSpacing: 0.4 })}
    <path d="M40 76H1740" stroke="#C9C6BE" stroke-width="1"/>
    ${text({ x: 40, y: 112, value: 'V1  /  EFFECT-LED', size: 15, fill: '#697176', weight: 600, letterSpacing: 1 })}
    ${text({ x: 40, y: 718, value: 'V2  /  FIELD-LED', size: 15, fill: '#007A3D', weight: 600, letterSpacing: 1 })}
    ${cards.join('')}
    <path d="M40 1282H1740" stroke="#C9C6BE" stroke-width="1"/>
    ${campaigns.map((campaign, index) => text({
      x: 40 + (index * 580),
      y: 1308,
      value: campaign.company,
      size: 15,
      fill: '#697176',
      weight: 600,
      letterSpacing: 0.2,
    })).join('')}
  </svg>`
}

export async function main() {
  const spec = await loadSpec()
  await mkdir(OUTPUT_DIR, { recursive: true })
  const report = {
    schemaVersion: 1,
    direction: 'human-editorial-v2',
    renderer: '@resvg/resvg-js',
    sourceRoot: path.relative(REPO_ROOT, TESTBED_DIR),
    visualPolicy: spec.visualPolicy,
    campaigns: [],
    artifacts: [],
  }

  for (const campaign of spec.campaigns) {
    const svg = await buildSvg(campaign, spec.canvas)
    const svgPath = path.join(OUTPUT_DIR, `${campaign.id}.svg`)
    const pngPath = path.join(OUTPUT_DIR, `${campaign.id}.png`)
    await writeFile(svgPath, svg)
    await writeFile(pngPath, renderPng(svg, { mode: 'width', value: spec.canvas.width }))

    const dimensions = await pngDimensions(pngPath)
    const checks = [
      ...validateCampaign(campaign, spec.canvas, spec.visualPolicy),
      ...validateSvgStyle(svg),
      check(
        'rendered-dimensions',
        dimensions.width === spec.canvas.width && dimensions.height === spec.canvas.height,
        dimensions,
      ),
    ]
    report.campaigns.push({
      id: campaign.id,
      company: campaign.company,
      output: path.relative(TESTBED_DIR, pngPath),
      passed: checks.every((item) => item.pass),
      checks,
    })
  }

  const sheets = [
    ['contact-sheet', await buildContactSheet(spec.campaigns), { width: 1780, height: 730 }],
    ['comparison-v1-v2', await buildComparisonSheet(spec.campaigns), { width: 1780, height: 1320 }],
  ]
  for (const [name, svg, expected] of sheets) {
    const svgPath = path.join(OUTPUT_DIR, `${name}.svg`)
    const pngPath = path.join(OUTPUT_DIR, `${name}.png`)
    await writeFile(svgPath, svg)
    await writeFile(pngPath, renderPng(svg))
    const dimensions = await pngDimensions(pngPath)
    report.artifacts.push({
      name,
      output: path.relative(TESTBED_DIR, pngPath),
      passed: dimensions.width === expected.width && dimensions.height === expected.height,
      checks: [check('rendered-dimensions', dimensions.width === expected.width && dimensions.height === expected.height, dimensions)],
    })
  }

  report.passed = report.campaigns.every((campaign) => campaign.passed)
    && report.artifacts.every((artifact) => artifact.passed)
  await writeFile(path.join(OUTPUT_DIR, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`)

  if (!report.passed) {
    throw new Error('One or more editorial campaign QA checks failed')
  }

  console.log(`Rendered ${report.campaigns.length} editorial campaigns to ${path.relative(process.cwd(), OUTPUT_DIR)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
