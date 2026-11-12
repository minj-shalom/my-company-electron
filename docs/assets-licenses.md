# 에셋 라이선스 기록

레포에 들어온 외부 에셋(폰트, 이미지 등)의 출처와 라이선스를 기록한다. 기록이 없는 에셋은 머지하지 않는다.
이미지/스프라이트 파일은 아직 반입하지 않았다. 가상 사무실(T-020)의 바닥, 책상, 아바타는 코드(PixiJS Graphics)로 그린 자체 제작물이다 (아래 "가상 사무실 스프라이트" 참고).

## 폰트 (확인일 2026-11-12, GitHub 공식 저장소에서 직접 확인)

| 폰트                           | 용도                       | 파일                                                                                  | 출처                                                                                     | 라이선스                                                                                                                                                                                                                   |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Galmuri11 (Regular, Bold)      | 제목/라벨 (한글 픽셀 폰트) | `src/renderer/src/assets/fonts/Galmuri11.woff2`, `Galmuri11-Bold.woff2`               | https://github.com/quiple/galmuri (`dist/`, 공식 저장소 main)                            | SIL OFL 1.1, Copyright 2019-2025 Lee Minseo. 전문: https://github.com/quiple/galmuri/blob/main/ofl.md, 사본 `fonts/Galmuri-OFL.md`. GitHub 라이선스 API도 `OFL-1.1`로 표시                                                 |
| Pretendard (Regular, SemiBold) | 본문                       | `src/renderer/src/assets/fonts/Pretendard-Regular.woff2`, `Pretendard-SemiBold.woff2` | https://github.com/orioncactus/pretendard (`packages/pretendard/dist/web/static/woff2/`) | SIL OFL 1.1, Copyright 2021 Kil Hyung-jin (Reserved Font Name 'Pretendard'). 전문: https://github.com/orioncactus/pretendard/blob/main/LICENSE, 사본 `fonts/Pretendard-OFL.txt` (Source, Inter, M PLUS 1 의 OFL 고지 포함) |

- 폰트 파일은 수정하지 않고 그대로 번들한다 (서브셋/변환 없음). 수정하면 OFL의 Reserved Font Name 조항 때문에 이름을 바꿔야 한다.
- OFL은 폰트 단독 판매만 금지하고 앱에 번들해 배포하는 것은 허용한다. 라이선스 전문을 폰트와 함께 둔다 (위 사본).
- 원격 로드는 하지 않는다. `@font-face`는 번들된 파일만 가리키며, CSP(`default-src 'self'`)는 바꾸지 않았다.
- GitHub 라이선스 API는 Pretendard를 `NOASSERTION`으로 표시한다 (여러 폰트의 고지가 한 파일에 합쳐져 있어서). 파일 본문에서 OFL 1.1임을 직접 확인했다.

## 가상 사무실 스프라이트 (T-020, 확인일 2026-11-12)

- 반입한 외부 이미지 에셋: 없음. 바닥 타일, 책상, 아바타(10x14 픽셀 도안), 상태 말풍선은 `src/renderer/src/office/sprites.ts`가 PixiJS Graphics로 그린다. 직접 만든 것이라 라이선스 의존이 없다.
- 사유: CEO 결정(D-018)은 "CC0 팩으로 먼저 만들고 별로면 추후 교체"다. Kenney 공식 사이트(https://kenney.nl/assets/tiny-dungeon, /roguelike-indoors, /support)를 확인하려 했으나 자동 요청이 HTTP 403으로 막혀 CC0 표기를 공식 페이지에서 직접 확인하지 못했다. 확인하지 못한 팩은 반입하지 않는다 (위 방침). 사람이 공식 페이지에서 라이선스를 확인하고 팩을 고르면 `sprites.ts`의 export만 같은 모양으로 바꿔 끼우면 된다 (레이아웃/상태 로직은 이 모듈을 거쳐서만 에셋을 쓴다).
- 색은 모두 `tokens.css` 토큰이다. 피부/머리카락/책상 색은 `--skin-*`, `--hair-*`, `--office-desk`.
- 글꼴은 위 표의 Galmuri11을 캔버스 텍스트(PixiJS Text)에도 쓴다.

## 코드 의존성 (T-020)

| 패키지  | 버전   | 라이선스 | 용도                              | 확인                                                                                                                            |
| ------- | ------ | -------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| pixi.js | 8.23.0 | MIT      | 가상 사무실 렌더링 (WebGL/canvas) | npm 레지스트리 메타데이터(`license: MIT`, 2026-11-11 갱신, 활발히 유지), `npm audit`에서 이 패키지 및 하위 의존성의 취약점 없음 |

- CSP(`default-src 'self'; script-src 'self'`)는 바꾸지 않았다. 기본 PixiJS는 셰이더 유니폼 동기화에 `new Function`(unsafe-eval)을 요구해 CSP에서 초기화가 실패한다 (dev 서버에서 확인). `import 'pixi.js/unsafe-eval'`(공식 제공 eval 없는 구현)을 쓰면 CSP 그대로 동작한다.
