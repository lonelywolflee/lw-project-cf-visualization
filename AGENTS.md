# AGENTS.md

이 문서는 이 repository를 변경하는 개발자와 coding agent를 위한 engineering contract다.
프로젝트 목적, 사용법, 최상위 폴더 설명은 [`README.md`](./README.md)를 기준으로 한다.
이 문서에서는 README를 반복하지 않고 구현 경계와 완료 조건만 정의한다.

## 1. Core Invariants

- 사용자는 `crawler`를 한 번 실행해 `web`이 읽는 data를 갱신할 수 있어야 한다.
- `web`은 생성된 static JSON만 읽으며 crawler나 server runtime을 요구하지 않는다.
- 모든 product 정보와 relationship은 공식 source를 추적할 수 있어야 한다.
- schema validation에 실패한 결과로 기존 정상 web data를 덮어쓰지 않는다.
- application, crawler, shared package는 모두 strict TypeScript로 작성한다.
- 단순한 세 폴더 구조와 hand-edited curated source(`data/curated/`)만 유지하고, 그 밖의 data
  layer나 orchestration project를 만들지 않는다.

## 2. Repository Boundaries

### `web/`

- Angular static application과 생성된 JSON data를 소유한다.
- Runtime data 위치는 `web/public/data`로 고정한다.
- `crawler` source code, Node.js filesystem API, raw HTML을 import하지 않는다.
- Data access는 Angular service 또는 repository를 통해 수행한다.

### `crawler/`

- 수집 대상 설정, HTTP access, parsing, normalization, validation, file update를 소유한다.
- 수집 대상 seed와 domain allowlist는 `crawler/config`에 둔다.
- Angular code를 import하지 않는다.
- 최종 output은 `web/public/data` 외의 위치에 만들지 않는다 (`data/curated/`는 output이
  아니라 hand-edited input이다).

### `packages/`

- 두 application에서 실제로 공유하는 library만 둔다.
- `packages/catalog`이 runtime schema, schema에서 파생한 TypeScript type, validator를 소유한다.
- Angular와 crawler implementation에 의존하지 않는다.
- 한쪽에서만 사용하는 helper를 성급하게 shared package로 이동하지 않는다.

### `data/curated/`

- 공식 page에 구조화되어 있지 않은 지식(map placement, 한국어 role 설명, solution 구성,
  요금제)을 사람이 편집하는 source of truth다.
- 모든 entry는 검증에 사용한 공식 `sourceUrl`과 `verifiedAt`을 필수로 가진다 — 큐레이션도
  근거 없는 서술을 허용하지 않는다.
- Web이 직접 읽지 않는다. `pnpm build:curated`가 검증 후 `web/public/data/curated.json`으로
  정규화한다.

Dependency direction은 다음과 같다.

```text
web ---------> packages/catalog
crawler -----> packages/catalog
crawler -----> web/public/data  # file output only
crawler <----- data/curated     # hand-edited curated source, file input only
```

`web`에서 `crawler`로 향하는 code dependency는 허용하지 않는다.

## 3. Crawler Contract

Root `pnpm crawl` command는 내부적으로 다음 작업을 순서대로 완료한다.

1. `crawler/config`에서 approved source를 읽는다.
2. Official page를 fetch하고 필요한 metadata만 추출한다.
3. Product, solution, use case, relationship을 stable ID로 normalize한다.
4. 각 record에 source reference와 retrieval timestamp를 연결한다.
5. 전체 output을 shared runtime schema로 validate한다.
6. 모든 검증이 성공한 경우에만 `web/public/data`를 교체한다.

Crawl pipeline 안에 candidate/publish 같은 중간 단계를 만들지 않고, crawl 결과를 사람이
수정하지 않는다. 관계를 공식 source에서 명시적으로 확인할 수 없으면 추론하지 말고 crawl
결과에서 제외한다 — 그런 지식이 필요하면 출처를 명시한 curated dataset(§4 Curated Dataset
Contract)으로만 추가한다.

### Crawling Safety

- 허용 source는 `cloudflare.com`과 `developers.cloudflare.com`으로 제한한다.
- Configured allowlist 밖의 URL을 자동으로 따라가지 않는다.
- `robots.txt`, site policy, rate limit을 존중한다.
- 식별 가능한 `User-Agent`, request timeout, 낮은 concurrency, 제한된 retry를 사용한다.
- Authentication, anti-bot control, access restriction을 우회하지 않는다.
- Full HTML이나 장문의 원문을 output 또는 repository에 저장하지 않는다.
- Playwright는 일반 HTTP parsing으로 처리할 수 없는 approved page에만 사용한다.
- Source 구조 변경으로 필수 field를 찾지 못하면 빈 성공 결과가 아니라 명시적 오류로 처리한다.

### Safe File Update

- Fetch 또는 parsing 일부가 실패하면 전체 실행을 실패시킨다.
- Output은 임시 directory에서 모두 생성하고 validation한 뒤 교체한다.
- File 교체 중 실패해도 기존 정상 data set을 복구할 수 있어야 한다.
- 같은 input은 timestamp 같은 명시적 volatile field를 제외하고 같은 output을 생성해야 한다.
- Key와 array의 정렬을 안정적으로 유지해 Git diff를 읽을 수 있게 한다.

## 4. Catalog Contract

기본 output은 `web/public/data/catalog.json` 하나로 시작한다. Data 크기나 독립적인 loading 요구가
확인되기 전에는 여러 file로 나누지 않는다.

여러 file이 필요해지면 다음 규칙을 적용한다.

- `manifest.json`이 `schemaVersion`, `generatedAt`, 필요한 data file 목록을 제공한다.
- Web은 hard-coded file 목록 대신 manifest를 진입점으로 사용한다.
- 모든 file은 하나의 catalog version으로 함께 validate하고 교체한다.
- 일부 file만 새 version으로 갱신된 상태를 허용하지 않는다.

Catalog는 최소한 다음 개념을 표현할 수 있어야 한다.

- Source: canonical URL, page kind, title, retrieval timestamp
- Product family: Cloudflare 공식 상위 taxonomy
- Product: 공식 제품명, 짧은 summary, family reference
- Solution과 use case: 공식 page에 명시된 분류
- Relationship: source로 근거를 확인할 수 있는 typed edge

모든 entity는 안정적인 `id`, 공식 `name`, 짧은 `summary`, 하나 이상의 source reference를 가진다.
URL이나 array index를 entity ID로 사용하지 않는다. Relationship type은 runtime schema가 제한하는
enum으로 관리한다.

Validator는 최소한 다음 오류를 거부한다.

- 중복 ID
- 존재하지 않는 entity 또는 source reference
- 허용하지 않는 relationship type
- Source가 없는 entity 또는 relationship
- Allowlist 밖의 canonical URL
- 빈 필수 field
- 지원하지 않는 `schemaVersion`

Schema와 TypeScript type을 별도로 중복 관리하지 않는다. Breaking schema change는 web과 crawler를
같은 Issue에서 함께 갱신한다.

### Curated Dataset Contract

Crawl로 얻을 수 없는 지식은 두 번째 document인 `web/public/data/curated.json`이 담는다.
위의 "기본 output은 `catalog.json` 하나" 규칙은 crawl 산출물에 관한 것으로, curated
artifact는 독립적인 lifecycle을 가진 별도 document다.

- Source of truth는 `data/curated/curated.json`이며 artifact는 `pnpm build:curated`만
  생성한다. Artifact bytes는 serializer가 소유한다 — 수동 편집 금지.
- `packages/catalog`의 curated runtime schema가 shape과 type의 single source다:
  placements(lane/layer), `roleKo`, compositions, pricing tier(사용량 meter 포함).
- 모든 entry는 approved hostname의 `sourceUrl`과 `verifiedAt`을 필수로 가진다. 요금 수치는
  인용한 공식 page에서 `verifiedAt` 시점에 확인한 값만 기록한다.
- Curated entry가 참조하는 product/solution id는 commit된 catalog에 존재해야 한다.
  `pnpm validate:data`가 shape, cross-reference, artifact 신선도(source 재빌드 byte와
  일치)를 함께 검증한다.
- Catalog와 curated는 `schemaVersion`을 각자 관리한다.

## 5. Angular Architecture

`web/src/app`은 feature-first 구조를 사용한다.

```text
app/
├── core/                       # Application-wide service and configuration
├── shared/                     # Domain ownership이 없는 reusable UI
└── features/
    ├── catalog/                # Routes와 layout gate (CatalogShell)
    ├── map/                    # 경로·레이어 지도(홈)와 product detail panel
    └── graph/                  # 솔루션 구성 focus graph
```

- Standalone component와 route-level lazy loading을 기본으로 한다.
- Component에서 직접 `fetch`하지 않고 catalog data service를 사용한다.
- State는 가장 가까운 feature에 두고 Angular signal/service로 충분하면 global store를 추가하지 않는다.
- `shared`를 miscellaneous helper 저장소로 사용하지 않는다.
- 화면 상태(선택·포커스)는 query param으로 관리해 딥링크를 유지하고, URL 입력은 catalog에
  존재하는 id인지 검증한 뒤에만 사용한다.
- 시각화에는 keyboard로 접근 가능한 동등한 조작 경로(칩/버튼 목록)를 제공한다.
- Route를 제거할 때는 같은 정보로 가는 redirect를 남겨 기존 딥링크를 깨지 않는다.
- Semantic HTML, visible focus, color contrast, responsive layout을 acceptance criteria에 포함한다.
- Nx, SSR, Angular Universal, NgRx는 구체적인 필요를 증명하는 별도 Issue 없이 도입하지 않는다.

## 6. TypeScript Rules

- `strict` mode를 끄지 않는다.
- `any`, unchecked cast, non-null assertion으로 input 문제를 숨기지 않는다.
- Network response와 JSON은 boundary에서 validate한 뒤 domain type으로 변환한다.
- Crawler의 fetch, parse, normalize, validate, write 단계를 분리한다.
- Domain transform은 network와 filesystem 없이 unit test할 수 있어야 한다.
- 작은 pure function을 선호하되 사용처가 하나뿐인 generic framework를 만들지 않는다.
- Error에는 source URL과 pipeline stage를 포함하되 page body나 secret을 log하지 않는다.

## 7. Testing

기본 test suite는 network에 연결하지 않아야 한다.

- Catalog schema와 reference integrity unit test
- Curated dataset의 schema, cross-reference, build 결정성과 신선도 test
- 최소 HTML fixture를 사용하는 parser regression test
- Normalization의 deterministic output test
- Invalid crawl 결과가 기존 web data를 보존하는 test
- Angular search, filter, detail state test
- 주요 route의 accessibility와 responsive smoke test
- Production static build test

Live crawl smoke test는 일반 unit test와 분리한다. Fixture에는 parser 동작에 필요한 최소 markup만
저장하고 공식 page 전체 snapshot을 복제하지 않는다.

변경 완료 전 README에 정의된 관련 root command를 실행한다. 아직 command가 구현되지 않았다면
성공으로 간주하지 말고 검증하지 못한 항목을 결과에 기록한다.

## 8. Issue Discipline

한 GitHub Issue는 하나의 검증 가능한 outcome만 다룬다. 각 Issue에는 scope, non-goals,
acceptance criteria, test plan, 선행 dependency를 포함한다.

권장 구현 순서는 다음과 같다.

1. `pnpm` workspace와 `web`, `crawler`, `packages/catalog` bootstrap
2. Catalog runtime schema, types, fixture, validator
3. Source config와 metadata crawler
4. Validated atomic web data update
5. Angular catalog loading과 application shell
6. Hierarchy, search, filter, detail
7. Relationship visualization과 accessible fallback
8. Cloudflare Pages deployment

관련 없는 refactor를 기능 Issue에 섞지 않는다. 새로운 dependency는 표준 API로 해결할 수 없는
구체적 이유가 있을 때만 추가한다.

## 9. Definition Of Done

- Issue acceptance criteria를 test 또는 재현 가능한 절차로 확인했다.
- Strict TypeScript, lint, 관련 test가 통과한다.
- Crawler 변경은 schema validation과 기존 data 보존 동작을 확인했다.
- Web 변경은 production static build와 주요 responsive/accessibility 동작을 확인했다.
- Architecture 또는 사용 command가 바뀌면 소유 문서 하나만 갱신한다.
- 사용자 목적과 실행법은 README, engineering rule은 AGENTS에서 관리하며 같은 설명을 복제하지 않는다.
