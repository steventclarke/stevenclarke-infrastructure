export interface ArtifactConfig {
  domainName: string;
  repositoryName: string;
  upstreamRepositoryName: string;
  npmScope: string;
  region: string;
  kmsKeyAlias: string;
}

export const artifactConfig: ArtifactConfig = {
  domainName: 'stevenclarke',
  repositoryName: 'shared',
  upstreamRepositoryName: 'npmjs',
  npmScope: '@stevenclarke',
  region: 'us-east-2',
  kmsKeyAlias: 'stevenclarke-artifacts',
};
