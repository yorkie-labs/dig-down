# 웹 배포 (GitHub Pages) — 2026-10-31

목표: 지금 게임을 웹으로 먼저 공개한다(나중에 Capacitor로 앱스토어 확장). 사용자 결정: GitHub Pages, 공개 저장소(B안), 이름 `dig-down`.

- [x] 에셋 URL을 페이지 기준 상대 경로로 바꿈(`/<repo>/` 하위 경로에서 동작)
- [x] Polyfork 모델은 polyfork.dev CDN에서 직접 불러옴(CORS `*` 확인). 로컬 사본은 gitignore. 라이선스상 파일 재배포 금지
- [x] Tripo 파생 모델 2개 제외(`assets/character/*tripo*`, `public/models/puppy.glb`, 비상업 라이선스)
- [x] `index.html`은 `3d.html`로 넘김(쿼리 유지), 옛 2D는 `2d.html`
- [x] `vite.config.ts`: base를 `VITE_BASE`로 설정하고 3개 페이지를 입력으로
- [x] 모델 파일 존재 테스트는 로컬 사본이 없으면 건너뜀(CI)
- [x] `.github/workflows/pages.yml`: main에 푸시 → 빌드 → Pages 배포
- [x] 공개 저장소 생성, 푸시, Pages(workflow 방식) 활성화: 사용자가 직접 실행(자동 권한 검사가 공개 저장소 생성을 거부)
- [x] 배포 확인: 첫 실행 성공, https://yorkie-labs.github.io/dig-down/ 에서 타이틀·소품(CDN)·플레이 정상, 콘솔 에러 없음

- [x] 레티나 대응: 코드로 그린 텍스처(산, 소나무, 지면, 골 바닥 등)를 슈퍼샘플링(고해상도 화면 4배, 아니면 2배, 4096px·약 4.2M픽셀 상한, 하늘·먼 배경은 2배). 게임 캔버스는 원래 DPR 2까지 렌더링 중
- [x] 초기 로딩 화면: HTML/CSS라 JS 번들이 오기 전부터 표시(로고, 강아지, 진행 바, '얼음 파는 중… n%'). three의 DefaultLoadingManager(모든 텍스처와 스프라이트)와 웹폰트 완료 후 페이드아웃, 15초 안전 타임아웃. CDN 소품은 별도 매니저라 로딩을 붙잡지 않음. dev `?holdloading`으로 화면 확인. 배포 확인(5aba627)

## 다음
- [ ] PWA(manifest, 아이콘, 오프라인 캐시)로 홈 화면에 설치
- [ ] Actions 경고: Node 20 액션 지원 종료 예정 → checkout/setup-node/upload-pages-artifact/deploy-pages 새 메이저 버전이 나오면 올리기
- [ ] 번들 737KB(gzip 200KB): three.js 코드 분할 검토
