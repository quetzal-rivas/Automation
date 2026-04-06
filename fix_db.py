import boto3
from boto3.dynamodb.conditions import Key
import os

session = boto3.Session(profile_name='voice-agent', region_name='us-east-2')
dynamodb = session.resource('dynamodb')
table = dynamodb.Table('agent-directive-hub-voice-agent-hub')

response = table.query(
    KeyConditionExpression=Key('agent_id').eq('vscode-macbook-pro'),
    ScanIndexForward=False,
    Limit=20
)

items = response.get('Items', [])
print("Found", len(items), "items")
for item in items:
    print(item.get('timestamp'), item.get('session_id'), item.get('status'))
    if item.get('status') == 'CALL_IN_PROGRESS':
        print("Fixing stuck call in progress...")
        table.update_item(
            Key={'agent_id': item['agent_id'], 'session_id': item['session_id']},
            UpdateExpression='SET #s = :s',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': 'STUCK_CALL_IGNORED'}
        )
