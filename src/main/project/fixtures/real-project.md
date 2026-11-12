# 프로젝트 설정

> `scripts/init.sh`가 채운다. 직접 수정해도 된다. 스크립트는 `- 키: 값` 형식의 줄만 읽는다.
> 값이 `(미설정)`이면 아직 초기화하지 않은 것이다.

- project_name: My Company
- project_dir: ../my-company-electron
- dev_command: npm run dev -- --host
- dev_session: dev
- extra_project_dirs: ../my-company-landing

## 설명

- `project_name`: 만들 프로젝트 이름
- `project_dir`: 프로젝트 레포 경로 (이 레포 기준 상대 경로 또는 절대 경로). 독립 git 레포여야 한다.
- `dev_command`: `scripts/dev.sh`가 `project_dir`에서 실행할 개발 서버 명령
- `dev_session`: dev 서버를 띄울 tmux 세션 이름
- `extra_project_dirs`: 이 회사가 함께 관리하는 추가 프로젝트 레포 (My Company: 랜딩 페이지 `my-company-landing`). 각각 독립 git 레포다.
