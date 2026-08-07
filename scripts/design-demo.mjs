/**
 * Design engine demo.
 *
 * Builds one card-news document, exports it at its native size, resizes it to
 * three channel presets, and writes a multi-page PDF. Run after `npm run build`.
 *
 *   node scripts/design-demo.mjs [outputDirectory]
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  applyBrandKit,
  exportDocument,
  inspectDocument,
  parseDesignDocument,
  resizeDocument,
} from '../dist/design/index.js'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const FONT_FILES = [
  path.join(REPO_ROOT, 'experiments/company-promo-editorial-v2/assets/fonts/IBMPlexSansKR-Regular.ttf'),
  path.join(REPO_ROOT, 'experiments/company-promo-editorial-v2/assets/fonts/IBMPlexSansKR-SemiBold.ttf'),
]

const brandKit = {
  id: 'sevasa',
  name: 'SEVASA',
  palette: [
    { id: 'ink', name: 'Ink', value: '#11191D' },
    { id: 'paper', name: 'Paper', value: '#FFFFFF' },
    { id: 'mist', name: 'Mist', value: '#F1F3F2' },
    { id: 'green', name: 'Signal Green', value: '#00A653' },
  ],
  fonts: [{ family: 'IBM Plex Sans KR', weights: [400, 600] }],
  logos: [],
}

function slide({ id, name, background, eyebrow, headline, body, accent }) {
  return {
    id,
    name,
    background,
    layers: [
      {
        id: 'accent-bar',
        type: 'rect',
        frame: { x: 80, y: 168, width: 96, height: 12 },
        fill: accent,
      },
      {
        id: 'eyebrow',
        type: 'text',
        frame: { x: 80, y: 216, width: 920, height: 40 },
        text: eyebrow,
        fontFamily: 'IBM Plex Sans KR',
        fontSize: 30,
        fontWeight: 600,
        color: '#11191D',
        letterSpacing: 1,
      },
      {
        id: 'headline',
        type: 'text',
        frame: { x: 80, y: 320, width: 920, height: 340 },
        text: headline,
        fontFamily: 'IBM Plex Sans KR',
        fontSize: 112,
        fontWeight: 600,
        color: '#11191D',
        lineHeight: 1.22,
        letterSpacing: -3,
      },
      {
        id: 'body',
        type: 'text',
        frame: { x: 80, y: 760, width: 920, height: 180 },
        text: body,
        fontFamily: 'IBM Plex Sans KR',
        fontSize: 40,
        color: '#11191D',
        lineHeight: 1.45,
      },
    ],
  }
}

const document = parseDesignDocument({
  id: 'sevasa-cardnews',
  title: '전기차 충전비 절감 카드뉴스',
  canvas: { width: 1080, height: 1350, safeMargin: 64 },
  brandKit,
  pages: [
    slide({
      id: 'cover',
      name: '표지',
      background: '#FFFFFF',
      accent: '#00A653',
      eyebrow: 'SEVASA 에너지 노트',
      headline: '충전비\n줄이는 법',
      body: '같은 전기차라도 충전 시간대에 따라\n월 요금이 달라집니다.',
    }),
    slide({
      id: 'point',
      name: '핵심',
      background: '#F1F3F2',
      accent: '#00A653',
      eyebrow: '01 시간대 요금',
      headline: '경부하 시간에\n충전하기',
      body: '심야 경부하 구간으로 옮기면\n같은 전력량이라도 단가가 내려갑니다.',
    }),
    slide({
      id: 'action',
      name: '실행',
      background: '#FFFFFF',
      accent: '#00A653',
      eyebrow: '02 운영 점검',
      headline: '충전 이력을\n월 단위로 보기',
      body: '어떤 요일과 시간대에 몰렸는지 확인하면\n다음 달 계획을 바꿀 수 있습니다.',
    }),
  ],
})

const RESIZE_TARGETS = [
  { preset: 'instagram-square', mode: 'fit' },
  { preset: 'instagram-story', mode: 'fit' },
  { preset: 'youtube-thumbnail', mode: 'adapt' },
]

async function writeExport(outputDir, label, doc, options) {
  const result = await exportDocument(doc, { fontFiles: FONT_FILES, ...options })
  const written = []
  for (const [index, file] of result.files.entries()) {
    const extension = result.format === 'jpg' ? 'png' : result.format
    const name = result.format === 'pdf'
      ? `${label}.pdf`
      : `${label}-${String(index + 1).padStart(2, '0')}-${file.pageId}.${extension}`
    await writeFile(path.join(outputDir, name), file.data)
    written.push({ name, bytes: file.data.length })
  }
  return { format: result.format, width: result.width, height: result.height, files: written }
}

export async function main() {
  const requested = process.argv[2] ?? path.join(REPO_ROOT, 'teguma-exports/design-demo')
  const outputDir = path.resolve(requested)
  await mkdir(outputDir, { recursive: true })

  const normalized = applyBrandKit(document)
  const report = inspectDocument(normalized)
  if (!report.passed) {
    const failed = report.checks.filter((check) => !check.pass)
    throw new Error(
      `Design QA failed: ${failed.map((check) => `${check.name} (${check.detail ?? ''})`).join('; ')}`,
    )
  }

  const artifacts = []
  artifacts.push(await writeExport(outputDir, 'cardnews', normalized, { format: 'png', width: 1080 }))
  artifacts.push(await writeExport(outputDir, 'cardnews', normalized, { format: 'pdf', width: 1080 }))

  for (const target of RESIZE_TARGETS) {
    const resized = resizeDocument(normalized, target)
    const resizedReport = inspectDocument(resized)
    if (!resizedReport.passed) {
      const failed = resizedReport.checks.filter((check) => !check.pass)
      throw new Error(
        `Resized ${target.preset}/${target.mode} failed QA: ${failed.map((check) => `${check.name} (${check.detail ?? ''})`).join('; ')}`,
      )
    }
    artifacts.push({
      preset: target.preset,
      mode: target.mode,
      canvas: { width: resized.canvas.width, height: resized.canvas.height },
      qaPassed: resizedReport.passed,
      ...(await writeExport(outputDir, target.preset, resized, { format: 'png', width: 1080 })),
    })
  }

  const summary = {
    documentId: normalized.id,
    pages: normalized.pages.length,
    qa: report,
    artifacts,
  }
  await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`Design demo written to ${outputDir}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
