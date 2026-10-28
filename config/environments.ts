import * as cdk from 'aws-cdk-lib';

export const envs = {
  primary: {
    account: process.env.CDK_DEFAULT_ACCOUNT || '470805152888',
    region: 'us-east-2',
  },
  usEast1: {
    account: process.env.CDK_DEFAULT_ACCOUNT || '470805152888',
    region: 'us-east-1',
  },
};
