#!/usr/bin/env tsx
import { createJiraClient, readJiraEnv, testConnection, checkProjectPermissions, verifyProjectAndIssueType } from '../../src/jira/client.js';

async function main() {
  try {
    const env = readJiraEnv();
    const projectKey = process.env.JIRA_PROJECT_KEY?.trim();
    const issueTypeName = process.env.JIRA_ISSUE_TYPE?.trim();
    const jira = createJiraClient(env);

    const conn = await testConnection(jira);
    if (!conn.ok) {
      console.error(JSON.stringify({ ok: false, step: 'auth', error: conn.error, status: conn.status }));
      process.exit(1);
    }

    const out: any = { ok: true, user: { accountId: conn.accountId, displayName: conn.displayName } };

    if (projectKey) {
      out.project = { key: projectKey };
      out.permissions = await checkProjectPermissions(jira, projectKey);
      const meta = await verifyProjectAndIssueType(jira, { projectKey, issueTypeName });
      out.project.meta = meta;
    }

    console.log(JSON.stringify(out));
  } catch (err: any) {
    const status = err?.statusCode || err?.status;
    console.error(JSON.stringify({ ok: false, error: err?.message || String(err), status }));
    process.exit(1);
  }
}

main();
