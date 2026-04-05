import json
import os
import boto3
from boto3.dynamodb.conditions import Key
from datetime import datetime, timedelta, timezone

dynamodb = boto3.resource('dynamodb')
table_name = os.environ.get('DYNAMODB_TABLE', 'agent-directive-hub')
table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    try:
        query_params = event.get('queryStringParameters', {}) or {}
        body = json.loads(event['body']) if event.get('body') else {}
        
        agent_id = query_params.get('agent_id') or body.get('agent_id')
        session_id = query_params.get('session_id') or body.get('session_id')

        if not agent_id:
            return {
                'statusCode': 400,
                'body': json.dumps({'error': 'agent_id is required'})
            }

        # 1. Query DynamoDB for recent activity (last 30 minutes)
        # Sort by timestamp descending
        response = table.query(
            KeyConditionExpression=Key('agent_id').eq(agent_id),
            Limit=5,
            ScanIndexForward=False
        )
        items = response.get('Items', [])

        # 2. Extract specific session if requested, else use latest
        current_session = None
        if session_id:
            current_session = next((i for i in items if i['session_id'] == session_id), None)
        
        if not current_session and items:
            current_session = items[0]

        # 3. Build a concise summary for the Voice Agent
        summary = {
            "status": "operational",
            "last_action_timestamp": "none",
            "active_session": "none",
            "recent_directives_count": len(items),
            "diagnostics": "No activity found recently."
        }

        if current_session:
            summary.update({
                "last_action_timestamp": current_session.get('timestamp', '?'),
                "active_session": current_session.get('session_id', '?')[:8],
                "current_directive_status": current_session.get('status', 'unknown'),
                "last_directive_saved": current_session.get('directive', 'none')[:100] + ('...' if current_session.get('directive') and len(current_session.get('directive')) > 100 else '')
            })
            
            if current_session.get('status') == 'PENDING':
                summary["diagnostics"] = "A directive is pending processing. Everything is normal."
            elif current_session.get('status') == 'PROCESSED':
                summary["diagnostics"] = "The last instruction was successfully processed by the IDE."
            else:
                summary["diagnostics"] = f"Session is in state: {current_session.get('status')}."

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(summary)
        }

    except Exception as e:
        print(f"Error in get_status: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Internal server error', 'details': str(e)})
        }
