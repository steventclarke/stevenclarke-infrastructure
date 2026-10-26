export interface ApplicationConfig {
  name: string;
  repo: string;
  subdomains: {
    preview: string[];
    prod: string[];
  };
  hasApi?: boolean;
}

export const applications: ApplicationConfig[] = [
  {
    name: 'portfolio',
    repo: 'steventclarke/portfolio',
    subdomains: {
      preview: ['portfolio-preview.stevenclarke.dev'],
      prod: ['stevenclarke.dev'],
    },
  },
  {
    name: 'iron-altar',
    repo: 'steventclarke/iron-altar',
    subdomains: {
      preview: ['iron-altar-preview.stevenclarke.dev'],
      prod: ['iron-altar.stevenclarke.dev'],
    },
  },
  {
    name: 'squat-monster',
    repo: 'steventclarke/squat-monster',
    subdomains: {
      preview: ['squat-monster-preview.stevenclarke.dev', 'api.squat-monster-preview.stevenclarke.dev'],
      prod: ['squat-monster.stevenclarke.dev', 'api.squat-monster.stevenclarke.dev'],
    },
    hasApi: true,
  },
  {
    name: 'media-inspector',
    repo: 'steventclarke/media-inspector',
    subdomains: {
      preview: ['media-inspector-preview.stevenclarke.dev'],
      prod: ['media-inspector.stevenclarke.dev'],
    },
  },
];
