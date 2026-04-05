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


def lambda_handler(event, context):
    try:
        query_params = event.get('queryStringParameters', {}) or {}
        body = json.loads(event['body']) if event.get('body') else {}
        callback_time = None

        # Extraction: prioritize query params (original design), fall back to body (ElevenLabs tool design)
        agent_id = query_params.get('agent_id') or body.get('agent_id')
        session_id = query_params.get('session_id') or body.get('session_id')

        if not agent_id or not session_id:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'error': 'agent_id and session_id are required',
                    'received': {'query': query_params, 'body_keys': list(body.keys())}
                })
            }

        call_status = body.get('status', 'unknown')
        transcript = body.get('transcript', '') or ''
        call_duration = body.get('duration_seconds', 0)
        now = datetime.now(timezone.utc)

        # Extraction for Tool Calls (direct input)
        tool_directive = body.get('directive')
        tool_scheduled_at = body.get('scheduled_at')

        # --- Determine base call outcome ---
        if tool_directive:
            # This is a direct 'save_directive' tool call
            final_status = 'PENDING'
            directive = tool_directive
        elif tool_scheduled_at:
            # This is a direct 'schedule_call' tool call
            final_status = 'CALLBACK_SCHEDULED'
            directive = body.get('summary', 'Scheduled via voice tool.')
            callback_time = tool_scheduled_at
        elif call_status == 'completed' and transcript:
            # This is the post-call cleanup webhook
            final_status = 'COMPLETED'
            directive = extract_directive(transcript)
        elif call_status in ('no_answer', 'failed'):
            final_status = 'USER_MISSED_CALL'
            directive = None
        elif call_status == 'busy':
            final_status = 'USER_BUSY'
            directive = None
        else:
            final_status = 'IN_PROGRESS'
            directive = None

        # --- Parse scheduling intent from transcript if not already set by tool ---
        schedule_info = None
        if not callback_time and final_status == 'COMPLETED' and transcript:
            schedule_info = parse_scheduling_intent(transcript, now)
            if schedule_info:
                final_status = schedule_info['status']
                callback_time = schedule_info.get('callback_time')

        # --- Update DynamoDB ---
        update_expr = (
            'SET #status = :status, directive = :directive, updated_at = :ts, '
            'call_duration = :dur, raw_webhook_data = :raw'
        )
        expr_values = {
            ':status': final_status,
            ':directive': directive,
            ':ts': now.isoformat(),
            ':dur': call_duration,
            ':raw': json.dumps(body)
        }
        if callback_time:
            update_expr += ', callback_scheduled_at = :cbt'
            expr_values[':cbt'] = callback_time

        table.update_item(
            Key={'agent_id': agent_id, 'session_id': session_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues=expr_values
        )

        # --- Schedule EventBridge follow-up if needed ---
        if schedule_info and callback_time:
            schedule_followup_call(agent_id, directive or 'Reporting back on the previous task.', callback_time)

        # --- Handle CALLBACK_NOW immediately ---
        if schedule_info and schedule_info['status'] == 'CALLBACK_NOW':
            trigger_immediate_callback(agent_id, directive or 'Reporting back on the previous task.')

        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'message': 'Webhook processed successfully',
                'agent_id': agent_id,
                'session_id': session_id,
                'status': final_status,
                'callback_scheduled_at': callback_time
            })
        }

    except Exception as e:
        print(f"Error processing webhook: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Internal server error'})
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
