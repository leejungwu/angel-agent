# Angel Agent

Angel Agent is an internal AI-powered workspace for automating and supporting ecommerce operations.

It brings content creation, publishing workflows, product operations, customer feedback analysis, knowledge workflows, and browser-based automation into a single system.

The project is designed as a modular platform rather than a collection of isolated automation scripts. Domains can evolve independently while sharing infrastructure for AI providers, persistent data, and browser-side execution.

## Core Areas

### Content & Publishing

AI-assisted content generation, editing, asset management, publishing preparation, and browser-assisted publishing workflows.

### Product Operations

Tools for managing and processing product-related information and supporting ecommerce workflows.

### Customer Intelligence

Collection, organization, and analysis of customer feedback, with reusable voice-of-customer (VOC) insights.

### Advertising References

A library of reference ads, source and landing URLs, optional media files, and product associations.

### Knowledge Workflows

Tools for generating and organizing knowledge-based content, including Q&A workflows.

### Browser Automation

Chrome Extension components for workflows that interact with external web services.

## Architecture

Angel Agent is built around a modular application structure:

- Next.js for the application and APIs
- Supabase for persistent data and file storage
- Multiple AI providers for content generation and analysis
- Chrome Extension components for browser-side execution
- Shared domain libraries for business logic and workflow coordination

Detailed implementation and system relationships are documented separately.

## Documentation

- [ROADMAP](docs/ROADMAP.md) — product capabilities, development priorities, and planned features
- [ARCHITECTURE](docs/ARCHITECTURE.md) — system structure, module responsibilities, and data/workflow relationships
- [AI_GENERATION](docs/AI_GENERATION.md) — AI generation architecture and behavior
- [Chrome Extension](extension/README.md) — Chrome Extension implementation details

## Development

Use the repository scripts defined in `package.json` for local development, validation, testing, and builds.
