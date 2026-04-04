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
        # Build wildcard Allow for all methods/routes in this API
        # methodArn = arn:aws:execute-api:{region}:{accountId}:{apiId}/{stage}/{method}/{resource}
        arn_parts = event['methodArn'].split(':')  # split on colon
        region     = arn_parts[3]
        account_id = arn_parts[4]
        api_id     = arn_parts[5].split('/')[0]    # e.g. "mrdbw1d3e9"
        resource   = f"arn:aws:execute-api:{region}:{account_id}:{api_id}/*/*"
        print(f"[Authorizer] ALLOW → resource wildcard: {resource}")
        return generate_policy('user', 'Allow', resource)
    else:
        print(f"[Authorizer] DENY — token mismatch")
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
