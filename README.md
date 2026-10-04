# ANGEL AGENT

## Features

### Product Management
- Product Knowledge Base
- Product CRUD
- USP / Target Customer / Customer Problem Management
- Product Cost / Price / Margin Management
- Product Asset Management

### VOC Intelligence
- CSV / XLSX Review Import
- Review Database
- AI VOC Analysis
- Pain Point Extraction
- Desire & Purchase Motivation Analysis
- Customer Language Extraction
- Product Improvement Insights
- FAQ Generation

### Advertising Intelligence
- Ad Reference Library
- Competitor Ad Management
- Hook / Problem / Desire / Proof / CTA Analysis
- Ad Structure Analysis
- Product-to-Ad Reference Mapping

### AI Content Generation
- Ad Hook Generation
- Ad Copy Generation
- Short-form Video Scripts
- Marketing Video Scripts
- Threads Content
- Instagram Content
- Blog Content
- Copy Variations

### AI Detail Page
- Detail Page Structure Generation
- Sales Copy Generation
- Section-based Page Planning
- Image Prompt Generation
- Brand Tone Application
- React Template Rendering
- Detail Page Preview
- AI-assisted Editing

### Product Sourcing
- Sourcing Candidate Database
- Supplier Management
- Cost / MOQ / Margin Analysis
- Competitor Product Analysis
- Market Opportunity Analysis
- AI Product Evaluation

### Commerce Intelligence
- Sales Dashboard
- Order Analytics
- Advertising Performance
- ROAS / CPA Analysis
- Product Profitability
- Inventory Management
- Margin Analysis
- KPI Monitoring

### Automation
- Scheduled Data Collection
- Webhook Processing
- Sales Data Sync
- Advertising Data Sync
- Inventory Sync
- Review Sync
- Anomaly Detection
- Inventory Alerts
- Automated Reports

### AI Agent
- Product Retrieval
- VOC Analysis
- Ad Search & Analysis
- Content Generation
- Script Generation
- Detail Page Generation
- Sales Analysis
- Inventory Analysis
- Tool Calling
- Multi-step Workflow Execution

### Social & Generative AI
- Threads Content Collection
- Viral Content Analysis
- Automated Social Publishing
- AI Image Generation
- AI Video Generation
- Image / Video Prompt Generation

### Commerce Operations
- Product Cost Calculator
- Import Cost / Exchange Rate / Fee Calculation
- Margin & Profit Analysis
- Product MAP Management
- Sales Performance Analysis
- Advertising Performance Analysis
- ROAS / CPA / CVR Tracking

### Sourcing Intelligence
- Supplier Database
- Supplier Quote Comparison
- MOQ / Cost / Lead Time Management
- Supplier Monitoring
- Competitor Product Monitoring
- Product Research Automation
- Market Opportunity Analysis

### Data & File Operations
- CSV / XLSX Import
- PDF / Spreadsheet Data Extraction
- Automatic File Classification
- Bulk File Rename / Conversion
- Product Image Batch Processing
- Image Resize / Compression / WebP Conversion
- Structured Data Mapping

### Monitoring & Reporting
- Competitor Price Monitoring
- Promotion / Product Change Detection
- Inventory Monitoring
- Scheduled Data Collection
- Daily / Weekly Reports
- KPI Monitoring
- Anomaly Detection
- Automated Work Logs
- Task & Workflow History

---

## Architecture

```mermaid
flowchart TD

    subgraph DATA[Data & Knowledge]
        P[Product DB]
        V[VOC / Reviews]
        A[Ad Library]
        S[Supplier / Sourcing Data]
        C[Commerce Data]
        F[Files / Documents]
        M[Market / Competitor Data]
    end

    subgraph CORE[ANGEL AGENT Core]
        AGENT[ANGEL AGENT]
        AI[GPT / Claude / Gemini]
    end

    subgraph OPERATIONS[Commerce Operations]
        COST[Cost / Margin Calculator]
        MAP[Product MAP]
        SALES[Sales / Ad Analytics]
        INVENTORY[Inventory Management]
    end

    subgraph GENERATION[AI Generation]
        CONTENT[Content Generator]
        SCRIPT[Ad / Shorts Studio]
        DETAIL[Detail Page Generator]
        MEDIA[Image / Video Workflow]
    end

    subgraph AUTOMATION[Automation & Monitoring]
        MONITOR[Supplier / Competitor Monitoring]
        SYNC[Data Sync]
        REPORT[Automated Reports]
        ANOMALY[Anomaly Detection]
        FILEOPS[File Processing]
    end

    subgraph INFRA[Agent Infrastructure]
        TOOLS[Tool Calling / MCP]
        OPENCLAW[OpenClaw]
        DEV[Codex / Claude Code]
    end

    P --> AGENT
    V --> AGENT
    A --> AGENT
    S --> AGENT
    C --> AGENT
    F --> AGENT
    M --> AGENT

    AI --> AGENT

    AGENT --> COST
    AGENT --> MAP
    AGENT --> SALES
    AGENT --> INVENTORY

    AGENT --> CONTENT
    AGENT --> SCRIPT
    AGENT --> DETAIL
    AGENT --> MEDIA

    AGENT --> MONITOR
    AGENT --> SYNC
    AGENT --> REPORT
    AGENT --> ANOMALY
    AGENT --> FILEOPS

    AGENT --> TOOLS
    TOOLS --> OPENCLAW
    TOOLS --> DEV
```
    


## Tech Stack

### Application
- Next.js 16
- React
- TypeScript
- Tailwind CSS

### Backend & Database
- Next.js Server Components
- Server Actions / Route Handlers
- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage

### AI
- OpenAI API
- Anthropic Claude API
- Google Gemini API
- Structured Output
- Tool Calling

### Commerce & Marketing Integrations
- Cafe24 API
- Naver Commerce API
- Coupang API
- Meta Marketing API
- Google Ads API
- Threads API

### Automation
- Cron Jobs
- Webhooks
- Background Workflows

### Generative Media
- Gemini Image
- Kling
- Veo
- Seedance

### Agent Infrastructure
- MCP
- OpenClaw
- Codex
- Claude Code

### Infrastructure
- Vercel
- Git
- GitHub

