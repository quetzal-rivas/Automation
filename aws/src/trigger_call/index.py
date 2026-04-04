import json
import boto3
import uuid
from datetime import datetime, timezone
import requests
import os

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('agent-directive-hub')

def lambda_handler(event, context):
    try:
        # Parse request body
        body = json.loads(event['body']) if event.get('body') else {}
        agent_id = body.get('agent_id')
        summary = body.get('summary', 'Agent requesting directive')
        
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
        table.put_item(
            Item={
                'agent_id': agent_id,
                'session_id': session_id,
                'status': 'CALL_IN_PROGRESS',
                'directive': None,
                'timestamp': timestamp,
                'summary': summary,
                'created_at': timestamp
            }
        )
        
        # Trigger ElevenLabs call
        elevenlabs_response = trigger_elevenlabs_call(agent_id, session_id, summary)
        
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

def trigger_elevenlabs_call(agent_id, session_id, summary):
    """Trigger ElevenLabs outbound call"""
    
    # ElevenLabs API configuration
    api_key = os.environ['ELEVENLABS_API_KEY']
    agent_voice_id = os.environ['ELEVENLABS_AGENT_ID']
    webhook_url = os.environ['WEBHOOK_URL']
    phone_number = os.environ['USER_PHONE_NUMBER']
    
    headers = {
        'xi-api-key': api_key,
        'Content-Type': 'application/json'
    }
    
    # Create the call prompt with agent identification
    call_prompt = f"""
    Hi! This is your {agent_id} calling. {summary}
    
    Please provide your directive or instruction for this agent. 
    I'll wait for your response and then execute the task accordingly.
    """
    
    payload = {
        'agent_id': agent_voice_id,
        'customer_phone_number': phone_number,
        'system_prompt': call_prompt,
        'webhook_url': f"{webhook_url}?agent_id={agent_id}&session_id={session_id}",
        'max_duration_seconds': 300,
        'wait_for_greeting': True,
        'record_call': True
    }
    
    response = requests.post(
        'https://api.elevenlabs.io/v1/convai/conversations/phone',
        headers=headers,
        json=payload
    )
    
    return response.json() if response.status_code == 200 else {}
