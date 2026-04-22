import json
import boto3
import os
from datetime import datetime, timezone

lambda_client = boto3.client('lambda')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE', 'agent-directive-hub'))

def lambda_handler(event, context):
    try:
        body = json.loads(event.get('body', '{}'))
        event_type = body.get('eventType')
        tenant_id = body.get('tenantId', 'global')
        metadata = body.get('metadata', {})
        
        print(f"Reflex Triggered: {event_type} for {tenant_id}")
        
        # 1. Log the event as a system message in the Directive Hub
        session_id = f"reflex-{int(datetime.now(timezone.utc).timestamp())}"
        table.put_item(
            Item={
                'agent_id': tenant_id,
                'session_id': session_id,
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'status': 'SYSTEM_REFLEX',
                'directive': f"System Event: {event_type}",
                'metadata': metadata
            }
        )

        # 2. Reflex Logic Mapping
        if event_type == 'ANOMALY_DETECTED':
            return handle_anomaly(tenant_id, metadata)
            
        return {
            'statusCode': 200,
            'body': json.stringify({'success': True, 'message': 'Event logged, no specific reflex triggered'})
        }

    except Exception as e:
        print(f"Reflex Error: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

def handle_anomaly(tenant_id, metadata):
    # A. Check Policy (Stage 4 Integration)
    # Note: We call the TacticalPolicyEngine name from environment
    policy_name = os.environ.get('POLICY_ENGINE_FUNCTION', 'TacticalPolicyEngine')
    
    policy_resp = lambda_client.invoke(
        FunctionName=policy_name,
        Payload=json.dumps({
            'mode': 'EVALUATE',
            'tenantId': tenant_id,
            'eventType': 'ANOMALY_DETECTED'
        })
    )
    
    policy_result = json.loads(policy_resp['Payload'].read())
    policy_body = json.loads(policy_result.get('body', '{}'))
    
    if not policy_body.get('allowed', True):
        print(f"Anomaly reflex blocked by policy: {policy_body.get('reason')}")
        return {
            'statusCode': 200,
            'body': json.dumps({'success': True, 'message': 'Anomaly logged but call blocked by policy'})
        }
    
    # B. Trigger Outbound Call (Stage 1 Integration)
    trigger_call_name = os.environ.get('TRIGGER_CALL_FUNCTION')
    if trigger_call_name:
        lambda_client.invoke(
            FunctionName=trigger_call_name,
            Payload=json.dumps({
                'body': {
                    'agent_id': tenant_id,
                    'summary': f"SITUATIONAL ALERT: {metadata.get('dbLevel', 'Unknown')}dB anomaly detected. Policy check passed."
                }
            })
        )
        return {
            'statusCode': 200,
            'body': json.dumps({'success': True, 'message': 'Anomaly detected: Reflex initiated (Policy Passed -> Call Triggered)'})
        }
    
    return {
        'statusCode': 200,
        'body': json.dumps({'success': True, 'message': 'Anomaly logged, but trigger_call function not found'})
    }
