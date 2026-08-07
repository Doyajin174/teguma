---
{
  "id": "feature.size-presets",
  "title": "사이즈 프리셋",
  "aliases": ["size presets", "breakpoints"],
  "reviewed_commit": "f388313fb01cac3add151297051b8a120c7d7702",
  "scope_roots": ["src", "test"],
  "entrypoints": [
    {"path": "src/compressor.ts", "symbol": "CompressorOptions", "role": "preset-input"},
    {"path": "src/compressor.ts", "symbol": "compressBrandContext", "role": "preset-consumer"},
    {"path": "src/tools/get-page-layout.ts", "symbol": "getPageLayout", "role": "layout-inspector"}
  ],
  "search_keys": ["DEFAULT_BREAKPOINTS", "breakpoints"],
  "tests": [
    {"path": "test/tools.test.ts", "symbol": "includes breakpoints", "role": "breakpoint-regression"},
    {"path": "test/compressor.test.ts", "symbol": "infers layout constraints", "role": "constraint-regression"}
  ],
  "known_gaps": ["No separate named preset registry exists; default breakpoints are an internal compressor constant and can be overridden through CompressorOptions."]
}
---

# 사이즈 프리셋

## Purpose and boundaries

압축된 레이아웃 제약의 기본 breakpoint 집합과 사용자 지정 breakpoint 입력을 가리킨다. 독립적인 프리셋 저장소나 웹 반응형 UI는 현재 없다.

## Invariants

- 기본 breakpoint는 `[375, 768, 1024, 1440]`이며 `compressBrandContext`의 `breakpoints` 옵션으로 대체할 수 있다.

## Change recipes

| Change type | Read first | Confirm |
| --- | --- | --- |
| breakpoint 변경 | `src/compressor.ts:CompressorOptions`, `compressBrandContext` | `test/compressor.test.ts`, `test/tools.test.ts` |
