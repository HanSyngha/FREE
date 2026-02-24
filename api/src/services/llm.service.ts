/**
 * LLM Service - ONCE 참조 구현
 * OpenAI API 호환 endpoint 사용
 */
import { prisma } from '../index.js';
import { decrypt } from '../utils/encryption.js';
import { toKSTDateString, parseKSTDate } from '../utils/date.js';

const LLM_PROXY_URL = process.env.LLM_PROXY_URL || '';
const LLM_SERVICE_ID = process.env.LLM_SERVICE_ID || 'free';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://a2g.samsungds.net:4090';

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  choices: Array<{ message: { content: string } }>;
}

/**
 * 활성 LLM Config 조회
 */
export async function getActiveLLMConfig() {
  return prisma.lLMConfig.findFirst({ where: { isActive: true } });
}

/**
 * Dashboard /v1/models API에서 첫 번째 사용 가능한 모델 조회 (ONCE 패턴)
 * 사업부 필터링을 위해 user 정보 필수
 */
async function fetchFirstAvailableModel(
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<string | null> {
  try {
    const baseUrl = LLM_PROXY_URL
      .replace(/\/chat\/completions$/, '')
      .replace(/\/v1$/, '');
    const modelsUrl = `${baseUrl}/v1/models`;

    const response = await fetch(modelsUrl, {
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Id': LLM_SERVICE_ID,
        'X-User-Id': userInfo.loginid,
        'X-User-Name': encodeURIComponent(userInfo.username),
        'X-User-Dept': encodeURIComponent(userInfo.deptname),
      },
    });

    if (response.ok) {
      const data = await response.json() as any;
      const models = data.data || [];
      if (models.length > 0) {
        console.log(`[LLM] Fetched ${models.length} available models, using: ${models[0].id}`);
        return models[0].id;
      }
    }
  } catch (e) {
    console.error('[LLM] Failed to fetch models from proxy:', e);
  }
  return null;
}

/**
 * LLM Chat Completions 호출 - ONCE와 동일 패턴
 */
export async function callLLM(
  messages: LLMMessage[],
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<string> {
  // userInfo는 필수 - Dashboard에서 권한 체크에 사용
  if (!userInfo || !userInfo.loginid) {
    throw new Error('userInfo is required for LLM calls');
  }

  // ONCE 패턴: 호출 시점에 동적으로 사용 가능한 모델 가져오기
  const dynamicModel = await fetchFirstAvailableModel(userInfo);

  const config = await getActiveLLMConfig();

  let chatUrl: string;
  let apiKey: string;
  let modelId: string;

  // 모델 우선순위: 동적으로 가져온 모델 > DB config > default
  if (dynamicModel) {
    modelId = dynamicModel;
  } else if (config?.modelId) {
    modelId = config.modelId;
  } else {
    modelId = 'default';
  }

  // endpoint 결정
  if (config?.endpoint) {
    chatUrl = config.endpoint.endsWith('/chat/completions')
      ? config.endpoint
      : `${config.endpoint}/chat/completions`;
    apiKey = config.apiKey ? decrypt(config.apiKey) : '';
  } else if (LLM_PROXY_URL) {
    chatUrl = LLM_PROXY_URL;
    apiKey = '';
  } else {
    throw new Error('No LLM configuration available');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Service-Id': LLM_SERVICE_ID,
    'X-User-Id': userInfo.loginid,  // ONCE와 동일하게 encode 없이
    'X-User-Name': encodeURIComponent(userInfo.username),
    'X-User-Dept': encodeURIComponent(userInfo.deptname),
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // 디버그 로그
  console.log('[LLM] Request:', {
    url: chatUrl,
    model: modelId,
    serviceId: LLM_SERVICE_ID,
    userId: userInfo.loginid,
    userName: userInfo.username,
    userDept: userInfo.deptname,
    hasApiKey: !!apiKey,
  });

  const response = await fetch(chatUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[LLM] Error:', {
      status: response.status,
      error: errorText,
      url: chatUrl,
      model: modelId,
      headers: { ...headers, Authorization: headers.Authorization ? '[REDACTED]' : undefined },
    });
    throw new Error(`LLM API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as LLMResponse;
  console.log('[LLM] Success:', { model: modelId, userId: userInfo.loginid });
  return data.choices[0]?.message?.content || '';
}

/**
 * LLM으로 텍스트 → WorkLog + Todo 동시 분리
 * 과거형/완료형 → WorkLog, 미래형/예정 → Todo
 */
export async function parseTextWithLLM(
  userInput: string,
  userContext: {
    username: string;
    businessUnit: string;
    teamName: string;
    groupName: string;
    partName: string;
    today: string;
    defaultDate?: string;
    preferences?: {
      tone?: string;
      language?: string;
      emphasis?: string;
      customInstructions?: string;
    };
    partItems?: Array<{ id: string; title: string }>;
    existingTodos?: Array<{ id: string; title: string }>;
  },
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<{
  workLogs: Array<{ title: string; content: string; date: string; linkedItemId?: string }>;
  todos: Array<{ title: string; endDate?: string; linkedItemId?: string }>;
}> {
  const defaultDate = userContext.defaultDate || userContext.today;
  const prefs = userContext.preferences || {};

  const toneMap: Record<string, string> = { formal: '격식체로 작성', concise: '간결하게 작성' };
  const toneInstruction = prefs.tone ? (toneMap[prefs.tone] || prefs.tone) : '';
  const languageInstruction = prefs.language === 'english' ? '모든 업무 항목을 영어로 작성해 주세요.' : '';
  const emphasisInstruction = prefs.emphasis ? `다음 내용을 특히 강조해서 작성해 주세요: ${prefs.emphasis}` : '';
  const customInstruction = prefs.customInstructions || '';

  const preferencesSection = [toneInstruction, languageInstruction, emphasisInstruction, customInstruction].filter(Boolean).join('\n- ');
  const preferencesPrompt = preferencesSection ? `\n\n## 사용자 선호 설정\n- ${preferencesSection}` : '';

  const partItemsStr = userContext.partItems?.length
    ? `\n\n## 파트 목표 (연결 참조용)\n${userContext.partItems.map(i => `- id: "${i.id}", title: "${i.title}"`).join('\n')}`
    : '';

  const existingTodosStr = userContext.existingTodos?.length
    ? `\n\n## 기존 미완료 할일 (중복 방지)\n${userContext.existingTodos.map(t => `- "${t.title}"`).join('\n')}`
    : '';

  const systemPrompt = `당신은 업무 보고 도우미입니다.

## 사용자 정보
- 이름: ${userContext.username}
- 사업부: ${userContext.businessUnit}
- 팀: ${userContext.teamName}
- 그룹: ${userContext.groupName}
- 파트: ${userContext.partName}
- 오늘 날짜: ${userContext.today}

## 작업
아래 텍스트에서 **업무 기록(workLogs)**과 **할일(todos)**을 분리해 주세요.

### 분류 기준
- **workLogs**: 이미 완료한 일, 과거형/완료형 표현 → 업무 기록으로
- **todos**: 앞으로 할 일, 미래형/예정 표현 → 할일로

### 규칙
1. 사용자 본인의 관점에서 추출합니다
2. 다른 사람의 업무나 일반적인 공유 정보는 제외합니다
3. 날짜를 특정할 수 없으면 workLogs는 ${defaultDate}를 사용합니다
4. 기존 미완료 할일과 중복되는 항목은 todos에서 제외합니다
5. 파트 목표가 있으면 관련 workLog/todo에 linkedItemId를 매핑합니다 (확실한 경우만)

### linkedItemId 매핑 규칙
- linkedItemId는 파트 목표 목록에 있는 **정확한 id 값**만 사용합니다
- 업무/할일의 내용이 목표의 **핵심 활동과 직접 관련**될 때만 연결합니다
- 간접적 관련(예: "회의 참석"은 모든 목표와 간접 관련)은 null로 설정합니다
- 확신이 50% 미만이면 null로 설정합니다
- 여러 목표와 관련될 수 있으면 가장 관련도 높은 하나만 선택합니다

### 예제

**파트 목표:**
- id: "goal-a1", title: "CI/CD 파이프라인 구축"
- id: "goal-a2", title: "API 성능 최적화"

**기존 미완료 할일:**
- "Jenkins 플러그인 조사"

**입력:**
"오늘 Jenkins 파이프라인에 Docker 빌드 스테이지를 추가하고 배포 자동화를 완성했다.
그리고 API 응답 시간을 측정해봤는데 평균 800ms로 너무 느렸다. 내일 캐싱 레이어를 추가할 예정.
팀 회의는 10시에 했고, 점심에 세미나 참석함."

**올바른 출력:**
{
  "workLogs": [
    { "title": "Jenkins Docker 빌드 스테이지 추가 및 배포 자동화", "content": "Jenkins 파이프라인에 Docker 빌드 스테이지를 추가하고 배포 자동화를 완성함", "date": "2026-02-24", "linkedItemId": "goal-a1" },
    { "title": "API 응답 시간 측정", "content": "API 응답 시간을 측정한 결과 평균 800ms로 확인됨", "date": "2026-02-24", "linkedItemId": "goal-a2" },
    { "title": "팀 회의 참석", "content": "10시 팀 회의 참석", "date": "2026-02-24", "linkedItemId": null },
    { "title": "세미나 참석", "content": "점심 세미나 참석", "date": "2026-02-24", "linkedItemId": null }
  ],
  "todos": [
    { "title": "API 캐싱 레이어 추가", "endDate": null, "linkedItemId": "goal-a2" }
  ]
}

**주의:** "팀 회의", "세미나"는 특정 목표와 직접 관련 없으므로 linkedItemId: null.
**주의:** "Jenkins 플러그인 조사"는 기존 할일이므로 todos에 포함하지 않음.${partItemsStr}${existingTodosStr}${preferencesPrompt}

다음 JSON 형식으로 출력하세요:
{
  "workLogs": [
    { "title": "간결한 업무 제목", "content": "업무 상세 내용", "date": "YYYY-MM-DD", "linkedItemId": "목표ID 또는 null" }
  ],
  "todos": [
    { "title": "할일 제목", "endDate": "YYYY-MM-DD 또는 null", "linkedItemId": "목표ID 또는 null" }
  ]
}

반드시 유효한 JSON만 출력하세요. 다른 텍스트는 포함하지 마세요.`;

  const result = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userInput }],
    userInfo
  );

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM did not return valid JSON');

  const parsed = JSON.parse(jsonMatch[0]);

  // WorkLog 날짜 유효성 검사
  const todayDate = parseKSTDate(userContext.today);
  const minDate = new Date(todayDate);
  minDate.setDate(minDate.getDate() - 29);
  const fallbackDate = parseKSTDate(defaultDate);

  const workLogs = (parsed.workLogs || []).map((wl: any) => {
    let wlDate = parseKSTDate(wl.date);
    if (isNaN(wlDate.getTime()) || wlDate > todayDate || wlDate < minDate) wlDate = fallbackDate;
    return {
      title: String(wl.title || ''),
      content: String(wl.content || ''),
      date: toKSTDateString(wlDate),
      linkedItemId: wl.linkedItemId || null,
    };
  });

  const todos = (parsed.todos || []).map((todo: any) => ({
    title: String(todo.title || ''),
    endDate: todo.endDate || null,
    linkedItemId: todo.linkedItemId || null,
  }));

  return { workLogs, todos };
}

/**
 * LLM으로 Item 분리/정리 (하위 호환)
 */
export async function parseItemsWithLLM(
  userInput: string,
  userContext: {
    username: string;
    businessUnit: string;
    teamName: string;
    groupName: string;
    partName: string;
    today: string;
    defaultDate?: string;
    preferences?: {
      tone?: string;
      language?: string;
      emphasis?: string;
      customInstructions?: string;
    };
  },
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<Array<{ title: string; content: string; date: string }>> {
  const defaultDate = userContext.defaultDate || userContext.today;
  const prefs = userContext.preferences || {};

  // 어조 설정
  const toneMap: Record<string, string> = {
    formal: '격식체로 작성',
    concise: '간결하게 작성',
  };
  const toneInstruction = prefs.tone
    ? (toneMap[prefs.tone] || prefs.tone)
    : '';

  // 언어 설정
  const languageInstruction = prefs.language === 'english'
    ? '모든 업무 항목을 영어로 작성해 주세요.'
    : '';

  // 강조 설정
  const emphasisInstruction = prefs.emphasis
    ? `다음 내용을 특히 강조해서 작성해 주세요: ${prefs.emphasis}`
    : '';

  // 추가 지시사항
  const customInstruction = prefs.customInstructions || '';

  // 사용자 선호 설정 섹션 구성
  const preferencesSection = [toneInstruction, languageInstruction, emphasisInstruction, customInstruction]
    .filter(Boolean)
    .join('\n- ');

  const preferencesPrompt = preferencesSection
    ? `\n\n## 사용자 선호 설정\n위 설정을 반영하여 업무 항목을 작성해 주세요:\n- ${preferencesSection}`
    : '';

  const systemPrompt = `당신은 업무 보고 도우미입니다.

## 사용자 정보
- 이름: ${userContext.username}
- 사업부: ${userContext.businessUnit}
- 팀: ${userContext.teamName}
- 그룹: ${userContext.groupName}
- 파트: ${userContext.partName}
- 오늘 날짜: ${userContext.today}

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
5. 날짜를 특정할 수 없으면 ${defaultDate}를 사용합니다${preferencesPrompt}

각 item은 다음 JSON 형식으로 출력하세요:
[
  {
    "title": "간결한 업무 제목 (1줄)",
    "content": "업무 상세 내용 (필요시 여러 줄)",
    "date": "YYYY-MM-DD"
  }
]

반드시 유효한 JSON 배열만 출력하세요. 다른 텍스트는 포함하지 마세요.`;

  const result = await callLLM(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInput },
    ],
    userInfo
  );

  // Parse JSON from LLM response
  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('LLM did not return valid JSON array');
  }

  const items = JSON.parse(jsonMatch[0]);

  // Validate date range (29 days ago ~ actual today, KST 기준)
  const todayDate = parseKSTDate(userContext.today);
  const minDate = new Date(todayDate);
  minDate.setDate(minDate.getDate() - 29);
  const fallbackDate = parseKSTDate(defaultDate);

  return items.map((item: any) => {
    let itemDate = parseKSTDate(item.date);
    if (isNaN(itemDate.getTime()) || itemDate > todayDate || itemDate < minDate) {
      itemDate = fallbackDate;
    }
    return {
      title: String(item.title || ''),
      content: String(item.content || ''),
      date: toKSTDateString(itemDate),
    };
  });
}

/**
 * 그룹/파트 이름 정규화
 */
export async function normalizeNameWithLLM(
  userInput: string,
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<string> {
  const systemPrompt = `다음 텍스트를 조직명으로 정규화해 주세요.
규칙: 영문은 대문자, 띄어쓰기 제거, 한글 유지

예시:
- "kpi group" → "KPI그룹"
- "ax 파트" → "AX파트"
- "platform team" → "Platform팀"

정규화된 이름만 출력하세요. 다른 텍스트는 포함하지 마세요.`;

  const result = await callLLM(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInput },
    ],
    userInfo
  );

  return result.trim();
}

/**
 * Model list 동기화 - ONCE와 동일 패턴
 */
export async function syncModelsFromEndpoint(
  endpoint: string,
  apiKey: string,
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<Array<{ id: string; displayName: string; maxTokens: number }>> {
  const baseUrl = endpoint
    .replace(/\/chat\/completions$/, '')
    .replace(/\/proxy$/, '')
    .replace(/\/v1$/, '');
  const modelsUrl = `${baseUrl}/v1/models`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Service-Id': LLM_SERVICE_ID,
    'X-User-Id': userInfo.loginid,  // ONCE와 동일하게 encode 없이
    'X-User-Name': encodeURIComponent(userInfo.username),
    'X-User-Dept': encodeURIComponent(userInfo.deptname),
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(modelsUrl, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status}`);
  }

  const data = await response.json() as any;
  return (data.data || []).map((m: any) => ({
    id: m.id,
    displayName: m._nexus?.displayName || m.id,
    maxTokens: m._nexus?.maxTokens || 128000,
  }));
}

/**
 * LLM으로 조직장 Item 입력 → 목표 분리+태그+매핑
 */
export async function parseGoalsWithLLM(
  text: string,
  context: {
    level: string;
    existingItems: Array<{ id: string; title: string }>;
    existingTags: string[];
    parentItems: Array<{ id: string; title: string }>;
  },
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<Array<{
  title: string;
  content: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  tags: string[];
  parentTitle: string | null;
}>> {
  const existingItemsStr = context.existingItems.length
    ? `\n\n## 기존 목표 (중복 방지)\n${context.existingItems.map(i => `- "${i.title}"`).join('\n')}`
    : '';

  const existingTagsStr = context.existingTags.length
    ? `\n\n## 기존 태그 (재사용 우선)\n${context.existingTags.join(', ')}`
    : '';

  const parentItemsStr = context.parentItems.length
    ? `\n\n## 상위 목표 (매핑 참조)\n${context.parentItems.map(p => `- "${p.title}"`).join('\n')}`
    : '';

  const levelLabel = context.level === 'TEAM' ? '팀' : context.level === 'GROUP' ? '그룹' : '파트';

  const systemPrompt = `당신은 조직 목표 관리 도우미입니다.

## 작업
아래 텍스트에서 ${levelLabel} 단위 목표(Item)를 분리해 주세요.

### 규칙
1. 하나의 텍스트에서 여러 목표가 나올 수 있습니다
2. 기존 목표와 중복되는 항목은 제외합니다
3. 태그는 기존 태그를 우선 재사용하고, 필요시 새로 생성합니다
4. 상위 목표가 있으면 가장 관련도 높은 상위 목표 title을 parentTitle에 매핑합니다
5. status는 PLANNED/IN_PROGRESS/COMPLETED 중 하나 (기본: PLANNED)
6. 날짜가 명시되지 않으면 null

### parentTitle 매핑 규칙
- parentTitle은 상위 목표 목록에 있는 **정확한 title 문자열을 그대로 복사**합니다
- 부분 일치나 의역은 허용되지 않습니다
- 정확히 일치하는 상위 목표가 없으면 null

### 태그 규칙
- 기존 태그와 **의미가 같으면 반드시 기존 태그명을 재사용**합니다
  예: 기존 "인프라" 태그가 있으면 → "인프라 구축", "Infrastructure" 대신 "인프라" 사용
- 새 태그는 2~6글자, 한글 또는 영문, 핵심 키워드만

### 예제

**상위 목표:**
- "서비스 안정성 확보"
- "고객 만족도 향상"

**기존 태그:** 인프라, 모니터링, CS

**기존 목표:** "서버 이중화 구성" (중복 방지)

**입력:**
"1분기 목표: 서버 모니터링 시스템 구축하고 장애 대응 시간 30% 단축.
고객 피드백 분석 시스템도 만들어야 함."

**올바른 출력:**
[
  { "title": "서버 모니터링 시스템 구축", "content": "실시간 서버 상태를 추적하는 모니터링 시스템 구축", "status": "PLANNED", "startDate": null, "endDate": null, "tags": ["모니터링", "인프라"], "parentTitle": "서비스 안정성 확보" },
  { "title": "장애 대응 시간 30% 단축", "content": "장애 발생 시 대응 프로세스를 개선하여 평균 대응 시간 30% 감소", "status": "PLANNED", "startDate": null, "endDate": null, "tags": ["인프라"], "parentTitle": "서비스 안정성 확보" },
  { "title": "고객 피드백 분석 시스템", "content": "고객 피드백을 수집·분석하는 시스템 개발", "status": "PLANNED", "startDate": null, "endDate": null, "tags": ["CS"], "parentTitle": "고객 만족도 향상" }
]

**주의:** "서버 이중화 구성"은 기존 목표이므로 제외.
**주의:** 태그 "모니터링", "인프라", "CS"는 기존 태그 재사용.${existingItemsStr}${existingTagsStr}${parentItemsStr}

다음 JSON 배열 형식으로 출력하세요:
[
  {
    "title": "목표 제목",
    "content": "목표 상세 설명",
    "status": "PLANNED",
    "startDate": "YYYY-MM-DD 또는 null",
    "endDate": "YYYY-MM-DD 또는 null",
    "tags": ["태그1", "태그2"],
    "parentTitle": "상위 목표 title 또는 null"
  }
]

반드시 유효한 JSON 배열만 출력하세요.`;

  const result = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
    userInfo
  );

  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('LLM did not return valid JSON array');

  const parsed = JSON.parse(jsonMatch[0]);
  return parsed.map((g: any) => ({
    title: String(g.title || ''),
    content: String(g.content || ''),
    status: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'].includes(g.status) ? g.status : 'PLANNED',
    startDate: g.startDate || null,
    endDate: g.endDate || null,
    tags: Array.isArray(g.tags) ? g.tags.map(String) : [],
    parentTitle: g.parentTitle || null,
  }));
}

/**
 * LLM으로 Todo → 파트 Item 자동 연결
 */
export async function linkTodoToItem(
  todoTitle: string,
  endDate: string | null | undefined,
  partItems: Array<{ id: string; title: string }>,
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<{ linkedItemId: string | null }> {
  if (partItems.length === 0) return { linkedItemId: null };

  const systemPrompt = `당신은 할일과 조직 목표를 연결하는 도우미입니다.

## 파트 목표 목록
${partItems.map(i => `- id: "${i.id}", title: "${i.title}"`).join('\n')}

## 작업
아래 할일이 위 목표 중 어떤 것과 가장 관련이 있는지 판단해 주세요.

## 연결 기준
- 할일의 내용이 목표의 **핵심 활동과 직접적으로 관련**될 때만 연결
- 간접적 관련성(예: "회의 참석"은 여러 목표와 관련될 수 있음)은 null
- 확신이 70% 미만이면 null

## 예제

**파트 목표:**
- id: "item-1", title: "프론트엔드 리팩토링"
- id: "item-2", title: "API 문서 자동화"

할일: "React 컴포넌트 코드 스플리팅 적용"
→ { "linkedItemId": "item-1" }

할일: "Swagger 자동 생성 스크립트 작성"
→ { "linkedItemId": "item-2" }

할일: "팀 회의 준비"
→ { "linkedItemId": null }

할일: "코드 리뷰 피드백 반영"
→ { "linkedItemId": null }  (여러 목표에 해당 가능 → null)

다음 JSON 형식으로 출력하세요:
{ "linkedItemId": "목표ID 또는 null" }

반드시 유효한 JSON만 출력하세요.`;

  const userContent = `할일: "${todoTitle}"${endDate ? `, 마감일: ${endDate}` : ''}`;

  const result = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
    userInfo
  );

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { linkedItemId: null };

  const parsed = JSON.parse(jsonMatch[0]);
  const linkedId = parsed.linkedItemId || null;

  // 유효한 Item ID인지 검증
  if (linkedId && partItems.some(i => i.id === linkedId)) {
    return { linkedItemId: linkedId };
  }
  return { linkedItemId: null };
}

/**
 * LLM으로 Item 진행률/진척사항 업데이트
 */
export async function updateItemProgress(
  item: { id: string; title: string; content: string },
  childData: string,
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<{ progress: number; summary: string }> {
  const systemPrompt = `당신은 목표 진행률 분석 도우미입니다.

## 목표
- 제목: ${item.title}
- 설명: ${item.content}

## 작업
아래 하위 데이터(하위 목표/할일/업무기록)를 분석하여 이 목표의 진행률과 진척사항을 판단해 주세요.

## 분석 기준
- 하위 목표가 있으면: 하위 목표들의 상태 가중 평균 (COMPLETED=100, IN_PROGRESS=progress값, PLANNED=0)
- 연결된 할일이 있으면: 완료된 할일 비율 참고
- 연결된 업무 기록이 있으면: 활동 빈도를 정성적으로 반영
- progress는 5 단위로 반올림 (0, 5, 10, ..., 95, 100)
- summary는 구체적 수치 포함 (예: "하위 3개 중 1개 완료")

## 예제

**목표:** "CI/CD 파이프라인 구축", 설명: "빌드~배포 전체 자동화"

**하위 데이터:**
하위 목표 3개: "Jenkins 설정"(COMPLETED, 100%), "Docker 빌드"(IN_PROGRESS, 50%), "배포 스크립트"(PLANNED, 0%)
연결 업무기록 5건, 연결 할일 3건(1건 완료)

→ { "progress": 50, "summary": "하위 목표 3개 중 1개 완료, 1개 진행중. 할일 3건 중 1건 완료." }

다음 JSON 형식으로 출력하세요:
{ "progress": 0~100, "summary": "진척사항 1-2문장" }

반드시 유효한 JSON만 출력하세요.`;

  const result = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: childData }],
    userInfo
  );

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { progress: 0, summary: '' };

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    progress: Math.max(0, Math.min(100, Number(parsed.progress) || 0)),
    summary: String(parsed.summary || ''),
  };
}

/**
 * Rating 제출 - ONCE와 동일 패턴 (Dashboard로 전송)
 */
export async function submitRating(
  modelName: string,
  rating: number,
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<void> {
  const url = `${DASHBOARD_URL}/api/rating`;

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Id': LLM_SERVICE_ID,
      'X-User-Id': userInfo.loginid,  // ONCE와 동일하게 encode 없이
      'X-User-Name': encodeURIComponent(userInfo.username),
      'X-User-Dept': encodeURIComponent(userInfo.deptname),
    },
    body: JSON.stringify({
      modelName,
      rating,
      serviceId: LLM_SERVICE_ID,
    }),
  });
}

/**
 * 보고서 생성 - 파트 보고서
 */
export async function generatePartReport(
  partName: string,
  itemsData: string,
  userInfo: { loginid: string; username: string; deptname: string },
  context?: { memberNames?: string; periodStr?: string }
): Promise<{ byMember: string; byItem: string }> {
  if (!itemsData.trim()) {
    return {
      byMember: '해당 기간 보고할 내용이 없습니다.',
      byItem: '해당 기간 보고할 내용이 없습니다.',
    };
  }

  const ctxLine = context
    ? `당신은 ${partName} 파트의 7일간(${context.periodStr}) 주간 보고서를 작성하고 있습니다.\n파트 구성원: ${context.memberNames}\n\n절대로 파트원간 업무를 비교, 평가하지 마시오. 평가와 비교는 보고서를 읽는 리더가 합니다.\n\n`
    : '';

  const byMember = await callLLM([
    {
      role: 'system',
      content: `${ctxLine}다음은 ${partName} 파트의 지난 7일간 개인별 업무 기록입니다.\n각 개인이 수행한 업무를 개인별로 정리하여 주간 보고서 형태로 작성해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.`,
    },
    { role: 'user', content: itemsData },
  ], userInfo);

  const byItem = await callLLM([
    {
      role: 'system',
      content: `${ctxLine}다음은 ${partName} 파트의 지난 7일간 업무 기록입니다.\n동일하거나 유사한 업무 항목을 기준으로 정리하여 주간 보고서 형태로 작성해 주세요.\n어떤 인원이 해당 업무에 참여했는지도 명시해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.`,
    },
    { role: 'user', content: itemsData },
  ], userInfo);

  return { byMember, byItem };
}

/**
 * 보고서 생성 - 그룹 보고서
 */
export async function generateGroupReport(
  groupName: string,
  partReportsData: string,
  userInfo: { loginid: string; username: string; deptname: string },
  context?: { partNames?: string; periodStr?: string }
): Promise<{ byMember: string; byItem: string }> {
  if (!partReportsData.trim()) {
    return {
      byMember: '해당 기간 보고할 내용이 없습니다.',
      byItem: '해당 기간 보고할 내용이 없습니다.',
    };
  }

  const ctxLine = context
    ? `당신은 ${groupName} 그룹의 7일간(${context.periodStr}) 주간 보고서를 작성하고 있습니다.\n그룹 소속 파트: ${context.partNames}\n\n절대로 파트간 업무를 비교, 평가하지 마시오. 평가와 비교는 보고서를 읽는 리더가 합니다.\n\n`
    : '';

  const byMember = await callLLM([
    {
      role: 'system',
      content: `${ctxLine}다음은 ${groupName} 그룹 내 각 파트의 주간 업무 정리입니다.\n각 파트의 업무를 파트 단위로 정리해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.`,
    },
    { role: 'user', content: partReportsData },
  ], userInfo);

  const byItem = await callLLM([
    {
      role: 'system',
      content: `${ctxLine}다음은 ${groupName} 그룹 내 각 파트의 주간 업무 정리입니다.\n파트 간 중복/유사 업무를 항목별로 통합 정리해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.`,
    },
    { role: 'user', content: partReportsData },
  ], userInfo);

  return { byMember, byItem };
}

/**
 * 보고서 생성 - 팀 보고서
 */
export async function generateTeamReport(
  teamName: string,
  groupReportsData: string,
  userInfo: { loginid: string; username: string; deptname: string },
  context?: { groupNames?: string; periodStr?: string }
): Promise<{ byMember: string; byItem: string }> {
  if (!groupReportsData.trim()) {
    return {
      byMember: '해당 기간 보고할 내용이 없습니다.',
      byItem: '해당 기간 보고할 내용이 없습니다.',
    };
  }

  const ctxLine = context
    ? `당신은 ${teamName} 팀의 7일간(${context.periodStr}) 주간 보고서를 작성하고 있습니다.\n팀 소속 그룹: ${context.groupNames}\n\n절대로 그룹간 업무를 비교, 평가하지 마시오. 평가와 비교는 보고서를 읽는 리더가 합니다.\n\n`
    : '';

  const byMember = await callLLM([
    {
      role: 'system',
      content: `${ctxLine}다음은 ${teamName} 팀 내 각 그룹의 주간 업무 정리입니다.\n각 그룹의 업무를 그룹 단위로 정리해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.`,
    },
    { role: 'user', content: groupReportsData },
  ], userInfo);

  const byItem = await callLLM([
    {
      role: 'system',
      content: `${ctxLine}다음은 ${teamName} 팀 내 각 그룹의 주간 업무 정리입니다.\n그룹 간 중복/유사 업무를 항목별로 통합 정리해 주세요.\nMarkdown 형식(제목, 볼드, 리스트, 테이블 등)을 활용해 가독성 좋게 작성해 주세요.`,
    },
    { role: 'user', content: groupReportsData },
  ], userInfo);

  return { byMember, byItem };
}
