/**
 * Canvas size presets.
 *
 * Values mirror the sizes MiriCanvas documents for each channel, plus Korean
 * channels teguma already targets. Print presets are declared in millimetres
 * so export can keep physical dimensions honest.
 */

export type PresetUnit = "px" | "mm";

export interface SizePreset {
  id: string;
  label: string;
  category: "social" | "video" | "blog" | "presentation" | "print";
  width: number;
  height: number;
  unit: PresetUnit;
  note?: string;
}

export const SIZE_PRESETS: readonly SizePreset[] = [
  {
    id: "youtube-thumbnail",
    label: "유튜브 썸네일",
    category: "video",
    width: 1280,
    height: 720,
    unit: "px",
  },
  {
    id: "youtube-video",
    label: "유튜브 영상",
    category: "video",
    width: 1920,
    height: 1080,
    unit: "px",
  },
  {
    id: "instagram-square",
    label: "인스타그램 정사각형",
    category: "social",
    width: 1080,
    height: 1080,
    unit: "px",
  },
  {
    id: "instagram-portrait",
    label: "인스타그램 세로·카드뉴스",
    category: "social",
    width: 1080,
    height: 1350,
    unit: "px",
    note: "카드뉴스 기본 비율",
  },
  {
    id: "instagram-story",
    label: "인스타그램 스토리·릴스",
    category: "social",
    width: 1080,
    height: 1920,
    unit: "px",
  },
  {
    id: "facebook-square",
    label: "페이스북 정사각형",
    category: "social",
    width: 1200,
    height: 1200,
    unit: "px",
  },
  {
    id: "blog-thumbnail",
    label: "블로그 썸네일",
    category: "blog",
    width: 900,
    height: 600,
    unit: "px",
  },
  {
    id: "blog-thumbnail-large",
    label: "블로그 썸네일 (대형)",
    category: "blog",
    width: 1200,
    height: 800,
    unit: "px",
  },
  {
    id: "naver-blog-square",
    label: "네이버 블로그 대표 이미지",
    category: "blog",
    width: 1080,
    height: 1080,
    unit: "px",
    note: "검색 결과에서 약 104×104px로 축소 노출",
  },
  {
    id: "naver-blog-thumbnail",
    label: "네이버 블로그 썸네일 권장",
    category: "blog",
    width: 800,
    height: 800,
    unit: "px",
    note: "앨범형 정방형 노출 권장값",
  },
  {
    id: "naver-blog-share",
    label: "네이버 블로그 헤더·공유용",
    category: "blog",
    width: 1200,
    height: 675,
    unit: "px",
    note: "게시글 썸네일과 용도가 다른 16:9 공유 이미지",
  },
  {
    id: "presentation-16-9",
    label: "프레젠테이션 16:9",
    category: "presentation",
    width: 1920,
    height: 1080,
    unit: "px",
  },
  {
    id: "a4-portrait",
    label: "A4 세로",
    category: "print",
    width: 210,
    height: 297,
    unit: "mm",
  },
  {
    id: "a4-landscape",
    label: "A4 가로",
    category: "print",
    width: 297,
    height: 210,
    unit: "mm",
  },
] as const;

export function listSizePresets(category?: SizePreset["category"]): SizePreset[] {
  if (!category) return [...SIZE_PRESETS];
  return SIZE_PRESETS.filter((preset) => preset.category === category);
}

export function findSizePreset(id: string): SizePreset | undefined {
  return SIZE_PRESETS.find((preset) => preset.id === id);
}

export function requireSizePreset(id: string): SizePreset {
  const preset = findSizePreset(id);
  if (!preset) {
    const available = SIZE_PRESETS.map((item) => item.id).join(", ");
    throw new Error(`Unknown size preset: ${id}. Available: ${available}`);
  }
  return preset;
}
