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

  const config = await getActiveLLMConfig();

  let endpoint: string;
  let apiKey: string;
  let modelId: string;

  if (config) {
    endpoint = config.endpoint;
    apiKey = decrypt(config.apiKey);
    modelId = config.modelId;
  } else if (LLM_PROXY_URL) {
    endpoint = LLM_PROXY_URL.replace(/\/chat\/completions$/, '');
    apiKey = '';
    modelId = 'default';
  } else {
    throw new Error('No LLM configuration available');
  }

  const chatUrl = endpoint.endsWith('/chat/completions')
    ? endpoint
    : `${endpoint}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Service-Id': LLM_SERVICE_ID,
    'X-User-Id': encodeURIComponent(userInfo.loginid),
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
 * LLM으로 Item 분리/정리
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
    'X-User-Id': encodeURIComponent(userInfo.loginid),
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
      'X-User-Id': encodeURIComponent(userInfo.loginid),
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
