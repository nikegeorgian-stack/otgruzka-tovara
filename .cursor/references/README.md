# Reference checklists (Addy pack)

Скопировано из [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) `references/`.
Скилы Addy подтягивают эти файлы по необходимости.

| Файл | Когда |
|------|--------|
| `definition-of-done.md` | Критерий готовности любого изменения |
| `testing-patterns.md` | Структура тестов, моки, anti-patterns |
| `security-checklist.md` | Auth, input, OWASP перед merge |
| `performance-checklist.md` | Core Web Vitals, профилирование |
| `accessibility-checklist.md` | WCAG, клавиатура, ARIA |
| `observability-checklist.md` | Логи, метрики, алерты |
| `orchestration-patterns.md` | Персоны Addy, multi-agent |

**Otgruzka поверх Addy:** прод-верификация → `otgruzka-browser-verify`; деплой → `otgruzka-deploy-auditor`; данные → `fst-data-integrity.mdc`.

**Единый гид (v2):** [`docs/OTGRUZKA-SKILLS-GUIDE.md`](../../docs/OTGRUZKA-SKILLS-GUIDE.md) · **Validate:** `npm run agent:validate` · **Archive:** `docs/agent-system/archive/`

Обновление с upstream:

```powershell
git clone --depth 1 https://github.com/addyosmani/agent-skills.git $env:TEMP\addy-agent-skills-compare
Copy-Item "$env:TEMP\addy-agent-skills-compare\references\*" .cursor\references\ -Recurse -Force
```
