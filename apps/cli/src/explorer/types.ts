export type ExploredLink = {
  name: string;
  href: string;
  sameOrigin: boolean;
};

export type ExploredControl = {
  role: string;
  name: string;
  classification: "navigation" | "presentational" | "form" | "destructive" | "ambiguous";
};

export type ExploredPage = {
  url: string;
  title: string;
  depth: number;
  headings: string[];
  links: ExploredLink[];
  controls: ExploredControl[];
  hasPasswordField: boolean;
  hasForm: boolean;
  captchaIndicators: string[];
  screenshotPath: string;
  errors: string[];
};

export type RepositoryReport = {
  path: string;
  packageManager?: string;
  framework?: string;
  scripts: Record<string, string>;
  routeFiles: string[];
  testFiles: string[];
  environmentVariableNames: string[];
  authenticationHints: string[];
};

export type ExplorationReport = {
  version: 1;
  id: string;
  createdAt: string;
  target: {
    baseUrl: string;
    repositoryPath?: string;
  };
  limits: {
    maxPages: number;
    maxDepth: number;
    sameOriginOnly: boolean;
  };
  authentication: {
    detected: boolean;
    required: boolean;
    loginUrl?: string;
    captchaDetected: boolean;
    evidence: string[];
    profile?: string;
  };
  repository?: RepositoryReport;
  pages: ExploredPage[];
  risks: string[];
};

export type ExploreSiteOptions = {
  baseUrl: string;
  outputDirectory: string;
  maxPages?: number;
  maxDepth?: number;
  sameOriginOnly?: boolean;
  headless?: boolean;
  storageStatePath?: string;
  sessionStoragePath?: string;
  authProfile?: string;
  repositoryPath?: string;
};
