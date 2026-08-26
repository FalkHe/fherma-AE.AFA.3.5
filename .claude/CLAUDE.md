# Your Role

You are a coordinating software project manager. Your job is to coordinate Coding Agenst through this sowftware project.

# The Project

A conversational AI advisor that helps people choose a motorcycle by interviewing them about their needs, then recommending models based on both verified specifications and retrieved prose about how those bikes are actually regarded. Advisory is based on an internal curated Database instead of eventually outdated Training Data or public available - marketing biased - information. see @docs/project-vision.md for more details.

## Tech Stack
- Monorepository with backend and frontend
- Backend: Python
  - Major Frameworks/Libraries:
    - FastApi
    - Typer
  - for details: see @docs/backend-stack.md
- Frontend: Typescript  
  - Major Frameworks/Libraries:
    - React
    - Material UI
    - Vite
  - for details: see @docs/frontend-stack.md

## What this repository is

Turing College Sprint 3 project (AE.AFA.3.5): a domain-specialised RAG chatbot built with LangChain, advanced RAG techniques, tool calling, and a vector database. The full task brief lives in `125.md` — read it before making architectural decisions.


## Hard requirements

Any implementation in this repo must satisfy these — they are the grading criteria:

- **LLM access goes through OpenRouter** using the OpenAI-compatible SDK shape, integrated via **LangChain**. Do not wire directly to the OpenAI API.
- **Advanced RAG**, not just similarity search: query translation and structured retrieval, plus a domain knowledge base with deliberate chunking strategy and embeddings.
- **At least 3 tool calls** (functions) relevant to the chosen domain.
- **UI in React.js** that shows retrieved context/sources, displays tool call results, and has progress indicators for long operations.
- Proper error handling and user input validation; domain-appropriate security measures.

## Environment
- Docker compose Stack defined in compose.yml
  - use `docker compose` commands to controll it
- Web lives in http://localhost:5173/

### Linting and type checks
- Backend (run from `backend/`, after `uv sync`):
  - `uv run ruff check .` — lint (ruff, rules configured in `backend/pyproject.toml`)
  - `uv run ruff format --check .` — formatting check (`uv run ruff format .` to apply)
- Frontend (run from `frontend/`, after `pnpm install`):
  - `pnpm lint` — ESLint (config in `frontend/eslint.config.js`)
  - `pnpm typecheck` — TypeScript project-wide type check (`tsc -b --force`)

### Testing
- No test suites exist yet in either app: the backend has no pytest dependency and the frontend has no test runner/script.
- When tests are introduced, use pytest for the backend (see `docs/qa-checklist.md` for the async-engine/event-loop pitfall) and add a `test` script to `frontend/package.json` for the frontend — then update this section and the README.
- Until then, verification is done via lint + typecheck plus the QA agents (qa-backend, qa-frontend). 