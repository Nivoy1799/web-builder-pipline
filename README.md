# Website Evaluation Pipeline

Multi-agent pipeline that evaluates, researches, plans, and regenerates websites using Claude AI.

## Architecture

```
URL Input
    │
    ├──► 🛡 Security Agent ──┐
    ├──► ⚙ Code Agent ───────┼──► Merge ──► ⛏ Crawler ──► ✎ Planner ──► 🔨 Generator
    └──► ◈ View Agent ───────┘
                                                                            │
                                                                     HTML Output
```

**6 AI agents** (3 run in parallel):

| Agent | Role | Categories |
|-------|------|------------|
| 🛡 Security | Vulnerability scanning | HTTPS/TLS, CSP, cookies, XSS, CSRF, info disclosure |
| ⚙ Code | Technical quality | Semantic HTML, SEO, performance, a11y, responsive, standards |
| ◈ View | Visual / UX | Hierarchy, typography, color, nav, CTAs, whitespace, polish |
| ⛏ Crawler | Business intel | Company profile, competitors, reviews, social, brand voice |
| ✎ Planner | Strategy | Design system, sitemap, content, security fixes, phases |
| 🔨 Generator | Build | Complete HTML/CSS/JS from plan |

## Project Structure

```
src/
├── prompts/
│   └── index.js          # All agent system prompts
├── lib/
│   ├── claude.js          # API wrapper, JSON repair, HTML parser
│   ├── constants.js       # Category labels, icons, step definitions
│   └── pipeline.js        # Orchestrator logic (framework-agnostic)
├── components/            # React UI components (TODO: extract from App)
└── App.jsx                # Main React component (TODO)
```

## Usage

### As Claude Artifact

Copy `pipeline.jsx` (monolith version) into a Claude artifact — it runs standalone.

### With Claude Code

```bash
cd pipeline
claude                     # start Claude Code session

# Example prompts:
# "Add a re-evaluation loop that scores the generated site"
# "Extract the UI components from the monolith into src/components/"
# "Add persistent storage for pipeline run history"
# "Write tests for the JSON repair function"
```

### Local Development (when ready)

```bash
npm install
npm run dev
```

## Key Design Decisions

- **Parallel evaluation**: `Promise.allSettled` runs all 3 eval agents simultaneously. Pipeline continues if 2/3 succeed.
- **JSON repair**: Truncated API responses are auto-repaired by closing unclosed brackets/strings.
- **Token budgets**: Eval agents get 8K tokens, generator gets 16K.
- **Prompt engineering**: Each sub-agent has domain-specific JSON schemas with 8 categories and evidence-citing instructions.

## Next Steps

- [ ] Extract React components from monolith into `src/components/`
- [ ] Add `window.storage` persistence for run history
- [ ] Add Vite config + local dev setup
- [ ] Re-evaluation loop (score generated output)
- [ ] n8n webhook integration for backend pipeline
- [ ] Batch mode for multiple URLs
