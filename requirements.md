# FREE (Fast Report & Easy Evidence) - Requirements Document

> Version: 1.0
> Date: 2026-01-29
> Author: syngha.han

---

## 1. Project Overview

### 1.1 Service Name
**FREE** - Fast Report & Easy Evidence

### 1.2 Purpose
팀 단위 주간 보고를 자동화하는 엔터프라이즈 웹 서비스. 개인이 서식 없이 간단하게 업무 내용을 입력하면 LLM이 자동으로 item을 분리/정리하고, 이를 파트/그룹/팀 단위로 취합하여 보고서를 자동 생성한다.

### 1.3 Target Users
- 삼성DS 전사 임직원 (300명+ 대규모)
- Desktop 브라우저 전용

### 1.4 Host & Domain
- Host: `a2g.samsungds.net`
- Ports: `15001` ~ (상세는 Section 3 참조)

---

## 2. Organization Hierarchy

```
사업부 (Business Unit)
 └── 팀 (Team)           ← SSO 자동 parsing
      └── 그룹 (Group)    ← 사용자 수동 등록
           └── 파트 (Part) ← 사용자 수동 등록
                └── 개인 (Individual)
```

- **사업부**: SSO `deptname`에서 자동 추출 (예: `DS부문`)
- **팀**: SSO `deptname`에서 자동 추출 (예: `AI플랫폼팀`)
- **그룹**: 최초 로그인 시 사용자가 선택 또는 신규 등록
- **파트**: 최초 로그인 시 사용자가 선택 또는 신규 등록

> **주의**: 서로 다른 사업부에 동일한 팀 이름이 존재할 수 있으므로, 팀은 반드시 `(사업부, 팀이름)` 조합으로 유일하게 구분한다.

---

## 3. Infrastructure Architecture

### 3.1 Container 구성

| Service       | Port  | Container         | Description                  |
|---------------|-------|-------------------|------------------------------|
| Frontend      | 15001 | free-frontend     | React SPA (Nginx)            |
| API Server    | 15002 | free-api          | Node.js Express REST API     |
| PostgreSQL    | 15003 | free-db           | Primary Database             |
| Redis         | 15004 | free-redis        | Cache / Job Queue            |
| Worker        | 15005 | free-worker       | BullMQ 보고서 생성 Worker    |

필요 시 `15006~` 추가 사용 가능.

### 3.2 Tech Stack

| Layer        | Technology                                      |
|--------------|--------------------------------------------------|
| Frontend     | React 18, TypeScript, Vite, Tailwind CSS, Zustand |
| Backend API  | Node.js, Express, TypeScript, Prisma ORM         |
| Database     | PostgreSQL 15+                                    |
| Cache/Queue  | Redis 7+, BullMQ                                  |
| LLM Client   | OpenAI API 호환 (endpoint + key)                  |
| Export       | docx (docx library), xlsx (exceljs library)       |
| Auth         | Custom Samsung SSO + Internal JWT                 |

---

## 4. Authentication & Authorization

### 4.1 SSO Login Flow

ONCE(`~/ONCE`)와 동일한 Custom Token 기반 Samsung SSO를 사용한다.

> **구현 참조**: SSO 로그인 구현 방법, User Info 수신 방법, 토큰 처리 등 모든 인증 관련 구현은 **`~/ONCE`** 소스코드를 참조하여 동일하게 구현할 것.
> - Frontend SSO Flow: `~/ONCE/frontend/src/pages/Login.tsx`
> - Backend Auth Route: `~/ONCE/api/src/routes/auth.routes.ts`
> - Auth Middleware: `~/ONCE/api/src/middleware/auth.ts`
> - SSO URL / ENV 설정: `~/ONCE/frontend/.env`

```
1. 사용자가 "SSO 로그인" 버튼 클릭
2. → SSO 서버로 리다이렉트 (redirect_url 포함)
3. SSO 서버 인증 후 ?data={URLEncodedJSON} 파라미터와 함께 콜백
4. Frontend: data에서 loginid, username, deptname 추출
5. → sso.{btoa(unescape(encodeURIComponent(jsonData)))} 형식 토큰 생성
6. → POST /auth/login (Authorization: Bearer sso.{token})
7. Backend: SSO 데이터 검증 → User upsert → JWT(24h) 발급
8. Frontend: sessionToken을 localStorage에 저장 → 메인 페이지 이동
```

### 4.2 SSO 데이터 추출

> **구현 참조**: deptname에서 businessUnit/teamName을 추출하는 regex 및 파싱 로직은 `~/ONCE/api/src/middleware/auth.ts`의 `extractBusinessUnit()`, `extractTeamName()` 함수를 참조할 것.

| Field         | Source                    | Example                    |
|---------------|---------------------------|----------------------------|
| `loginid`     | SSO 직접 제공              | `syngha.han`               |
| `username`    | SSO 직접 제공              | `한승하`                    |
| `deptname`    | SSO 직접 제공              | `AI플랫폼팀(DS부문)`         |
| `businessUnit`| deptname에서 regex 추출    | `DS부문`                    |
| `teamName`    | deptname에서 regex 추출    | `AI플랫폼팀`                |

### 4.3 최초 로그인 프로세스

1. SSO 인증 성공
2. User 레코드 생성/업데이트
3. 사업부 + 팀 자동 등록 (SSO 데이터 기반)
4. 개인 Space 자동 생성
5. 팀 Space 자동 생성 (해당 팀 최초 사용자인 경우)
6. **그룹/파트 선택 화면 표시**:
   - 해당 팀 내 기존 그룹 목록을 드롭다운으로 표시
   - 기존 그룹 선택 시 → 해당 그룹 내 기존 파트 목록을 드롭다운으로 표시
   - 기존에 없으면 직접 입력 가능
7. 신규 그룹/파트 입력 시:
   - LLM으로 이름 정규화 (규칙: 대문자 + 띄어쓰기 없음 + 한글)
   - 예: `kpi group` → `KPI그룹`, `ax 파트` → `AX파트`
   - **변환 결과를 사용자에게 보여주고 확인 후 적용**
   - 같은 팀 내 동일 이름 그룹 → 추가 실패
   - 같은 그룹 내 동일 이름 파트 → 추가 실패
8. 그룹 Space 생성 (해당 그룹 최초 등록자인 경우)
9. 파트 Space 생성 (해당 파트 최초 등록자인 경우)

### 4.4 Role & Permission

| Role              | Scope      | Description                                |
|-------------------|------------|--------------------------------------------|
| Super Admin       | 전체 시스템 | `syngha.han` 고정. LLM 관리, 권한 관리      |
| Team Admin        | 팀 내      | Super Admin이 지정. 팀 내 관리 권한          |
| Regular User      | 개인       | 본인 Space 입력/수정/삭제                    |

#### Super Admin 전용 기능
- LLM Setup: endpoint 설정 → model list sync → model 선택/활성화
- 전체 팀 목록 조회
- 팀 내 사용자 username(id) 목록 확인
- 팀 내 admin 부여/해제 (사업부/팀/그룹/파트 드롭다운으로 선택)

#### Team Admin 전용 기능
- 팀 내 사용자 목록 조회 (그룹/파트 드롭다운 필터)
- 0시 보고서 생성 로그 조회 (파트/그룹/팀 보고서 성공/실패 기록)

#### 접근 권한
- 모든 게시물/보고서는 **팀 내 전체 공개**
- 팀 간에는 **비공개** (다른 팀 데이터 접근 불가)
- Super Admin은 Super Admin 전용 창 + Admin 전용 창 모두 접근 가능
- Team Admin은 Admin 전용 창만 접근 가능

### 4.5 Token Management

- Internal JWT 토큰, 24시간 유효
- localStorage에 저장
- 모든 API 요청 시 `Authorization: Bearer {token}` 헤더 포함
- 401/403 응답 시 자동 로그아웃 → 로그인 페이지 리다이렉트

---

## 5. Core Feature: Item Management

### 5.1 Item 정의

Item은 업무 기록의 최소 단위이며, 다음 속성을 가진다:

| Field       | Type     | Description                             |
|-------------|----------|-----------------------------------------|
| id          | UUID     | 고유 식별자                               |
| userId      | String   | 작성자 loginid                            |
| spaceId     | String   | 소속 개인 Space ID                        |
| title       | String   | Item 제목 (LLM 생성)                      |
| content     | Text     | Item 상세 내용 (LLM 정리)                  |
| link        | String?  | 클릭 시 연결되는 외부 링크 (optional)        |
| date        | Date     | 업무 수행 날짜 (사용자 선택 가능, 기본: 오늘) |
| createdAt   | DateTime | 생성 시각                                 |
| updatedAt   | DateTime | 수정 시각                                 |

### 5.2 입력 창 UX

개인 Space 최상단에 위치하는 입력 창은 다음과 같이 구성된다:

- **Placeholder 문구**: `"Jira 이슈, 채팅 내역, 메일 본문, 회의록, 메모... 무엇이든 붙여넣으세요. AI가 자동으로 정리합니다."`
- **입력 방식**: 서식 없는 plain textarea (줄바꿈 허용, **최대 50,000자**)
- **날짜 선택**: 입력 창 옆 또는 하단에 날짜 피커 (기본값: 오늘, 과거 날짜 선택 가능)
- **Submit 버튼**: 입력 창 우측 하단

> **핵심 원칙**: 사용자는 그 어떤 형태의 텍스트든 입력할 수 있다. Jira 이슈 전체 복사, 메신저 대화 이력, 이메일 스레드, 회의록, 자유 메모 등 형식에 관계없이 LLM이 사용자의 업무/성과를 자동 추출하여 item으로 분리한다.

### 5.3 Item 입력 Flow

1. 개인 Space 상단 입력 창에 **아무 텍스트나** 자유롭게 입력 또는 붙여넣기
2. 날짜 선택 (선택사항, 기본: 오늘)
3. **Submit 버튼 클릭**
4. API가 원문 텍스트 + 사용자 컨텍스트(이름/팀/그룹/파트/오늘 날짜)를 LLM에 전달
5. LLM이 텍스트를 분석하여 **사용자 본인의 업무/성과 관점**에서 개별 item으로 분리
   - 각 item에 title과 content를 부여
   - 하나의 입력에서 복수의 item이 생성될 수 있음
   - 텍스트 내 날짜 정보가 있으면 해당 날짜를 item에 자동 부여
6. 분리된 item 목록을 사용자에게 반환
7. 개인 Space에 item block으로 표시

**LLM 처리 중 UX**:
- Submit 후 입력 창 아래에 스피너 + `"AI가 정리 중입니다..."` 텍스트 표시
- 입력 창은 비활성화 (중복 제출 방지)
- 완료 시 스피너 사라지고 새 item block이 목록에 추가됨
- 실패 시 `"정리에 실패했습니다. 다시 시도해 주세요."` 에러 메시지 + 원문 복원

### 5.4 Item Block UI

각 item은 다음과 같은 block으로 표시된다:

```
┌──────────────────────────────────────────┐
│ [Title]                    ✏️  🗑️  🔗    │
│                                          │
│ [Content - multi line]                   │
│ ...                                      │
│                                          │
│ 2026-01-29                               │
└──────────────────────────────────────────┘
```

- **✏️ (연필)**: 클릭 시 title/content 인라인 수정 가능
- **🗑️ (휴지통)**: 클릭 시 확인 후 즉시 영구 삭제
- **🔗 (링크)**: 클릭 시 URL 입력 팝업, 입력된 링크는 title 클릭 시 새 탭으로 열림

### 5.5 Item 날짜 관리

- 입력 시 날짜를 선택할 수 있음 (기본값: 오늘)
- **선택 가능 범위**: 오늘 기준 29일 전 ~ 오늘 (총 30일)
- **미래 날짜 입력 불가**
- LLM이 텍스트 내 날짜를 감지한 경우에도 위 범위를 벗어나면 오늘 날짜로 대체

### 5.6 Item 보관 기간

- Space에서의 **표시 범위**: 오늘 포함 7일간 (`date` 기준)
- **DB 보관 기간**: 30일 (오늘 기준 29일 전까지)
- **30일 경과 시**: 영구 삭제 (00시 batch job)
- 7일 이후 ~ 30일 이내의 item은 Space에는 표시되지 않으나 DB에 보관됨 (그룹/파트 변경 시 데이터 이관 목적)

### 5.7 Item 수정/삭제

- 본인의 item만 수정/삭제 가능 (loginid 기반 검증)
- 수정: title, content, link, date 변경 가능
- 삭제: 즉시 영구 삭제 (soft delete 없음)
- 모든 변경은 상위 Space(파트/그룹/팀)에 실시간 반영

---

## 6. Space System

### 6.1 Space 유형

| Space Type | 생성 시점                   | 내용                                    |
|------------|----------------------------|-----------------------------------------|
| 개인 Space  | 최초 로그인 시 자동          | 본인의 item block 표시 (7일간)            |
| 파트 Space  | 파트 최초 등록자가 등록 시    | 파트 내 개인별/날짜별 title 목록          |
| 그룹 Space  | 그룹 최초 등록자가 등록 시    | 그룹 내 파트별/날짜별 title 목록          |
| 팀 Space    | 팀 최초 사용자 로그인 시 자동 | 팀 내 그룹별/날짜별 item 목록             |

### 6.2 개인 Space

- **표시 범위**: 오늘 포함 7일간 저장된 item
- **상단**: 텍스트 입력 창 + 날짜 선택 + Submit 버튼
- **본문**: 날짜별로 그룹핑된 item block 목록 (최신 날짜 위)
- **권한**: 본인만 신규 입력/수정/삭제 가능. 팀 내 전체 조회 가능

### 6.3 파트 Space

- **표시 범위**: 오늘 포함 7일간 파트 내 모든 개인의 기록
- **구성**: 날짜별 → 개인별 → title 목록
- **클릭 동작**: title 클릭 시 해당 개인 Space의 해당 날짜로 **새 웹 페이지(탭)** 열림
- **보고서**: 매일 0시 생성된 주간 보고서 표시 (7일 보관)
- **내보내기**: 보고서 docx/xlsx 내보내기 버튼
- **권한**: 파트 내 전체 + 팀 내 전체 조회 가능

### 6.4 그룹 Space

- **표시 범위**: 오늘 포함 7일간 그룹 내 모든 파트의 기록
- **구성**: 날짜별 → 파트별 → title 목록
- **클릭 동작**: 파트의 title 클릭 시 해당 파트 Space가 **새 웹 페이지(탭)**에서 열림
- **보고서**: 매일 0시 생성된 주간 보고서 표시 (7일 보관)
- **내보내기**: 보고서 docx/xlsx 내보내기 버튼
- **권한**: 팀 내 전체 조회 가능

### 6.5 팀 Space

- **표시 범위**: 오늘 포함 7일간 팀 내 모든 그룹의 기록
- **구성**: 날짜별 → 그룹별 → item 목록
- **클릭 동작**: 그룹 item 클릭 시 해당 그룹 Space가 **새 웹 페이지(탭)**에서 열림
- **보고서**: 매일 0시 생성된 주간 보고서 표시 (7일 보관)
- **내보내기**: 보고서 docx/xlsx 내보내기 버튼
- **"계속해서 생성하기" 버튼**: 보고서 생성 실패 시에만 표시
- **공지 영역**: 팀 Space 상단에 Team Admin/Super Admin이 작성하는 간단 공지 (Section 6.7 참조)
- **권한**: 팀 내 전체 조회 가능

### 6.7 팀 공지 (Announcement)

팀 Space 상단에 위치하는 간단 공지 영역:

- **작성 권한**: Team Admin 또는 Super Admin만 작성/수정/삭제
- **표시**: 팀 Space 최상단에 배너 형태로 표시
- **제한**: 팀당 활성 공지 1개 (새 공지 작성 시 기존 공지 대체)
- **내용**: 제목 + 본문 (plain text)
- **조회 권한**: 팀 내 전체

### 6.6 Space 계층 반영 규칙

```
개인 item 추가/변경/삭제
  → 파트 Space 반영 (개인별 title 업데이트)
    → 그룹 Space 반영 (파트별 title 업데이트)  [recursive]
      → 팀 Space 반영 (그룹별 item 업데이트)  [recursive]
```

모든 변경은 페이지 새로고침 시 반영된다 (실시간 WebSocket 미사용).

### 6.8 Space 계층 반영 시 데이터 조회 방식

Space는 데이터를 복제 저장하지 않는다. 상위 Space는 하위 데이터를 실시간 조회(query)하여 표시한다:
- 파트 Space → 파트에 속한 모든 User의 Item을 date/userId 기준 조회
- 그룹 Space → 그룹에 속한 모든 파트의 Item title을 date/partId 기준 조회
- 팀 Space → 팀에 속한 모든 그룹의 Item을 date/groupId 기준 조회

---

## 7. User Profile & Settings

### 7.1 프로필 페이지

| 항목             | 설명                                          |
|-----------------|-----------------------------------------------|
| 이름 (username)  | SSO에서 가져온 이름 (읽기 전용)                  |
| ID (loginid)    | SSO에서 가져온 ID (읽기 전용)                    |
| 사업부           | SSO에서 자동 추출 (읽기 전용)                    |
| 팀               | SSO에서 자동 추출 (읽기 전용)                    |
| 그룹             | 현재 소속 그룹 (변경 가능)                       |
| 파트             | 현재 소속 파트 (변경 가능)                       |

### 7.2 활동 로그

프로필 페이지 하단에 본인의 최근 활동 이력 표시:
- Item 추가/수정/삭제 이력
- 그룹/파트 변경 이력
- 최근 30일간의 활동 기록
- 날짜/시간, 액션 유형, 대상 item title 표시

### 7.3 그룹/파트 변경

사용자가 설정 페이지에서 본인의 그룹/파트를 직접 변경할 수 있다.
**최초 로그인(onboarding)과 완전히 동일한 UI/로직을 재사용한다:**

1. 설정 페이지에서 "그룹/파트 변경" 선택
2. 팀 내 기존 그룹 드롭다운에서 선택 → 없으면 직접 입력
3. 그룹 선택/입력 후 → 해당 그룹 내 기존 파트 드롭다운에서 선택 → 없으면 직접 입력
4. 신규 입력 시:
   - LLM으로 이름 정규화 (대문자 + 띄어쓰기 없음 + 한글)
   - 변환 결과를 사용자에게 보여주고 **확인 후 적용**
   - 같은 팀 내 동일 이름 그룹 → 추가 실패
   - 같은 그룹 내 동일 이름 파트 → 추가 실패
   - 신규 그룹/파트 등록 시 해당 Space도 자동 생성
5. **변경 시 처리**:
   - 기존 모든 item의 소속이 새 그룹/파트로 이관
   - 이미 생성된 보고서는 변경하지 않음 (변경 전 시점의 보고서 유지)
   - 변경 이력은 활동 로그에 기록
   - **빈 그룹/파트 자동 삭제**: 변경 결과 소속 인원이 0명이 된 그룹/파트는 자동으로 삭제 (해당 Space도 함께 삭제)

---

## 8. Report Generation (핵심 기능)

### 8.1 실행 시간

매일 **00:00 (자정)** 에 자동 실행

### 8.2 생성 순서 (팀 내 순차, 팀 간 병렬)

```
[팀 A 순차]                    [팀 B 순차]           ← 팀 간 병렬
  1. 파트A-1 보고서 생성          1. 파트B-1 보고서 생성
  2. 파트A-2 보고서 생성          2. 파트B-2 보고서 생성
  3. ...                         3. ...
  4. 그룹A-1 보고서 생성          4. 그룹B-1 보고서 생성
     (파트A-1,A-2의 item별 정리 사용)
  5. 그룹A-2 보고서 생성          5. ...
  6. ...                         6. 팀B 보고서 생성
  7. 팀A 보고서 생성
```

### 8.3 파트 보고서 생성

> 파트에 인원이 1명이든, 그룹에 파트가 1개든 **항상 보고서를 생성**한다. 단, 7일간 item이 0건이면 "해당 기간 보고할 내용이 없습니다." 로 보고서를 대체한다.

**Input**: 파트 내 모든 개인의 7일간 title + content item 전체

**LLM 요청 1**: 개인별 정리
- 각 개인이 지난 7일간 수행한 업무를 개인별로 정리
- 출력: 개인별 업무 요약

**LLM 요청 2**: Item별 정리
- 동일/유사 업무 item을 기준으로 정리
- 출력: 업무 항목별 수행자 및 내용 요약

**최종 보고서**: 두 결과를 구분자로 구분하여 게시

```
=== 개인별 업무 정리 ===
[개인별 정리 내용]

=== 업무 항목별 정리 ===
[Item별 정리 내용]
```

### 8.4 그룹 보고서 생성

**전제**: 그룹 내 모든 파트의 보고서 생성 완료 후 실행

**Input**: 그룹 내 모든 파트의 **"Item별 정리"** 결과

**LLM 요청 1**: 파트별 정리
- 각 파트의 업무를 파트 단위로 정리

**LLM 요청 2**: Item별 정리
- 파트 간 중복/유사 업무를 항목별로 통합 정리

### 8.5 팀 보고서 생성

**전제**: 팀 내 모든 그룹의 보고서 생성 완료 후 실행

**Input**: 팀 내 모든 그룹의 **"Item별 정리"** 결과

**LLM 요청 1**: 그룹별 정리
- 각 그룹의 업무를 그룹 단위로 정리

**LLM 요청 2**: Item별 정리
- 그룹 간 중복/유사 업무를 항목별로 통합 정리

### 8.6 보고서 보관

- **보관 기간**: 7일
- **7일 후**: 영구 삭제
- **내보내기**: docx, xlsx 형식 (기본 포맷)

### 8.7 LLM Error Handling & Retry

```
LLM 요청 실패
  → 10초 대기 → Retry (최대 5회)
    → 5회 모두 실패
      → 10분 대기
        → 10초 대기 → Retry (최대 5회)
          → 5회 모두 실패
            → 작업 중단
            → 중단 지점 기록 (어느 파트/그룹/팀에서 실패했는지)
            → 팀 Space에 "계속해서 생성하기" 버튼 표시
```

- **"계속해서 생성하기" 버튼**: 보고서 생성 실패 시에만 표시
- 클릭 시 중단 지점부터 이어서 보고서 생성 재개
- 재개 시에도 동일한 retry 정책 적용
- 팀 내 누구나 클릭 가능 (조기 출근자가 처리)

### 8.8 Retry 대상 Error Code

모든 LLM 요청 실패 (HTTP 4xx/5xx, timeout, network error 등)에 대해 동일한 retry 정책 적용.

---

## 9. LLM Integration

> **구현 참조**: 아래 항목은 모두 **`~/ONCE`** 소스코드를 참조하여 동일하게 구현할 것.
> - LLM Chat 호출: endpoint URL, 필수 Header, 요청/응답 형식 → `~/ONCE/api/src/` 내 LLM 관련 서비스/유틸
> - Model List 조회 (`v1/models`): endpoint, Header → `~/ONCE/api/` 내 model list 관련 로직
> - Rating 제출: endpoint, Header → `~/ONCE/api/` 내 rating 관련 로직
> - 환경변수/인증 설정 → `~/ONCE/api/` 내 환경변수 및 설정 파일

### 9.1 LLM Setup (Super Admin) - Model Sync 방식

LLM은 **등록이 아닌 Sync(동기화) 방식**으로 관리한다:

1. Super Admin이 **endpoint + 인증 정보**를 설정
2. 시스템이 해당 endpoint에서 **model list를 자동 조회** (API 호출)
3. 조회된 model 목록을 Super Admin에게 표시
4. Super Admin이 사용할 **model을 선택하여 setup**
5. 전역 1개만 활성화

| Field       | Type   | Description                        |
|-------------|--------|------------------------------------|
| id          | UUID   | 고유 식별자                          |
| endpoint    | String | API endpoint URL                    |
| apiKey      | String | API Key (암호화 저장)                 |
| modelId     | String | Sync된 model 중 선택한 model ID      |
| modelName   | String | 표시용 model 이름 (sync에서 가져옴)   |
| isActive    | Bool   | 활성화 상태                          |
| lastSyncAt  | DateTime | 마지막 model list sync 시각         |
| createdAt   | DateTime | 등록 시각                          |

> **전역 1개 활성화 정책**: 전체 시스템에서 **1개 model만 활성화** 가능. 새 model 활성화 시 기존 활성 model은 자동 비활성화. 모든 팀의 item 분리 및 보고서 생성은 동일한 활성 model을 사용한다.

### 9.2 LLM 사용 위치

| 기능                    | 요청 빈도          | Description                            |
|------------------------|-------------------|----------------------------------------|
| Item 분리/정리          | 사용자 Submit 시    | 자유 텍스트 → 구조화된 item 변환          |
| 그룹/파트 이름 정규화    | 신규 등록 시        | 사용자 입력 → 대문자+한글 표준 형식 변환   |
| 파트 보고서 생성         | 매일 0시            | 개인별 정리 + Item별 정리                |
| 그룹 보고서 생성         | 매일 0시            | 파트별 정리 + Item별 정리                |
| 팀 보고서 생성           | 매일 0시            | 그룹별 정리 + Item별 정리                |

### 9.3 API 요청 형식

> **구현 참조**: 실제 API 호출 형식, 필수 Header, 인증 방식은 **`~/ONCE`** 소스코드의 LLM 호출 로직을 그대로 따를 것. 아래는 개념적 구조이며, 세부 구현은 ~/ONCE 참조.

```json
POST {endpoint}/chat/completions
Headers: { ... ~/ONCE의 LLM 호출 Header 참조 ... }
Body: {
  "model": "{modelId}",
  "messages": [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "..."}
  ]
}
```

### 9.4 Rating (사용자 피드백)

개인별 LLM 요청 **매 20회마다** rating을 요청한다:

- **대상**: Item 분리/정리 요청 (사용자가 Submit 하는 요청만 카운트)
- **주기**: 개인별 누적 20회 요청마다 1회 rating 팝업
- **별점**: 1 ~ 5 (별 아이콘)
- **선택 사항**: rating은 skip 가능
- **표시 시점**: 20번째 요청의 결과가 표시된 직후 팝업/모달로 표시
- **저장 데이터**:

| Field       | Type     | Description                     |
|-------------|----------|---------------------------------|
| id          | UUID     | 고유 식별자                       |
| userId      | FK → User| 평가자                           |
| score       | Int      | 1 ~ 5                          |
| requestCount| Int      | 해당 시점의 누적 요청 수            |
| modelId     | String   | 평가 시점의 활성 model ID          |
| createdAt   | DateTime | 평가 시각                        |

> **구현 참조**: Rating 제출 시 사용하는 endpoint, Header 등은 **`~/ONCE`** 소스코드의 rating 관련 로직을 그대로 따를 것.

---

## 10. Data Model (ERD Summary)

### 10.1 Core Entities

```
User
  - id: UUID (PK)
  - loginid: String (UNIQUE) -- syngha.han
  - username: String -- 한승하
  - deptname: String -- AI플랫폼팀(DS부문)
  - businessUnit: String -- DS부문
  - teamId: FK → Team
  - groupId: FK → Group (nullable until first login setup)
  - partId: FK → Part (nullable until first login setup)
  - createdAt: DateTime
  - lastActive: DateTime

Team
  - id: UUID (PK)
  - name: String -- AI플랫폼팀
  - businessUnit: String -- DS부문
  - UNIQUE(name, businessUnit)
  - createdAt: DateTime

Group
  - id: UUID (PK)
  - name: String -- KPI그룹
  - teamId: FK → Team
  - UNIQUE(name, teamId)
  - createdAt: DateTime

Part
  - id: UUID (PK)
  - name: String -- AX파트
  - groupId: FK → Group
  - UNIQUE(name, groupId)
  - createdAt: DateTime

Space
  - id: UUID (PK)
  - type: ENUM (PERSONAL, PART, GROUP, TEAM)
  - ownerId: String -- User/Part/Group/Team ID
  - teamId: FK → Team (팀 간 격리용)
  - createdAt: DateTime

Item
  - id: UUID (PK)
  - userId: FK → User
  - spaceId: FK → Space (개인 Space)
  - title: String
  - content: Text
  - link: String? (nullable)
  - date: Date
  - createdAt: DateTime
  - updatedAt: DateTime

Report
  - id: UUID (PK)
  - spaceId: FK → Space (파트/그룹/팀 Space)
  - type: ENUM (PART, GROUP, TEAM)
  - byMemberContent: Text -- 개인별/파트별/그룹별 정리
  - byItemContent: Text -- Item별 정리
  - periodStart: Date
  - periodEnd: Date
  - createdAt: DateTime
  - expiresAt: DateTime (createdAt + 7일)

ReportJob
  - id: UUID (PK)
  - teamId: FK → Team
  - status: ENUM (PENDING, IN_PROGRESS, COMPLETED, FAILED)
  - failedAt: String? -- 실패 지점 (예: "PART:uuid" / "GROUP:uuid" / "TEAM:uuid")
  - retryCount: Int
  - lastError: Text?
  - createdAt: DateTime
  - updatedAt: DateTime

LLMConfig
  - id: UUID (PK)
  - endpoint: String
  - apiKey: String (encrypted)
  - modelId: String -- sync된 model 중 선택한 model ID
  - modelName: String -- 표시용 이름 (sync에서 가져옴)
  - isActive: Boolean
  - lastSyncAt: DateTime
  - createdAt: DateTime

LLMRating
  - id: UUID (PK)
  - userId: FK → User
  - score: Int (1~5)
  - requestCount: Int -- 해당 시점 누적 요청 수
  - modelId: String -- 평가 시점 활성 model ID
  - createdAt: DateTime

TeamAdmin
  - id: UUID (PK)
  - userId: FK → User
  - teamId: FK → Team
  - UNIQUE(userId, teamId)
  - createdAt: DateTime

ReportLog
  - id: UUID (PK)
  - teamId: FK → Team
  - reportType: ENUM (PART, GROUP, TEAM)
  - targetName: String -- 파트/그룹/팀 이름
  - status: ENUM (SUCCESS, FAILED)
  - errorMessage: Text?
  - createdAt: DateTime

Announcement
  - id: UUID (PK)
  - teamId: FK → Team (UNIQUE -- 팀당 1개)
  - authorId: FK → User
  - title: String
  - content: Text
  - createdAt: DateTime
  - updatedAt: DateTime

ActivityLog
  - id: UUID (PK)
  - userId: FK → User
  - action: ENUM (CREATE_ITEM, UPDATE_ITEM, DELETE_ITEM, CHANGE_GROUP, CHANGE_PART)
  - targetType: String? -- ITEM, GROUP, PART
  - targetId: String?
  - details: Text? -- 변경 상세 (예: "AX파트 → BX파트")
  - createdAt: DateTime
```

---

## 11. API Endpoints

### 11.1 Auth

| Method | Endpoint              | Description           | Auth       |
|--------|-----------------------|-----------------------|------------|
| POST   | /auth/login           | SSO 토큰 교환 → JWT    | SSO Token  |
| GET    | /auth/me              | 현재 사용자 정보        | JWT        |
| POST   | /auth/refresh         | JWT 갱신               | JWT        |
| POST   | /auth/logout          | 로그아웃               | JWT        |

### 11.2 Onboarding (최초 로그인)

| Method | Endpoint                          | Description                   | Auth |
|--------|-----------------------------------|-------------------------------|------|
| GET    | /onboarding/groups                | 팀 내 그룹 목록 조회            | JWT  |
| GET    | /onboarding/parts?groupId={id}    | 그룹 내 파트 목록 조회           | JWT  |
| POST   | /onboarding/setup                 | 그룹/파트 선택 또는 신규 등록     | JWT  |
| POST   | /onboarding/normalize-name        | LLM 이름 정규화 요청             | JWT  |

### 11.3 Items

| Method | Endpoint               | Description                        | Auth |
|--------|------------------------|------------------------------------|------|
| POST   | /items                 | 텍스트 제출 → LLM item 분리 → 저장  | JWT  |
| PUT    | /items/:id             | Item 수정 (title/content/link/date) | JWT  |
| DELETE | /items/:id             | Item 영구 삭제                      | JWT  |

### 11.4 Spaces

| Method | Endpoint                          | Description                    | Auth |
|--------|-----------------------------------|--------------------------------|------|
| GET    | /spaces/personal                  | 내 개인 Space (7일 items)       | JWT  |
| GET    | /spaces/personal/:userId          | 특정 사용자 개인 Space 조회      | JWT  |
| GET    | /spaces/part/:partId              | 파트 Space 조회                 | JWT  |
| GET    | /spaces/group/:groupId            | 그룹 Space 조회                 | JWT  |
| GET    | /spaces/team                      | 팀 Space 조회                   | JWT  |

### 11.5 Reports

| Method | Endpoint                              | Description                    | Auth |
|--------|---------------------------------------|--------------------------------|------|
| GET    | /reports/space/:spaceId               | Space의 보고서 목록 조회         | JWT  |
| GET    | /reports/:id                          | 보고서 상세 조회                 | JWT  |
| GET    | /reports/:id/export?format=docx\|xlsx | 보고서 내보내기                  | JWT  |
| POST   | /reports/resume                       | 실패한 보고서 생성 재개           | JWT  |

### 11.6 Super Admin

| Method | Endpoint                       | Description                   | Auth         |
|--------|--------------------------------|-------------------------------|--------------|
| POST   | /admin/llm/endpoint            | LLM endpoint + 인증 정보 설정  | Super Admin  |
| POST   | /admin/llm/sync                | endpoint에서 model list 동기화  | Super Admin  |
| GET    | /admin/llm/models              | Sync된 model 목록 조회         | Super Admin  |
| PUT    | /admin/llm/activate/:modelId   | model 활성화 (전역 1개)         | Super Admin  |
| GET    | /admin/teams                   | 전체 팀 + 사용자 목록           | Super Admin  |
| POST   | /admin/team-admin             | Team Admin 부여              | Super Admin  |
| DELETE | /admin/team-admin/:id         | Team Admin 해제              | Super Admin  |

### 11.7 Team Admin

| Method | Endpoint                         | Description                      | Auth        |
|--------|----------------------------------|----------------------------------|-------------|
| GET    | /team-admin/users                | 팀 내 사용자 목록 (그룹/파트 필터) | Team Admin  |
| GET    | /team-admin/report-logs          | 보고서 생성 로그 조회              | Team Admin  |

### 11.8 Rating

| Method | Endpoint               | Description                              | Auth |
|--------|------------------------|------------------------------------------|------|
| POST   | /ratings               | LLM 사용 rating 제출 (1~5)               | JWT  |
| GET    | /ratings/check         | 현재 rating 요청 필요 여부 확인 (20회 도달) | JWT  |

### 11.10 Profile & Settings

| Method | Endpoint                     | Description                        | Auth |
|--------|------------------------------|------------------------------------|------|
| GET    | /profile                     | 내 프로필 정보 조회                  | JWT  |
| PUT    | /profile/organization        | 그룹/파트 변경                      | JWT  |
| GET    | /profile/activity-log        | 내 활동 로그 조회 (최근 30일)        | JWT  |

### 11.11 Announcements

| Method | Endpoint                         | Description                  | Auth        |
|--------|----------------------------------|------------------------------|-------------|
| GET    | /announcements/team              | 팀 공지 조회                  | JWT         |
| POST   | /announcements/team              | 팀 공지 작성/수정             | Team Admin  |
| DELETE | /announcements/team              | 팀 공지 삭제                  | Team Admin  |

---

## 12. UI Pages

### 12.1 Page 구성

| Page              | Route                           | Description                      |
|-------------------|---------------------------------|----------------------------------|
| Login             | /login                          | SSO 로그인 페이지                 |
| Onboarding        | /onboarding                     | 최초 로그인 그룹/파트 선택         |
| Personal Space    | /space/personal                 | 내 개인 Space                     |
| Personal (Other)  | /space/personal/:userId/:date?  | 타인 개인 Space (읽기 전용)        |
| Part Space        | /space/part/:partId             | 파트 Space                       |
| Group Space       | /space/group/:groupId           | 그룹 Space                       |
| Team Space        | /space/team                     | 팀 Space                        |
| Report Detail     | /report/:id                     | 보고서 상세 보기                  |
| Profile           | /profile                        | 프로필 + 활동 로그 + 설정          |
| Super Admin       | /admin/super                    | Super Admin 관리 페이지           |
| Team Admin        | /admin/team                     | Team Admin 관리 페이지            |

### 12.2 Navigation

- **좌측 사이드바**: 팀/그룹/파트/개인 Space 트리 구조 네비게이션
- **상단**: 서비스명(**FREE** - Fast Report & Easy Evidence), 사용자 이름, 프로필 링크, 로그아웃
- Super Admin / Team Admin 메뉴는 권한이 있는 사용자에게만 표시
- **FREE 브랜딩**: 로그인 페이지 중앙에 "FREE" 로고 + "Fast Report & Easy Evidence" 서브타이틀 표시. 상단 네비게이션 좌측에 항상 "FREE" 로고 표시

---

## 13. Scheduled Jobs

### 13.1 보고서 생성 (매일 0시)

- **Scheduler**: BullMQ Cron Job (Worker container)
- **실행 시간**: 매일 00:00 KST
- **병렬/순차**:
  - 팀 간: 병렬 실행
  - 팀 내: 순차 실행 (파트 → 그룹 → 팀 순서)
- **Retry 정책**: Section 7.7 참조

### 13.2 만료 데이터 정리

- **실행 시간**: 매일 01:00 KST (보고서 생성 완료 후)
- **대상**:
  - 30일 경과한 Item 영구 삭제 (date 기준)
  - 7일 경과한 Report 영구 삭제 (createdAt 기준)
  - 30일 경과한 ActivityLog 영구 삭제

---

## 14. Export (내보내기)

### 14.1 지원 형식

| Format | Library  | Description                          |
|--------|----------|--------------------------------------|
| docx   | docx     | Word 문서 형식                        |
| xlsx   | exceljs  | Excel 스프레드시트 형식                |

### 14.2 기본 포맷 구성

**DOCX**:
- 헤더: 보고서 제목 (예: "AX파트 주간 보고서"), 기간, 생성일
- 본문 섹션 1: 개인별(파트별/그룹별) 업무 정리
- 본문 섹션 2: 업무 항목별 정리
- 폰트: 맑은 고딕

**XLSX**:
- Sheet 1: 개인별(파트별/그룹별) 정리 (행: 개인/파트/그룹, 열: 업무 내용)
- Sheet 2: Item별 정리 (행: 업무 항목, 열: 관련 인원/파트/그룹 및 상세)

---

## 15. Security

### 15.1 인증/인가
- Samsung SSO 기반 인증
- 모든 API에 JWT 인증 미들웨어 적용
- Role 기반 접근 제어 (Super Admin / Team Admin / Regular User)
- 팀 간 데이터 격리 (`teamId` 기반 필터)

### 15.2 데이터 보호
- LLM API Key 암호화 저장 (AES-256)
- CORS whitelist 설정 (프론트엔드 origin만 허용)
- SQL Injection 방지 (Prisma ORM parameterized query)
- XSS 방지 (React 기본 escaping + 사용자 입력 sanitize)

### 15.3 Rate Limiting
- Item 생성 API: 분당 30회 (사용자 당)
- LLM 관련 API: 분당 10회 (사용자 당)
- 일반 조회 API: 분당 100회 (사용자 당)

---

## 16. Non-Functional Requirements

| Category        | Requirement                                           |
|-----------------|-------------------------------------------------------|
| Availability    | 99% uptime (서비스 시간: 평일 08:00~22:00 기준)         |
| Performance     | API 응답 시간 < 500ms (LLM 요청 제외)                   |
| LLM 응답        | Item 분리: < 15초, 보고서 생성: < 60초 (건당)            |
| Scalability     | 300+ 동시 사용자 지원                                   |
| Browser         | Chrome 최신 2버전, Edge 최신 2버전 (Desktop Only)        |
| Language        | 한국어 Only (UI, 보고서, 에러 메시지)                    |
| Data Retention  | Item/보고서 7일 보관 후 영구 삭제                        |
| Backup          | PostgreSQL 일일 백업 (최소 30일 보관)                    |

---

## 17. Deployment

### 17.1 Container Orchestration

Docker Compose 기반 배포:

```yaml
services:
  free-frontend:    # Port 15001
  free-api:         # Port 15002
  free-db:          # Port 15003
  free-redis:       # Port 15004
  free-worker:      # Port 15005
```

### 17.2 Environment Variables

```env
# API Server
DATABASE_URL=postgresql://...@free-db:15003/free
REDIS_URL=redis://free-redis:15004
JWT_SECRET=<secret>
DEVELOPERS=syngha.han
CORS_ORIGIN=https://a2g.samsungds.net:15001
VITE_SSO_URL=https://genai.samsungds.net:36810

# Worker
DATABASE_URL=<same>
REDIS_URL=<same>
```

---

## Appendix A: LLM Prompt Templates

### A.1 Item 분리

```
당신은 업무 보고 도우미입니다.

## 사용자 정보
- 이름: {username}
- 사업부: {businessUnit}
- 팀: {teamName}
- 그룹: {groupName}
- 파트: {partName}
- 오늘 날짜: {today}

## 작업
아래 텍스트는 위 사용자가 입력한 내용입니다.
입력은 다양한 형태일 수 있습니다:
- Jira 이슈 내용을 그대로 복사한 것
- 메신저/채팅 이력을 그대로 붙여넣은 것
- 이메일 본문/스레드를 복사한 것
- 회의록, 메모 등
- 직접 작성한 자유 텍스트

이 텍스트에서 **위 사용자 본인이 수행한 일/성과** 를 중심으로 개별 업무 항목(item)을 분리해 주세요.

규칙:
1. 사용자 본인의 관점에서 한 일/성과 위주로 추출합니다
2. 다른 사람의 업무나 일반적인 공유 정보는 제외합니다
3. 하나의 입력에서 여러 item이 나올 수 있습니다
4. 날짜 정보가 텍스트에 포함된 경우 해당 날짜를 item의 date로 지정합니다
5. 날짜를 특정할 수 없으면 오늘 날짜({today})를 사용합니다

각 item은 다음 JSON 형식으로 출력하세요:
[
  {
    "title": "간결한 업무 제목 (1줄)",
    "content": "업무 상세 내용 (필요시 여러 줄)",
    "date": "YYYY-MM-DD"
  }
]

입력 텍스트:
{userInput}
```

### A.2 그룹/파트 이름 정규화

```
다음 텍스트를 조직명으로 정규화해 주세요.
규칙: 영문은 대문자, 띄어쓰기 제거, 한글 유지

예시:
- "kpi group" → "KPI그룹"
- "ax 파트" → "AX파트"
- "platform team" → "Platform팀"

입력: {userInput}
출력:
```

### A.3 파트 보고서 - 개인별 정리

```
다음은 {partName} 파트의 지난 7일간 개인별 업무 기록입니다.
각 개인이 수행한 업무를 개인별로 정리하여 주간 보고서 형태로 작성해 주세요.

{itemsData}
```

### A.4 파트 보고서 - Item별 정리

```
다음은 {partName} 파트의 지난 7일간 업무 기록입니다.
동일하거나 유사한 업무 항목을 기준으로 정리하여 주간 보고서 형태로 작성해 주세요.
어떤 인원이 해당 업무에 참여했는지도 명시해 주세요.

{itemsData}
```

---

## Appendix B: Glossary

| Term      | Description                                                  |
|-----------|--------------------------------------------------------------|
| Item      | 개인이 입력한 업무 기록의 최소 단위 (title + content)           |
| Block     | Item이 UI에서 표시되는 카드 형태의 컴포넌트                     |
| Space     | 개인/파트/그룹/팀 단위의 업무 게시판                            |
| Report    | LLM이 생성한 주간 보고서                                       |
| FREE      | Fast Report & Easy Evidence (서비스명)                         |
| SSO       | Single Sign-On (삼성 통합 인증)                                |
| BU        | Business Unit (사업부)                                        |
