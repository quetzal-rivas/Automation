import json
import boto3
import uuid
from datetime import datetime, timezone
import requests
import os

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE', 'agent-directive-hub'))

# Closing prompt the ElevenLabs agent ALWAYS reads at the end of every call.
SCHEDULING_PROMPT = """
Once you have confirmed the directive with the user, say EXACTLY this:

"Got it! I'll get started. Before I hang up — once I finish working on this, should I call you back right away to report progress, or would you prefer a different time?"

Listen carefully to their response and interpret it:
- If they say "call me right away", "immediately", "as soon as you're done", "yes call me" → respond with the keyword CALLBACK_NOW
- If they say a specific time like "call me at 8am", "in 2 hours", "tonight at 9" → respond with CALLBACK_AT followed by the time they said
- If they say "tomorrow", "Monday", "next week", or a weekday → respond with CALLBACK_DAY followed by their exact words
- If they say "don't call", "I'll reach out", "I'm traveling", "I'm busy", "no", "not now" → respond with CALLBACK_SNOOZE
- If they say "remind me on Monday", "Monday morning", or similar → respond with CALLBACK_MONDAY

Only output ONE of these exact keywords + the time phrase at the very end, after saying goodbye. The keyword must be on its own line.
"""


def lambda_handler(event, context):
    try:
        # Support both API Gateway calls and direct EventBridge invocations
        body = {}
        if event.get('body'):
            body = json.loads(event['body'])
        elif event.get('agent_id'):
            # Direct invocation from EventBridge scheduled call
            body = event

        agent_id = body.get('agent_id')
        summary = body.get('summary', 'Agent requesting directive')
        scheduled_by = body.get('scheduled_by')  # EventBridge rule name if scheduled

        if not agent_id:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'agent_id is required'})
            }

        # Generate session ID
        session_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()

        # Store initial state in DynamoDB
        item = {
            'agent_id': agent_id,
            'session_id': session_id,
            'status': 'CALL_IN_PROGRESS',
            'directive': None,
            'timestamp': timestamp,
            'summary': summary,
            'created_at': timestamp
        }
        if scheduled_by:
            item['scheduled_by'] = scheduled_by

        table.put_item(Item=item)

        # Construct Webhook URL dynamically (from API Gateway context or env fallback)
        domain_name = event.get('requestContext', {}).get('domainName') or os.environ.get('API_DOMAIN')
        stage = event.get('requestContext', {}).get('stage', 'prod')
        webhook_url = f"https://{domain_name}/{stage}/webhook" if domain_name else ''

        # Trigger ElevenLabs call
        elevenlabs_response = trigger_elevenlabs_call(agent_id, session_id, summary, webhook_url)

        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'session_id': session_id,
                'status': 'CALL_IN_PROGRESS',
                'message': f'Call initiated for agent {agent_id}',
                'elevenlabs_call_id': elevenlabs_response.get('call_id')
            })
        }

    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Internal server error'})
        }


def trigger_elevenlabs_call(agent_id, session_id, summary, webhook_url):
    """Trigger ElevenLabs outbound call with scheduling prompt at end."""

    api_key = os.environ['ELEVENLABS_API_KEY']
    agent_voice_id = os.environ['ELEVENLABS_AGENT_ID']
    phone_number = os.environ['USER_PHONE_NUMBER']
    phone_number_id = os.environ.get('ELEVENLABS_PHONE_NUMBER_ID', '')

    headers = {
        'xi-api-key': api_key,
        'Content-Type': 'application/json'
    }

    system_prompt = f"""You are calling on behalf of the AI agent named "{agent_id}".

The agent has the following update: {summary}

First, clearly communicate the update to the user. Then listen for any questions or corrections they have.
After confirming the directive:

{SCHEDULING_PROMPT}
"""

    payload = {
        'agent_id': agent_voice_id,
        'customer_phone_number': phone_number,
        'system_prompt': system_prompt,
        'max_duration_seconds': 300,
        'wait_for_greeting': True,
        'record_call': True
    }

    # Add phone number ID (required when ElevenLabs account has Twilio integration)
    if phone_number_id:
        payload['phone_number_id'] = phone_number_id

    # Add webhook URL if available
    if webhook_url:
        payload['webhook_url'] = f"{webhook_url}?agent_id={agent_id}&session_id={session_id}"

    print(f"[ElevenLabs] Triggering call to {phone_number} via agent {agent_voice_id}")
    print(f"[ElevenLabs] Webhook URL: {payload.get('webhook_url', 'NOT SET')}")
    print(f"[ElevenLabs] Phone number ID: {phone_number_id or 'NOT SET'}")

    response = requests.post(
        'https://api.elevenlabs.io/v1/convai/conversations/phone',
        headers=headers,
        json=payload
    )

    print(f"[ElevenLabs] Response status: {response.status_code}")
    try:
        response_body = response.json()
    except Exception:
        response_body = {'raw': response.text}

    print(f"[ElevenLabs] Response body: {json.dumps(response_body)}")

    if response.status_code == 200:
        return response_body
    else:
        print(f"[ElevenLabs] ERROR! Call failed. Status={response.status_code} Body={response_body}")
        return {}

