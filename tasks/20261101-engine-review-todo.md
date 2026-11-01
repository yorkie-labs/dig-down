# 20261101 Engine review (scary-island 대비 엔진·렌더링 개선)

scary-island(three.js + Rapier, JS)의 엔진·렌더링·도구를 4개 에이전트로 병렬 조사하고 dig-down과 비교했다.
결론: 렌더링은 dig-down이 이미 더 정교하다(블록 InstancedMesh 창, 셰이더 외곽선, 시드 결정론).
가져올 가치가 큰 것은 검증 도구(헤드리스 E2E), CI 테스트 게이트, 엔진 구조 패턴이다.
나머지는 조사 중 드러난 dig-down 자체의 프레임당 비용이다.

## 계획

### P0 검증 기반
- [x] CI: `pages.yml`에 `npm test` (main 푸시 = 공개 배포인데 테스트 없이 배포되고 있음)
- [x] 빌드: `dist/models/` 제거 플러그인 (로컬 빌드 때 Polyfork·Tripo 파생 GLB가 dist로 복사됨. scary-island `drop-local-models`)
- [x] 헤드리스 E2E: `scripts/e2e.mjs` + `scripts/scenarios/` (puppeteer-core, 시스템 Chrome)
  - 사용자 Chrome 탭을 건드리지 않음 (lessons: 입력 오염)
  - 콘솔 에러 수집, 장면 스크린샷, `renderer.info`·프레임 JS 비용을 JSON으로 출력 (성능 기준선)

### P1 렌더 성능 (측정 → 수정 → 재측정)
- [x] fx 2D 캔버스 DPR 상한 2 (지금은 DPR 3 기기에서 3배 해상도로 매 프레임 지움·그림)
- [x] `syncBlocks` 프레임당 할당 제거 (셀마다 클로저 2개, 색 문자열 파싱)
- [x] 이펙트 풀: `filter()` 새 배열, `new THREE.Color`, 빈 풀 업로드
- [x] 그 외 매 프레임 상수 재설정, 죽은 `castShadow`

### P1 엔진 구조
- [x] 키 반복·입력 버퍼를 고정 틱 안으로 (지금은 가변 dt로 `move()`/`drill()` 호출 → 프레임률에 따라 판정 타이밍이 다름)
- [x] (검토 후 보류) 모드 판정 정리 검토 (`paused`, `hitStop`, `started`, `game.state`) — scary-island `settle()` 패턴

### P2
- [x] 소품 머티리얼 공유 (클론마다 메시마다 새 `MeshToonMaterial`과 잉크 머티리얼)

### 하지 않기로 한 것 (근거)
- 셰도우맵 + 텍셀 스냅 그림자 카메라: dig-down은 블롭 그림자로 툰 스타일을 정했음
- 점광원 풀: 움직이는 광원이 없음 (헤드램프 1개). 추가할 때 다시 본다
- `fetch-assets` 스크립트: dig-down은 dev에서도 CDN을 직접 씀. 로컬 사본이 런타임에 쓰이지 않음
- reload 리셋, 프로덕션 `window.G`, `Math.random` 직접 사용: dig-down 쪽이 이미 더 나음
- `main3d.ts` 대규모 분할: 3600줄 리스크 대비 이번 범위 밖. 구간 경계만 기록 (아래)

## main3d.ts 구간 (분할할 때 참고)
63-100 three 셋업·조명 / 101-468 배경 / 469-617 크리스털·소품·골 바닥 / 618-941 블록 셰이더·인스턴스 /
942-1508 캐릭터 / 1509-1695 이펙트 풀 / 1696-2365 상태·입력·메뉴 / 2366-2790 튜토리얼·이벤트·결과 /
2791-3525 프레임 동기화·카메라·2D fx·HUD / 3526-3603 루프

## 리뷰

### 적용한 것
- CI `npm test` 단계, `drop-local-models` 빌드 플러그인 (`dist/models` 없음 확인)
- `scripts/e2e.mjs` + 시나리오 5개: smoke(시작·굴착), input(누른 키 반복·네 방향 회전·망치 유지), perf(프레임 JS 비용·draw call), title(소품), deep(`?depth=`)
  - DEV 전용 `window.__dd`(game, start, perfReset/perf). 프로덕션 번들에 없음 확인
- 렌더 성능
  - fx 캔버스 DPR 상한 2: 휴대폰(DPR 3) 1179×1977 → 786×1318, 픽셀 2.25배 감소 (WebGL 캔버스와 같은 해상도)
  - 이펙트 풀: 제자리 수명 처리(`agePool`), 색 문자열 파싱 캐시(`cssColor`), 쓰는 개수만큼만 GPU 업로드(`uploadInstances`, 빈 풀은 업로드 없음)
  - `syncBlocks`: 셀마다 만들던 클로저 2개 제거, 색 캐시, 범위 업로드
  - 깊이 분위기 색·배경색은 바뀔 때만 설정, 공기 바 style은 0.1% 단위로 바뀔 때만 씀, 죽은 `castShadow` 2곳 제거
- 엔진: 키 반복과 입력 버퍼를 `update(g, dt, beforeTick)`로 고정 틱 안에서 처리. 반복 속도와 재시도 창이 프레임률과 무관해짐(단위 테스트 2개)
  - 동작 차이: 히트스톱(0.03~0.16초) 동안에는 누른 키 반복도 멈춘다(세계와 같이 정지). 새로 누른 키는 전과 같이 즉시 반응
- 소품: 변환한 toon 머티리얼과 잉크 머티리얼을 원본 머티리얼 기준으로 공유. main과 같은 화면 확인(타이틀 스크린샷 비교)

### 측정 (헤드리스 Chrome, M 시리즈 Mac, 프레임 JS 비용 평균 ms, 3~6회 평균)
| | 이전 | 이후 |
|---|---|---|
| 데스크톱 타이틀 | 1.08 | 0.98 |
| 데스크톱 굴착 중 | 1.63 | 1.52 |
| 모바일 에뮬 굴착 중 | 1.52 | 1.44 |
| 모바일 에뮬 타이틀 | 0.66 | 0.96 (소품 로딩 시점에 따라 draw call 26~98로 흔들림, 비교 불가) |

- CPU 쪽 이득은 5~10%로 작다. 휴대폰에서의 주 이득은 fx 캔버스 채우기(GPU)인데, 헤드리스 JS 비용으로는 측정되지 않는다. 실제 폰 측정은 아직 안 함
- 플레이 중 draw call 21~29 (소품이 보이는 타이틀 ~100)

### 보류한 것
- `settle()` 모드 재계산: 확인해 보니 `setPaused`가 시작 전·결과 화면에서 일시정지를 막고, 프레임 루프 한 곳에서 `paused`/`hitStop`/`started`를 판정한다. 꼬이는 상태 조합을 찾지 못해 리팩터 이득보다 회귀 위험이 크다
- 적응형 DPR: 실제 폰 측정 근거가 없음. 폰 측정 후 판단
- 눈 220개 CPU 갱신, floater 정규식: 측정상 의미 없는 크기

### 다른 task 문서의 남은 항목 검토 (2026-11-01)
- 이번 범위(엔진·렌더링·CI)와 겹치는 것: deploy-todo의 Actions 버전(올림), 번들 분할(보류, 이유는 deploy-todo)
- 범위 밖이라 그대로 둔 것: stages-todo 2~5(체크만 안 됐을 뿐 스테이지는 이미 구현됨), studio-review2 2·3·5·15(밸런스·점수 설계, 사용자 결정 필요), render-loop 59·11·12(그림 생성 작업)

