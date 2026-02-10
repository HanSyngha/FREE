# FREE API 레퍼런스

기본 URL: `http://52.78.246.50.nip.io:6090/api`

## 인증 방식

모든 API는 OAuth 기반 JWT 인증을 사용합니다. 요청 헤더에 다음이 필요합니다:

| 헤더 | 설명 |
|------|------|
| `Authorization` | `Bearer <sessionToken>` (로그인 후 발급) |

SSO 프록시 헤더 (최초 로그인 시 자동 주입):

| 헤더 | 설명 |
|------|------|
| `X-Auth-Token` | SSO 토큰 |
| `X-User-Id` | 사용자 loginid |
| `X-User-Name` | 사용자 이름 (URL-encoded) |
| `X-User-Dept` | 부서명 (URL-encoded) |

---

## 인증 (Auth)

### POST /auth/login

SSO 인증 후 로그인. 사용자/팀/공간을 자동 초기화합니다.

**응답:**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "loginid": "syngha.han",
    "username": "한승하",
    "deptname": "AI플랫폼팀(DS부문)",
    "businessUnit": "DS부문",
    "teamId": "uuid",
    "groupId": "uuid",
    "partId": "uuid",
    "teamName": "AI플랫폼팀",
    "groupName": "AE그룹",
    "partName": "AE파트"
  },
  "spaces": {
    "personalSpaceId": "uuid",
    "teamSpaceId": "uuid",
    "teamId": "uuid",
    "teamName": "AI플랫폼팀"
  },
  "sessionToken": "jwt-token",
  "isSuperAdmin": false,
  "isTeamAdmin": false,
  "needsOnboarding": false
}
```

### GET /auth/me

현재 로그인된 사용자 정보 조회.

### POST /auth/refresh

세션 토큰 갱신.

### POST /auth/logout

로그아웃. Redis에서 활성 세션을 삭제합니다.

---

## 온보딩

### GET /onboarding/groups

팀 내 그룹 목록 조회.

**응답:**
```json
{
  "groups": [
    { "id": "uuid", "name": "AE그룹", "teamId": "uuid" }
  ]
}
```

### GET /onboarding/parts?groupId={id}

그룹 내 파트 목록 조회.

**응답:**
```json
{
  "parts": [
    { "id": "uuid", "name": "AE파트", "groupId": "uuid" }
  ]
}
```

### POST /onboarding/setup

그룹/파트 선택 또는 신규 생성.

**요청 본문 (기존 그룹/파트 선택):**
```json
{
  "groupId": "uuid",
  "partId": "uuid"
}
```

**요청 본문 (신규 생성):**
```json
{
  "groupName": "AE그룹",
  "partName": "AE파트"
}
```

### POST /onboarding/normalize-name

LLM으로 그룹/파트 이름 정규화. (예: `Agent Enabler` → `AE그룹`)

**요청 본문:**
```json
{ "name": "Agent Enabler" }
```

**응답:**
```json
{ "original": "Agent Enabler", "normalized": "AE그룹" }
```

---

## 업무 기록 (Items)

### POST /items

텍스트를 제출하면 LLM이 업무 항목으로 분리하여 저장합니다.

**요청 본문:**
```json
{
  "text": "오늘 CI/CD 파이프라인 구축하고, API 문서 작성했습니다.",
  "date": "2026-01-27"
}
```

| 필드 | 필수 | 설명 |
|------|------|------|
| `text` | O | 업무 내용 (최대 50,000자) |
| `date` | X | 날짜 (29일 전 ~ 오늘, 기본값: 오늘) |

**응답:**
```json
{
  "success": true,
  "items": [
    {
      "id": "uuid",
      "title": "CI/CD 파이프라인 구축",
      "content": "CI/CD 파이프라인 구축 작업 수행",
      "date": "2026-01-27T00:00:00.000Z",
      "userId": "uuid",
      "spaceId": "uuid"
    }
  ],
  "shouldRate": false,
  "requestCount": 5
}
```

### PUT /items/:id

업무 항목 수정. 본인 항목만 수정 가능.

**요청 본문 (모두 선택):**
```json
{
  "title": "수정된 제목",
  "content": "수정된 내용",
  "link": "https://example.com",
  "date": "2026-01-26"
}
```

### DELETE /items/:id

업무 항목 삭제. 본인 항목만 삭제 가능.

### POST /items/external

**인증 불필요.** loginid로 사용자를 식별하여 업무 항목을 직접 추가합니다 (LLM 파싱 없이).

**요청 본문:**
```json
{
  "loginid": "syngha.han",
  "items": [
    {
      "title": "CI/CD 파이프라인 구축",
      "content": "Jenkins + Docker 기반 CI/CD 파이프라인 구축 완료",
      "date": "2026-01-27"
    },
    {
      "title": "API 문서 작성",
      "content": "FREE 서비스 API Reference 문서 작성"
    }
  ]
}
```

| 필드 | 필수 | 설명 |
|------|------|------|
| `loginid` | O | 대상 사용자의 loginid |
| `items` | O | 업무 항목 배열 |
| `items[].title` | O | 업무 제목 (최대 500자) |
| `items[].content` | O | 업무 내용 (최대 10,000자) |
| `items[].date` | X | 날짜 (29일 전 ~ 오늘, 기본값: 오늘) |

**사용 예시 (curl):**
```bash
curl -X POST http://52.78.246.50.nip.io:6090/api/items/external \
  -H "Content-Type: application/json" \
  -d '{
    "loginid": "syngha.han",
    "items": [
      { "title": "업무 제목", "content": "업무 상세 내용", "date": "2026-01-30" }
    ]
  }'
```

**응답:**
```json
{
  "success": true,
  "items": [...],
  "count": 1
}
```

**에러:**
| 상태 코드 | 설명 |
|-----------|------|
| 400 | loginid 누락, items 누락, 그룹/파트 미설정, 유효하지 않은 날짜 |
| 404 | 사용자를 찾을 수 없음 (먼저 웹에서 로그인 필요) |
| 500 | 서버 오류 |

---

## 공간 조회 (Spaces)

### GET /spaces/personal

내 개인 공간 및 최근 7일 업무 항목 조회.

### GET /spaces/personal/:userId

특정 사용자의 개인 공간 조회 (같은 팀만 가능).

### GET /spaces/part/:partId

파트 공간 조회 — 파트 내 모든 사용자의 업무 항목 + 보고서.

### GET /spaces/group/:groupId

그룹 공간 조회 — 그룹 내 모든 파트의 업무 항목 + 보고서.

### GET /spaces/team

팀 공간 조회 — 팀 전체 업무 항목, 보고서, 공지사항, 실패한 보고서 작업 포함.

---

## 보고서 (Reports)

### GET /reports/space/:spaceId

해당 공간의 보고서 목록 조회 (만료되지 않은 것만).

### GET /reports/:id

보고서 상세 조회.

**응답:**
```json
{
  "report": {
    "id": "uuid",
    "type": "PART",
    "byMemberContent": "개인별 정리 내용...",
    "byItemContent": "항목별 정리 내용...",
    "periodStart": "2026-01-20T00:00:00.000Z",
    "periodEnd": "2026-01-26T00:00:00.000Z",
    "expiresAt": "2026-02-02T00:00:00.000Z"
  }
}
```

### GET /reports/:id/export?format=docx|xlsx

보고서 내보내기. 파일을 바이너리로 반환합니다.

| 파라미터 | 설명 |
|----------|------|
| `format` | `docx` (기본값) 또는 `xlsx` |

### POST /reports/resume

실패한 보고서 생성을 재개합니다.

---

## 프로필

### GET /profile

내 프로필 정보 (팀/그룹/파트 포함).

### PUT /profile/organization

소속 그룹/파트 변경. 온보딩과 동일한 형식.

**요청 본문:**
```json
{
  "groupId": "uuid",
  "partId": "uuid"
}
```

### GET /profile/activity-log

내 활동 로그 조회 (최근 30일).

---

## 평가 (Ratings)

### POST /ratings

LLM 평가 점수 제출 (1~5점).

**요청 본문:**
```json
{ "score": 4 }
```

### GET /ratings/check

평가 팝업 표시 여부 확인. 20회 요청마다 1번 표시.

---

## 공지사항 (Announcements)

> 권한: 팀 관리자(Team Admin) 이상

### GET /announcements/team

팀 공지 조회 (일반 사용자도 가능).

### POST /announcements/team

팀 공지 작성/수정.

**요청 본문:**
```json
{
  "title": "공지 제목",
  "content": "공지 내용"
}
```

### DELETE /announcements/team

팀 공지 삭제.

---

## 팀 관리자 (Team Admin)

> 권한: 팀 관리자(Team Admin) 이상

### GET /team-admin/users?groupId={id}&partId={id}

팀 내 사용자 목록 조회. 그룹/파트 필터 가능.

### GET /team-admin/report-logs

보고서 생성 로그 조회 (최근 100건).

---

## 시스템 관리 (Super Admin 전용)

> 권한: SuperAdmin만 접근 가능

### POST /admin/llm/endpoint

LLM 엔드포인트 설정.

**요청 본문:**
```json
{
  "endpoint": "http://proxy-server:8080/v1",
  "apiKey": "선택사항"
}
```

### POST /admin/llm/sync

엔드포인트에서 사용 가능한 모델 목록을 동기화.

**요청 본문 (선택):**
```json
{
  "endpoint": "http://proxy-server:8080/v1",
  "apiKey": "선택사항"
}
```

### GET /admin/llm/models

동기화된 모델 목록 및 현재 활성 모델 조회.

### PUT /admin/llm/activate/:modelId

특정 모델 활성화.

**요청 본문:**
```json
{
  "modelName": "GPT-4o",
  "endpoint": "http://proxy-server:8080/v1",
  "apiKey": "선택사항"
}
```

### GET /admin/teams

전체 팀 + 그룹/파트/사용자/팀관리자 목록 조회.

### POST /admin/team-admin

팀 관리자(Team Admin) 권한 부여.

**요청 본문:**
```json
{
  "userId": "uuid",
  "teamId": "uuid"
}
```

### DELETE /admin/team-admin/:id

팀 관리자 권한 해제. `:id`는 TeamAdmin 레코드의 ID.

### POST /admin/items

특정 사용자에게 업무 항목을 직접 추가합니다 (LLM 파싱 없이).

**요청 본문:**
```json
{
  "loginid": "syngha.han",
  "items": [
    {
      "title": "CI/CD 파이프라인 구축",
      "content": "Jenkins + Docker 기반 CI/CD 파이프라인 구축 완료",
      "date": "2026-01-27"
    },
    {
      "title": "API 문서 작성",
      "content": "FREE 서비스 API Reference 문서 작성"
    }
  ]
}
```

| 필드 | 필수 | 설명 |
|------|------|------|
| `loginid` | O | 대상 사용자의 loginid |
| `items` | O | 업무 항목 배열 |
| `items[].title` | O | 업무 제목 (최대 500자) |
| `items[].content` | O | 업무 내용 (최대 10,000자) |
| `items[].date` | X | 날짜 (29일 전 ~ 오늘, 기본값: 오늘) |

**응답:**
```json
{
  "success": true,
  "items": [...],
  "count": 2
}
```

**에러:**
| 상태 코드 | 설명 |
|-----------|------|
| 400 | loginid 누락, items 누락, title/content 누락, 유효하지 않은 날짜 |
| 404 | 사용자를 찾을 수 없음 |
| 500 | 개인 공간 없음, 서버 오류 |

### POST /admin/trigger-report

특정 팀의 보고서를 수동 생성합니다. 매일 00:00(KST) 자동 생성과 동일한 동작입니다.

**요청 본문:**
```json
{
  "teamId": "uuid"
}
```

**응답:**
```json
{
  "success": true,
  "message": "AI플랫폼팀 팀 보고서 생성이 시작되었습니다."
}
```

**에러:**
| 상태 코드 | 설명 |
|-----------|------|
| 400 | teamId 누락 |
| 404 | 팀을 찾을 수 없음 |
| 409 | 이미 해당 팀의 보고서 생성이 진행 중 |

---

## 상태 확인

### GET /health

서버 상태 확인. 인증 불필요.

**응답:**
```json
{ "status": "ok" }
```

---

## 에러 형식

모든 에러는 동일한 형식으로 반환됩니다:

```json
{
  "error": "에러 메시지"
}
```

## 요청 제한 (Rate Limit)

| 대상 | 제한 |
|------|------|
| `POST /items` (업무 입력) | 분당 10회 |
| LLM 호출 관련 | 분당 20회 |
| 일반 조회 | 분당 60회 |
