# 미리캔버스 파리티 디자인 엔진 명세

> 상태: Implemented
>
> 작성일: 2026-08-01
>
> 관련 이슈: [#13](https://github.com/Doyajin174/teguma/issues/13)

## 목표

캠페인마다 흩어진 실험용 렌더러를 대체하는 재사용 가능한 디자인 엔진을 만든다. 에이전트가 선언형 문서를 만들고, 프리셋으로 리사이즈하고, 브랜드 키트를 적용·검사하고, 자동 레이아웃·템플릿·프로젝트 저장을 거쳐 여러 형식으로 내보낼 수 있어야 한다.

`src/design/`에 TypeScript로 구현해 MCP 서버와 같은 빌드·타입 검사를 공유한다. 이 엔진은 Penpot 연결 없이도 동작한다.

## 문서 모델

```
DesignDocument
├── id, title
├── canvas: { width, height, unit, safeMargin }
├── brandKit?: BrandKit
└── pages: DesignPage[]
    ├── id, name, background
    └── layers: DesignLayer[]
        ├── TextLayer  { text, fontFamily, fontSize, fontWeight, color, align, lineHeight, letterSpacing }
        ├── RectLayer  { fill, radius }
        └── ImageLayer { source, fit, logoId? }
```

공통 레이어 필드는 `id`, `type`, `frame { x, y, width, height }`, `opacity`다. 식별자는 영숫자로 시작하고 영숫자·`.`, `_`, `-`만 쓴다. 페이지는 1개 이상이고 페이지 id 및 각 페이지 안의 레이어 id는 유일해야 한다. 색상은 `#RRGGBB`, 캔버스 단위는 `px` 또는 `mm`이며 기본값은 각각 `px`, `safeMargin: 0`, 페이지 배경 `#FFFFFF`다.

`frame.width`와 `frame.height`는 양수 유한 수지만 `x`, `y`는 의도적으로 부호 있는 유한 수다. 특히 `fill` 리사이즈는 정상적인 크롭 오프셋으로 음수 좌표를 만들 수 있다. 최종 출고 경계는 스키마가 아니라 QA의 `layers-inside-canvas`가 강제한다.

## 사이즈 프리셋

레지스트리는 14종이며 `social`, `video`, `blog`, `presentation`, `print`로 필터할 수 있다.

| id | 분류 | 크기 | 비고 |
|---|---|---|---|
| `youtube-thumbnail` | video | 1280×720px | |
| `youtube-video` | video | 1920×1080px | |
| `instagram-square` | social | 1080×1080px | |
| `instagram-portrait` | social | 1080×1350px | 카드뉴스 기본 비율 |
| `instagram-story` | social | 1080×1920px | 스토리·릴스 |
| `facebook-square` | social | 1200×1200px | |
| `blog-thumbnail` | blog | 900×600px | |
| `blog-thumbnail-large` | blog | 1200×800px | |
| `naver-blog-square` | blog | 1080×1080px | 검색 결과 약 104×104px 축소 노출 |
| `naver-blog-thumbnail` | blog | 800×800px | 앨범형 정방형 노출 권장값 |
| `naver-blog-share` | blog | 1200×675px | 헤더·공유용 16:9 |
| `presentation-16-9` | presentation | 1920×1080px | |
| `a4-portrait` | print | 210×297mm | |
| `a4-landscape` | print | 297×210mm | |

## 리사이즈 엔진

대상은 프리셋 또는 양의 유한 수치로 지정한다. 프리셋과 수치를 함께 줄 수 없고, 한 축만 지정할 때는 `lockAspectRatio: true`가 필요하다. 단위 변환은 하지 않으므로 대상 단위가 원본 캔버스 단위와 달라지면 거부한다. 기본 모드는 `fill`이다.

| 모드 | 보장과 동작 |
|---|---|
| `fill` | 두 축 중 큰 비율로 균일 확대·축소해 캔버스를 완전히 덮는다. 넘친 부분은 크롭되며 중앙 배치로 음수 좌표가 가능하다. |
| `fit` | 두 축 중 작은 비율로 균일 확대·축소해 **원본 문서가 원본 캔버스 안에 있을 때** 모든 내용을 보인다. 남는 공간은 중앙 여백이 된다. 원본부터 캔버스 밖인 레이어는 그대로 밖에 남으며 QA가 이를 검출한다. |
| `original` | 배율 1로 레이어 크기를 유지하고 새 캔버스 중앙으로만 이동한다. |
| `adapt` | 글자·일반 도형의 크기는 작은 축 비율로 균일 확대·축소하고, 가로 좌표는 `targetWidth / sourceWidth`로 별도 배치한다. 페이지마다 실제 콘텐츠 블록을 세로 중앙 정렬한다. |

`fill`과 `fit`은 계산한 정확한 IEEE-754 비율을 사용하며, 각각 미세한 빈틈과 초과를 막기 위해 방향성 한 ULP 보정을 한다. 0·무한대·언더플로/오버플로로 유효한 기하를 잃는 배율은 거부한다. 텍스트의 `fontSize`·`letterSpacing`, 사각형의 `radius`, `safeMargin`도 균일 배율을 따른다.

`adapt`의 세로 콘텐츠 범위는 텍스트의 선언 프레임 전체가 아니라 실제 줄 수×글꼴 크기×행간으로 계산한다. 각 페이지는 독립 출력이므로 세로 이동도 페이지별이다. 원본에서 `x === 0`, `y === 0`, `width === sourceCanvas.width`, `height === sourceCanvas.height`를 모두 만족하는 사각형만 명시적 풀블리드 배경으로 취급해 대상 폭으로 늘린다. 따라서 0이 아닌 y의 장식용 가로 밴드는 일반 도형으로서 균일 비율을 유지한다. `ResolvedResize`는 일반 모드에 `offsetX`, `offsetY`를, `adapt`에 `offsetX: 0`, `axisScaleX`, 페이지 id별 `pageOffsetY`를 보고한다.

## 브랜드 키트와 색상

`BrandKit`은 `id`, `name`, 하나 이상의 팔레트·글꼴 등록, 선택적 로고 등록으로 구성한다. `applyBrandKit`은 페이지 배경·사각형·텍스트 색상을 RGB 제곱 유클리드 거리상 가장 가까운 팔레트 색으로, 텍스트 글꼴을 등록 글꼴(없으면 첫 글꼴)로, 굵기를 가장 가까운 등록 굵기로 정규화한다. 입력은 변경하지 않고 새 문서를 반환한다.

`findBrandViolations`는 키트가 있을 때 비등록 사각형/텍스트 색상, 글꼴, 글꼴 굵기, 그리고 `logoId`가 있는 이미지의 로고를 개별 보고한다. 주장한 `logoId`는 등록되어야 하며 이미지 `source`도 그 로고의 등록 `source`와 정확히 같아야 한다. 키트가 없으면 위반은 없다. 공유 `color.ts`는 `#RRGGBB`→RGB, WCAG 상대 휘도, 대비비를 한 구현으로 제공해 브랜드 정규화와 QA의 수치가 일치하게 한다.

## 텍스트 측정과 자동 레이아웃

브라우저 레이아웃 엔진 대신 등록 글꼴의 sfnt `cmap`·`hmtx`에서 읽은 실제 glyph advance(em)를 써서 결정론적으로 측정한다. 글꼴 파일을 한 번 파싱하고, 파일별 provider와 코드포인트별 advance를 캐시한다. 굵기를 지정하면 가장 가까운 등록 face의 advance를, 지정하지 않으면 등록 face 중 각 코드포인트에서 가장 넓은 advance를 쓴다. 등록되지 않은 글꼴은 모든 문자군을 3em으로 잡는 보수적 fallback을 사용한다. 음수 `letterSpacing`은 유한 수이면 입력할 수 있으며 별도 하한은 없지만, 측정 폭은 추적 advance와 가장 넓은 글리프 폭 중 큰 값으로 고정한다. 따라서 과도한 음수 자간이 보이는 글리프의 잉크 폭을 0으로 축소해 QA가 false fit으로 승인하지 않는다. `wrapText`는 명시적 줄바꿈을 보존하고, 긴 토큰은 문자 경계에서 나누며, `maxLines`에서는 마지막 줄을 `…`로 줄이고 overflow를 보고한다. `measureTextBlock`은 줄·폭·높이·overflow를 계산한다.

`wrapTextLayers`는 기존 프레임 폭에 하드 래핑한다. `fitTextLayers`와 `autoLayoutDocument`는 텍스트를 래핑한 뒤 원본 글꼴 크기부터 최소 크기까지 41개(양 끝 포함)의 0.001 단위 결정론 후보 사다리를 큰 값부터 탐색한다. 기본 `minimumFontScale`은 `0.6`, 기본 `onOverflow`는 `grow`다.

- `shrink`: 최소 크기에도 못 맞으면 오류를 낸다.
- `grow`: 최소 크기에서 필요한 높이만큼 프레임을 늘리되, 시작점과 늘어난 프레임이 안전영역 안에 있어야 한다. 기본값이며 텍스트를 조용히 버리지 않는다.
- `truncate`: 최소 크기에서 프레임에 들어가는 줄 수로 말줄임표 처리한다.

한 글자도 최소 크기에 프레임 폭을 못 맞추거나, 안전영역을 벗어난 성장이 필요하거나, 말줄임표조차 못 넣으면 오류다. 결과와 변경 보고는 입력 순서에 고정되어 있어 같은 입력에 결정론적이며, 이미 맞는 결과에 다시 적용해도 변하지 않는다.

## 자동 QA

`inspectDocument`는 다음 8개 검사와 브랜드 위반 목록을 반환한다.

| 검사 이름 | 실제 검증 |
|---|---|
| `layers-inside-canvas` | 모든 레이어 프레임이 캔버스 범위 안에 있는지 |
| `content-respects-safe-area` | `safeMargin > 0`일 때 텍스트와 이미지만 안전영역 안에 있는지 |
| `text-contrast-at-least-4.5` | 각 분할 배경에서 텍스트 불투명도를 합성한 유효 색상의 대비가 4.5:1 이상인지. 둥근 사각형은 텍스트 프레임 전체가 유효 반지름만큼 안쪽에 있을 때만 배경으로 인정 |
| `text-fits-frame-width` | 측정 텍스트 폭이 프레임 폭의 101% 이하인지 |
| `text-fits-frame-height` | 측정 텍스트 높이가 프레임 높이 이하인지 |
| `text-not-occluded-by-later-opaque-layer` | 뒤 순서의 불투명, 모서리 반경 0 사각형 또는 불투명 이미지가 텍스트 프레임 전체를 덮지 않는지 |
| `image-layers-have-source` | 이미지 `source`가 공백 문자열이 아닌지 |
| `brand-kit-respected` | 위 브랜드 키트 위반이 없는지 |

대비 검사는 텍스트 프레임을 이전 사각형·이미지 경계로 나눈 모든 영역을 검사한다. 각 영역에서 텍스트 색상은 `text × opacity + backdrop × (1 − opacity)`로 먼저 합성한 뒤 WCAG 대비를 계산하며, 반투명 사각형도 알려진 배경에 합성한다. 둥근 사각형은 텍스트 프레임 전체가 `min(radius, width/2, height/2)`만큼 inset된 내부 사각형에 들어갈 때만 균일 배경으로 인정한다. 그렇지 않은 둥근 배경, 또는 이미지 픽셀이 불명인 배경은 fail-closed로 실패하고 수정 방법을 보고한다. `inspectDocument` 자체는 바이트 해시·재현성 검사를 하지 않으며, 직렬화·렌더의 바이트 동일성은 회귀 테스트 범위다.

## SVG·이미지·글꼴

SVG는 레이어 순서와 고정된 숫자 형식으로 결정론 직렬화한다. `mm` 캔버스의 출력 픽셀 크기는 96dpi(`96 / 25.4` px/mm)로 반올림해 계산하고 viewBox는 문서 단위를 유지한다. 텍스트와 속성은 XML 이스케이프하고, 이미지 resolver 결과는 base64 PNG/JPEG/WebP/SVG data URI만 허용한 뒤 이스케이프한다.

`createImageResolver`는 설정한 자산 루트 아래의 PNG·JPG/JPEG·WebP·SVG만 읽는다. 파일을 먼저 `O_NOFOLLOW`로 열어 held descriptor를 `fstat`하고, 실경로의 inode와 대조한 뒤 승인한 크기만 descriptor에서 읽는다. 어휘 경로와 실경로 모두 containment를 확인하며 기본 파일 상한은 20 MiB(`20 * 1024 * 1024`)이고 실경로별 data URI를 캐시한다.

래스터 내보내기는 시스템 글꼴을 읽지 않는다(`loadSystemFonts: false`). 기본 레지스트리는 번들된 IBM Plex Sans KR Regular(400)·SemiBold(600)를 자동 해석하므로 한국어 문서는 `fontFiles`를 명시하지 않아도 결정론적으로 렌더한다. 등록되지 않은 문서 글꼴의 `onMissingFont` 정책은 `throw`(기본), `warn`, `ignore`이며 기본은 tofu를 조용히 내보내지 않도록 `throw`다. 호출자가 `fontFiles`를 주면 유효한 sfnt 파일인지 검사한 해당 경로를 우선한다. npm 패키지는 이 런타임 자동 해석을 위해 `assets/fonts`와 OFL 라이선스를 함께 배포한다.

### 고전 이미지 처리

`process_design_image`는 기존 hardened image resolver로 승인한 PNG/JPEG를 읽고, 기존 hardened export writer로 PNG를 쓴다. 최대 20개 연산을 입력 순서대로 적용하며 결과는 축 최대 8,192px, 총 16,000,000px를 넘을 수 없다.

- `crop`: 이미지 안의 정수 좌표 사각형을 재표본화 없이 자른다.
- `scale`: 한 축 또는 두 축과 `stretch`/`contain`/`cover`를 받아 크기를 정한다. 축소는 source 면적을 적분하는 area/box 필터, 확대는 bilinear 필터를 쓴다. 필터 전 알파를 premultiply하고 후 unpremultiply하므로 투명 픽셀의 RGB가 가장자리를 어둡게 하지 않는다.
- `pad`: 지정한 RGBA 단색으로 캔버스를 확장한다. 장면을 생성하거나 확장하지 않는다.
- `remove-flat-background`: 선택한 모서리 표본과 허용 오차에 맞는 경계 연결 픽셀만 flood fill로 투명화한다.
- `trim-transparent`: 투명 여백을 잘라 네 변의 제거량을 보고한다.

이 연산들은 결정론적 고전 이미지 처리입니다. 캔버스 패딩은 단색으로 이미지를 확장하며 새 이미지를 생성하지 않습니다. 단색 배경 제거는 모서리 표본 기반의 경계 연결 색상 flood fill이므로 균일한 배경에만 적합하며, AI 마팅이 아니고 머리카락·부드러운 경계·복잡하거나 그라디언트 배경은 안정적으로 처리하지 못합니다.

## 워크스페이스 정책 게이트

`DesignPolicy`는 문서와 분리된 워크스페이스 선언이다. 금지어와 필수 문구는 NFKC 정규화 후 검사한다. `mode: "regex"` 패턴은 비어 있지 않은 256자 이하의 allowlist 문법만 쓴다: 일반 리터럴, `\\.*+?|()[]{}^$`로 escape한 리터럴, 선택적 선행 `^` 부정·escape한 메타문자·단순 범위를 가진 비어 있지 않은 문자 클래스, `^`/`$` 앵커, 그리고 리터럴 또는 문자 클래스 바로 뒤의 한 번짜리 고정 반복 `{n}`(`0 ≤ n ≤ 64`)이다. bare `.`와 `*`·`+`·`?`·`|`·괄호·escape class·backreference는 거부하며, `{n,}`와 `{n,m}`도 허용하지 않는다. 따라서 그룹·교대·lookaround·무한 반복을 Node 정규식 엔진에 넘기지 않아 catastrophic backtracking을 만들 수 없다. 한 텍스트 레이어 안의 명시적 줄바꿈은 제거해 줄바꿈으로 나뉜 용어를 잡는다. 레이어는 기하만으로 신뢰할 읽기 순서를 정할 수 없으므로 서로 연결하지 않으며, 따라서 서로 다른 레이어에 나뉜 용어는 검사하지 못한다.

승인 상태 전이는 `draft → in-review → approved | rejected`다. `approved`와 `rejected`는 terminal이며 불법 전이는 오류를 낸다. `requireApprovalForExport: true`일 때만 `approved`가 아닌 상태가 출고를 막고, 어떤 정책 위반이든 출고 허용을 거부한다. 제한은 이미지 레이어 금지, 브랜드 키트 색상 필수, 등록 캔버스 프리셋 필수, 최대 페이지 수다. 일반 위반은 예외가 아니라 위반 목록으로 반환하지만 잘못된 정책은 스키마 오류를 낸다. 정책을 주지 않은 문서는 기존과 정확히 같은 QA 보고를 반환한다.

**구현 — MCP 브랜드 정책 게이트:** 워크스페이스별 금지어·필수 문구, 승인 상태(`draft → in-review → approved/rejected`), 이미지/브랜드 색상/등록 프리셋/페이지 수 제한을 선언적으로 검사한다. `check_design_policy`는 위반 목록과 출고 허용 여부를 반환하며, 기존 QA는 정책을 명시적으로 받을 때만 정책 검사를 추가한다.

**UI 후속 범위:** 정책 편집 화면, 사람 검토용 승인함·알림·이력, 에디터 조작부 숨김은 웹 에디터 UI에서 구현한다. 사용자별 권한 부여는 호출자 identity/authorization 모델이 도입될 때 별도 범위로 구현한다.

## 내보내기

`exportDocument`는 기본적으로 `enforceQa: true`로 QA 실패를 거부한다. 원시 렌더는 라이브러리 호출에서만 명시적 `enforceQa: false`로 선택할 수 있으며, MCP `export_design_document`는 항상 QA를 먼저 통과해야 한다.

| 형식 | 실제 결과와 치수 보고 |
|---|---|
| SVG | 페이지별 UTF-8 SVG. 폭 지정은 허용하지 않으며 네이티브 픽셀 캔버스 치수를 보고한다. |
| PNG | 페이지별 resvg PNG. `transparentBackground: true`일 때 배경 사각형을 처음부터 그리지 않으며, 그 외에는 페이지 배경(또는 `backgroundColor`)으로 불투명 평탄화한다. 실제 PNG IHDR 치수를 보고한다. |
| JPG | 페이지 배경(또는 `backgroundColor`)에 알파를 평탄화한 실제 baseline sequential JPEG(JFIF) 바이트를 `.jpg` 확장자로 반환한다. 의존성 없는 in-house 인코더의 기본 `quality`는 85(1–100)이며, 컬러 텍스트 가장자리를 보호하기 위해 4:4:4 chroma sampling을 쓴다. |
| PDF | 모든 페이지를 평탄화 RGB 이미지 한 장씩 넣는 PDF 1.4 한 파일. 출력 폭 기준 래스터의 실제 치수를 보고한다. |
| PPTX | 전체 문서를 하나의 PresentationML/OOXML 패키지로 반환한다. 텍스트는 실제 `<p:sp>`/`<a:t>` run, 사각형은 실제 사각형 shape, 이미지는 embedded media를 참조하는 `<p:pic>`이므로 PowerPoint·Keynote·Google Slides에서 개별 텍스트·사각형·이미지 객체를 선택해 편집할 수 있다. ZIP 엔트리는 고정 timestamp와 CRC-32로 결정론적으로 기록한다. |
| GIF | 전체 문서를 GIF89a 한 파일로 반환하며 페이지 순서는 애니메이션 프레임 순서다. 공용 팔레트는 최대 256색 가중 median-cut 양자화로 만들고 모든 비교에 명시적 동률 순서를 둔다. 기본 프레임 지연은 10 centiseconds(100ms)이고, 평면 브랜드 패널에는 무디더링이 더 적합하므로 Floyd–Steinberg 디더링(`gifDither`)은 기본 `false`의 라이브러리 선택 옵션이다. 단일 프레임은 `NETSCAPE2.0` 확장을 생략하고, 둘 이상의 프레임은 loop count 0(무한 반복)을 기록한다. |
| MP4 | 전체 문서를 페이지 순서의 Motion JPEG 프레임을 담은 ISO BMFF MP4 한 파일로 반환한다. 기본 프레임 길이는 100ms이며 `mp4FrameDuration`에 모든 페이지 공통 값 또는 페이지별 배열을 줄 수 있다. JPEG 전부가 intra frame이므로 H.264 동등 품질보다 파일이 훨씬 크고, ffmpeg·QuickTime·VLC는 재생하지만 대부분 브라우저는 Motion JPEG MP4를 네이티브 재생하지 않는다. 인라인 짧은 루프에는 GIF, 비디오 파이프라인 전달에는 MP4를 쓴다. 고정 creation/modification timestamp로 바이트 결정론을 보장하며 홀수 치수도 지원한다. |

PDF 이미지 스트림은 Node `zlib`의 `FlateDecode`(level 9)를 쓰며, 캔버스가 `mm`면 PDF MediaBox는 72dpi(`72 / 25.4` pt/mm), `px`면 0.75pt/px로 계산한다. 제목과 Producer 메타데이터는 ASCII literal 또는 BOM이 붙은 UTF-16BE hex string으로 인코딩해 한글과 PDF 문법을 안전하게 처리한다.

PPTX 좌표는 EMU(인치당 914,400)로 변환한다: `px` 캔버스는 96dpi이므로 `px * 9,525 EMU`, `mm` 캔버스는 `mm * 36,000 EMU`다. 텍스트 크기는 PowerPoint의 1/100 point 단위로 각각 `px * 75`, `mm * (72 / 25.4) * 100`으로 기록한다. 각 슬라이드는 blank layout/master를 상속하는 대신 자기 `<p:bg>`에 페이지 배경색을 명시해 QA가 대비를 계산한 배경을 그대로 렌더한다. 최소 PresentationML은 텍스트 run, 사각형, 이미지 배치와 이 단색 페이지 배경만 표현한다. 텍스트와 레이어 객체는 편집할 수 있지만 복잡한 path, 둥근 사각형 반지름, 이미지 `cover`/`contain` crop, 필터·그라데이션·애니메이션·전환은 표현하지 않는다.

리소스 제한은 내보내기 전에 강제된다: 픽셀 축 최대 8,192, 페이지당 최대 16,000,000px, 문서당 최대 10페이지, 문서당 최대 1,000레이어다. GIF와 MP4는 같은 10페이지 상한을 10프레임 상한으로 적용하고 각각 총 프레임 픽셀을 32,000,000 이하로 추가 제한한다. `gifFrameDelay`(프레임별 0–65,535 centiseconds)·`gifDither`·`mp4FrameDuration`은 라이브러리 `exportDocument` 옵션이며, 현재 MCP 도구 스키마에는 노출되지 않는다. 래스터 폭은 양의 안전 정수여야 하며 비율로 계산한 실제 높이도 같은 축·픽셀 제한을 통과해야 한다. PDF/PPTX/GIF/MP4는 문서 전체를 한 파일로, SVG/PNG/JPG는 페이지마다 한 파일로 반환한다. MCP 출력은 output root 안의 상대 경로만 받고, 검증한 디렉터리 handle의 inode를 각 경로 연산 전 재검증한다. 파일은 `O_EXCL | O_NOFOLLOW`로 만들고 regular file·link count 1을 확인한 뒤 쓴다. 다만 Node에는 `openat`/디렉터리 상대 API가 없어 마지막 디렉터리 검증 뒤의 교체 경쟁을 원자화할 수 없다. 그 경우 post-open 검증이 바이트 쓰기를 거부하지만 외부에 빈 파일 하나가 생길 수 있으며, 같은 자격 증명 주체는 link-count 검사 뒤 hardlink를 추가할 수 있다. 따라서 절대적 containment를 주장하지 않는다.

## 템플릿과 프로젝트

템플릿은 복제 콘텐츠가 아닌 파라미터화된 원본 레이아웃 12종이다. 입력은 선언한 슬롯만 받을 수 있으며, 생성 시 브랜드 정규화·자동 레이아웃·QA를 수행한다.

| id | 캔버스 | 필수 슬롯 | 선택 슬롯 | 구성 의도 |
|---|---|---|---|---|
| `naver-blog-thumbnail` | `naver-blog-thumbnail` | `hook`, `imageSource` | `bandColor`, `accentColor`, `brandKit` | 104px 목록에서도 읽히는 한 장면·한 문구 사진형 썸네일 |
| `card-news-cover` | `instagram-portrait` | `eyebrow`, `headline`, `body` | `footer`, `accentColor`, `brandKit` | 악센트 바와 큰 제목의 카드뉴스 표지 |
| `card-news-slide` | `instagram-portrait` | `eyebrow`, `headline`, `body` | `footer`, `accentColor`, `brandKit` | 같은 그리드에서 핵심 한 가지를 설명하는 본문 |
| `youtube-thumbnail` | `youtube-thumbnail` | `hook` | `eyebrow`, `footer`, `accentColor`, `brandKit` | 작은 화면에 한 개의 고대비 훅을 남기는 영상 썸네일 |
| `instagram-story` | `instagram-story` | `eyebrow`, `headline`, `body` | `footer`, `accentColor`, `brandKit` | 상하 UI 여백을 확보한 세로 안내 카드 |
| `presentation-title` | `presentation-16-9` | `headline`, `body` | `eyebrow`, `accentColor`, `brandKit` | 제목·부제·발표자 정보를 위한 16:9 표지 |
| `card-news-closing` | `instagram-portrait` | `headline`, `summary`, `cta` | `eyebrow`, `footer`, `accentColor`, `brandKit` | 핵심 요약과 다음 행동을 제시하는 카드뉴스 마지막 장 |
| `presentation-agenda` | `presentation-16-9` | `title`, `item1`, `item2`, `item3` | `item4`, `eyebrow`, `accentColor`, `brandKit` | 네 구간을 훑는 16:9 아젠다 슬라이드 |
| `presentation-metric` | `presentation-16-9` | `metric`, `label`, `context` | `eyebrow`, `footer`, `accentColor`, `brandKit` | 큰 수치와 해석을 분리한 16:9 지표 슬라이드 |
| `instagram-square-quote` | `instagram-square` | `quote`, `attribution` | `role`, `eyebrow`, `accentColor`, `brandKit` | 인용문과 출처 중심의 정방형 소셜 포스트 |
| `blog-header` | `naver-blog-share` | `headline`, `imageSource` | `category`, `byline`, `accentColor`, `panelColor`, `brandKit` | 사진과 제목 패널을 나란히 둔 네이버 블로그 공유용 16:9 헤더 |
| `event-notice` | `instagram-portrait` | `headline`, `date`, `time`, `place` | `eyebrow`, `cta`, `accentColor`, `brandKit` | 행사 제목·일시·시간·장소를 한 장에 담는 세로 공지 포스터 |

프로젝트 저장소는 호출자가 지정한 루트의 `<id>.json` 한 파일로 `schemaVersion`, id, 제목, 생성·수정 시각, 문서, 선택적 프로젝트 브랜드 키트를 보존한다. id는 최대 128자이고 영숫자로 시작하며 영숫자·`.`, `_`, `-`만 쓸 수 있고 `..`와 경로 구분자는 금지한다. 저장소 루트·파일 symlink와 비정규 파일을 거부하고, 임시 파일(`0600`) 동기화 후 원자적 rename으로 저장한다. 목록은 파일명 id 순서로 결정론적이다.

현재 `schemaVersion`은 1이다. 더 새로운 버전은 거부하며, 더 오래된 버전도 명시적 마이그레이션이 구현되기 전에는 거부한다. `save_design_project`는 작업 중인 DRAFT를 재개할 수 있도록 QA 실패 문서도 의도적으로 저장하고 QA 상태를 함께 돌려준다.

## 레이아웃 프리미티브

레이아웃 연산은 입력 순서와 레이어 순서를 유지하고 새 레이어 객체를 돌려주는 결정론·불변 함수다. 모두 캔버스의 `safeMargin` 안에서 선택 레이어가 맞지 않으면 오류를 내 QA 불량 좌표를 만들지 않는다.

- `alignLayers`: 선택 레이어를 가로/세로 `start`·`center`·`end`에 각각 정렬한다. 가로 정렬한 텍스트는 SVG 앵커도 `start`/`middle`/`end`로 맞춘다.
- `distributeLayers`: 선택 순서대로 `space-between`, `space-around`, `fixed-gap`으로 x 또는 y축에 분배한다. `fixed-gap`은 gap이 필수이며, 한 레이어 `space-between`은 가운데 놓인다.
- `stackLayers`: 지정 origin에서 x/y축으로 쌓는다. 세로 텍스트는 여분의 선언 프레임 높이 대신 측정 자연 높이만큼 다음 레이어를 이동한다.
- `distributeVerticalRhythm`: 각 레이어를 `top`, `upper-middle`(안전영역 높이의 38% 중심), `remaining-space`, `bottom` 앵커에 배치한다. 남은 공간 레이어는 앵커 그룹 사이에 같은 앞·사이·뒤 간격으로 분배한다.

`arrange_design_layers`는 한 페이지의 중복 없는 `layerIds`를 선택해 이 네 연산 중 하나를 적용하고, 선택하지 않은 레이어 순서·좌표는 보존한 새 문서와 QA를 반환한다. 스택 origin과 gap은 호출자가 지정하며, vertical rhythm anchor 수는 선택 레이어 수와 정확히 같아야 한다.

## MCP 도구

`server.ts`에 등록된 MCP 도구는 23개다.

| 도구 | 역할 |
|---|---|
| `get_design_context` | Penpot 파일의 압축 브랜드 컨텍스트 추출 |
| `get_tokens` | Penpot 색상·타이포·간격 토큰 추출 |
| `get_components` | Penpot 컴포넌트와 변형 조회 |
| `list_files` | 접근 가능한 Penpot 파일 조회 |
| `create_element` | Penpot 페이지에 도형·텍스트·보드·SVG 생성 |
| `get_constraints` | Penpot 레이아웃 가드레일 조회 |
| `get_page_layout` | Penpot 페이지 레이아웃 트리 조회 |
| `import_figma` | Figma 디자인 시스템을 Penpot으로 변환·가져오기 |
| `update_element` | Penpot 요소 속성 수정 |
| `delete_element` | Penpot 요소 삭제 |
| `check_connection` | Penpot 연결·인증 확인 |
| `list_size_presets` | 14종 캔버스 프리셋 조회 |
| `create_design_document` | 문서 검증, 선택적 브랜드 정규화, QA 보고 |
| `check_design_policy` | 정책 위반과 출고 허용 여부 조회 |
| `create_from_template` | 등록 템플릿에서 문서·QA 생성 |
| `autolayout_design_document` | 텍스트 래핑·축소·성장/말줄임 및 변경 보고 |
| `arrange_design_layers` | 선택 레이어의 정렬·분배·측정 스택·세로 리듬 배치와 QA |
| `resize_design_document` | 프리셋·수치 4모드 리사이즈와 적용값 보고 |
| `export_design_document` | output root 내부로 SVG/PNG/JPG/PDF/PPTX/GIF/MP4 내보내기 |
| `process_design_image` | resolver 승인 이미지의 결정론적 고전 처리 후 output root 내부 PNG 저장 |
| `save_design_project` | QA 상태와 함께 DRAFT 프로젝트 저장 |
| `load_design_project` | 프로젝트 envelope 로드 |
| `list_design_projects` | id 순서 프로젝트 목록 조회 |

## 실행과 검증

`npm run design:demo`는 3면 카드뉴스를 네이티브 PNG·PDF와 세 채널 리사이즈 PNG로 내보내고 요약 JSON을 만든다. `npm run design:gallery`는 12개 템플릿의 PNG, 블로그 104px 미리보기, 네 가지 리사이즈 비교 PNG, contact sheet와 summary JSON을 만든다. 두 스크립트는 먼저 TypeScript를 빌드한다.

Vitest는 resvg PNG/PDF 렌더가 cold cache·CI에서 기본 5초보다 느릴 수 있어 테스트와 hook timeout을 각각 30,000ms로 올린다. 이는 테스트를 느슨하게 통과시키려는 설정이 아니라 실제 렌더 회귀가 가짜 시간초과로 보이지 않게 하기 위한 것이다.

## 후속 범위

- [#15](https://github.com/Doyajin174/teguma/issues/15): PPTX·GIF·MP4 내보내기까지 완료되어 해결됨
- [#16](https://github.com/Doyajin174/teguma/issues/16): 12종 템플릿이 등록되어 있으며 추가 확장은 선택 사항
- [#18](https://github.com/Doyajin174/teguma/issues/18): 웹 에디터 UI
