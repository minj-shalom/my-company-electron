# 에셋 라이선스 기록

레포에 들어온 외부 에셋(폰트, 이미지 등)의 출처와 라이선스를 기록한다. 기록이 없는 에셋은 머지하지 않는다.
이미지/스프라이트 에셋은 아직 반입하지 않았다 (CEO 결정 D-018: CC0 팩 방침 보류, UI는 CSS만 사용).

## 폰트 (확인일 2026-11-12, GitHub 공식 저장소에서 직접 확인)

| 폰트                           | 용도                       | 파일                                                                                  | 출처                                                                                     | 라이선스                                                                                                                                                                                                                   |
| ------------------------------ | -------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Galmuri11 (Regular, Bold)      | 제목/라벨 (한글 픽셀 폰트) | `src/renderer/src/assets/fonts/Galmuri11.woff2`, `Galmuri11-Bold.woff2`               | https://github.com/quiple/galmuri (`dist/`, 공식 저장소 main)                            | SIL OFL 1.1, Copyright 2019-2025 Lee Minseo. 전문: https://github.com/quiple/galmuri/blob/main/ofl.md, 사본 `fonts/Galmuri-OFL.md`. GitHub 라이선스 API도 `OFL-1.1`로 표시                                                 |
| Pretendard (Regular, SemiBold) | 본문                       | `src/renderer/src/assets/fonts/Pretendard-Regular.woff2`, `Pretendard-SemiBold.woff2` | https://github.com/orioncactus/pretendard (`packages/pretendard/dist/web/static/woff2/`) | SIL OFL 1.1, Copyright 2021 Kil Hyung-jin (Reserved Font Name 'Pretendard'). 전문: https://github.com/orioncactus/pretendard/blob/main/LICENSE, 사본 `fonts/Pretendard-OFL.txt` (Source, Inter, M PLUS 1 의 OFL 고지 포함) |

- 폰트 파일은 수정하지 않고 그대로 번들한다 (서브셋/변환 없음). 수정하면 OFL의 Reserved Font Name 조항 때문에 이름을 바꿔야 한다.
- OFL은 폰트 단독 판매만 금지하고 앱에 번들해 배포하는 것은 허용한다. 라이선스 전문을 폰트와 함께 둔다 (위 사본).
- 원격 로드는 하지 않는다. `@font-face`는 번들된 파일만 가리키며, CSP(`default-src 'self'`)는 바꾸지 않았다.
- GitHub 라이선스 API는 Pretendard를 `NOASSERTION`으로 표시한다 (여러 폰트의 고지가 한 파일에 합쳐져 있어서). 파일 본문에서 OFL 1.1임을 직접 확인했다.
