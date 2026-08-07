# 미리캔버스 기능 파리티 조사

> 조사일: 2026-08-01
>
> 관련 이슈: [#13](https://github.com/Doyajin174/teguma/issues/13)

## 결론

미리캔버스와의 "동급"은 콘텐츠 물량 경쟁이 아니라 **기능 파리티 + 에이전트 우위**로 정의한다.

미리캔버스의 핵심 자산 중 53만 개 이상의 템플릿과 1,000만 개 이상의 요소는 라이선스 상용 콘텐츠이므로 복제 대상이 아니다. 반면 사이즈 프리셋, 리사이즈, 다중 페이지 문서, 브랜드 키트, 내보내기, AI 생성은 teguma에서 재현 가능하며 자동 검증까지 붙일 수 있다.

## 실측 사양

### 사이즈 프리셋

미리캔버스 공식 안내 기준 주요 프리셋:

| 용도 | 크기 |
|---|---|
| 유튜브 썸네일 | 1280×720 |
| 유튜브 영상 | 1920×1080 |
| 인스타그램 정사각 | 1080×1080 |
| 인스타그램 세로·카드뉴스 | 1080×1350 |
| 인스타그램 스토리·릴스 | 1080×1920 |
| 페이스북 정사각 | 1200×1200 |
| 블로그 썸네일 | 900×600, 1200×800 |
| 프레젠테이션 | 1920×1080 |
| A4 인쇄 | 210×297mm |

출처: [유튜브 썸네일 사이즈 안내](https://help.miricanvas.com/hc/ko/articles/360039313772), [인스타그램 템플릿](https://www.miricanvas.com/ko/template/instagram_default)

### 크기 조정 (매직 리사이즈)

[크기 변경 가이드](https://help.miricanvas.com/hc/ko/articles/360032161252)에 따르면:

- 프리셋 선택 또는 직접 수치 입력
- 적용 방식 3종: **채우기**, **맞추기**, **원본 크기**
- 자물쇠(비율 고정) ON이면 한 축 입력 시 다른 축 자동 계산

### 내보내기

[다운로드 가이드](https://help.miricanvas.com/hc/ko/articles/32570677518617):

- PNG (투명 배경 지원)
- JPG
- PDF (다중 페이지, 인쇄용)
- PPTX (편집 가능)
- MP4, GIF (GIF는 최대 10초·32페이지·1080×1080)

### 브랜드 키트

[브랜드 키트 가이드](https://help.miricanvas.com/hc/ko/articles/4411396671769):

- 로고, 색상 팔레트, 글꼴 등록
- Pro 10개 / Enterprise 100개
- 팀원이 등록된 자산만 사용하도록 유도

### 브랜드 관리

[브랜드 관리 가이드](https://help.miricanvas.com/hc/ko/articles/4414540118937):

- 디자인 승인·검토 워크플로
- 금지어 설정
- 에디터 기능 제한
- 워크스페이스 권한 관리

### AI 기능 (미리클)

[AI 기능 안내](https://help.miricanvas.com/hc/ko/articles/33349963638553):

- 프레젠테이션 자동 생성
- 리디자인
- 배경 제거, 이미지 확장
- 상품·음식 연출 이미지
- AI 라이팅
- 딱 맞는 페이지 추천

## 파리티 매트릭스

| 미리캔버스 기능 | teguma 대응 | 판정 |
|---|---|---|
| 사이즈 프리셋 | 14종 프리셋 레지스트리(네이버 블로그 3종 포함) | 구현 |
| 크기 조정 3-모드 | 4-모드 리사이즈(`fill`/`fit`/`original`/`adapt`) | 구현 — `adapt`는 원본 캔버스 전체를 덮는 사각형만 가로 확장하는 teguma 확장. `fit`의 무크롭 보장은 원본이 캔버스 안에 있을 때만 성립 |
| 다중 페이지 문서 | 선언형 문서 모델 | 구현 |
| 브랜드 키트·브랜드 관리 | 팔레트·글꼴·로고 정규화와 위반 검출, 워크스페이스 정책 게이트 | 구현 — 금지어·필수 문구·승인·이미지/색상/프리셋/페이지 제한은 MCP에서 검사. 편집 UI·사람 검토 운영·사용자별 권한은 웹 에디터/identity 범위에 남음 |
| SVG·PNG·JPG·PDF·PPTX·GIF·MP4 | SVG·PNG·JPG·PDF·PPTX·GIF·MP4 구현. PPTX는 고정 timestamp ZIP의 PresentationML이며 각 슬라이드의 `<p:bg>`에 페이지 배경을 기록하고 텍스트·사각형·이미지는 개별 객체로 편집 가능하다. JPG는 배경 평탄화 후 in-house baseline JPEG(JFIF), 기본 quality 85의 4:4:4 chroma sampling으로 `.jpg` 바이트를 반환한다. GIF는 문서 페이지를 GIF89a 프레임으로 내보내며 최대 256색 결정론적 median-cut 팔레트, 기본 100ms 지연, 10프레임·총 32,000,000 프레임 픽셀 상한을 적용한다. MP4는 같은 페이지를 Motion JPEG intra frame으로 담고 기본 100ms, 같은 10프레임·32,000,000 픽셀 상한을 적용한다. | 구현 — [#14](https://github.com/Doyajin174/teguma/issues/14) real JPEG 완료, [#15](https://github.com/Doyajin174/teguma/issues/15) PPTX·GIF·MP4 완료 |
| 자동 레이아웃·검수 | 등록 글꼴의 실제 advance를 파일·코드포인트 단위로 캐시하는 결정론적 텍스트 래핑·축소·성장/말줄임 + 유효 텍스트 색상·둥근 배경을 fail-closed로 검사하는 QA 게이트 | 구현 (미리캔버스 미제공) |
| 원본 템플릿 | 파라미터화된 12종 채널 템플릿: `naver-blog-thumbnail`, `card-news-cover`, `card-news-slide`, `card-news-closing`, `youtube-thumbnail`, `instagram-story`, `presentation-title`, `presentation-agenda`, `presentation-metric`, `instagram-square-quote`, `blog-header`, `event-notice` | 구현 — [#16](https://github.com/Doyajin174/teguma/issues/16) 등록분 완료; 추가 확장은 선택 사항 |
| 프로젝트 저장 | 로컬 원자 저장·로드·목록 | 구현 |
| 결정론 재현 | 동일 입력의 바이트 동일성을 회귀 테스트로 검증 | 테스트 검증 (해시 기반 `inspectDocument` 기능은 미구현) |
| AI 이미지 생성 | 생성 + C2PA provenance | 기존 자산 재사용 |
| AI 라이팅·페이지 추천 | 호출하는 에이전트가 담당 | 구조적 우위 |
| MP4 | 의존성 없이 기존 JPEG 인코더를 재사용한 ISO BMFF Motion JPEG | 구현 — [#15](https://github.com/Doyajin174/teguma/issues/15) 완료. `mp4FrameDuration`은 기본 100ms의 공통 값 또는 페이지별 배열이며 고정 creation/modification timestamp로 바이트 결정론적이다. ffprobe 독립 검증: `mjpeg`, 64×40, 3프레임, 0.300000초, 10fps, `mov,mp4,m4a,3gp,3g2,mj2`; ffmpeg 추출 프레임의 채널별 MAE는 3 미만이다. 홀수 치수도 지원한다. 매 프레임이 full intra frame이라 H.264 동등 품질보다 훨씬 크고, ffmpeg·QuickTime·VLC는 재생하지만 대부분 브라우저는 네이티브 재생하지 않는다. 짧은 인라인 루프에는 GIF, 비디오 파이프라인 전달에는 MP4를 쓴다. |
| 고전 이미지 처리 | `process_design_image`: crop·scale·단색 pad·단색 배경 제거·투명 여백 trim | 부분 구현 — 결정론적 픽셀 연산이며 AI 배경 제거·이미지 확장·화질 개선은 미구현 |
| 승인·금지어·권한 | 워크스페이스 정책 게이트 | **구현 — MCP 브랜드 정책 게이트:** 워크스페이스별 금지어·필수 문구, 승인 상태(`draft → in-review → approved/rejected`), 이미지/브랜드 색상/등록 프리셋/페이지 수 제한을 선언적으로 검사한다. `check_design_policy`는 위반 목록과 출고 허용 여부를 반환하며, 기존 QA는 정책을 명시적으로 받을 때만 정책 검사를 추가한다.<br><br>**UI 후속 범위:** 정책 편집 화면, 사람 검토용 승인함·알림·이력, 에디터 조작부 숨김은 웹 에디터 UI에서 구현한다. 사용자별 권한 부여는 호출자 identity/authorization 모델이 도입될 때 별도 범위로 구현한다. |
| 53만 템플릿 / 1,000만 요소 | 라이선스 콘텐츠, 복제 불가 | 범위 제외 |

## teguma가 더 나은 지점

미리캔버스는 사람이 클릭으로 조작하는 편집기다. teguma는 명세를 입력받아 검증 가능한 산출물을 생성하는 파이프라인이다.

- 동일 입력의 바이트 동일성을 회귀 테스트로 확인
- 캔버스 이탈·텍스트 프레임 적합·완전 가림·안전영역, 텍스트 불투명도를 합성한 4.5:1 대비를 자동 검수하며 모서리 반경 안쪽에 완전히 들어가지 않는 둥근 배경은 fail-closed
- 생성 이미지의 프롬프트·해시·C2PA 상태 추적
- 실노출 크기(예: 네이버 검색 104px) 검증

## 범위 결정

에이전트용 MCP 백엔드 + 문서 엔진으로 구현한다. 사람이 직접 조작하는 캔버스 웹 에디터는 아키텍처가 전혀 달라지므로 [#18](https://github.com/Doyajin174/teguma/issues/18)로 분리한다. 문서 모델·프리셋·리사이즈·내보내기는 UI 없이도 완전히 구현 가능하며, UI를 나중에 붙일 때 그대로 재사용된다.
