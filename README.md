# AI Support Bot Correction Tracker

> An automated intelligence system that detects AI support bot corrections in Google Chat, analyzes patterns using AI, and generates targeted documentation improvements — seamlessly integrating with existing Jira workflows and Docusaurus documentation to create a continuous improvement loop for internal support quality.

## 🎯 Project Overview

The AI Support Bot Correction Tracker transforms scattered chat corrections into structured documentation improvements and bot training data through an intelligent automation pipeline.

### The Problem
- AI Support bot occasionally provides incorrect answers in internal Google Chat channels
- Team members manually correct these responses, but corrections are lost after conversations end
- No systematic way to identify patterns, improve bot training, or create targeted documentation
- Knowledge gaps go unaddressed, leading to repeated corrections

### The Solution
**Detect** → **Analyze** → **Act** → **Improve**

1. **Detect**: Capture correction conversations using Google Chat slash commands
2. **Analyze**: Use OpenAI to classify correction types and extract structured data
3. **Act**: Automatically create Jira tickets and generate documentation update suggestions
4. **Improve**: Provide analytics and insights for continuous bot and documentation enhancement

## 🏗️ System Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Google Chat   │───▶│   Orchestration  │───▶│   Analytics &   │
│   Integration   │    │     Service      │    │   Reporting     │
│ (Haley's Part)  │    │   (Jon's Part)   │    │   (Jon's Part)  │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │    AI Analysis      │
                   │   (OpenAI API)      │
                   └─────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            ┌───────────────┐   ┌─────────────────┐
            │     Jira      │   │     GitHub      │
            │  Integration  │   │  Documentation  │
            │               │   │    Analysis     │
            └───────────────┘   └─────────────────┘
```

## 🔧 Core Components

### 1. **OpenAI Integration** (JON-12)
- AI-powered correction analysis and classification
- Prompt engineering for accurate correction type detection
- Rate limiting and cost control

### 2. **Correction Analysis Engine** (JON-13)
- Data parsing and validation from Google Chat
- Structured data extraction and output formatting
- Confidence scoring and classification logic

### 3. **Jira Integration** (JON-14)
- Automated ticket creation and management
- Smart search for existing related issues
- Rich context inclusion in tickets

### 4. **GitHub Documentation Analysis** (JON-15)
- Documentation repository search and analysis
- Content analysis for identifying update needs
- Specific, actionable update suggestions

### 5. **Orchestration Service** (JON-16)
- Central workflow coordination
- HTTP endpoints for Google Chat integration
- Comprehensive error handling and logging

### 6. **Analytics & Pattern Recognition** (JON-17)
- Data collection and trend analysis
- Automated reporting and insights
- Pattern recognition for proactive improvements

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- OpenAI API key (Response API)
- Jira API access
- GitHub API token
- Google Chat Apps Script integration (Haley's component)

### Environment Variables
```bash
# OpenAI (Response API)
OPENAI_API_KEY=your_openai_api_key               # required
OPENAI_MODEL=gpt-4o-mini                         # optional default model
OPENAI_MAX_RETRIES=3                             # optional; transient retries in limiter
OPENAI_BUDGET_PERSIST=file                       # optional; persist monthly spend
OPENAI_BUDGET_FILE=.cache/openai_budget.json     # optional; path for spend file
LOG_LEVEL=info                                   # debug|info|warn|error

# Jira
JIRA_HOST=your-company.atlassian.net
JIRA_USERNAME=your_email@company.com
JIRA_API_TOKEN=your_jira_token
JIRA_PROJECT_KEY=SUPPORT

# GitHub
GITHUB_TOKEN=your_github_token
GITHUB_REPOS=company/help-docs,company/api-docs

# Service (if/when applicable)
SERVICE_VERSION=1.0.0
PORT=3000
```

### Installation
```bash
# Clone the repository
git clone https://github.com/your-org/ai-support-bot-correction-tracker.git
cd ai-support-bot-correction-tracker

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys and configuration

# TypeScript check
npm run typecheck

# Run tests
npm test

# Optional: verify OpenAI connectivity (requires OPENAI_API_KEY)
npm run openai:test
```

## 📋 Development Roadmap

### Phase 1: Foundation APIs (Week 1)
- [ ] OpenAI API client setup and authentication
- [ ] Data parser for Google Chat integration
- [ ] Jira API client and basic connectivity
- [ ] GitHub API client and repository access
- [ ] Analytics data storage foundation

### Phase 2: Core Logic (Week 2)
- [ ] Prompt templates and classification logic
- [ ] Correction type classification implementation
- [ ] Jira issue search with JQL
- [ ] Documentation repository search

### Phase 3: Integration Logic (Week 3)
- [ ] Rate limiting and error handling
- [ ] Structured output formatting
- [ ] Jira ticket creation and update logic
- [ ] Documentation content analysis
- [ ] Main service endpoint

### Phase 4: Orchestration & Analytics (Week 4)
- [ ] GitHub update suggestions
- [ ] Workflow orchestration logic
- [ ] Comprehensive error handling and logging
- [ ] Pattern recognition algorithms
- [ ] Automated reporting system
- [ ] Integration tests

## 🎯 Success Criteria

- ✅ **90%+ Detection Accuracy**: Successfully identify actual correction conversations
- ✅ **<10% False Positive Rate**: Maintain low false positive rate for corrections
- ✅ **30-Second Processing**: Complete workflow within 30 seconds
- ✅ **99%+ Uptime**: Reliable webhook processing and data capture
- ✅ **Actionable Insights**: Generate 20+ documentation improvement suggestions
- ✅ **Team Adoption**: Support team actively using generated tickets

## 🔗 Linear Project

Track development progress: [AI Support Bot Correction Tracker](https://linear.app/jonn/project/ai-support-bot-correction-tracker-4456965a7a36)

## 🤝 Team

- **Jon Neher**: AI integration, pattern recognition, and orchestration service
- **Haley Serrano**: Google Chat integration and webhook processing

## Centralized prompts

Parameterizable LangChain `ChatPromptTemplate` definitions with Zod-typed outputs live under `src/prompts/` (see `docs/prompts/README.md`). These templates power correction analysis, documentation generation, and pattern recognition, and include few-shot examples plus version metadata.

## OpenAI Response API quickstart

Use the rate limiter for production pathways; it calls our Response API client under the hood:

```ts
// Inside this repo (source):
import { OpenAIRateLimiter } from './src/index.js';

const limiter = new OpenAIRateLimiter(50, 100);
const res = await limiter.makeRequest('Summarize this text:', {
  model: 'gpt-4o-mini',
  maxTokens: 128,
  temperature: 0.2,
});
console.log(res.content);
```

See docs for details:

- Internal API reference: docs/internal/api-reference.md
- Migration guide: docs/guides/response-api-migration.md
- Troubleshooting: docs/troubleshooting/response-api.md

## 📖 API Documentation

### Main Endpoint
```http
POST /process-correction
Content-Type: application/json

{
  "threadContext": {
    "originalQuestion": "How do I reset my partner dashboard password?",
    "botResponse": "You can reset passwords in Account Settings under Security.",
    "timestamp": "2024-07-15T10:30:00Z",
    "userId": "user123",
    "channelId": "channel456"
  },
  "correctionFields": {
    "wrong": "Account Settings → Security",
    "right": "Partner Center → Profile page",
    "reason": "UI changed in 2024.07"
  }
}
```

### Health Check
```http
GET /health

Response:
{
  "status": "healthy",
  "timestamp": "2024-07-15T10:30:00Z",
  "version": "1.0.0"
}
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e

# Test coverage
npm run test:coverage
```

## 📊 Monitoring & Analytics

The system provides comprehensive analytics including:
- **Correction Trends**: Identify recurring topics and patterns
- **System Performance**: Processing times and API usage
- **Bot Improvement**: Track accuracy improvements over time
- **Documentation Impact**: Measure effectiveness of updates

## 🔐 Security

- API key management through environment variables
- Rate limiting to prevent abuse
- Input sanitization and validation
- Secure credential storage
- CORS configuration for web interfaces

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤖 AI-Powered Development

This project leverages AI throughout:
- **OpenAI**: For correction analysis and classification
- **Automated Code Generation**: Using AI coding assistants for implementation
- **Pattern Recognition**: AI-driven insights and trend analysis
- **Content Generation**: Automated documentation suggestions

---

*Built with ❤️ for continuous improvement and intelligent automation*
