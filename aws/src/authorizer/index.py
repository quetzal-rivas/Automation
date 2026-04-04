import json
import os

def lambda_handler(event, context):
    token = event['authorizationToken']
    
    # Remove 'Bearer ' prefix if present
    if token.startswith('Bearer '):
        token = token[7:]
    
    # Check against environment variable
    expected_token = os.environ['API_BEARER_TOKEN']
    
    if token == expected_token:
        # Allow access to all methods in this API (wildcard resource)
        # This prevents stale per-method cache misses
        arn_parts = event['methodArn'].split(':')
        api_gateway_arn = ':'.join(arn_parts[:6])
        resource = f"{api_gateway_arn}/*/*"
        return generate_policy('user', 'Allow', resource)
    else:
        return generate_policy('user', 'Deny', event['methodArn'])

def generate_policy(principal_id, effect, resource):
    return {
        'principalId': principal_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [
                {
                    'Action': 'execute-api:Invoke',
                    'Effect': effect,
                    'Resource': resource
                }
            ]
        }
    }
