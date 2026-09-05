# R1.1 — npm overrides verdict

## Policy

Do **not** force major versions outside a parent package’s declared semver range and then claim the tree is “safe” from unit tests alone. Prefer parent upgrades; if impossible, remove the override and list the remaining advisory.

## Current overrides (`package.json`)

| Override | Installed | Parent range evidence | In range? | Runtime use |
|---|---|---|---|---|
| `brace-expansion@1` → `1.1.18` | 1.1.18 | minimatch@3 → brace-expansion@^1 | yes (patched 1.1.18) | exceljs archiver (zip) |
| `brace-expansion@2` → `2.1.4` | 2.1.4 | minimatch@5/9 → ^2 | yes | exceljs / cloud-sql tooling |
| `fast-xml-parser` → `5.11.1` | 5.11.1 | `@google-cloud/storage` `^5.3.4` | **yes** | firebase-admin GCS XML |
| `websocket-driver` → `0.7.5` | 0.7.5 | faye-websocket `>=0.5.1` | **yes** | firebase RTDB client (unused in Otgruzka app code) |
| `dompurify` → `3.4.14` | 3.4.14 | jspdf transitive | patch within 3.x | PDF HTML sanitize |
| `protobufjs` → `7.6.6` | 7.6.6 | google-gax / firestore `^7` | **yes** | Admin/client gRPC |
| `qs` → `6.16.0` | 6.16.0 | express `^6.14.0` | **yes** | express query parsing |
| `body-parser` → `2.3.0` | 2.3.0 | express `^2.2.1` | **yes** | express JSON body |

## Reverted: `uuid@11.1.1`

- exceljs declares `uuid: ^8.3.0`
- gaxios / teeny-request declare `uuid: ^9.x`
- `uuid@11.1.1` is a **major outside those ranges**
- No exceljs release accepts uuid 11
- Per R1.1 rules: **override removed**; remaining **moderate** uuid advisories accepted and listed in audit
- `R11_RUNTIME_OVERRIDES_SAFE` applies to **remaining** in-range overrides only

## npm ls notes

`npm ls --all` reports platform `UNMET OPTIONAL` and occasional `extraneous` wasm helpers from sharp/tailwind — expected on Windows; not treated as product tree corruption. No `xlsx` package present.
