# Jira API client setup

This repository includes a minimal Jira API client wrapper for authentication, connection testing, permission checks, and basic project/issue-type validation.

## Environment variables

Set the following environment variables (export in your shell, `.env` via your process manager, or CI secrets). Do not commit secrets.

- `JIRA_HOST` (required): e.g. `your-domain.atlassian.net`
- `JIRA_USERNAME` (required if not using bearer): email used for Jira Cloud
- `JIRA_API_TOKEN` (required if not using bearer): API token from https://id.atlassian.com/manage-profile/security/api-tokens
- `JIRA_BEARER` (optional): bearer token for OAuth 2.0 if you use that flow instead of basic auth
- `JIRA_PROTOCOL` (optional): default `https`
- `JIRA_API_VERSION` (optional): default `2`
- `JIRA_STRICT_SSL` (optional): set to `false` to disable strict SSL
- `JIRA_PROJECT_KEY` (optional): project key to check permissions against (e.g., `ENG`)
- `JIRA_ISSUE_TYPE` (optional): issue type name to validate in the project (e.g., `Task`, `Bug`)

## Quick connectivity check

```bash
# Prints JSON with user, permissions (if JIRA_PROJECT_KEY is set), and project/issue-type metadata
npm run jira:test
```

## Programmatic usage

```ts
import { createJiraClient, testConnection, checkProjectPermissions, assertReady } from '../../src/jira/client.js';

const jira = createJiraClient();
await testConnection(jira); // throws JiraAuthError on 401/403

await assertReady(jira, { projectKey: 'ENG', issueTypeName: 'Task' });
```

## Required permissions

- Browse projects
- Create issues
- Edit issues
- Add comments
- Search issues (covered by Browse projects)

If `assertReady()` fails, the error message will report missing permissions or configuration.

## Notes

- The wrapper uses the [`jira-client`](https://www.npmjs.com/package/jira-client) package under the hood and calls `/myself`, `/mypermissions`, and `/issue/createmeta` endpoints.
- Secrets should always be provided via environment variables or your secret manager; avoid `.env` files in source control.
