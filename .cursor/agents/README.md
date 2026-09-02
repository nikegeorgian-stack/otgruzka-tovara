# Otgruzka subagents

| Agent | Mode | When |
|-------|------|------|
| **`project-guardian`** | read-only | Before cross-module / store / SQL / roles changes |
| **`product-verifier`** | review | After implementation — diff, tests, journals, coach, scope |
| **`security-auditor`** | read-only | Explicit security review |
| **`timesheet-doc-critic`** | specialized | Timesheet-as-documents feature PASS/FAIL |

Legacy archived: `docs/agent-system/archive/agents/` (`code-reviewer`, `test-engineer`, `web-performance-auditor`).

Invoke via Cursor Task tool with matching `subagent_type` or custom prompt referencing this file.

## Typical chain

```
project-guardian → implement → product-verifier → otgruzka-browser-verify (UI)
```

Deploy only on explicit user request (`fst-deploy-otgruzka.mdc`).
