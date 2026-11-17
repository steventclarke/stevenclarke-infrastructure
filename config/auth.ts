export interface AuthConfig {
  userPoolName: string;
  domainPrefix: string;
  googleClientIdParameterName: string;
  googleClientSecretName: string;
}

export const authConfig: AuthConfig = {
  userPoolName: 'stevenclarke-users',
  domainPrefix: process.env.GOOGLE_AUTH_DOMAIN_PREFIX || 'stevenclarke',
  googleClientIdParameterName:
    process.env.GOOGLE_CLIENT_ID_PARAMETER || '/platform/auth/google/client-id',
  googleClientSecretName:
    process.env.GOOGLE_CLIENT_SECRET_NAME || 'platform/google-oauth-client',
};
