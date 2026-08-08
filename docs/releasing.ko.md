# 릴리스

[English](releasing.md)

`@devslab/ssrf-guard-js`의 한 버전이 npm에 올라가는 절차. 메인테이너 전용
문서이며, README가 아니라 `docs/`에 두는 이유는 README가 곧 npmjs.com의
패키지 페이지이기 때문이다. 패키지를 설치하는 사람에게 릴리스 절차는
노이즈다.

배포는 GitHub Actions가 처리한다. 저장소 시크릿 `NPM_TOKEN`(npm automation
토큰)이 필요하다.

## 머지가 곧 릴리스

`package.json`의 `version`을 올리고 그에 맞는 `CHANGELOG.md` 섹션을 추가한
PR을 연다. `main`에 머지되면 `Publish to npm`이 돌면서 패키지를 검증하고,
provenance와 함께 배포하고, `vX.Y.Z` 태그를 만들고, 그 CHANGELOG 섹션을
릴리스 노트로 하는 GitHub Release를 생성한다:

```bash
npm publish --access public --provenance
```

게이트는 태그가 아니라 **npm 레지스트리**다. `package.json`의 버전이 이미
배포돼 있으면 워크플로는 조용한 no-op이 된다. 그래서 평범한 머지는 아무 일도
하지 않고, 재실행해도 두 번 배포될 수 없다.

태그 푸시가 아니라 머지를 트리거로 삼은 이유는
[JS-013](decisions.ko.md#js-013--머지가-곧-릴리스) 참조.

## 손으로 태그 푸시하기

여전히 동작하며, 태그 생성 단계만 빠질 뿐 결과는 같다:

```bash
git tag v0.7.0
git push origin v0.7.0
```

손으로 푸시한 태그는 `package.json`과 일치해야 하고, 아니면 워크플로가
실패한다. 매니페스트와 어긋나는 태그는 무엇이 배포될지에 대한 거짓말이기
때문이다.

## 버전을 올리기 전에

- 로컬 `pnpm verify` 그린 — 타입체크·전체 스위트·빌드.
- 런타임 매트릭스 그린. CI가 `scripts/runtime-check.mjs`를 Node·Bun·Deno에서
  돌린다. 빌드된 `dist/`를 실행하며, 런타임 차이는 거기서만 드러난다.
- `CHANGELOG.md`에 새 버전 섹션이 있을 것. 릴리스 노트가 이 섹션에서
  생성되므로, 비어 있거나 없으면 빈 릴리스가 나간다.
- `docs/roadmap.md`와 `.ko.md` 짝에 출시 내용이 기록되고, 그 과정에서 내린
  결정은 `docs/decisions.md`(양쪽 언어)에 남아 있을 것.
- `README.md`와 `README.ko.md` 모두 새 버전의 실제 동작과 일치할 것 — 이
  둘이 npm 페이지와 그 번역이다.
