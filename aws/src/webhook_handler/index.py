import json
import boto3
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('agent-directive-hub')

def lambda_handler(event, context):
    try:
        # Parse query parameters and body
        query_params = event.get('queryStringParameters', {}) or {}
        agent_id = query_params.get('agent_id')
        session_id = query_params.get('session_id')
        
        body = json.loads(event['body']) if event.get('body') else {}
        
        if not agent_id or not session_id:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'agent_id and session_id are required'})
            }
        
        # Process different webhook events
        call_status = body.get('status', 'unknown')
        transcript = body.get('transcript', '')
        call_duration = body.get('duration_seconds', 0)
        
        # Determine final status based on call outcome
        if call_status == 'completed' and transcript:
            final_status = 'COMPLETED'
            directive = transcript
        elif call_status == 'no_answer' or call_status == 'failed':
            final_status = 'USER_MISSED_CALL'
            directive = None
        elif call_status == 'busy':
            final_status = 'USER_BUSY'
            directive = None
        else:
            final_status = 'CALL_FAILED'
            directive = None
        
        # Update DynamoDB record
        timestamp = datetime.now(timezone.utc).isoformat()
        
        table.update_item(
            Key={
                'agent_id': agent_id,
                'session_id': session_id
            },
            UpdateExpression='SET #status = :status, directive = :directive, updated_at = :timestamp, call_duration = :duration, raw_webhook_data = :raw_data',
            ExpressionAttributeNames={
                '#status': 'status'
            },
            ExpressionAttributeValues={
                ':status': final_status,
                ':directive': directive,
                ':timestamp': timestamp,
                ':duration': call_duration,
                ':raw_data': json.dumps(body)
            }
        )
        
        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({
                'message': 'Webhook processed successfully',
                'agent_id': agent_id,
                'session_id': session_id,
                'status': final_status
            })
        }
        
    except Exception as e:
        print(f"Error processing webhook: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Internal server error'})
        }
