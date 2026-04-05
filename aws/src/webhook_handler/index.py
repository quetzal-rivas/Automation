import json
import boto3
import os
import re
import uuid
from datetime import datetime, timezone, timedelta

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE', 'agent-directive-hub'))
events_client = boto3.client('events')
lambda_client = boto3.client('lambda')


import hmac
import hashlib

def lambda_handler(event, context):
    try:
        headers = {k.lower(): v for k, v in event.get('headers', {}).items()}
        body_raw = event.get('body', '')
        body = json.loads(body_raw) if body_raw else {}
        query_params = event.get('queryStringParameters', {}) or {}
        
        # --- Dual Security Check ---
        auth_header = headers.get('authorization', '').replace('Bearer ', '').strip()
        expected_token = os.environ.get('API_BEARER_TOKEN', '').strip()
        
        # 2. Check ElevenLabs HMAC Signature (for Post-call)
        signature = headers.get('x-elevenlabs-signature-signature') or headers.get('elevenlabs-signature')
        is_hmac_valid = False
        if signature:
            is_hmac_valid = verify_elevenlabs_signature(headers, body_raw)
            
        # Authenticated if either static token matches or HMAC signature matches
        authenticated = (auth_header == expected_token) or is_hmac_valid
        
        if not authenticated:
            return {'statusCode': 401, 'body': json.dumps({'error': 'Unauthorized'})}

        # --- Event Dispatching ---
        event_type = body.get('type')
        
        # Determine if this is an initiation request even if 'type' is missing
        is_initiation = (event_type == "conversation_initiation_client_data") or \
                        (not event_type and 'conversation_id' in body and 'agent_id' in body)
        
        if is_initiation:
            return handle_initiation(query_params, body)
            
        # Handle POST-CALL TRANSCRIPTION
        if event_type == "post_call_transcription":
            return handle_post_call(body)

        # Handle DIRECT TOOL CALLS
        agent_id = query_params.get('agent_id') or body.get('agent_id')
        session_id = query_params.get('session_id') or body.get('session_id')

        if not agent_id or not session_id:
            if event_type: # Ignore other lifecycle events we don't need
                return {'statusCode': 200, 'body': json.dumps({'status': 'ignored'})}
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'agent_id and session_id required'})
            }

        return process_tool_call(agent_id, session_id, body)

    except Exception as e:
        print(f"Error: {str(e)}")
        return {'statusCode': 500, 'body': json.dumps({'error': 'Internal error'})}

def verify_elevenlabs_signature(headers, body_raw):
    """
    Verify ElevenLabs HMAC signature using the shared secret.
    Expected headers: x-elevenlabs-signature-timestamp and x-elevenlabs-signature-signature
    """
    secret = os.environ.get('ELEVENLABS_WEBHOOK_SECRET')
    if not secret:
        print("[Auth] Missing ELEVENLABS_WEBHOOK_SECRET env var.")
        return False
        
    timestamp = headers.get('x-elevenlabs-signature-timestamp')
    signature = headers.get('x-elevenlabs-signature-signature')
    
    if not timestamp or not signature:
        return False
        
    # Signature = hmac_sha256(secret, timestamp + body)
    message = timestamp + body_raw
    expected_sig = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    
    return hmac.compare_digest(expected_sig, signature)

def handle_initiation(query_params, body):
    """Responds to conversation initiation with our local session variables."""
    agent_id = query_params.get('agent_id') or body.get('agent_id', 'unknown')
    session_id = query_params.get('session_id') or body.get('session_id', 'unknown')
    
    print(f"[Webhook] INITIATION for {agent_id}/{session_id}")
    
    # ElevenLabs contract requires 'dynamic_variables' for injection
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({
            "dynamic_variables": {
                "agent_id": agent_id,
                "session_id": session_id
            }
        })
    }


def handle_post_call(body):
    """
    Called by ElevenLabs AFTER the call ends with full transcripts and analysis.
    """
    data = body.get('data', {})
    conv_id = data.get('conversation_id')
    transcript_obj = data.get('transcript', [])
    analysis = data.get('analysis', {})
    
    # Reconstruct transcript as text
    full_text = "\n".join([f"{t['role'].upper()}: {t['message']}" for t in transcript_obj])
    summary = analysis.get('summary', 'No summary available.')
    
    # ElevenLabs lifecycle events don't send our custom agent_id/session_id in the root,
    # BUT they are available in the 'dynamic_variables' if we sent them, or here:
    custom_vars = data.get('config_overrides', {}).get('agent', {}).get('prompt', {}).get('dynamic_variables', {})
    agent_id = custom_vars.get('agent_id')
    session_id = custom_vars.get('session_id')

    print(f"[Webhook] POST-CALL for session={session_id} conv={conv_id}")

    if agent_id and session_id:
        table.update_item(
            Key={'agent_id': agent_id, 'session_id': session_id},
            UpdateExpression='SET #status = :status, transcript = :text, ai_summary = :summary, updated_at = :ts',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={
                ':status': 'COMPLETED',
                ':text': full_text,
                ':summary': summary,
                ':ts': datetime.now(timezone.utc).isoformat()
            }
        )

    return {'statusCode': 200, 'body': json.dumps({'status': 'recorded'})}


def process_tool_call(agent_id, session_id, body):
    """Original tool processing logic for directive/scheduling."""
    callback_time = None
    tool_directive = body.get('directive')
    tool_scheduled_at = body.get('scheduled_at')
    now = datetime.now(timezone.utc)

    if tool_directive:
        final_status = 'PENDING'
        directive = tool_directive
    elif tool_scheduled_at:
        final_status = 'CALLBACK_SCHEDULED'
        directive = body.get('summary', 'Scheduled via voice tool.')
        callback_time = tool_scheduled_at
    else:
        # Generic status update
        final_status = 'IN_PROGRESS'
        directive = None

    table.update_item(
                Key={'agent_id': agent_id, 'session_id': session_id},
                UpdateExpression='SET #status = :status, directive = :directive, updated_at = :ts, raw_webhook_data = :raw',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={
                    ':status': final_status,
                    ':directive': directive,
                    ':ts': now.isoformat(),
                    ':raw': json.dumps(body)
                }
            )

    if final_status == 'CALLBACK_SCHEDULED' and callback_time:
        schedule_followup_call(agent_id, directive, callback_time)

    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps({'message': 'Tool processed', 'status': final_status})
    }


def extract_directive(transcript):
    """Strip the scheduling keyword lines from the end of the transcript to get the real directive."""
    lines = transcript.strip().split('\n')
    clean_lines = [
        line for line in lines
        if not any(kw in line for kw in [
            'CALLBACK_NOW', 'CALLBACK_AT', 'CALLBACK_DAY', 'CALLBACK_SNOOZE', 'CALLBACK_MONDAY'
        ])
    ]
    return '\n'.join(clean_lines).strip()


def parse_scheduling_intent(transcript, now):
    """
    Look for scheduling keywords injected by the ElevenLabs agent at the end of the call.
    Returns a dict with 'status' and optionally 'callback_time' (ISO string, UTC).
    """
    upper = transcript.upper()

    # CALLBACK_NOW — call back immediately after finishing
    if 'CALLBACK_NOW' in upper:
        return {'status': 'CALLBACK_NOW', 'callback_time': None}

    # CALLBACK_MONDAY — next Monday at 8:00 AM local (stored as UTC assuming UTC-7)
    if 'CALLBACK_MONDAY' in upper:
        days_ahead = (7 - now.weekday()) % 7  # weekday 0=Mon
        if days_ahead == 0:
            days_ahead = 7
        monday = now.replace(hour=15, minute=0, second=0, microsecond=0) + timedelta(days=days_ahead)
        return {'status': 'CALLBACK_SCHEDULED', 'callback_time': monday.isoformat()}

    # CALLBACK_DAY — tomorrow or a named day
    if 'CALLBACK_DAY' in upper:
        callback_time = resolve_day_phrase(transcript, now)
        return {'status': 'CALLBACK_SCHEDULED', 'callback_time': callback_time}

    # CALLBACK_AT — specific time today or mentioned hour
    if 'CALLBACK_AT' in upper:
        callback_time = resolve_time_phrase(transcript, now)
        return {'status': 'CALLBACK_SCHEDULED', 'callback_time': callback_time}

    # CALLBACK_SNOOZE — user doesn't want to be called, manual trigger required
    if 'CALLBACK_SNOOZE' in upper:
        return {'status': 'SNOOZED', 'callback_time': None}

    return None


def resolve_time_phrase(transcript, now):
    """Extract a clock time like '8am', '9:30', '2 hours' from the transcript and return UTC ISO string."""
    # Match "in X hours"
    m = re.search(r'in (\d+) hours?', transcript, re.IGNORECASE)
    if m:
        return (now + timedelta(hours=int(m.group(1)))).isoformat()

    # Match "at Xam/pm" or "at X:YY"
    m = re.search(r'at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?', transcript, re.IGNORECASE)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2) or 0)
        meridiem = (m.group(3) or '').lower()
        if meridiem == 'pm' and hour != 12:
            hour += 12
        elif meridiem == 'am' and hour == 12:
            hour = 0
        # Assume user is in UTC-7 (PDT); add 7 hours to get UTC
        target = now.replace(hour=(hour + 7) % 24, minute=minute, second=0, microsecond=0)
        if target < now:
            target += timedelta(days=1)
        return target.isoformat()

    # Fallback: 2 hours from now
    return (now + timedelta(hours=2)).isoformat()


def resolve_day_phrase(transcript, now):
    """Resolve phrases like 'tomorrow', 'Monday', 'next week' to a UTC ISO datetime at 8:00 AM local (3 PM UTC)."""
    lower = transcript.lower()
    base = now.replace(hour=15, minute=0, second=0, microsecond=0)  # 8am PDT = 3pm UTC

    day_map = {
        'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
        'friday': 4, 'saturday': 5, 'sunday': 6
    }

    if 'tomorrow' in lower:
        return (base + timedelta(days=1)).isoformat()

    for day_name, weekday in day_map.items():
        if day_name in lower:
            days_ahead = (weekday - now.weekday()) % 7
            if days_ahead == 0:
                days_ahead = 7
            return (base + timedelta(days=days_ahead)).isoformat()

    # Default: tomorrow morning
    return (base + timedelta(days=1)).isoformat()


def schedule_followup_call(agent_id, summary, callback_time_iso):
    """Create a one-time AWS EventBridge rule to trigger a follow-up call at the scheduled time."""
    trigger_fn_arn = os.environ.get('TRIGGER_CALL_FUNCTION_ARN')
    if not trigger_fn_arn:
        print("TRIGGER_CALL_FUNCTION_ARN not set — skipping EventBridge schedule")
        return

    # Parse the ISO time and format as EventBridge cron (UTC)
    dt = datetime.fromisoformat(callback_time_iso.replace('Z', '+00:00'))
    cron_expr = f"cron({dt.minute} {dt.hour} {dt.day} {dt.month} ? {dt.year})"

    rule_name = f"callback-{agent_id}-{uuid.uuid4().hex[:8]}"

    events_client.put_rule(
        Name=rule_name,
        ScheduleExpression=cron_expr,
        State='ENABLED',
        Description=f'Scheduled callback for {agent_id} at {callback_time_iso}'
    )

    events_client.put_targets(
        Rule=rule_name,
        Targets=[{
            'Id': 'TriggerCallTarget',
            'Arn': trigger_fn_arn,
            'Input': json.dumps({
                'agent_id': agent_id,
                'summary': summary,
                'scheduled_by': rule_name
            })
        }]
    )

    # Allow EventBridge to invoke the Lambda
    try:
        lambda_client.add_permission(
            FunctionName=trigger_fn_arn,
            StatementId=f'eventbridge-{rule_name}',
            Action='lambda:InvokeFunction',
            Principal='events.amazonaws.com',
            SourceArn=f"arn:aws:events:{os.environ.get('AWS_REGION', 'us-east-2')}:{get_account_id()}:rule/{rule_name}"
        )
    except lambda_client.exceptions.ResourceConflictException:
        pass  # Permission already exists

    print(f"Scheduled follow-up call for {agent_id} at {callback_time_iso} via rule {rule_name}")


def trigger_immediate_callback(agent_id, summary):
    """Immediately invoke the trigger_call Lambda for a CALLBACK_NOW response."""
    trigger_fn_arn = os.environ.get('TRIGGER_CALL_FUNCTION_ARN')
    if not trigger_fn_arn:
        print("TRIGGER_CALL_FUNCTION_ARN not set — skipping immediate callback")
        return

    lambda_client.invoke(
        FunctionName=trigger_fn_arn,
        InvocationType='Event',  # async
        Payload=json.dumps({
            'agent_id': agent_id,
            'summary': f'[Follow-up] {summary}',
            'scheduled_by': 'callback_now'
        })
    )
    print(f"Immediately triggered follow-up call for {agent_id}")


def get_account_id():
    """Get the current AWS account ID."""
    sts = boto3.client('sts')
    return sts.get_caller_identity()['Account']
