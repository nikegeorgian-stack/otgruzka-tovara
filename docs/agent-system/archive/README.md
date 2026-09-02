# Agent system archive (Otgruzka)

Versioned archive of skills and agents **removed from Cursor auto-discovery paths** (`.cursor/skills/`, `.agents/skills/`, `.cursor/agents/`).

Canonical active skills: **`.cursor/skills/<name>/SKILL.md`**

## Why archive instead of delete

- Preserve Addy/upstream history and local customizations
- Allow manual restore if a workflow returns
- Record decision date and reason per folder (`ARCHIVE_REASON.txt`)

## Archived skills (2026-09-02)

| Skill | Was in | Reason |
|-------|--------|--------|
| `ayla-saas-admin-ui-ux-pro` | `.cursor/skills` | Unused SaaS kit; Otgruzka uses `fc-*` Tailwind |
| `ui-ux-pro-max` | `.cursor/skills` | Redundant with `frontend-ui-engineering` + `fst-design-system` |
| `using-agent-skills` | both | Meta; covered by `docs/OTGRUZKA-SKILLS-GUIDE.md` |
| `spec-driven-development` | both | Superseded by `speckit-*` |
| `context-engineering` | both | Rare; use `planning-and-task-breakdown` |
| `doubt-driven-development` | both | Use `project-guardian` for disputes |
| `shipping-and-launch` | both | Generic; `otgruzka-deploy-auditor` for Otgruzka |
| `deploy-to-vercel` | both | Generic; `otgruzka-deploy-auditor` + deploy rule |
| `speckit-checklist` | `.cursor/skills` | Not in active Spec Kit flow |
| `speckit-taskstoissues` | `.cursor/skills` | No GitHub Issues sync |
| `openopc-request-analysis` | `.cursor/skills` | Rule → `fst-core-policy.mdc` |
| `firebase-crashlytics` | `.agents/skills` | Not in Otgruzka web |
| `firebase-remote-config-basics` | `.agents/skills` | Not used |
| `firebase-ai-logic-basics` | `.agents/skills` | Not used |
| `xcode-project-setup` | `.agents/skills` | iOS out of scope |
| `extension-to-functions-codebase` | `.agents/skills` | Not used |

Duplicates from `.agents/skills/` are under `skills/_agents-duplicate-<name>/` (canonical copy kept in `.cursor/skills/`).

## Archived agents (2026-09-02)

| Agent | Replaced by |
|-------|-------------|
| `code-reviewer` | `product-verifier` |
| `test-engineer` | `product-verifier` |
| `web-performance-auditor` | `vercel-react-best-practices` + `performance-optimization` skills |

## Restore procedure

```powershell
Copy-Item -Recurse docs/agent-system/archive/skills/<name> .cursor/skills/<name>
# Update docs/OTGRUZKA-SKILLS-GUIDE.md and fst-skill-router.mdc
```
