# Cloudflare Product & Solution Explorer

Cloudflare의 공식 제품군과 solution을 학습하기 위한 정적 visualization project입니다.
TypeScript crawler가 공식 web source를 수집해 JSON으로 구조화하고, Angular web application이
생성된 JSON을 읽어 제품과 관계를 보여줍니다.

> 현재 pnpm workspace와 세 package(`web`, `crawler`, `packages/catalog`)의 bootstrap이
> 완료되어 아래 command를 실행할 수 있습니다. `pnpm crawl`이 공식 source 수집, schema
> validation, `web/public/data/catalog.json` 갱신까지 수행합니다. web은 `catalog.json`을
> schema validation과 함께 불러와
> product family 계층 탐색, product·solution 상세(공식 출처 링크 포함), URL로 공유
> 가능한 검색·필터, 출처가 표기된 관계 시각화(접근 가능한 목록 병행), loading·오류·빈
> 데이터 상태를 제공합니다.

## 목표

이 project는 다음 질문에 답할 수 있는 탐색 화면을 만드는 것을 목표로 합니다.

- Cloudflare에는 어떤 공식 product family와 product가 있는가?
- 각 product는 어떤 solution과 use case에 연결되는가?
- 수집된 정보의 공식 출처는 어디인가?

MVP는 product family 탐색, 검색과 filter, 상세 정보, 출처가 포함된 관계 보기를 제공합니다.
로그인, browser 편집, backend API, database, scheduled crawling은 포함하지 않습니다.

## 동작 방식

```text
Cloudflare official sources          data/curated/ (hand-edited)
            |                                  |
       pnpm crawl                     pnpm build:curated
 fetch -> normalize -> validate     validate -> normalize
            |                                  |
            v                                  v
 web/public/data/catalog.json    web/public/data/curated.json
            \_________________________________/
                            |
                        pnpm dev
                 Angular visualization
```

Data는 두 갈래입니다. **Crawl**은 공식 page에 있는 살아있는 사실(제품·솔루션의 존재, 설명,
URL)을 수집하고, **curation**은 공식 page에 구조화되어 있지 않은 지식(요청 경로상의 레이어
위치, 한국어 역할 설명, 솔루션 구성, 요금제)을 담습니다. 두 쪽 모두 모든 record가 공식
source URL과 확인 시각을 포함하며, 수집·검증이 실패하면 기존 정상 data file을 변경하지
않습니다.

## 프로젝트 구조

```text
.
├── web/                         # Angular 정적 visualization web
│   └── public/data/             # 생성된 JSON data (catalog.json, curated.json)
├── crawler/                     # 수집·빌드 script (Node.js TypeScript)
│   └── config/                  # 수집 대상 seed와 허용 host, fetch 정책 (sources.json)
├── data/
│   └── curated/                 # 손으로 편집하는 curated dataset source (출처 필수)
└── packages/                    # 공통 library, schema, TypeScript type
    └── catalog/                 # Crawler와 web이 공유하는 data contract
```

### `web`

Cloudflare 제품군과 관계를 시각화하는 Angular application입니다. `public/data`의 검증된 JSON만
읽으며 crawler 내부 code에는 의존하지 않습니다.

### `crawler`

공식 source를 수집하고 구조화하는 실행 script입니다. 생성 결과를 schema로 검증한 뒤
`web/public/data`를 갱신합니다.

### `packages`

Crawler와 web이 함께 사용하는 code를 둡니다. 첫 package인 `catalog`은 runtime schema,
TypeScript type, validator를 제공하며 data 구조의 single source of truth입니다.

세부 dependency 규칙과 품질 기준은 [`AGENTS.md`](./AGENTS.md)를 참조하세요.

## 기술 구성

- Angular CLI와 standalone Angular component (zoneless)
- strict TypeScript
- Node.js LTS (`.nvmrc` 기준 24)
- `pnpm` workspace
- Vitest unit test와 ESLint, Prettier
- Cloudflare Pages static hosting

초기 범위에는 Nx, SSR, NgRx를 사용하지 않습니다.

## 설정과 실행

다음 command를 repository root에서 실행합니다.

```bash
corepack enable
pnpm install

# 공식 source 수집과 web data 갱신 (network 사용)
pnpm crawl

# Curated source를 검증·정규화해 web artifact 갱신 (offline)
pnpm build:curated

# 갱신된 data를 시각화 (Angular dev server)
pnpm dev

# 품질 검증과 production build
pnpm lint
pnpm test
pnpm build

# Commit된 data(catalog + curated)의 schema·정합성 validation (offline)
pnpm validate:data
```

`pnpm crawl`은 승인된 source를 수집하고 전체 결과가 schema validation을 통과한 경우에만
`web/public/data/catalog.json`을 원자적으로 교체합니다. 수집이나 검증이 실패하면 기존 data
file은 변경되지 않습니다. 일반적인 사용 순서는 `pnpm crawl` 후 `pnpm dev`입니다.

Curated data를 수정할 때는 `data/curated/curated.json`을 편집한 뒤 `pnpm build:curated`를
실행합니다. Schema, 중복, catalog 참조 검증을 통과한 경우에만 `web/public/data/curated.json`이
정규화된 형태로 교체되며, source만 고치고 rebuild를 잊으면 `pnpm validate:data`가
freshness 단계에서 실패합니다.

## 공식 Source

- `cloudflare.com`의 공식 product 및 solution page
- `developers.cloudflare.com`의 공식 documentation

정보가 충돌하면 현재 `cloudflare.com` product taxonomy를 우선하고 Developer Docs를 세부
설명과 관계의 보조 source로 사용합니다.

## 배포

Target hosting은 Cloudflare Pages입니다. `pnpm build`가 만든 static output
(`web/dist/web/browser`)을 순수 static asset으로 배포하며 server-side runtime은 필요하지
않습니다. Route 직접 진입과 새로고침은 Cloudflare Pages의 내장 SPA fallback이 처리합니다
(`404.html`이 없으면 존재하지 않는 경로에 `index.html`을 자동 제공; 별도 `_redirects` 규칙은
필요 없고, `/* /index.html 200` 형태는 Pages가 무한 루프로 판정해 무시합니다). 실제 file이
있는 asset(`/data/catalog.json`, `/data/curated.json`, hashed chunk)은 언제나 그대로 제공됩니다. Cache 정책은
`web/public/_headers`가 정의합니다. 모든 pull
request는 GitHub Actions CI(`.github/workflows/ci.yml`)가 `pnpm lint`, `pnpm test`,
`pnpm validate:data`, `pnpm build`로 검증합니다.

### Data 갱신

Production build와 배포는 network를 사용하지 않습니다. 배포되는 data는 commit된
`web/public/data/`의 `catalog.json`과 `curated.json`이 전부입니다. Catalog는 수동으로
`pnpm crawl`을 실행해, curated artifact는 `data/curated/curated.json` 편집 후
`pnpm build:curated`를 실행해 갱신하고 변경분을 commit합니다. Commit된 data는
`pnpm validate:data`가 schema, cross-reference, artifact 신선도까지 언제든 다시
검증할 수 있습니다.

### Local 검증

배포 전에 Pages와 같은 SPA fallback과 `_headers` 규칙을 적용하는 local static server로
직접 진입 route와 data 응답을 확인합니다.

```bash
pnpm build
pnpm dlx wrangler pages dev web/dist/web/browser --port 8788
```

`http://127.0.0.1:8788`에서 두 화면의 직접 진입(`/`, `/solutions`)과 딥링크
(`/?product=<id>`, `/solutions?solution=<id>`), 은퇴한 v1 경로의 redirect
(`/browse`, `/discovery` → `/`, `/relationships` → `/solutions`,
`/products/<id>` → `/?product=<id>`, `/solutions/<id>` → `/solutions?solution=<id>`),
그리고 `/data/catalog.json`·`/data/curated.json` 응답을 확인합니다. 일상적인 개발에는
`pnpm dev`를 사용하고, 이 검증은 배포 전 확인 용도입니다.

### Cloudflare Pages 설정

Dashboard에서 git integration으로 GitHub repository를 연결하고 다음 값을 사용합니다.

| 항목                   | 값                                             |
| ---------------------- | ---------------------------------------------- |
| Production branch      | `main`                                         |
| Build command          | `pnpm install --frozen-lockfile && pnpm build` |
| Build output directory | `web/dist/web/browser`                         |
| Root directory         | repository root                                |
| Environment variables  | 없음 (secret 불필요)                           |

Pages build system(v2)은 root `package.json`의 `packageManager` field로 pnpm version을,
`.nvmrc`로 Node.js version을 결정합니다. `main`이 production을 추적하고 다른 branch
push는 preview deployment로 배포됩니다.

### Rollback

- Application rollback: Pages dashboard → Deployments에서 이전 deployment의
  `Rollback to this deployment`를 실행합니다. 모든 deployment는 immutable하게 보존되므로
  즉시 이전 상태로 복귀합니다.
- Data rollback: `catalog.json`을 갱신한 commit을 `git revert`한 뒤 push하면 새
  deployment가 이전 data로 다시 배포됩니다. Rollback 후에도 `pnpm validate:data`로
  data 유효성을 확인합니다.

## License

[MIT](./LICENSE)
