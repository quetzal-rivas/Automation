#!/usr/bin/env bash
# =============================================================================
# Voice Agent Hub — Debug & Status Script
# Fetches logs, DynamoDB state, and Lambda invocation results
# Usage: ./aws/debug.sh [agent_id] [since_minutes]
# =============================================================================

AGENT_ID="${1:-vscode-macbook-pro}"
SINCE_MINUTES="${2:-60}"
REGION="us-east-2"
TABLE="agent-directive-hub"
BEARER_TOKEN="${BEARER_TOKEN:-123456789}"
API_URL="https://mrdbw1d3e9.execute-api.us-east-2.amazonaws.com/prod"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

sep() { echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

header() { sep; echo -e "${BOLD}${YELLOW}▶ $1${NC}"; }

echo -e "\n${BOLD}🔍 Voice Agent Hub — Diagnostic Report${NC}"
echo -e "   Agent ID : ${CYAN}$AGENT_ID${NC}"
echo -e "   Region   : ${CYAN}$REGION${NC}"
echo -e "   API URL  : ${CYAN}$API_URL${NC}"

# ── 1. API Health Check ──────────────────────────────────────────────────────
header "1. API Endpoint Health Check"
echo "Testing GET /get-directive for agent: $AGENT_ID"
RESPONSE=$(curl -s -w "\n__STATUS__%{http_code}" \
  "$API_URL/get-directive?agent_id=$AGENT_ID" \
  -H "Authorization: Bearer $BEARER_TOKEN")

HTTP_STATUS=$(echo "$RESPONSE" | grep "__STATUS__" | sed 's/__STATUS__//')
BODY=$(echo "$RESPONSE" | sed '/__STATUS__/d')

if [ "$HTTP_STATUS" = "200" ]; then
  echo -e "${GREEN}✓ API reachable (HTTP $HTTP_STATUS)${NC}"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
else
  echo -e "${RED}✗ API returned HTTP $HTTP_STATUS${NC}"
  echo "$BODY"
fi

# ── 2. DynamoDB — Latest Records ─────────────────────────────────────────────
header "2. DynamoDB — Detecting Active Table"
# Find the correct table — could be with or without the stack suffix
ALL_TABLES=$(aws dynamodb list-tables --region "$REGION" --query "TableNames" --output text 2>&1)
echo "All tables in $REGION:"
echo "$ALL_TABLES" | tr '\t' '\n' | sed 's/^/  • /'

# Try to find the directive hub table
TABLE=$(echo "$ALL_TABLES" | tr '\t' '\n' | grep -i "agent-directive-hub" | head -1)
if [ -z "$TABLE" ]; then
  TABLE="agent-directive-hub"
  echo -e "${YELLOW}  ⚠ No agent-directive-hub table found — using default: $TABLE${NC}"
else
  echo -e "${GREEN}  ✓ Found table: $TABLE${NC}"
fi

# ── 3. DynamoDB — Latest Records ─────────────────────────────────────────────
header "3. DynamoDB — Latest Sessions for '$AGENT_ID'"
aws dynamodb query \
  --region "$REGION" \
  --table-name "$TABLE" \
  --key-condition-expression "agent_id = :a" \
  --expression-attribute-values "{\":a\":{\"S\":\"$AGENT_ID\"}}" \
  --scan-index-forward false \
  --limit 5 \
  --output json 2>&1 | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    items = data.get('Items', [])
    if not items:
        print('  No records found for this agent')
    for item in items:
        print(f\"  session: {item.get('session_id',{}).get('S','?')[:12]}...  status: {item.get('status',{}).get('S','?')}  summary: {item.get('summary',{}).get('S','?')[:50]}\")
except Exception as e:
    print(sys.stdin.read())
    print(f'Parse error: {e}')
" 2>/dev/null || echo -e "${RED}  Could not query DynamoDB${NC}"

header "3b. DynamoDB — All Recent Activity (any agent)"
aws dynamodb scan \
  --region "$REGION" \
  --table-name "$TABLE" \
  --limit 10 \
  --output json 2>&1 | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    items = data.get('Items', [])
    if not items:
        print('  Table is empty')
    for item in items:
        agent = item.get('agent_id',{}).get('S','?')
        status = item.get('status',{}).get('S','?')
        session = item.get('session_id',{}).get('S','?')[:12]
        summary = item.get('summary',{}).get('S','?')[:40]
        print(f'  agent={agent}  status={status}  session={session}...  summary={summary}')
except Exception as e:
    print(f'  Error: {e}')
" 2>/dev/null || echo -e "${RED}  Could not scan DynamoDB${NC}"

# ── 4. Lambda — Direct Invocation Test ───────────────────────────────────────
header "4. Lambda — Direct Invocation Test (trigger-call)"
echo "Directly invoking Lambda with test payload..."
INVOKE_RESULT=$(aws lambda invoke \
  --region "$REGION" \
  --function-name "agent-directive-trigger-call" \
  --payload '{"agent_id":"debug-test","summary":"Debug invocation test — checking ElevenLabs connectivity"}' \
  --cli-binary-format raw-in-base64-out \
  --log-type Tail \
  /tmp/lambda-response.json 2>&1)

if echo "$INVOKE_RESULT" | grep -q "LogResult"; then
  echo -e "${GREEN}✓ Lambda reachable${NC}"
  echo ""
  echo "--- Response Body ---"
  cat /tmp/lambda-response.json | python3 -m json.tool 2>/dev/null || cat /tmp/lambda-response.json
  echo ""
  echo "--- Execution Log (last 4KB, base64 decoded) ---"
  echo "$INVOKE_RESULT" | python3 -c "
import sys, json, base64
data = json.load(sys.stdin)
log = data.get('LogResult', '')
if log:
    print(base64.b64decode(log).decode('utf-8'))
else:
    print('No log returned')
" 2>/dev/null
else
  echo -e "${RED}✗ Lambda invocation failed${NC}"
  echo "$INVOKE_RESULT"
fi

# ── 5. CloudWatch Logs (if available) ────────────────────────────────────────
header "5. CloudWatch Logs — Last ${SINCE_MINUTES}m"
LOG_GROUP="/aws/lambda/agent-directive-trigger-call"
echo "Checking log group: $LOG_GROUP"
aws logs tail "$LOG_GROUP" \
  --region "$REGION" \
  --since "${SINCE_MINUTES}m" \
  --format short 2>&1 || echo -e "${YELLOW}  ℹ No log group found (Lambda may not have logged yet)${NC}"

# ── 6. Lambda — Environment Check ────────────────────────────────────────────
header "6. Lambda — Environment Variable Audit"
echo "Checking trigger-call function config..."
aws lambda get-function-configuration \
  --region "$REGION" \
  --function-name "agent-directive-trigger-call" \
  --query "{Runtime:Runtime, Role:Role, EnvKeys:join(',', keys(Environment.Variables || `{}`))}" \
  --output table 2>&1 || echo -e "${RED}  Could not get function config${NC}"

# ── Summary ───────────────────────────────────────────────────────────────────
sep
echo -e "\n${BOLD}📋 Quick Reference${NC}"
echo -e "  Trigger call  : ${CYAN}Ctrl+Alt+D${NC} (VS Code task)"
echo -e "  Manual curl   : ${CYAN}curl -X POST $API_URL/trigger-call -H 'Authorization: Bearer $BEARER_TOKEN' -d '{\"agent_id\":\"$AGENT_ID\",\"summary\":\"test\"}'${NC}"
echo -e "  Check status  : ${CYAN}curl '$API_URL/get-directive?agent_id=$AGENT_ID' -H 'Authorization: Bearer $BEARER_TOKEN'${NC}"
echo -e "  DynamoDB table: ${CYAN}$TABLE${NC} in $REGION"
echo ""
