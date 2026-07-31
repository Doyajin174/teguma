import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { PNG } from 'pngjs'
import { z } from 'zod'
import {
  resolveContainedAssetPath,
  resolveContainedAssetRealPath,
} from '../../scripts/resolve-asset.mjs'

const TESTBED_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TESTBED_DIR, '../..')
const OUTPUT_DIR = path.join(TESTBED_DIR, 'output')
const FONT_FAMILY = 'IBM Plex Sans KR'
const FONT_FILES = [
  path.join(TESTBED_DIR, '../company-promo-editorial-v2/assets/fonts/IBMPlexSansKR-Regular.ttf'),
  path.join(TESTBED_DIR, '../company-promo-editorial-v2/assets/fonts/IBMPlexSansKR-SemiBold.ttf'),
]

const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/)

const BoundsSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
})

const PointSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
})

const CampaignSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  company: z.string().min(1),
  background: z.string().min(1),
  sourceUrl: z.string().url(),
  hook: z.string().min(1),
  externalTitle: z.tuple([z.string().min(1), z.string().min(1)]),
  previewExcerpt: z.string().min(1),
  author: z.string().min(1),
  palette: z.object({
    overlay: HexColorSchema,
    text: HexColorSchema,
    accent: HexColorSchema,
  }),
  layout: z.object({
    overlay: BoundsSchema,
    focusPoint: PointSchema,
    subjectCoverage: z.number().min(0).max(1),
  }),
})

const TestbedSpecSchema = z.object({
  version: z.literal('v3'),
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    safeMargin: z.number().nonnegative(),
  }),
  displayTests: z.object({
    search: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    homefeed: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      cropTop: z.number().nonnegative(),
      cropBottom: z.number().positive(),
    }),
  }),
  visualPolicy: z.object({
    fontFamily: z.literal(FONT_FAMILY),
    fontSize: z.number().positive(),
    maxHookCharacters: z.number().int().positive(),
    maxOverlayRatio: z.number().positive().max(1),
    usesGradient: z.literal(false),
    usesFilter: z.literal(false),
    usesTextStroke: z.literal(false),
    usesRoundedPills: z.literal(false),
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
  return resolveContainedAssetPath(TESTBED_DIR, REPO_ROOT, relativePath, 'repository')
}

export async function resolveAssetRealPath(relativePath) {
  return resolveContainedAssetRealPath(TESTBED_DIR, REPO_ROOT, relativePath, 'repository')
}

async function dataUri(relativePath) {
  const absolutePath = await resolveAssetRealPath(relativePath)
  const data = await readFile(absolutePath)
  return `data:${mimeType(absolutePath)};base64,${data.toString('base64')}`
}

async function pngDataUri(filePath) {
  const data = await readFile(await resolveAssetRealPath(filePath))
  return `data:image/png;base64,${data.toString('base64')}`
}

function pngBufferDataUri(data) {
  return `data:image/png;base64,${data.toString('base64')}`
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

function isInside(box, width, height) {
  return box.x >= 0
    && box.y >= 0
    && box.x + box.width <= width
    && box.y + box.height <= height
}

export function validateCampaign(campaign, spec) {
  const { canvas, displayTests, visualPolicy } = spec
  const { overlay, focusPoint, subjectCoverage } = campaign.layout
  const centralMarginX = canvas.width * 0.1
  const centralMarginY = canvas.height * 0.1
  const overlayRatio = (overlay.width * overlay.height) / (canvas.width * canvas.height)
  const displayFontSize = visualPolicy.fontSize * displayTests.search.width / canvas.width
  const hookCharacters = Array.from(campaign.hook).length

  return [
    check('overlay-inside-canvas', isInside(overlay, canvas.width, canvas.height)),
    check(
      'overlay-respects-safe-area',
      overlay.x >= canvas.safeMargin
        && overlay.y >= canvas.safeMargin
        && overlay.x + overlay.width <= canvas.width - canvas.safeMargin
        && overlay.y + overlay.height <= canvas.height - canvas.safeMargin,
    ),
    check(
      'hook-is-one-line',
      !/[\r\n]/.test(campaign.hook) && hookCharacters <= visualPolicy.maxHookCharacters,
      hookCharacters,
    ),
    check('search-font-is-readable', displayFontSize >= 11.5, Number(displayFontSize.toFixed(2))),
    check('overlay-area-is-bounded', overlayRatio <= visualPolicy.maxOverlayRatio, Number(overlayRatio.toFixed(4))),
    check(
      'overlay-survives-homefeed-crop',
      overlay.y >= displayTests.homefeed.cropTop
        && overlay.y + overlay.height <= displayTests.homefeed.cropBottom,
    ),
    check(
      'focus-stays-in-central-eighty-percent',
      focusPoint.x >= centralMarginX
        && focusPoint.x <= canvas.width - centralMarginX
        && focusPoint.y >= centralMarginY
        && focusPoint.y <= canvas.height - centralMarginY,
    ),
    check(
      'focus-survives-homefeed-crop',
      focusPoint.y >= displayTests.homefeed.cropTop
        && focusPoint.y <= displayTests.homefeed.cropBottom,
    ),
    check('subject-coverage-is-close', subjectCoverage >= 0.6 && subjectCoverage <= 0.75, subjectCoverage),
    check(
      'hook-text-contrast',
      contrastRatio(campaign.palette.text, campaign.palette.overlay) >= 4.5,
      Number(contrastRatio(campaign.palette.text, campaign.palette.overlay).toFixed(2)),
    ),
    check(
      'accent-contrast',
      contrastRatio(campaign.palette.accent, campaign.palette.overlay) >= 3,
      Number(contrastRatio(campaign.palette.accent, campaign.palette.overlay).toFixed(2)),
    ),
    check(
      'effects-policy-is-off',
      !visualPolicy.usesGradient
        && !visualPolicy.usesFilter
        && !visualPolicy.usesTextStroke
        && !visualPolicy.usesRoundedPills,
    ),
  ]
}

export function validateSvgStyle(svg) {
  const withoutEmbeddedAssets = svg.replace(/href="data:[^"]+"/g, 'href="data:"')
  const textNodes = withoutEmbeddedAssets.match(/<text\b[^>]*>/g) ?? []
  const imageNodes = withoutEmbeddedAssets.match(/<image\b[^>]*>/g) ?? []
  return [
    check('svg-has-one-primary-image', imageNodes.length === 1, imageNodes.length),
    check('svg-has-one-text-node', textNodes.length === 1, textNodes.length),
    check('svg-has-no-gradient', !/<(?:linear|radial)Gradient\b/i.test(withoutEmbeddedAssets)),
    check('svg-has-no-filter', !/\bfilter\s*=/i.test(withoutEmbeddedAssets)),
    check('svg-has-no-drop-shadow', !/<feDropShadow\b/i.test(withoutEmbeddedAssets)),
    check('svg-has-no-text-stroke', !/<text\b[^>]*\bstroke\s*=/i.test(withoutEmbeddedAssets)),
    check('svg-has-no-rounded-pills', !/\brx\s*=/i.test(withoutEmbeddedAssets)),
    check(
      'svg-uses-approved-font',
      textNodes.length === 1 && textNodes[0].includes(`font-family="${FONT_FAMILY}"`),
    ),
  ]
}

export function parseSpec(value) {
  return TestbedSpecSchema.parse(value)
}

export async function loadSpec() {
  const value = JSON.parse(await readFile(await resolveAssetRealPath('campaigns.json'), 'utf8'))
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

export async function buildSvg(campaign, spec) {
  const { canvas, visualPolicy } = spec
  const background = await dataUri(campaign.background)
  const { overlay } = campaign.layout
  const baseline = overlay.y + Math.round((overlay.height + (visualPolicy.fontSize * 0.68)) / 2)

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    <image href="${background}" width="${canvas.width}" height="${canvas.height}" preserveAspectRatio="xMidYMid slice"/>
    <rect x="${overlay.x}" y="${overlay.y}" width="${overlay.width}" height="${overlay.height}" fill="${campaign.palette.overlay}"/>
    <rect x="${overlay.x}" y="${overlay.y}" width="16" height="${overlay.height}" fill="${campaign.palette.accent}"/>
    ${text({
      x: overlay.x + 40,
      y: baseline,
      value: campaign.hook,
      size: visualPolicy.fontSize,
      fill: campaign.palette.text,
      weight: 600,
      letterSpacing: -3,
    })}
  </svg>`
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

function wrapCopy(value, maxCharacters = 23) {
  const words = value.split(' ')
  const lines = ['']
  for (const word of words) {
    const line = lines.at(-1)
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length > maxCharacters && line) lines.push(word)
    else lines[lines.length - 1] = candidate
  }
  return lines.slice(0, 2)
}

async function buildContactSheet(campaigns) {
  const cards = await Promise.all(campaigns.map(async (campaign, index) => {
    const href = await pngDataUri(path.join(OUTPUT_DIR, `${campaign.id}.png`))
    const x = 40 + (index * 580)
    return `
      <g transform="translate(${x} 108)">
        <image href="${href}" width="520" height="520"/>
        ${text({ x: 0, y: 568, value: `0${index + 1}`, size: 15, fill: '#687078', weight: 600, letterSpacing: 1 })}
        ${text({ x: 42, y: 568, value: campaign.company, size: 24, fill: '#15191D', weight: 600, letterSpacing: -0.5 })}
        ${text({ x: 520, y: 568, value: campaign.hook, size: 18, fill: '#687078', anchor: 'end', letterSpacing: -0.4 })}
      </g>`
  }))

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1780" height="730" viewBox="0 0 1780 730">
    <rect width="1780" height="730" fill="#F1F2F0"/>
    ${text({ x: 40, y: 58, value: 'NAVER BLOG THUMBNAIL / V3', size: 25, fill: '#15191D', weight: 600, letterSpacing: 0.4 })}
    <path d="M40 76H1740" stroke="#CDD1CE" stroke-width="1"/>
    ${cards.join('')}
  </svg>`
}

async function buildSearchPreview(campaigns) {
  const rows = await Promise.all(campaigns.map(async (campaign, index) => {
    const y = 72 + (index * 228)
    const href = await pngDataUri(path.join(OUTPUT_DIR, `${campaign.id}-104.png`))
    const excerptLines = wrapCopy(campaign.previewExcerpt, 24)
    return `
      <g transform="translate(0 ${y})">
        ${text({ x: 20, y: 26, value: campaign.author, size: 12, fill: '#737A78', weight: 400, letterSpacing: -0.2 })}
        ${text({ x: 20, y: 62, value: campaign.externalTitle[0], size: 18, fill: '#202422', weight: 600, letterSpacing: -0.6 })}
        ${text({ x: 20, y: 87, value: campaign.externalTitle[1], size: 18, fill: '#202422', weight: 600, letterSpacing: -0.6 })}
        ${excerptLines.map((line, lineIndex) => text({
          x: 20,
          y: 121 + (lineIndex * 19),
          value: line,
          size: 12,
          fill: '#737A78',
          letterSpacing: -0.25,
        })).join('')}
        <image href="${href}" x="306" y="39" width="104" height="104"/>
        ${text({ x: 20, y: 176, value: '2026. 7. 31.  ·  4분 읽기', size: 11, fill: '#A0A5A3', letterSpacing: -0.15 })}
        <path d="M20 208H410" stroke="#ECEEEC" stroke-width="1"/>
      </g>`
  }))

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="430" height="780" viewBox="0 0 430 780">
    <rect width="430" height="780" fill="#FFFFFF"/>
    ${text({ x: 20, y: 38, value: '블로그', size: 22, fill: '#202422', weight: 600, letterSpacing: -0.8 })}
    <rect x="91" y="22" width="46" height="23" fill="#E8F8EF"/>
    ${text({ x: 114, y: 38, value: 'VIEW', size: 11, fill: '#00A653', weight: 600, anchor: 'middle', letterSpacing: 0.4 })}
    <path d="M20 56H410" stroke="#DDE1DE" stroke-width="1"/>
    ${rows.join('')}
  </svg>`
}

async function buildHomefeedPreview(campaigns) {
  const cards = await Promise.all(campaigns.map(async (campaign, index) => {
    const href = await pngDataUri(path.join(OUTPUT_DIR, `${campaign.id}.png`))
    const x = 40 + (index * 580)
    return `
      <g transform="translate(${x} 118)">
        <rect width="520" height="514" fill="#FFFFFF"/>
        <image href="${href}" width="520" height="293" preserveAspectRatio="xMidYMid slice"/>
        ${text({ x: 24, y: 337, value: campaign.author, size: 13, fill: '#737A78', letterSpacing: -0.2 })}
        ${text({ x: 24, y: 380, value: campaign.externalTitle[0], size: 26, fill: '#202422', weight: 600, letterSpacing: -0.8 })}
        ${text({ x: 24, y: 416, value: campaign.externalTitle[1], size: 26, fill: '#202422', weight: 600, letterSpacing: -0.8 })}
        ${text({ x: 24, y: 465, value: campaign.previewExcerpt, size: 14, fill: '#737A78', letterSpacing: -0.3 })}
        ${text({ x: 24, y: 496, value: '2026. 7. 31.', size: 12, fill: '#A0A5A3' })}
      </g>`
  }))

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1780" height="700" viewBox="0 0 1780 700">
    <rect width="1780" height="700" fill="#F1F2F0"/>
    ${text({ x: 40, y: 58, value: 'HOME FEED / CENTER-CROPPED 16:9', size: 25, fill: '#15191D', weight: 600, letterSpacing: 0.4 })}
    <path d="M40 76H1740" stroke="#CDD1CE" stroke-width="1"/>
    ${cards.join('')}
  </svg>`
}

async function buildComparisonSheet(campaigns) {
  const groups = await Promise.all(campaigns.map(async (campaign, index) => {
    const v2Source = await pngDataUri(`../company-promo-editorial-v2/output/${campaign.id}.png`)
    const v2ThumbnailSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="104" height="104" viewBox="0 0 104 104">
        <image href="${v2Source}" width="104" height="104"/>
      </svg>`
    const v2 = pngBufferDataUri(renderPng(v2ThumbnailSvg))
    const v3 = await pngDataUri(path.join(OUTPUT_DIR, `${campaign.id}-104.png`))
    const x = 40 + (index * 580)
    return `
      <g transform="translate(${x} 116)">
        ${text({ x: 0, y: 0, value: campaign.company, size: 22, fill: '#15191D', weight: 600, letterSpacing: -0.4 })}
        ${text({ x: 0, y: 38, value: '실제 104px', size: 13, fill: '#737A78', letterSpacing: -0.2 })}
        <image href="${v2}" x="0" y="58" width="104" height="104"/>
        <image href="${v3}" x="140" y="58" width="104" height="104"/>
        ${text({ x: 52, y: 186, value: 'V2', size: 12, fill: '#737A78', weight: 600, anchor: 'middle' })}
        ${text({ x: 192, y: 186, value: 'V3', size: 12, fill: '#00A653', weight: 600, anchor: 'middle' })}
        ${text({ x: 0, y: 236, value: '104px 결과 확대', size: 13, fill: '#737A78', letterSpacing: -0.2 })}
        <image href="${v2}" x="0" y="256" width="250" height="250" image-rendering="pixelated"/>
        <image href="${v3}" x="270" y="256" width="250" height="250" image-rendering="pixelated"/>
      </g>`
  }))

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1780" height="690" viewBox="0 0 1780 690">
    <rect width="1780" height="690" fill="#F1F2F0"/>
    ${text({ x: 40, y: 58, value: 'V2 → V3 / 104PX LEGIBILITY', size: 25, fill: '#15191D', weight: 600, letterSpacing: 0.4 })}
    <path d="M40 76H1740" stroke="#CDD1CE" stroke-width="1"/>
    ${groups.join('')}
  </svg>`
}

export async function main() {
  const spec = await loadSpec()
  await mkdir(OUTPUT_DIR, { recursive: true })
  const report = {
    schemaVersion: 1,
    direction: 'naver-blog-thumbnail-v3',
    renderer: '@resvg/resvg-js',
    sourceRoot: path.relative(REPO_ROOT, TESTBED_DIR),
    visualPolicy: spec.visualPolicy,
    displayTests: spec.displayTests,
    campaigns: [],
    artifacts: [],
  }

  for (const campaign of spec.campaigns) {
    const svg = await buildSvg(campaign, spec)
    const svgPath = path.join(OUTPUT_DIR, `${campaign.id}.svg`)
    const pngPath = path.join(OUTPUT_DIR, `${campaign.id}.png`)
    const smallPath = path.join(OUTPUT_DIR, `${campaign.id}-104.png`)
    await writeFile(svgPath, svg)
    await writeFile(pngPath, renderPng(svg, { mode: 'width', value: spec.canvas.width }))
    await writeFile(smallPath, renderPng(svg, { mode: 'width', value: spec.displayTests.search.width }))

    const dimensions = await pngDimensions(pngPath)
    const smallDimensions = await pngDimensions(smallPath)
    const checks = [
      ...validateCampaign(campaign, spec),
      ...validateSvgStyle(svg),
      check(
        'rendered-dimensions',
        dimensions.width === spec.canvas.width && dimensions.height === spec.canvas.height,
        dimensions,
      ),
      check(
        'search-thumbnail-dimensions',
        smallDimensions.width === spec.displayTests.search.width
          && smallDimensions.height === spec.displayTests.search.height,
        smallDimensions,
      ),
    ]
    report.campaigns.push({
      id: campaign.id,
      company: campaign.company,
      output: path.relative(TESTBED_DIR, pngPath),
      searchOutput: path.relative(TESTBED_DIR, smallPath),
      passed: checks.every((item) => item.pass),
      checks,
    })
  }

  const sheets = [
    ['contact-sheet', await buildContactSheet(spec.campaigns), { width: 1780, height: 730 }],
    ['search-preview-104', await buildSearchPreview(spec.campaigns), { width: 430, height: 780 }],
    ['homefeed-preview', await buildHomefeedPreview(spec.campaigns), { width: 1780, height: 700 }],
    ['comparison-v2-v3-104', await buildComparisonSheet(spec.campaigns), { width: 1780, height: 690 }],
  ]

  for (const [name, svg, expected] of sheets) {
    const svgPath = path.join(OUTPUT_DIR, `${name}.svg`)
    const pngPath = path.join(OUTPUT_DIR, `${name}.png`)
    await writeFile(svgPath, svg)
    await writeFile(pngPath, renderPng(svg))
    const dimensions = await pngDimensions(pngPath)
    const passed = dimensions.width === expected.width && dimensions.height === expected.height
    report.artifacts.push({
      name,
      output: path.relative(TESTBED_DIR, pngPath),
      passed,
      checks: [check('rendered-dimensions', passed, dimensions)],
    })
  }

  report.passed = report.campaigns.every((campaign) => campaign.passed)
    && report.artifacts.every((artifact) => artifact.passed)
  await writeFile(path.join(OUTPUT_DIR, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`)

  if (!report.passed) throw new Error('One or more Naver thumbnail QA checks failed')

  console.log(`Rendered ${report.campaigns.length} Naver thumbnails to ${path.relative(process.cwd(), OUTPUT_DIR)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
