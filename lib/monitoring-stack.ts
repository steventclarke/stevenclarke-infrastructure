import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const alertTopic = new sns.Topic(this, 'BudgetAlerts', {
      displayName: 'Platform Budget Alerts',
      enforceSSL: true,
    });

    // Email subscription - must be confirmed after deploy
    alertTopic.addSubscription(
      new subscriptions.EmailSubscription('steven.t.clarke@gmail.com')
    );

    NagSuppressions.addResourceSuppressions(alertTopic, [
      {
        id: 'AwsSolutions-SNS3',
        reason: 'SSL is enforced via enforceSSL.',
      },
    ]);

    new budgets.CfnBudget(this, 'MonthlyPlatformBudget', {
      budget: {
        budgetName: 'stevenclarke-platform-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: 10,
          unit: 'USD',
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 50,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
        {
          notification: {
            notificationType: 'FORECASTED',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'SNS', address: alertTopic.topicArn }],
        },
      ],
    });

    new cdk.CfnOutput(this, 'BudgetAlertsTopicArn', {
      value: alertTopic.topicArn,
    });
  }
}
