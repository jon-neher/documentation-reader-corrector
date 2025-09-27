import JiraApi from 'jira-client';
import { JiraAuthError, JiraConfigError, JiraPermissionError } from './errors.js';

export type JiraEnvConfig = {
  host: string;
  username?: string; // Email for Jira Cloud
  apiToken?: string; // Jira API token
  bearer?: string; // OAuth 2.0 bearer token (optional alternative)
  protocol?: 'https' | 'http';
  apiVersion?: string; // default '2'
  strictSSL?: boolean;
};

export type JiraProjectConfig = {
  projectKey: string;
  issueTypeName?: string; // e.g., 'Task', 'Bug'
};

export function readJiraEnv(): JiraEnvConfig {
  const host = process.env.JIRA_HOST?.trim();
  const username = process.env.JIRA_USERNAME?.trim() || process.env.JIRA_EMAIL?.trim();
  const apiToken = process.env.JIRA_API_TOKEN?.trim();
  const bearer = process.env.JIRA_BEARER?.trim();
  const protocol = (process.env.JIRA_PROTOCOL?.trim() as 'http' | 'https') || 'https';
  const apiVersion = process.env.JIRA_API_VERSION?.trim() || '2';
  const strictSSL = process.env.JIRA_STRICT_SSL?.trim()?.toLowerCase() !== 'false';

  if (!host) {
    throw new JiraConfigError('Missing JIRA_HOST environment variable');
  }
  if (!bearer && (!username || !apiToken)) {
    throw new JiraConfigError('Missing credentials: set JIRA_USERNAME and JIRA_API_TOKEN, or JIRA_BEARER');
  }

  return { host, username, apiToken, bearer, protocol, apiVersion, strictSSL };
}

export function createJiraClient(env: JiraEnvConfig = readJiraEnv()): JiraApi {
  const { host, username, apiToken, bearer, protocol = 'https', apiVersion = '2', strictSSL = true } = env;
  const options: any = {
    protocol,
    host,
    apiVersion,
    strictSSL,
  };
  if (bearer) {
    options.bearer = bearer;
  } else {
    options.username = username;
    options.password = apiToken;
  }
  return new JiraApi(options);
}

export type ConnectionInfo = {
  ok: true;
  accountId: string;
  displayName: string;
} | {
  ok: false;
  error: string;
  status?: number;
};

// Authenticated ping using /myself
export async function testConnection(jira: JiraApi = createJiraClient()): Promise<ConnectionInfo> {
  try {
    const me = await jira.getCurrentUser();
    return { ok: true, accountId: (me as any).accountId ?? (me as any).key ?? 'unknown', displayName: (me as any).displayName ?? 'unknown' };
  } catch (err: any) {
    const status = err?.statusCode || err?.status;
    const msg = err?.message || String(err);
    // Normalize common auth status codes
    if (status === 401 || status === 403) {
      throw new JiraAuthError(`Authentication failed (${status}): ${msg}`, status);
    }
    return { ok: false, error: msg, status };
  }
}

export type PermissionCheck = {
  BROWSE_PROJECTS: boolean; // search/browse
  CREATE_ISSUES: boolean;
  EDIT_ISSUES: boolean;
  ADD_COMMENTS: boolean;
};

export async function checkProjectPermissions(jira: JiraApi, projectKey: string): Promise<PermissionCheck> {
  const wanted = ['BROWSE_PROJECTS', 'CREATE_ISSUES', 'EDIT_ISSUES', 'ADD_COMMENTS'] as const;
  const uri = (jira as any).makeUri({
    pathname: `/mypermissions`,
    query: { projectKey, permissions: wanted.join(',') },
  });
  const req = (jira as any).makeRequestHeader(uri, { method: 'GET' });
  const res = await (jira as any).doRequest(req);
  const permissions = res?.permissions ?? {};
  const out: PermissionCheck = {
    BROWSE_PROJECTS: Boolean(permissions.BROWSE_PROJECTS?.havePermission),
    CREATE_ISSUES: Boolean(permissions.CREATE_ISSUES?.havePermission),
    EDIT_ISSUES: Boolean(permissions.EDIT_ISSUES?.havePermission),
    ADD_COMMENTS: Boolean(permissions.ADD_COMMENTS?.havePermission),
  };
  return out;
}

export type ProjectIssueTypeCheck = {
  projectExists: boolean;
  issueTypeSupported: boolean;
  availableIssueTypes: string[];
};

export async function verifyProjectAndIssueType(jira: JiraApi, cfg: JiraProjectConfig): Promise<ProjectIssueTypeCheck> {
  const { projectKey, issueTypeName } = cfg;
  const uri = (jira as any).makeUri({
    pathname: `/issue/createmeta`,
    query: { projectKeys: projectKey, expand: 'projects.issuetypes' },
  });
  const req = (jira as any).makeRequestHeader(uri, { method: 'GET' });
  const res = await (jira as any).doRequest(req);
  const projects = res?.projects ?? [];
  const project = projects.find((p: any) => p.key === projectKey);
  const availableIssueTypes: string[] = Array.isArray(project?.issuetypes) ? project.issuetypes.map((t: any) => t.name) : [];
  const projectExists = Boolean(project);
  const issueTypeSupported = issueTypeName ? availableIssueTypes.includes(issueTypeName) : availableIssueTypes.length > 0;
  return { projectExists, issueTypeSupported, availableIssueTypes };
}

export async function assertReady(jira: JiraApi, cfg: JiraProjectConfig): Promise<void> {
  // 1) Auth works
  await testConnection(jira);

  // 2) Project + issue type exists
  const meta = await verifyProjectAndIssueType(jira, cfg);
  if (!meta.projectExists) {
    throw new JiraConfigError(`Project ${cfg.projectKey} not found or not accessible`);
  }
  if (!meta.issueTypeSupported) {
    throw new JiraConfigError(`Issue type ${cfg.issueTypeName ?? '(unspecified)'} not available in project ${cfg.projectKey}. Available: ${meta.availableIssueTypes.join(', ')}`);
  }

  // 3) Permissions
  const perms = await checkProjectPermissions(jira, cfg.projectKey);
  if (!perms.BROWSE_PROJECTS || !perms.CREATE_ISSUES || !perms.ADD_COMMENTS) {
    const missing = Object.entries(perms)
      .filter(([, ok]) => !ok)
      .map(([k]) => k)
      .join(', ');
    throw new JiraPermissionError(`Missing required project permissions: ${missing}`);
  }
}
