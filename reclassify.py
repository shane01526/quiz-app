import json, re

with open('C:/Users/user/Desktop/2026_Cathay/AWS SAA/raw_text.txt', 'r', encoding='utf-8') as f:
    pass  # just checking it exists

with open('C:/Users/user/Desktop/2026_Cathay/AWS SAA/quiz-app/questions_data.js', 'r', encoding='utf-8') as f:
    content = f.read()
    data = json.loads(content.replace('const QUESTIONS_DATA = ', '').rstrip(';\n'))

categories = {
    'Database':                ['RDS', 'DynamoDB', 'Aurora', 'ElastiCache', 'Redshift', 'Neptune', 'DocumentDB', 'QLDB', 'Keyspaces', 'database'],
    'Analytics':               ['Athena', 'Glue', 'EMR', 'QuickSight', 'Data Pipeline', 'Lake Formation', 'OpenSearch', 'Elasticsearch', 'data lake'],
    'Migration':               ['migrat', 'DMS', 'Application Discovery', 'Transfer Family', 'Snowball', 'Snow Family', 'DataSync', 'on-premises'],
    'Messaging / Integration': ['SQS', 'SNS', 'EventBridge', 'Step Functions', 'Kinesis', 'Amazon MQ', 'AppSync', 'decouple', 'message queue'],
    'Security / IAM':          ['IAM', 'KMS', 'Cognito', 'GuardDuty', 'Inspector', 'Macie', 'Shield', 'WAF', 'Secrets Manager', 'Certificate Manager', 'ACM', 'Security Hub', 'SSO', 'STS', 'encrypt', 'permission', 'access control', 'compliance'],
    'Networking / VPC':        ['VPC', 'subnet', 'CloudFront', 'Route 53', 'Direct Connect', ' VPN', 'Transit Gateway', 'Global Accelerator', 'NAT gateway', 'API Gateway', 'PrivateLink', 'load balancer', 'ALB', 'NLB', 'ELB', 'DNS', 'latency', 'CDN'],
    'S3 / Storage':            [' S3 ', ' S3.', ' S3,', 'Glacier', ' EBS', ' EFS', ' FSx', 'Storage Gateway', 'object stor', 'block stor', 'file stor'],
    'Monitoring / Mgmt':       ['CloudWatch', 'CloudTrail', 'Config', 'Systems Manager', 'Trusted Advisor', 'CloudFormation', 'OpsWorks', 'Service Catalog', 'Organizations', 'logging', 'monitoring', 'audit'],
    'Cost / Architecture':     ['cost', 'budget', 'pricing', 'Reserved Instance', 'Spot Instance', 'Savings Plan', 'Cost Explorer', 'cost-effective', 'least expensive', 'minimize cost', 'cheapest', 'billing'],
    'EC2 / Compute':           ['EC2', 'Auto Scaling', 'Elastic Beanstalk', 'ECS', 'EKS', 'Fargate', 'Lambda', 'Lightsail', 'Batch', 'container', 'serverless', 'compute'],
}

def classify(q):
    qtext = q['question'].lower()
    full_text = (q['question'] + ' ' + ' '.join(o['text'] for o in q['options'])).lower()

    # Score each category: question matches worth 3, option matches worth 1
    scores = {}
    for cat, keywords in categories.items():
        score = 0
        for kw in keywords:
            kw_lower = kw.lower()
            if kw_lower in qtext:
                score += 3
            elif kw_lower in full_text:
                score += 1
        if score > 0:
            scores[cat] = score

    if not scores:
        return 'General', ['General']

    sorted_cats = sorted(scores.items(), key=lambda x: -x[1])
    primary = sorted_cats[0][0]
    tags = [c for c, s in sorted_cats]
    return primary, tags

for q in data:
    primary, tags = classify(q)
    q['topic'] = primary
    q['tags'] = tags

with open('C:/Users/user/Desktop/2026_Cathay/AWS SAA/quiz-app/questions_data.js', 'w', encoding='utf-8') as f:
    f.write('const QUESTIONS_DATA = ')
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write(';\n')

from collections import Counter
c = Counter(q['topic'] for q in data)
print('Primary topic distribution:')
for cat, cnt in c.most_common():
    print(f'  {cat}: {cnt}')
print(f'Total: {len(data)}')
