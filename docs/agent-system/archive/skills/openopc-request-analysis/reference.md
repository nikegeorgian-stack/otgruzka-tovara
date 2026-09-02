# OpenOPC → Cursor mapping (reference)

Full OpenOPC is an AI-native company runtime (Self-Built / Self-Run / Self-Grown,
work-item DAG, collaboration MCP). This skill only borrows the **request
analysis and verification** habits useful inside Cursor.

## Useful extracts from the archive

| Path in OpenOPC | What we reuse |
|-----------------|---------------|
| `.opc/skills/collaboration-playbook/SKILL.md` | Stay in work-item boundary; verifiable handoffs; no fake status |
| `.opc/skills/memory/SKILL.md` | Save only durable preferences, never secrets/transcripts |
| `.opc/skills/core/coding.md` | Understand → plan → implement → verify |
| `.opc/skills/skill-evolution/SKILL.md` | Capture repeating patterns as skills later |

## Not installed as Cursor skills

These need the OpenOPC runtime / MCP and are intentionally skipped:

- company_mode collaboration tools (`send_dm`, meetings, …)
- talent prompts under `.opc/prompts/talent/`
- clawhub / cron / tmux / weather OPC skills
- Office UI / Phaser company simulation

## Priority policy

`openopc-request-analysis` = **low priority overlay**.

Order of precedence:

1. User message (explicit instructions)
2. Project skills (e.g. FST payroll, architecture)
3. User rules / AGENTS.md
4. This skill (thin analysis + verify-before-claim)
