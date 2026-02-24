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
 * LLM Chat Completions 호출
 * operation이 지정되면 LLMOperationConfig 테이블에서 해당 모델 조회
 */
export async function callLLM(
  messages: LLMMessage[],
  userInfo: { loginid: string; username: string; deptname: string },
  operation?: string
): Promise<string> {
  if (!userInfo || !userInfo.loginid) {
    throw new Error('userInfo is required for LLM calls');
  }

  // operation별 모델 설정 조회
  let operationModelId: string | null = null;
  if (operation) {
    try {
      const opConfig = await prisma.lLMOperationConfig.findUnique({ where: { operation } });
      if (opConfig) operationModelId = opConfig.modelId;
    } catch { /* table might not exist yet */ }
  }

  const dynamicModel = await fetchFirstAvailableModel(userInfo);
  const config = await getActiveLLMConfig();

  let chatUrl: string;
  let apiKey: string;
  let modelId: string;

  // 모델 우선순위: operation 설정 > 동적 모델 > DB config > default
  if (operationModelId) {
    modelId = operationModelId;
  } else if (dynamicModel) {
    modelId = dynamicModel;
  } else if (config?.modelId) {
    modelId = config.modelId;
  } else {
    modelId = 'default';
  }

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
    'X-User-Id': userInfo.loginid,
    'X-User-Name': encodeURIComponent(userInfo.username),
    'X-User-Dept': encodeURIComponent(userInfo.deptname),
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  console.log('[LLM] Request:', {
    url: chatUrl, model: modelId, operation: operation || 'default',
    serviceId: LLM_SERVICE_ID, userId: userInfo.loginid,
  });

  const response = await fetch(chatUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: modelId, messages, temperature: 0.3 }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[LLM] Error:', { status: response.status, error: errorText, url: chatUrl, model: modelId });
    throw new Error(`LLM API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as LLMResponse;
  console.log('[LLM] Success:', { model: modelId, userId: userInfo.loginid });
  return data.choices[0]?.message?.content || '';
}

/**
 * LLM으로 텍스트 → WorkLog + Todo 동시 분리
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
- 여러 목표와 관련될 수 있으면 가장 관련도 높은 하나만 선택합니다${partItemsStr}${existingTodosStr}${preferencesPrompt}

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
    userInfo,
    'PARSE_TEXT'
  );

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('LLM did not return valid JSON');

  const parsed = JSON.parse(jsonMatch[0]);

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

  const toneMap: Record<string, string> = { formal: '격식체로 작성', concise: '간결하게 작성' };
  const toneInstruction = prefs.tone ? (toneMap[prefs.tone] || prefs.tone) : '';
  const languageInstruction = prefs.language === 'english' ? '모든 업무 항목을 영어로 작성해 주세요.' : '';
  const emphasisInstruction = prefs.emphasis ? `다음 내용을 특히 강조해서 작성해 주세요: ${prefs.emphasis}` : '';
  const customInstruction = prefs.customInstructions || '';

  const preferencesSection = [toneInstruction, languageInstruction, emphasisInstruction, customInstruction].filter(Boolean).join('\n- ');
  const preferencesPrompt = preferencesSection ? `\n\n## 사용자 선호 설정\n위 설정을 반영하여 업무 항목을 작성해 주세요:\n- ${preferencesSection}` : '';

  const systemPrompt = `당신은 업무 보고 도우미입니다.

## 사용자 정보
- 이름: ${userContext.username}
- 사업부: ${userContext.businessUnit}
- 팀: ${userContext.teamName}
- 그룹: ${userContext.groupName}
- 파트: ${userContext.partName}
- 오늘 날짜: ${userContext.today}

## 작업
아래 텍스트에서 **위 사용자 본인이 수행한 일/성과** 를 중심으로 개별 업무 항목(item)을 분리해 주세요.

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
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userInput }],
    userInfo,
    'PARSE_TEXT'
  );

  const jsonMatch = result.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error('LLM did not return valid JSON array');

  const items = JSON.parse(jsonMatch[0]);

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
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userInput }],
    userInfo
  );

  return result.trim();
}

/**
 * Model list 동기화
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
    'X-User-Id': userInfo.loginid,
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
 * LLM으로 조직장 Item 입력 → 목표 분리+매핑
 */
export async function parseGoalsWithLLM(
  text: string,
  context: {
    level: string;
    existingItems: Array<{ id: string; title: string }>;
    parentItems: Array<{ id: string; title: string }>;
  },
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<Array<{
  title: string;
  content: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  parentTitle: string | null;
}>> {
  const existingItemsStr = context.existingItems.length
    ? `\n\n## 기존 목표 (중복 방지)\n${context.existingItems.map(i => `- "${i.title}"`).join('\n')}`
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
3. 상위 목표가 있으면 가장 관련도 높은 상위 목표 title을 parentTitle에 매핑합니다
4. status는 PLANNED/IN_PROGRESS/COMPLETED 중 하나 (기본: PLANNED)
5. 날짜가 명시되지 않으면 null

### 상위 목표 매핑 (필수)
- GROUP/PART 레벨에서 상위 목표가 1개 이상 존재하면 **반드시** 하나의 상위 목표에 매핑
- 어떤 상위 목표와도 관련이 없으면 가장 포괄적인 상위 목표를 선택
- parentTitle이 null인 것은 TEAM 레벨이거나 상위 목표가 0개일 때만 허용

### parentTitle 매핑 규칙
- parentTitle은 상위 목표 목록에 있는 **정확한 title 문자열을 그대로 복사**합니다
- 부분 일치나 의역은 허용되지 않습니다
- 정확히 일치하는 상위 목표가 없으면 null${existingItemsStr}${parentItemsStr}

다음 JSON 배열 형식으로 출력하세요:
[
  {
    "title": "목표 제목",
    "content": "목표 상세 설명",
    "status": "PLANNED",
    "startDate": "YYYY-MM-DD 또는 null",
    "endDate": "YYYY-MM-DD 또는 null",
    "parentTitle": "상위 목표 title 또는 null"
  }
]

반드시 유효한 JSON 배열만 출력하세요.`;

  const result = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
    userInfo,
    'PARSE_GOALS'
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
    parentTitle: g.parentTitle || null,
  }));
}

/**
 * 새 목표의 하위 미매핑 Item 자동 연결
 */
export async function autoMapNewGoal(
  newItem: { id: string; title: string; content: string; level: string },
  unmappedChildItems: Array<{ id: string; title: string }>,
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<{ childItemIds: string[] }> {
  if (unmappedChildItems.length === 0) return { childItemIds: [] };

  const systemPrompt = `당신은 조직 목표 매핑 도우미입니다.

## 새로 생성된 상위 목표
- 제목: ${newItem.title}
- 설명: ${newItem.content}

## 미매핑 하위 목표 목록
${unmappedChildItems.map(c => `- id: "${c.id}", title: "${c.title}"`).join('\n')}

## 작업
위 상위 목표와 관련된 하위 목표를 선택해 주세요.
- 관련도가 높은 항목만 선택합니다
- 확신이 50% 미만인 항목은 제외합니다
- id는 목록에 있는 정확한 값만 사용합니다

다음 JSON 형식으로 출력하세요:
{ "childItemIds": ["id1", "id2"] }

관련 항목이 없으면: { "childItemIds": [] }

반드시 유효한 JSON만 출력하세요.`;

  const result = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: '매핑 분석 요청' }],
    userInfo,
    'AUTO_MAP'
  );

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { childItemIds: [] };

  const parsed = JSON.parse(jsonMatch[0]);
  const validIds = new Set(unmappedChildItems.map(c => c.id));
  const childItemIds = (parsed.childItemIds || []).filter((id: string) => validIds.has(id));

  return { childItemIds };
}

/**
 * PART 목표에 미매핑 Todo/WorkLog 자동 연결
 */
export async function autoMapTodosAndWorkLogs(
  partItem: { id: string; title: string; content: string },
  unmappedTodos: Array<{ id: string; title: string }>,
  unmappedWorkLogs: Array<{ id: string; title: string }>,
  userInfo: { loginid: string; username: string; deptname: string }
): Promise<{ todoIds: string[]; workLogIds: string[] }> {
  if (unmappedTodos.length === 0 && unmappedWorkLogs.length === 0) {
    return { todoIds: [], workLogIds: [] };
  }

  const todosStr = unmappedTodos.length > 0
    ? `\n## 미매핑 할일\n${unmappedTodos.map(t => `- id: "${t.id}", title: "${t.title}"`).join('\n')}`
    : '';
  const workLogsStr = unmappedWorkLogs.length > 0
    ? `\n## 미매핑 업무기록\n${unmappedWorkLogs.map(w => `- id: "${w.id}", title: "${w.title}"`).join('\n')}`
    : '';

  const systemPrompt = `당신은 업무-목표 매핑 도우미입니다.

## 파트 목표
- 제목: ${partItem.title}
- 설명: ${partItem.content}
${todosStr}${workLogsStr}

## 작업
위 파트 목표와 직접 관련된 할일/업무기록을 선택해 주세요.
- 핵심 활동과 직접 관련된 항목만 선택
- 간접적 관련(회의, 세미나 등)은 제외
- 확신이 50% 미만이면 제외

다음 JSON 형식으로 출력하세요:
{ "todoIds": ["id1"], "workLogIds": ["id1", "id2"] }

반드시 유효한 JSON만 출력하세요.`;

  const result = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: '매핑 분석 요청' }],
    userInfo,
    'AUTO_MAP'
  );

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { todoIds: [], workLogIds: [] };

  const parsed = JSON.parse(jsonMatch[0]);
  const validTodoIds = new Set(unmappedTodos.map(t => t.id));
  const validWorkLogIds = new Set(unmappedWorkLogs.map(w => w.id));

  return {
    todoIds: (parsed.todoIds || []).filter((id: string) => validTodoIds.has(id)),
    workLogIds: (parsed.workLogIds || []).filter((id: string) => validWorkLogIds.has(id)),
  };
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
- 간접적 관련성은 null
- 확신이 70% 미만이면 null

다음 JSON 형식으로 출력하세요:
{ "linkedItemId": "목표ID 또는 null" }

반드시 유효한 JSON만 출력하세요.`;

  const userContent = `할일: "${todoTitle}"${endDate ? `, 마감일: ${endDate}` : ''}`;

  const result = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
    userInfo,
    'LINK_TODO'
  );

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { linkedItemId: null };

  const parsed = JSON.parse(jsonMatch[0]);
  const linkedId = parsed.linkedItemId || null;

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
아래 하위 데이터를 분석하여 이 목표의 진행률과 진척사항을 판단해 주세요.

## 분석 기준
- 하위 목표가 있으면: 하위 목표들의 상태 가중 평균
- 연결된 할일이 있으면: 완료된 할일 비율 참고
- 연결된 업무 기록이 있으면: 활동 빈도를 정성적으로 반영
- progress는 5 단위로 반올림
- summary는 구체적 수치 포함

다음 JSON 형식으로 출력하세요:
{ "progress": 0~100, "summary": "진척사항 1-2문장" }

반드시 유효한 JSON만 출력하세요.`;

  const result = await callLLM(
    [{ role: 'system', content: systemPrompt }, { role: 'user', content: childData }],
    userInfo,
    'UPDATE_PROGRESS'
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
 * Rating 제출
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
      'X-User-Id': userInfo.loginid,
      'X-User-Name': encodeURIComponent(userInfo.username),
      'X-User-Dept': encodeURIComponent(userInfo.deptname),
    },
    body: JSON.stringify({ modelName, rating, serviceId: LLM_SERVICE_ID }),
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
    return { byMember: '해당 기간 보고할 내용이 없습니다.', byItem: '해당 기간 보고할 내용이 없습니다.' };
  }

  const ctxLine = context
    ? `당신은 ${partName} 파트의 7일간(${context.periodStr}) 주간 보고서를 작성하고 있습니다.\n파트 구성원: ${context.memberNames}\n\n절대로 파트원간 업무를 비교, 평가하지 마시오. 평가와 비교는 보고서를 읽는 리더가 합니다.\n\n`
    : '';

  const byMember = await callLLM([
    { role: 'system', content: `${ctxLine}다음은 ${partName} 파트의 지난 7일간 개인별 업무 기록입니다.\n각 개인이 수행한 업무를 개인별로 정리하여 주간 보고서 형태로 작성해 주세요.\nMarkdown 형식을 활용해 가독성 좋게 작성해 주세요.` },
    { role: 'user', content: itemsData },
  ], userInfo, 'REPORT');

  const byItem = await callLLM([
    { role: 'system', content: `${ctxLine}다음은 ${partName} 파트의 지난 7일간 업무 기록입니다.\n동일하거나 유사한 업무 항목을 기준으로 정리하여 주간 보고서 형태로 작성해 주세요.\n어떤 인원이 해당 업무에 참여했는지도 명시해 주세요.\nMarkdown 형식을 활용해 가독성 좋게 작성해 주세요.` },
    { role: 'user', content: itemsData },
  ], userInfo, 'REPORT');

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
    return { byMember: '해당 기간 보고할 내용이 없습니다.', byItem: '해당 기간 보고할 내용이 없습니다.' };
  }

  const ctxLine = context
    ? `당신은 ${groupName} 그룹의 7일간(${context.periodStr}) 주간 보고서를 작성하고 있습니다.\n그룹 소속 파트: ${context.partNames}\n\n절대로 파트간 업무를 비교, 평가하지 마시오.\n\n`
    : '';

  const byMember = await callLLM([
    { role: 'system', content: `${ctxLine}다음은 ${groupName} 그룹 내 각 파트의 주간 업무 정리입니다.\n각 파트의 업무를 파트 단위로 정리해 주세요.\nMarkdown 형식을 활용해 가독성 좋게 작성해 주세요.` },
    { role: 'user', content: partReportsData },
  ], userInfo, 'REPORT');

  const byItem = await callLLM([
    { role: 'system', content: `${ctxLine}다음은 ${groupName} 그룹 내 각 파트의 주간 업무 정리입니다.\n파트 간 중복/유사 업무를 항목별로 통합 정리해 주세요.\nMarkdown 형식을 활용해 가독성 좋게 작성해 주세요.` },
    { role: 'user', content: partReportsData },
  ], userInfo, 'REPORT');

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
    return { byMember: '해당 기간 보고할 내용이 없습니다.', byItem: '해당 기간 보고할 내용이 없습니다.' };
  }

  const ctxLine = context
    ? `당신은 ${teamName} 팀의 7일간(${context.periodStr}) 주간 보고서를 작성하고 있습니다.\n팀 소속 그룹: ${context.groupNames}\n\n절대로 그룹간 업무를 비교, 평가하지 마시오.\n\n`
    : '';

  const byMember = await callLLM([
    { role: 'system', content: `${ctxLine}다음은 ${teamName} 팀 내 각 그룹의 주간 업무 정리입니다.\n각 그룹의 업무를 그룹 단위로 정리해 주세요.\nMarkdown 형식을 활용해 가독성 좋게 작성해 주세요.` },
    { role: 'user', content: groupReportsData },
  ], userInfo, 'REPORT');

  const byItem = await callLLM([
    { role: 'system', content: `${ctxLine}다음은 ${teamName} 팀 내 각 그룹의 주간 업무 정리입니다.\n그룹 간 중복/유사 업무를 항목별로 통합 정리해 주세요.\nMarkdown 형식을 활용해 가독성 좋게 작성해 주세요.` },
    { role: 'user', content: groupReportsData },
  ], userInfo, 'REPORT');

  return { byMember, byItem };
}
