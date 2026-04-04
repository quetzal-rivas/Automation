import json
import boto3
from boto3.dynamodb.conditions import Key
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('agent-directive-hub')

def lambda_handler(event, context):
    try:
        # Parse query parameters
        query_params = event.get('queryStringParameters', {}) or {}
        agent_id = query_params.get('agent_id')
        
        if not agent_id:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'agent_id is required'})
            }
        
        # Query for the latest directive for this agent
        response = table.query(
            KeyConditionExpression=Key('agent_id').eq(agent_id),
            ScanIndexForward=False,  # Sort by session_id descending
            Limit=10  # Get last 10 sessions
        )
        
        items = response.get('Items', [])
        
        if not items:
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({
                    'agent_id': agent_id,
                    'status': 'NO_DIRECTIVES',
                    'message': 'No directives found for this agent'
                })
            }
        
        # Find the most recent completed directive or pending call
        latest_item = None
        pending_call = None
        
        for item in items:
            if item['status'] == 'COMPLETED' and item.get('directive'):
                if not latest_item:
                    latest_item = item
            elif item['status'] in ['CALL_IN_PROGRESS', 'USER_MISSED_CALL', 'USER_BUSY']:
                if not pending_call:
                    pending_call = item
        
        # Prepare response
        response_data = {
            'agent_id': agent_id,
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        if pending_call:
            response_data.update({
                'status': pending_call['status'],
                'session_id': pending_call['session_id'],
                'message': get_status_message(pending_call['status']),
                'summary': pending_call.get('summary', ''),
                'created_at': pending_call.get('created_at')
            })
        elif latest_item:
            response_data.update({
                'status': 'DIRECTIVE_AVAILABLE',
                'session_id': latest_item['session_id'],
                'directive': latest_item['directive'],
                'summary': latest_item.get('summary', ''),
                'created_at': latest_item.get('created_at'),
                'call_duration': latest_item.get('call_duration', 0)
            })
        else:
            response_data.update({
                'status': 'NO_COMPLETED_DIRECTIVES',
                'message': 'No completed directives available'
            })
        
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps(response_data)
        }
        
    except Exception as e:
        print(f"Error retrieving directive: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Internal server error'})
        }

def get_status_message(status):
    messages = {
        'CALL_IN_PROGRESS': 'Call is currently in progress. Please wait.',
        'USER_MISSED_CALL': 'User missed the call. Should I try again in 10 minutes or wait for manual trigger?',
        'USER_BUSY': 'User was busy. Should I try again later?',
        'CALL_FAILED': 'Call failed. Please check configuration and try again.'
    }
    return messages.get(status, 'Unknown status')
