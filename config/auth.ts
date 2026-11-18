export interface AuthConfig {
  userPoolName: string;
  domainPrefix: string;
  userPoolArnParameterName: string;
  googleClientIdParameterName: string;
  googleClientSecretName: string;
}

export const authConfig: AuthConfig = {
  userPoolName: 'stevenclarke-users',
  domainPrefix: process.env.GOOGLE_AUTH_DOMAIN_PREFIX || 'stevenclarke',
  userPoolArnParameterName: '/platform/auth/user-pool-arn',
  googleClientIdParameterName:
    process.env.GOOGLE_CLIENT_ID_PARAMETER || '/platform/auth/google/client-id',
  googleClientSecretName:
    process.env.GOOGLE_CLIENT_SECRET_NAME || 'platform/google-oauth-client',
};
