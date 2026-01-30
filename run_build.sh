#!/bin/bash

PROJECT_DIR="/home/syngha/FREE"
cd "$PROJECT_DIR"

# 시작 step 인자 (기본값: 01)
START_STEP="${1:-01}"

LOG_DIR="$PROJECT_DIR/build_logs"
mkdir -p "$LOG_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SUMMARY_FILE="$LOG_DIR/summary_${TIMESTAMP}.txt"
STATUS_FILE="$PROJECT_DIR/build_logs/STATUS"

TOTAL_STEPS=12
PASSED=0
FAILED=0
FAILED_STEPS=""
PIPELINE_START=$(date +%s)

# ──────────────────────────────────────────────
# Step 정의 (번호 | 설명)
# ──────────────────────────────────────────────
STEP_NAMES=(
    "01|Initial Implementation"
    "02|Requirement Verification (1/5)"
    "03|Requirement Verification (2/5)"
    "04|Requirement Verification (3/5)"
    "05|Requirement Verification (4/5)"
    "06|Requirement Verification (5/5)"
    "07|Quality Verification (1/5)"
    "08|Quality Verification (2/5)"
    "09|Quality Verification (3/5)"
    "10|Quality Verification (4/5)"
    "11|Quality Verification (5/5)"
    "12|Login & LLM Final Verification"
)

# ──────────────────────────────────────────────
# STATUS 파일 실시간 갱신
#   다른 터미널에서: cat ~/FREE/build_logs/STATUS
#   또는:           watch -n1 cat ~/FREE/build_logs/STATUS
# ──────────────────────────────────────────────
update_status() {
    local current_step=$1
    local current_desc=$2
    local current_state=$3  # RUNNING / PASS / FAIL

    local now=$(date +%s)
    local total_elapsed=$(( now - PIPELINE_START ))
    local t_min=$(( total_elapsed / 60 ))
    local t_sec=$(( total_elapsed % 60 ))

    {
        echo "============================================"
        echo "  FREE Build Pipeline - LIVE STATUS"
        echo "  Updated: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "  Elapsed: ${t_min}m ${t_sec}s"
        echo "============================================"
        echo ""
        echo "  Progress: [$PASSED pass / $FAILED fail / $TOTAL_STEPS total]"
        echo ""

        for entry in "${STEP_NAMES[@]}"; do
            local snum="${entry%%|*}"
            local sdesc="${entry#*|}"

            if [ "$snum" = "$current_step" ]; then
                case "$current_state" in
                    RUNNING) echo "  ▶ [$snum] $sdesc  ← RUNNING" ;;
                    PASS)    echo "  ✓ [$snum] $sdesc  ← PASS" ;;
                    FAIL)    echo "  ✗ [$snum] $sdesc  ← FAIL" ;;
                esac
            elif [ "$snum" \< "$current_step" ] || [ "$snum" = "$current_step" ]; then
                # 이전 step: 결과 파일에서 읽기
                local prev_result=$(grep "^\[$snum\]" "$SUMMARY_FILE" 2>/dev/null || echo "")
                if echo "$prev_result" | grep -q "PASS"; then
                    echo "  ✓ [$snum] $sdesc"
                elif echo "$prev_result" | grep -q "FAIL"; then
                    echo "  ✗ [$snum] $sdesc"
                else
                    echo "  · [$snum] $sdesc"
                fi
            else
                echo "  · [$snum] $sdesc"
            fi
        done

        echo ""
        echo "--------------------------------------------"
        echo "  Logs: $LOG_DIR/"
        echo "  Current log: step_${current_step}_${TIMESTAMP}.log"
        echo ""
        echo "  Monitor commands:"
        echo "    cat ~/FREE/build_logs/STATUS"
        echo "    watch -n1 cat ~/FREE/build_logs/STATUS"
        echo "    tail -f $LOG_DIR/step_${current_step}_${TIMESTAMP}.log"
        echo "============================================"
    } > "$STATUS_FILE"
}

# ──────────────────────────────────────────────
# Step 실행 함수
# ──────────────────────────────────────────────
run_step() {
    local step_num=$1
    local description=$2
    local prompt=$3

    # START_STEP보다 이전 step이면 skip
    if [ "$step_num" \< "$START_STEP" ]; then
        echo "  ⏭ Skipping [$step_num] $description (starting from step $START_STEP)"
        return 0
    fi

    local log_file="$LOG_DIR/step_${step_num}_${TIMESTAMP}.log"
    local start_time=$(date +%s)

    echo "============================================"
    echo "[$step_num/$TOTAL_STEPS] $description"
    echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "============================================"

    # STATUS 갱신: RUNNING
    update_status "$step_num" "$description" "RUNNING"

    local MAX_RETRIES=3
    local RETRY_DELAY=30
    local attempt=1
    local exit_code=1

    set +e
    while [ $attempt -le $MAX_RETRIES ]; do
        if [ $attempt -gt 1 ]; then
            echo ""
            echo "  ⟳ Retry $attempt/$MAX_RETRIES (waiting ${RETRY_DELAY}s...)"
            sleep $RETRY_DELAY
        fi

        # 프롬프트를 임시 파일로 저장하여 전달 (긴 프롬프트 안정성)
        local prompt_file=$(mktemp /tmp/claude_prompt_XXXXXX.txt)
        printf '%s' "$prompt" > "$prompt_file"
        claude -p "$(cat "$prompt_file")" \
            --dangerously-skip-permissions \
            --model opus \
            2>&1 | tee "$log_file"
        exit_code=${PIPESTATUS[0]}
        rm -f "$prompt_file"

        # 성공이면 루프 탈출
        if [ $exit_code -eq 0 ]; then
            break
        fi

        # "No messages returned" 에러인지 확인
        if grep -q "No messages returned" "$log_file" 2>/dev/null; then
            echo "  ⚠ 'No messages returned' error detected (attempt $attempt/$MAX_RETRIES)"
            attempt=$((attempt + 1))
            continue
        fi

        # 다른 에러면 재시도하지 않음
        break
    done
    set -e

    local end_time=$(date +%s)
    local elapsed=$(( end_time - start_time ))
    local minutes=$(( elapsed / 60 ))
    local seconds=$(( elapsed % 60 ))

    if [ $exit_code -eq 0 ]; then
        PASSED=$((PASSED + 1))
        local status="PASS"
    else
        FAILED=$((FAILED + 1))
        FAILED_STEPS="${FAILED_STEPS}  - Step ${step_num}: ${description}\n"
        local status="FAIL (exit: $exit_code)"
    fi

    echo ""
    echo "  Status: $status"
    echo "  Elapsed: ${minutes}m ${seconds}s"
    echo "  Log: $log_file"
    echo ""

    echo "[$step_num] $description | $status | ${minutes}m ${seconds}s" >> "$SUMMARY_FILE"

    # STATUS 갱신: 결과
    update_status "$step_num" "$description" "$([ $exit_code -eq 0 ] && echo PASS || echo FAIL)"
}

# ──────────────────────────────────────────────
# Pipeline Start
# ──────────────────────────────────────────────
echo "============================================" | tee "$SUMMARY_FILE"
echo "  FREE Build Pipeline Started (from step $START_STEP)" | tee -a "$SUMMARY_FILE"
echo "  $(date '+%Y-%m-%d %H:%M:%S')" | tee -a "$SUMMARY_FILE"
echo "============================================" | tee -a "$SUMMARY_FILE"
echo "" | tee -a "$SUMMARY_FILE"
echo ""
echo "  시작 Step: $START_STEP"
echo "  실시간 모니터링:"
echo "    cat ~/FREE/build_logs/STATUS"
echo "    watch -n1 cat ~/FREE/build_logs/STATUS"
echo ""

# ──────────────────────────────────────────────
# Step 01: 초기 구현
# ──────────────────────────────────────────────
run_step "01" "Initial Implementation" \
"이 프로젝트 디렉토리의 requirements.md를 처음부터 끝까지 자세히 읽고, 모든 요구사항을 빠짐없이 제대로 구현해줘.
~/ONCE 소스코드를 참조하여 SSO 로그인, LLM 호출, Rating, Model Sync 등의 구현을 동일하게 가져올 것.
Docker Compose 기반 컨테이너 구성(frontend:15001, api:15002, db:15003, redis:15004, worker:15005)까지 모두 포함.
프론트엔드는 React+TypeScript+Vite+TailwindCSS, 백엔드는 Node.js+Express+TypeScript+Prisma 스택으로 구현할 것."

# ──────────────────────────────────────────────
# Step 02~06: 요구사항 검증 반복 (5회)
# ──────────────────────────────────────────────
for i in $(seq 1 5); do
    step_num=$(printf "%02d" $((i + 1)))
    run_step "$step_num" "Requirement Verification ($i/5)" \
"이 코드베이스가 requirements.md의 모든 요구사항을 제대로 구현했는지 꼼꼼히 확인하고 보완해줘.
체크리스트:
- SSO 로그인 flow (~/ONCE 참조 구현)
- 최초 로그인 onboarding (그룹/파트 선택/등록, LLM 정규화)
- Item 입력/분리(LLM)/수정/삭제/링크
- 개인/파트/그룹/팀 Space 계층 구조 및 데이터 반영
- 0시 보고서 자동 생성 (팀 간 병렬, 팀 내 순차, LLM 2회 요청)
- Retry 정책 (10초x5 → 10분 대기 → 10초x5 → 중단 기록)
- 계속해서 생성하기 버튼
- docx/xlsx 내보내기
- Super Admin (LLM model sync, 권한관리)
- Team Admin (사용자 목록, 보고서 로그)
- 프로필/활동로그/그룹파트 변경
- 팀 공지
- Rating (매 20요청마다 1~5점)
- 날짜 범위 제한 (29일 전~오늘, 미래 불가)
- 30일 경과 item 삭제, 7일 경과 보고서 삭제
- 빈 그룹/파트 자동 삭제
- 팀 간 데이터 격리
누락되거나 불완전한 부분이 있으면 즉시 수정/추가 구현할 것."
done

# ──────────────────────────────────────────────
# Step 07~11: 품질 검증 반복 (5회)
# ──────────────────────────────────────────────
for i in $(seq 1 5); do
    step_num=$(printf "%02d" $((i + 6)))
    run_step "$step_num" "Quality Verification ($i/5)" \
"requirements.md 기준으로 이 코드베이스를 다음 관점에서 검증하고 보완해줘:

1. 요구사항 완전성: requirements.md의 모든 기능이 빠짐없이 구현되었는지 코드 레벨에서 확인
2. 잠재 버그: race condition, null 처리, edge case, 에러 핸들링, 타입 안전성 등 점검
3. 디자인 품질: 엔터프라이즈급 UI/UX인지 확인
   - 일관된 컬러 팔레트, 타이포그래피, spacing
   - 로딩/에러/빈 상태(empty state) 처리
   - FREE 브랜딩 (로그인 페이지 로고, 상단 네비게이션)
   - 사이드바 트리 네비게이션
   - 반응형 레이아웃 (Desktop 기준)
   - 접근성 (키보드 네비, aria label)
4. 보안: 팀 간 데이터 격리, JWT 검증, 권한 체크, XSS/Injection 방지

문제가 발견되면 즉시 수정할 것."
done

# ──────────────────────────────────────────────
# Step 12: 로그인/LLM 최종 검증
# ──────────────────────────────────────────────
run_step "12" "Login & LLM Final Verification" \
"이 코드베이스의 로그인 및 LLM 관련 API가 완전하게 구현되었는지 최종 확인하고 보완해줘.

로그인 관련:
- ~/ONCE의 SSO 로그인 flow를 그대로 가져왔는지 코드 비교 확인
- SSO 콜백 data 파싱, 토큰 생성(sso.{base64}), /auth/login POST
- Backend: 토큰 검증 미들웨어 3단계 (내부 JWT → SSO 토큰 → fallback JWT)
- deptname에서 businessUnit/teamName 추출 regex
- User upsert, Space 자동 생성, Team/TeamMember 처리
- JWT(24h) 발급/갱신/검증
- 401/403 시 자동 로그아웃 → 리다이렉트

LLM 관련:
- ~/ONCE의 LLM 호출 로직(endpoint, Header, 요청형식) 그대로 가져왔는지 코드 비교 확인
- v1/models endpoint 호출로 model list sync (~/ONCE 참조)
- Item 분리 LLM 요청 (사용자 컨텍스트 포함 프롬프트)
- 그룹/파트 이름 정규화 LLM 요청
- 보고서 생성 LLM 요청 (개인별/파트별/그룹별 + Item별, 총 2회)
- Rating 제출 API (~/ONCE 참조, 매 20요청마다)
- LLM 에러 retry 정책 구현 확인
- 전역 1개 model 활성화 정책

누락되거나 ~/ONCE와 다르게 구현된 부분이 있으면 즉시 수정할 것."

# ──────────────────────────────────────────────
# Final Summary
# ──────────────────────────────────────────────
PIPELINE_END=$(date +%s)
TOTAL_ELAPSED=$(( PIPELINE_END - PIPELINE_START ))
TOTAL_MIN=$(( TOTAL_ELAPSED / 60 ))
TOTAL_SEC=$(( TOTAL_ELAPSED % 60 ))

{
    echo ""
    echo "============================================"
    echo "  ALL STEPS COMPLETED"
    echo "  $(date '+%Y-%m-%d %H:%M:%S')"
    echo "  Total elapsed: ${TOTAL_MIN}m ${TOTAL_SEC}s"
    echo "  Passed: $PASSED / $TOTAL_STEPS"
    echo "  Failed: $FAILED / $TOTAL_STEPS"
    if [ -n "$FAILED_STEPS" ]; then
        echo ""
        echo "  Failed steps:"
        echo -e "$FAILED_STEPS"
    fi
    echo "  Logs: $LOG_DIR/"
    echo "  Summary: $SUMMARY_FILE"
    echo "============================================"
} | tee -a "$SUMMARY_FILE"

# STATUS 파일 최종 갱신
{
    echo "============================================"
    echo "  FREE Build Pipeline - DONE"
    echo "  $(date '+%Y-%m-%d %H:%M:%S')"
    echo "  Total elapsed: ${TOTAL_MIN}m ${TOTAL_SEC}s"
    echo "============================================"
    echo ""
    echo "  Result: $PASSED pass / $FAILED fail / $TOTAL_STEPS total"
    echo ""
    for entry in "${STEP_NAMES[@]}"; do
        local_snum="${entry%%|*}"
        local_sdesc="${entry#*|}"
        local_result=$(grep "^\[$local_snum\]" "$SUMMARY_FILE" 2>/dev/null || echo "")
        if echo "$local_result" | grep -q "PASS"; then
            echo "  ✓ [$local_snum] $local_sdesc"
        elif echo "$local_result" | grep -q "FAIL"; then
            echo "  ✗ [$local_snum] $local_sdesc"
        else
            echo "  ? [$local_snum] $local_sdesc"
        fi
    done
    echo ""
    echo "  Summary: $SUMMARY_FILE"
    echo "============================================"
} > "$STATUS_FILE"
