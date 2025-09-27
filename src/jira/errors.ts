export class JiraConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JiraConfigError';
  }
}

export class JiraAuthError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'JiraAuthError';
    this.status = status;
  }
}

export class JiraPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JiraPermissionError';
  }
}
