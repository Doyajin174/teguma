import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { PNG } from 'pngjs'
import { z } from 'zod'

const TESTBED_DIR = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(TESTBED_DIR, '../..')
const OUTPUT_DIR = path.join(TESTBED_DIR, 'output')
const FONT_FILES = [
  path.join(TESTBED_DIR, 'assets/fonts/BlackHanSans-Regular.ttf'),
  path.join(TESTBED_DIR, 'assets/fonts/DoHyeon-Regular.ttf'),
]

const BoundsSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
})

const CampaignSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  company: z.string().min(1),
  template: z.enum(['split-tech', 'creator-pop', 'urban-grid']),
  background: z.string().min(1),
  logo: z.string().min(1),
  sourceUrl: z.string().url(),
  eyebrow: z.string().min(1),
  headline: z.tuple([z.string().min(1).max(13), z.string().min(1).max(13)]),
  subtitle: z.string().min(1),
  tags: z.array(z.string().min(1)).length(3),
  footer: z.string().min(1),
  palette: z.object({
    primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    signal: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    ink: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  }),
  layout: z.object({
    textBounds: BoundsSchema,
    subjectBounds: BoundsSchema,
    logoBounds: BoundsSchema,
  }),
})

const TestbedSpecSchema = z.object({
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    safeMargin: z.number().nonnegative(),
  }),
  campaigns: z.array(CampaignSchema).min(1),
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
  const allowedPrefix = `${path.resolve(TESTBED_DIR)}${path.sep}`
  if (!absolutePath.startsWith(allowedPrefix)) {
    throw new Error(`Asset path escapes testbed directory: ${relativePath}`)
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
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  )
}

function hexToRgb(hex) {
  const normalized = hex.replace('#', '')
  if (!/^(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(normalized)) {
    throw new Error(`Invalid hex color: ${hex}`)
  }
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split('').map((part) => part + part).join('')
    : normalized, 16)
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

export function validateCampaign(campaign, canvas) {
  const checks = []
  const { textBounds, subjectBounds, logoBounds } = campaign.layout
  const bounds = [
    ['textBounds', textBounds],
    ['subjectBounds', subjectBounds],
    ['logoBounds', logoBounds],
  ]

  for (const [name, box] of bounds) {
    checks.push({
      name: `${name}-inside-canvas`,
      pass: box.x >= 0 && box.y >= 0 && box.x + box.width <= canvas.width && box.y + box.height <= canvas.height,
    })
  }

  checks.push({
    name: 'headline-avoids-subject',
    pass: !rectsIntersect(textBounds, subjectBounds),
  })
  checks.push({
    name: 'logo-avoids-subject',
    pass: !rectsIntersect(logoBounds, subjectBounds),
  })
  checks.push({
    name: 'logo-avoids-copy',
    pass: !rectsIntersect(logoBounds, textBounds),
  })
  checks.push({
    name: 'content-respects-safe-area',
    pass: [textBounds, logoBounds].every((box) => (
      box.x >= canvas.safeMargin &&
      box.y >= canvas.safeMargin &&
      box.x + box.width <= canvas.width - canvas.safeMargin &&
      box.y + box.height <= canvas.height - canvas.safeMargin
    )),
  })
  checks.push({
    name: 'copy-is-bounded',
    pass: campaign.headline.length === 2 && campaign.headline.every((line) => line.length > 0 && line.length <= 13),
  })

  const contrastBackground = campaign.template === 'creator-pop' ? '#FFFFFF' : campaign.palette.ink
  checks.push({
    name: 'primary-contrast',
    pass: contrastRatio(campaign.palette.primary, contrastBackground) >= 4.5,
    value: Number(contrastRatio(campaign.palette.primary, contrastBackground).toFixed(2)),
  })
  checks.push({
    name: 'accent-large-text-contrast',
    pass: contrastRatio(campaign.palette.accent, contrastBackground) >= 3,
    value: Number(contrastRatio(campaign.palette.accent, contrastBackground).toFixed(2)),
  })

  return checks
}

export function parseSpec(value) {
  return TestbedSpecSchema.parse(value)
}

export async function loadSpec() {
  const value = JSON.parse(await readFile(path.join(TESTBED_DIR, 'campaigns.json'), 'utf8'))
  return parseSpec(value)
}

function text({ x, y, value, size, fill, family = 'Black Han Sans', anchor = 'start', stroke, strokeWidth = 0, opacity = 1, letterSpacing = -1 }) {
  const strokeAttrs = stroke
    ? ` stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke fill" stroke-linejoin="round"`
    : ''
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${family}" font-size="${size}" letter-spacing="${letterSpacing}" fill="${fill}" opacity="${opacity}"${strokeAttrs}>${escapeXml(value)}</text>`
}

function pill({ x, y, width, height, fill, label, textColor, stroke = 'none', opacity = 1, size = 25 }) {
  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}"/>
    ${text({ x: x + width / 2, y: y + height * 0.68, value: label, size, fill: textColor, family: 'Do Hyeon', anchor: 'middle', letterSpacing: 0 })}
  `
}

function commonDefs() {
  return `
    <defs>
      <linearGradient id="leftShade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#04121F" stop-opacity="0.98"/>
        <stop offset="0.56" stop-color="#04121F" stop-opacity="0.78"/>
        <stop offset="1" stop-color="#04121F" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="softWhite" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.96"/>
        <stop offset="0.58" stop-color="#FFFFFF" stop-opacity="0.78"/>
        <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="roadShade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#07141D" stop-opacity="0.98"/>
        <stop offset="0.62" stop-color="#07141D" stop-opacity="0.64"/>
        <stop offset="1" stop-color="#07141D" stop-opacity="0.05"/>
      </linearGradient>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="9" stdDeviation="10" flood-color="#000000" flood-opacity="0.34"/>
      </filter>
      <filter id="whiteLogo" color-interpolation-filters="sRGB">
        <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/>
      </filter>
      <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
        <path d="M44 0H0V44" fill="none" stroke="#79EBFF" stroke-opacity="0.10" stroke-width="1"/>
      </pattern>
    </defs>
  `
}

async function renderSevasa(campaign, canvas) {
  const background = await dataUri(campaign.background)
  const logo = await dataUri(campaign.logo)
  const [first, second] = campaign.headline
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    ${commonDefs()}
    <image href="${background}" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>
    <rect width="760" height="1080" fill="url(#leftShade)"/>
    <rect x="0" y="0" width="1080" height="1080" fill="none" stroke="#79EBFF" stroke-opacity="0.17" stroke-width="2"/>
    <image href="${logo}" x="64" y="64" width="250" height="64" preserveAspectRatio="xMinYMid meet" filter="url(#whiteLogo)"/>
    ${pill({ x: 64, y: 176, width: 224, height: 50, fill: '#79EBFF', label: campaign.eyebrow, textColor: '#061725', size: 24 })}
    ${text({ x: 64, y: 354, value: first, size: 79, fill: '#FFFFFF', letterSpacing: -3 })}
    ${text({ x: 64, y: 458, value: second, size: 82, fill: '#79EBFF', letterSpacing: -3 })}
    <rect x="68" y="488" width="356" height="12" rx="6" fill="#FBBA00"/>
    ${text({ x: 68, y: 565, value: campaign.subtitle, size: 31, fill: '#FFFFFF', family: 'Do Hyeon', opacity: 0.94, letterSpacing: 0 })}
    ${campaign.tags.map((tag, index) => pill({
      x: 66 + index * 150,
      y: 640,
      width: 132,
      height: 48,
      fill: '#071B2B',
      label: tag,
      textColor: '#FFFFFF',
      stroke: '#79EBFF',
      opacity: 0.86,
      size: 22,
    })).join('')}
    <path d="M68 834H530" stroke="#FFFFFF" stroke-opacity="0.28"/>
    ${text({ x: 68, y: 886, value: campaign.footer, size: 23, fill: '#FFFFFF', family: 'Do Hyeon', opacity: 0.76, letterSpacing: 0.5 })}
    <circle cx="567" cy="882" r="5" fill="#FBBA00"/>
  </svg>`
}

async function renderSupershorts(campaign, canvas) {
  const background = await dataUri(campaign.background)
  const logo = await dataUri(campaign.logo)
  const [first, second] = campaign.headline
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    ${commonDefs()}
    <image href="${background}" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>
    <rect width="760" height="1080" fill="url(#softWhite)"/>
    <circle cx="88" cy="84" r="48" fill="#FFFFFF" fill-opacity="0.92"/>
    <image href="${logo}" x="52" y="48" width="72" height="72"/>
    ${text({ x: 146, y: 105, value: campaign.company, size: 39, fill: '#101B3D', family: 'Do Hyeon', letterSpacing: 0 })}
    ${pill({ x: 64, y: 205, width: 230, height: 52, fill: '#101B3D', label: campaign.eyebrow, textColor: '#FFFFFF', size: 24 })}
    ${text({ x: 64, y: 382, value: first, size: 69, fill: '#101B3D', stroke: '#FFFFFF', strokeWidth: 12, letterSpacing: -3 })}
    ${text({ x: 64, y: 498, value: second, size: 92, fill: '#388DFF', stroke: '#FFFFFF', strokeWidth: 15, letterSpacing: -4 })}
    <path d="M70 532C188 566 320 568 498 532" fill="none" stroke="#A78BFA" stroke-width="13" stroke-linecap="round" opacity="0.9"/>
    ${text({ x: 68, y: 610, value: campaign.subtitle, size: 31, fill: '#101B3D', family: 'Do Hyeon', letterSpacing: 0 })}
    ${campaign.tags.map((tag, index) => pill({
      x: 64 + index * 158,
      y: 666,
      width: 142,
      height: 46,
      fill: index === 0 ? '#E8F2FF' : '#FFFFFF',
      label: tag,
      textColor: index === 0 ? '#216FD4' : '#3D4567',
      stroke: index === 0 ? '#9CC7FF' : '#D8DCEC',
      size: 21,
    })).join('')}
    <g filter="url(#shadow)">
      <rect x="64" y="778" width="260" height="70" rx="35" fill="#101B3D"/>
      ${text({ x: 194, y: 825, value: `${campaign.footer}  →`, size: 27, fill: '#FFFFFF', family: 'Do Hyeon', anchor: 'middle', letterSpacing: 0 })}
    </g>
    ${text({ x: 64, y: 932, value: 'BLOG  →  SCRIPT  →  SHORTS', size: 20, fill: '#59617D', family: 'Do Hyeon', opacity: 0.82, letterSpacing: 2 })}
  </svg>`
}

async function renderRoadmap(campaign, canvas) {
  const background = await dataUri(campaign.background)
  const logo = await dataUri(campaign.logo)
  const [first, second] = campaign.headline
  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
    ${commonDefs()}
    <image href="${background}" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>
    <rect width="830" height="1080" fill="url(#roadShade)"/>
    <rect width="690" height="1080" fill="url(#grid)"/>
    <image href="${logo}" x="64" y="62" width="286" height="66" preserveAspectRatio="xMinYMid meet"/>
    ${pill({ x: 64, y: 186, width: 330, height: 52, fill: '#79EBFF', label: campaign.eyebrow, textColor: '#07141D', size: 22 })}
    ${text({ x: 64, y: 374, value: first, size: 68, fill: '#FFFFFF', letterSpacing: -3 })}
    ${text({ x: 64, y: 495, value: second, size: 112, fill: '#79EBFF', letterSpacing: -4 })}
    <rect x="66" y="526" width="200" height="9" rx="5" fill="#79EBFF"/>
    ${text({ x: 66, y: 608, value: campaign.subtitle, size: 31, fill: '#FFFFFF', family: 'Do Hyeon', opacity: 0.92, letterSpacing: 0 })}
    ${campaign.tags.map((tag, index) => `
      <g transform="translate(${66 + index * 174} 680)">
        <circle cx="8" cy="8" r="8" fill="#79EBFF" opacity="${1 - index * 0.18}"/>
        ${text({ x: 28, y: 17, value: tag, size: 24, fill: '#FFFFFF', family: 'Do Hyeon', opacity: 0.9, letterSpacing: 0 })}
      </g>`).join('')}
    <path d="M66 820H610" stroke="#79EBFF" stroke-opacity="0.36"/>
    ${text({ x: 66, y: 873, value: campaign.footer, size: 25, fill: '#FFFFFF', family: 'Do Hyeon', opacity: 0.76, letterSpacing: 0 })}
    <path d="M58 1008H426" stroke="#79EBFF" stroke-width="3"/>
    ${text({ x: 66, y: 1040, value: 'SMART CITY MOBILITY', size: 18, fill: '#79EBFF', family: 'Do Hyeon', opacity: 0.76, letterSpacing: 3 })}
  </svg>`
}

const TEMPLATE_RENDERERS = {
  'split-tech': renderSevasa,
  'creator-pop': renderSupershorts,
  'urban-grid': renderRoadmap,
}

export async function buildSvg(campaign, canvas) {
  const renderer = TEMPLATE_RENDERERS[campaign.template]
  if (!renderer) throw new Error(`Unknown template: ${campaign.template}`)
  return renderer(campaign, canvas)
}

function renderPng(svg, width) {
  const renderer = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: 'Do Hyeon',
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
    const x = 40 + index * 580
    return `
      <g transform="translate(${x} 100)">
        <rect x="-8" y="-8" width="536" height="536" rx="28" fill="#FFFFFF" stroke="#DDE3EA"/>
        <image href="${href}" width="520" height="520" rx="22"/>
        ${text({ x: 260, y: 575, value: campaign.company, size: 30, fill: '#16202A', family: 'Do Hyeon', anchor: 'middle', letterSpacing: 0 })}
      </g>`
  }))

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1780" height="730" viewBox="0 0 1780 730">
    <rect width="1780" height="730" fill="#F4F6F8"/>
    ${text({ x: 40, y: 58, value: 'Teguma / 회사 홍보 썸네일 테스트베드', size: 34, fill: '#16202A', family: 'Do Hyeon', letterSpacing: 0 })}
    ${cards.join('')}
  </svg>`
}

export async function main() {
  const spec = await loadSpec()
  await mkdir(OUTPUT_DIR, { recursive: true })
  const report = {
    schemaVersion: 1,
    renderer: '@resvg/resvg-js',
    sourceRoot: path.relative(ROOT_DIR, TESTBED_DIR),
    campaigns: [],
  }

  for (const campaign of spec.campaigns) {
    const svg = await buildSvg(campaign, spec.canvas)
    const svgPath = path.join(OUTPUT_DIR, `${campaign.id}.svg`)
    const pngPath = path.join(OUTPUT_DIR, `${campaign.id}.png`)
    await writeFile(svgPath, svg)
    await writeFile(pngPath, renderPng(svg, spec.canvas.width))

    const dimensions = await pngDimensions(pngPath)
    const checks = validateCampaign(campaign, spec.canvas)
    checks.push({
      name: 'rendered-dimensions',
      pass: dimensions.width === spec.canvas.width && dimensions.height === spec.canvas.height,
      value: dimensions,
    })
    report.campaigns.push({
      id: campaign.id,
      company: campaign.company,
      output: path.relative(TESTBED_DIR, pngPath),
      passed: checks.every((check) => check.pass),
      checks,
    })
  }

  const contactSheetSvg = await buildContactSheet(spec.campaigns)
  await writeFile(path.join(OUTPUT_DIR, 'contact-sheet.svg'), contactSheetSvg)
  const contactRenderer = new Resvg(contactSheetSvg, {
    fitTo: { mode: 'original' },
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'Do Hyeon' },
  })
  await writeFile(path.join(OUTPUT_DIR, 'contact-sheet.png'), contactRenderer.render().asPng())
  await writeFile(path.join(OUTPUT_DIR, 'qa-report.json'), `${JSON.stringify(report, null, 2)}\n`)

  if (report.campaigns.some((campaign) => !campaign.passed)) {
    throw new Error('One or more campaign QA checks failed')
  }

  console.log(`Rendered ${report.campaigns.length} campaigns to ${path.relative(process.cwd(), OUTPUT_DIR)}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
