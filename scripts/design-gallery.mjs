/**
 * Design template gallery.
 *
 * Renders the complete template library as human-reviewable PNGs so visual
 * quality, small-size legibility, and resize behaviour are visible alongside
 * the design engine's automated QA. Run after `npm run build`.
 *
 *   node scripts/design-gallery.mjs [outputDirectory]
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import {
  createImageResolver,
  exportDocument,
  inspectDocument,
  instantiateTemplate,
  listTemplates,
  resizeDocument,
} from '../dist/design/index.js'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const FONT_FILES = [
  path.join(REPO_ROOT, 'experiments/company-promo-editorial-v2/assets/fonts/IBMPlexSansKR-Regular.ttf'),
  path.join(REPO_ROOT, 'experiments/company-promo-editorial-v2/assets/fonts/IBMPlexSansKR-SemiBold.ttf'),
]
const IMAGE_RESOLVER = createImageResolver({ root: REPO_ROOT })
const RESIZE_TEMPLATE_ID = 'naver-blog-thumbnail'
const RESIZE_TARGET = { preset: 'youtube-thumbnail' }
const RESIZE_MODES = ['fill', 'fit', 'original', 'adapt']

const TEMPLATE_INPUTS = {
  'naver-blog-thumbnail': {
    hook: '충전 운영, 한눈에',
    imageSource: 'experiments/company-promo-naver-v3/assets/backgrounds/sevasa.jpg',
    bandColor: '#11191D',
    accentColor: '#00A653',
  },
  'card-news-cover': {
    eyebrow: 'SEVASA 운영 인사이트',
    headline: '충전소\n가동률을 높이는 법',
    body: '현장 데이터에서 찾은 예약·점검·요금제\n운영의 세 가지 기준을 정리했습니다.',
    accentColor: '#00A653',
  },
  'card-news-slide': {
    eyebrow: '01 예약 흐름',
    headline: '빈 시간대를\n고객에게 먼저 보여주세요',
    body: '혼잡 시간만 막기보다 다음 예약 가능 시간을\n안내하면 회전율과 이용 경험이 함께 좋아집니다.',
    accentColor: '#00A653',
  },
  'card-news-closing': {
    eyebrow: 'SEVASA 운영 인사이트',
    headline: '오늘의 기준을\n운영에 적용하세요',
    summary: '예약·요금·점검 데이터를 같은 화면에서 보면 다음 주의 운영 결정을 더 빨리 내릴 수 있습니다.',
    cta: '운영 진단 받기 →',
    footer: 'SEVASA / ENERGY NOTE',
    accentColor: '#00A653',
  },
  'youtube-thumbnail': {
    eyebrow: '크리에이터 운영실험',
    hook: '콘텐츠 제작,\n하루 2시간 줄였다',
    accentColor: '#00A653',
  },
  'instagram-story': {
    eyebrow: 'B2B GROWTH NOTE',
    headline: '팀의 노하우를\n콘텐츠 자산으로',
    body: '세일즈·CS·제품팀의 답변을 모으면\n다음 캠페인의 가장 좋은 소재가 됩니다.',
    accentColor: '#00A653',
  },
  'presentation-title': {
    eyebrow: '2026 CREATOR BUSINESS REVIEW',
    headline: '작은 팀이 만드는\n반복 가능한 성장',
    body: 'SEVASA 파트너 운영 리포트 · 2026 하반기',
    accentColor: '#00A653',
  },
  'presentation-agenda': {
    eyebrow: '2026 H2 BUSINESS REVIEW',
    title: '오늘 이야기할 네 가지',
    item1: '시장과 고객의 변화',
    item2: '운영 데이터에서 찾은 기회',
    item3: '다음 분기의 실행 기준',
    item4: '팀이 바로 시작할 일',
    accentColor: '#00A653',
  },
  'presentation-metric': {
    eyebrow: 'OPERATIONAL IMPACT',
    metric: '38%',
    label: '예약 전환율 상승',
    context: '예약 가능 시간을 먼저 보여준 충전소에서 8주 동안 확인한 평균 변화입니다.',
    footer: 'SEVASA 운영 데이터 · 2026.08',
    accentColor: '#00A653',
  },
  'instagram-square-quote': {
    eyebrow: 'PARTNER VOICE',
    quote: '좋은 운영은 고객에게\n기다림을 설명하지 않습니다.',
    attribution: '김은서',
    role: 'SEVASA 파트너 운영 리드',
    accentColor: '#00A653',
  },
  'blog-header': {
    headline: '작은 팀이\n반복 가능한 콘텐츠를 만드는 법',
    imageSource: 'experiments/company-promo-naver-v3/assets/backgrounds/sevasa.jpg',
    category: 'CREATOR OPERATIONS',
    byline: 'SEVASA 인사이트 팀 · 2026.08',
    accentColor: '#00A653',
    panelColor: '#FFFFFF',
  },
  'event-notice': {
    eyebrow: 'SEVASA OPEN SESSION',
    headline: '현장 운영자를 위한\n데이터 활용 워크숍',
    date: '2026. 08. 21. THU',
    time: '14:00–16:00',
    place: '성수 스테이션 3F',
    cta: '사전 신청은 프로필 링크에서',
    accentColor: '#00A653',
  },
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function pngDataUri(data) {
  return `data:image/png;base64,${data.toString('base64')}`
}

function renderPng(svg) {
  const renderer = new Resvg(svg, {
    font: {
      fontFiles: FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: 'IBM Plex Sans KR',
    },
  })
  return Buffer.from(renderer.render().asPng())
}

function dimensionsFromPng(data) {
  if (
    data.length < 24
    || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || data.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    throw new Error('Expected a valid PNG output')
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

function failedQaMessage(label, report) {
  const failed = report.checks.filter((check) => !check.pass)
  return `${label} QA failed: ${failed.map((check) => `${check.name} (${check.detail ?? ''})`).join('; ')}`
}

async function exportPng(document, width) {
  const result = await exportDocument(document, {
    format: 'png',
    ...(width === undefined ? {} : { width }),
    fontFiles: FONT_FILES,
    resolveImage: IMAGE_RESOLVER,
  })
  if (result.files.length !== 1) throw new Error(`Expected one page for ${document.id}`)
  return { data: result.files[0].data, canvas: { width: result.width, height: result.height } }
}

function contactSheetSvg(items) {
  const columns = 3
  const sheetWidth = 1440
  const cellHeight = 520
  const sheetHeight = 126 + (Math.ceil(items.length / columns) * cellHeight)
  const cells = items.map((item, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = 40 + (column * 480)
    const y = 126 + (row * cellHeight)
    return `
      <g transform="translate(${x} ${y})">
        <rect width="440" height="420" fill="#FFFFFF"/>
        <image href="${pngDataUri(item.data)}" width="440" height="420" preserveAspectRatio="xMidYMid meet"/>
        <text x="0" y="458" font-family="IBM Plex Sans KR" font-size="22" font-weight="600" letter-spacing="-0.4" fill="#11191D">${escapeXml(item.id)}</text>
        <text x="0" y="490" font-family="IBM Plex Sans KR" font-size="16" font-weight="400" fill="#6B7470">${item.canvas.width} × ${item.canvas.height}</text>
      </g>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}" viewBox="0 0 ${sheetWidth} ${sheetHeight}">
    <rect width="${sheetWidth}" height="${sheetHeight}" fill="#F1F3F2"/>
    <text x="40" y="58" font-family="IBM Plex Sans KR" font-size="28" font-weight="600" letter-spacing="0.3" fill="#11191D">DESIGN TEMPLATE LIBRARY</text>
    <text x="40" y="90" font-family="IBM Plex Sans KR" font-size="16" font-weight="400" fill="#6B7470">Native-size exports · Korean B2B and creator marketing copy</text>
    <path d="M40 108H1400" stroke="#CDD1CE" stroke-width="1"/>
    ${cells}
  </svg>`
}

function resizeSheetSvg(items) {
  const sheetWidth = 1440
  const sheetHeight = 620
  const cards = items.map((item, index) => {
    const x = 40 + (index * 350)
    return `
      <g transform="translate(${x} 146)">
        <rect width="310" height="390" fill="#FFFFFF"/>
        <image href="${pngDataUri(item.data)}" width="310" height="174" preserveAspectRatio="xMidYMid meet"/>
        <text x="0" y="222" font-family="IBM Plex Sans KR" font-size="23" font-weight="600" letter-spacing="-0.3" fill="#11191D">${item.mode.toUpperCase()}</text>
        <text x="0" y="254" font-family="IBM Plex Sans KR" font-size="16" font-weight="400" fill="#6B7470">800 × 800 → 1280 × 720</text>
        <text x="0" y="286" font-family="IBM Plex Sans KR" font-size="15" font-weight="400" fill="#6B7470">QA: ${item.qa.passed ? 'pass' : 'expected crop'}</text>
      </g>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}" viewBox="0 0 ${sheetWidth} ${sheetHeight}">
    <rect width="${sheetWidth}" height="${sheetHeight}" fill="#F1F3F2"/>
    <text x="40" y="58" font-family="IBM Plex Sans KR" font-size="28" font-weight="600" letter-spacing="0.3" fill="#11191D">RESIZE MODE COMPARISON</text>
    <text x="40" y="90" font-family="IBM Plex Sans KR" font-size="16" font-weight="400" fill="#6B7470">naver-blog-thumbnail resized for youtube-thumbnail</text>
    <path d="M40 108H1400" stroke="#CDD1CE" stroke-width="1"/>
    ${cards}
  </svg>`
}

async function writeArtifact(outputDir, filename, data) {
  await writeFile(path.join(outputDir, filename), data)
  return filename
}

export async function main() {
  const requested = process.argv[2] ?? path.join(REPO_ROOT, 'teguma-exports/design-gallery')
  const outputDir = path.resolve(requested)
  await mkdir(outputDir, { recursive: true })

  const artifacts = []
  const galleryItems = []
  const templates = listTemplates()

  for (const template of templates) {
    const input = TEMPLATE_INPUTS[template.id]
    if (!input) throw new Error(`Missing gallery input for ${template.id}`)
    const instantiated = instantiateTemplate(template.id, input)
    if (!instantiated.qa.passed) throw new Error(failedQaMessage(template.id, instantiated.qa))

    const native = await exportPng(instantiated.document)
    const filename = await writeArtifact(outputDir, `${template.id}.png`, native.data)
    artifacts.push({
      templateId: template.id,
      canvas: native.canvas,
      qa: instantiated.qa,
      qaPassed: instantiated.qa.passed,
      output: filename,
    })
    galleryItems.push({ id: template.id, canvas: native.canvas, data: native.data })

    if (template.category === 'blog') {
      const small = await exportPng(instantiated.document, 104)
      artifacts.push({
        templateId: template.id,
        canvas: small.canvas,
        qa: instantiated.qa,
        qaPassed: instantiated.qa.passed,
        output: await writeArtifact(outputDir, `${template.id}-104.png`, small.data),
      })
    }
  }

  const resizeSource = instantiateTemplate(RESIZE_TEMPLATE_ID, TEMPLATE_INPUTS[RESIZE_TEMPLATE_ID]).document
  const resizeItems = []
  for (const mode of RESIZE_MODES) {
    const document = resizeDocument(resizeSource, { ...RESIZE_TARGET, mode })
    const qa = inspectDocument(document)
    const exported = await exportDocument(document, {
      format: 'png',
      fontFiles: FONT_FILES,
      resolveImage: IMAGE_RESOLVER,
      enforceQa: false,
    })
    if (exported.files.length !== 1) throw new Error(`Expected one resize page for ${mode}`)
    const filename = await writeArtifact(outputDir, `resize-${RESIZE_TEMPLATE_ID}-${mode}.png`, exported.files[0].data)
    const artifact = {
      templateId: RESIZE_TEMPLATE_ID,
      canvas: { width: exported.width, height: exported.height },
      resizeMode: mode,
      qa,
      qaPassed: qa.passed,
      output: filename,
    }
    artifacts.push(artifact)
    resizeItems.push({ mode, qa, data: exported.files[0].data })
  }

  const contactSheet = renderPng(contactSheetSvg(galleryItems))
  const resizeSheet = renderPng(resizeSheetSvg(resizeItems))
  const contactSheetCanvas = dimensionsFromPng(contactSheet)
  const resizeSheetCanvas = dimensionsFromPng(resizeSheet)
  const expectedContactSheetHeight = 126 + (Math.ceil(galleryItems.length / 3) * 520)
  if (contactSheetCanvas.width !== 1440 || contactSheetCanvas.height !== expectedContactSheetHeight) {
    throw new Error('Contact sheet dimensions do not match the intended gallery grid')
  }
  if (resizeSheetCanvas.width !== 1440 || resizeSheetCanvas.height !== 620) {
    throw new Error('Resize comparison dimensions do not match the intended 1440 × 620 canvas')
  }
  artifacts.push({
    templateId: null,
    canvas: contactSheetCanvas,
    qaPassed: true,
    output: await writeArtifact(outputDir, 'contact-sheet.png', contactSheet),
  })
  artifacts.push({
    templateId: null,
    canvas: resizeSheetCanvas,
    qaPassed: true,
    output: await writeArtifact(outputDir, 'resize-comparison.png', resizeSheet),
  })

  await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify({
    templates: templates.map((template) => template.id),
    artifacts,
  }, null, 2)}\n`)
  console.log(`Design gallery written to ${outputDir}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
