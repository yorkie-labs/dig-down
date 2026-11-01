# Dig Down

Mr. Driller 스타일의 브라우저 퍼즐 액션 게임(강아지가 얼음 아래로 굴착). three.js + TypeScript + Vite.
배포: https://yorkie-labs.github.io/dig-down/ (공개 저장소 `yorkie-labs/dig-down`)

## 명령
- `npm run dev` → http://localhost:5173/3d.html (메인 게임)
- `npm test` (vitest), `npm run build` (`tsc && vite build`)
- `npm run e2e -- scripts/scenarios/<name>.js [outDir]`: 헤드리스 Chrome 시나리오(puppeteer-core). 개발 서버가 필요하다(`npm run dev -- --port 5188`, 다른 주소는 `GAME_URL`). 장면은 쿼리로 고르고(`GAME_URL='…/3d.html?depth=230'`), `MOBILE=1`이면 휴대폰(DPR 3)으로 띄운다. `perf.js`는 프레임 JS 비용과 draw call 수를 JSON으로 출력한다
- 완료 전에는 `npm test`와 `npm run build`를 모두 통과시킨다.

## 구조
- 진입점: `3d.html` → `src/main3d.ts`(메인 게임, 렌더링·입력·HUD), `index.html`은 `3d.html`로 리다이렉트(쿼리 유지), `2d.html` → `src/main.ts`(옛 2D 판)
- 게임 로직은 렌더링과 분리: `src/sim.ts`, `src/game.ts`, `src/stages.ts`, `src/progress.ts`, `src/chunks.ts` — 각각 `*.test.ts`가 있음
- 소품: `src/props3d.ts`, `src/propsCatalog.ts` / 사운드: `src/sfx.ts` / 로딩 화면: `src/loading.ts`
- `tools/`: 에셋 준비용 Python 스크립트(스프라이트 컷아웃, 영상→시트 등)
- 개발용 쿼리 훅이 있음(예: `?holdloading`, `?slowswing`, `?depth=`, `?bg=paint` 옛 그림 절벽). 화면 확인 시 활용
- 배경 절벽: `src/backdrop3d.ts` 절차 생성 로우폴리 얼음 암벽(기본값)

## 배포
- main에 푸시 → `.github/workflows/pages.yml`이 빌드 후 Pages 배포. 즉 **main 푸시 = 공개 배포**
- `vite.config.ts`의 base는 `VITE_BASE`(CI에서 `/dig-down/`). 에셋 URL은 반드시 페이지 기준 상대 경로로 쓴다(`/`로 시작 금지)

## 라이선스 제약 (중요)
- Polyfork 모델: 재배포 금지 → polyfork.dev CDN에서 런타임 로드. 로컬 사본(`public/models/polyfork/`)은 gitignore, 절대 커밋하지 않음
- Tripo 파생 에셋(`assets/character/*tripo*`, `public/models/puppy.glb`): 비상업 → 커밋 금지
- Jua 폰트: OFL, `public/fonts/`에 서브셋 포함
- 새 외부 에셋을 넣을 때는 라이선스를 먼저 확인하고 README 크레딧에 추가

## 작업 방식
- 작업 문서는 `tasks/`(목차 `tasks/README.md`). lessons는 프로젝트 공용 `tasks/20261025-dig-prototype-lessons.md` 하나에 누적
- 원작/레퍼런스 수치는 "확인됨 / 팬 자료 / 우리 선택"을 구분해 말하고 상수 주석에도 남긴다
- 화면 확인은 헤드리스 E2E(`scripts/e2e.mjs`)를 먼저 쓴다. 자체 브라우저라 사용자 탭에 키가 섞이지 않는다. DEV 전용 훅은 `window.__dd`(game, start, perf)
- 브라우저 확인 시 사용자가 같은 Chrome 창에서 플레이 중일 수 있음 → 키 입력 오염을 먼저 의심하고, 검증 후 탭을 조작하지 않는다
