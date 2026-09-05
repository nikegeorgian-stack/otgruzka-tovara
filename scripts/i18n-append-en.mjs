import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const translations = {
  "access.adminHint": "Create users, link them to employee records, and configure which sections each role can see. For cloud, login must match the sign-in e-mail.",
  "access.adminHintWeb": "New user: e-mail, sign-in password (created in Firebase), role, employee, and sections. Shared role permissions — «Interfaces» tab.",
  "access.cabinetPreviewHint": "You remain an administrator. Menu matches «Interfaces» for the selected role (not a trimmed web cabinet).",
  "access.defaultBrigadesHint": "This account's scope: view and edit only selected brigades (strict for shop foreman). Does not limit HR/finance.",
  "access.employeeHint": "Linking is required so the system knows whose account this is (foreman brigades, signatures, journals). One employee — one account.",
  "access.firebaseListOptional": "Firebase sign-in list unavailable (server key). This does not block setup: you link employee and permissions in the app — e-mail accounts already exist in Firebase.",
  "access.interfacesHint": "Sections are grouped. Timesheet permission is separate: none / view / edit (foreman — own brigades only).",
  "access.negativeStockHint": "Allow batch or issue when stock is short (with warning). Storekeeper balances stock.",
  "access.passwordFirebaseOneTimeHint": "One-time password: user sets their own on first sign-in. Minimum 8 characters.",
  "access.passwordResetOneTimeHint": "Set a temporary password and give it to the employee. Account appears in Firebase Authentication if not there yet. On sign-in, employee changes password to their own.",
  "access.timesheetScopeHint": "Role sets level (view / edit). Brigades below — whose people this person can access.",
  "access.userSavedAllowlistWarn": "Saved. Access list in Firestore not updated — sign-in already allowed by rules for these e-mails.",
  "access.userViewsEmployeeOnly": "«Employee» role — personal «My» cabinet only (hours and pay). Timesheet and other sections unavailable.",
  "access.userViewsHint": "Check any sections. If none selected — role sections from «Interfaces» tab are used.",
  "cellPicker.cycleFirstHint": "This day is the first working day of the cycle; schedule continues automatically",
  "cellPicker.cycleLastHint": "This day is the last working day in the shift: then 2 days off and 2-on-2 again",
  "coach.intro": "Ask in your own words — I'll explain step by step and highlight where to click. For example:",
  "coachAnalytics.hint": "Non-deletable log of staff questions. Helps see where employees struggle most often.",
  "common.resetConfirm": "Delete ALL local app data (timesheet, HR, finance)? This cannot be undone. Export JSON first if needed.",
  "coverage.hint": "Numbered document: draft grants no access; after posting, rule applies in the specified period (and in the open month's timesheet).",
  "directories.payAccrual.codePlan": "Month norm — plan in timesheet. Salary ÷ plan hours = ₾/h. Actual = plan → full salary; actual > plan → overtime.",
  "directories.payAccrual.planNormBody": "Each employee has their own norm: sum of plan hours in the timesheet for the month. If plan is 100 h — to get salary, work 100 h. Rate ₾/h = salary ÷ month plan. No fixed «165 / 176».",
  "directories.payAccrual.subtitle": "Pay coefficients: night, idle, overtime. Changes here immediately affect payroll calculation.",
  "docHeader.settingsHint": "Enable fields by presets. Empty organization fields come from employer details.",
  "editLock.conflictMsg": "While you were editing, the record was changed elsewhere. Overwrite with your data, load new, or cancel?",
  "employee.picker.assignConflictNotice": "{name} is already planned in brigade «{from}». Assigning to «{to}» removes them from the previous brigade.",
  "fin.accrual.editHint": "Change amount manually — saved as individual (fixed) for this statement. Permanent employee rule — in «Rates».",
  "fin.accrual.emptyBody": "No employees with salary and advance rule. Check rates and default %.",
  "fin.accrual.hint": "First accrue (due), then create AV payout. Default 30% of salary; in rates you can set individual permanently, in NA draft — adjust amount for this month.",
  "fin.accrual.individualHint": "Individual permanently: Finance → Rates (own % or fixed ₾). This month: open draft → «Lines».",
  "fin.bankTransfer.copySheetHint": "Click yellow cell with account → Ctrl+C. Filter by bank and name — in header.",
  "fin.bankTransfer.excelHint": "Filter in table header: alphabetically, bank, amount, department. Yellow column «Account → Ctrl+C» — select cell and copy. Sheet «Copy accounts» — accounts only.",
  "finance.rates.individualHint": "«Ind.» checkbox — employee's personal rate/salary overrides staffing table. When role salary changes, such employees are not affected.",
  "finishedProduct.stockHint": "Warehouse balance — by linked item; «Produced» — sum of actuals from planner orders.",
  "formulation.componentsWhHint": "«In batch, kg» — how much is written off warehouse per one cook. Balance and shortage calculated automatically.",
  "formulation.editorHint": "Calculation only by warehouse consumption: link components to nomenclature and specify «in batch, kg». On save, finished impregnation item with FC-… code and EAN-13 barcode is created.",
  "formulation.importHint": "Each recipe — impregnation batch: ~800 kg dry base + water to 1000 kg. Components: dispersions, calcite, dispersant, thickener, water, pigment pastes. Cost by €/kg or $/kg price.",
  "formulation.troubleHighGsm": "If grammage above plan — reduce dispersion or add 10–15% water, check dry residue.",
  "formulation.troubleLowGsm": "If grammage below plan — increase LL 145-50 dispersion or reduce water by 0.5% per step.",
  "formulation.warehouseHint": "Item appears in «Chemistry» category. When batch is released by recipe, it is written off and replenished via warehouse.",
  "hr.candidate.hireConfirm": "Hire «{name}» to staff? Employee record and timesheet row will be created.",
  "hr.cec.err.cec_cloudflare": "CEC site blocked automatic request. Open ems-voters.cec.gov.ge in browser and copy addresses manually",
  "hr.cec.err.cec_cors_or_network": "Browser could not reach CEC site. Try again or fill addresses manually",
  "hr.cec.err.cec_not_found": "Data not found. Check number and surname or open CEC site manually",
  "hr.cec.hint": "For Georgian citizens: enter personal number and surname, then «Open CEC site» — site opens in separate window (Cloudflare), copy addresses into record.",
  "hr.cec.portal.cloudflareHint": "Click «Open CEC site window». If browser asks — allow pop-ups for this site. Pass Cloudflare check in opened window, find employee and copy addresses into fields below.",
  "hr.cec.portal.popupBlocked": "Browser blocked window. Allow pop-ups or click «Open in tab».",
  "hr.cec.portal.popupOpen": "CEC window open — number and surname passed in link. If fields empty after Cloudflare, paste from clipboard (Ctrl+V).",
  "hr.cec.portal.step2": "Number and surname will be filled in site form — pass Cloudflare and click «ძებნა» (search).",
  "hr.cec.portal.subtitle": "CEC site cannot be embedded in page — it opens in separate browser window where Cloudflare check runs.",
  "hr.document.googleHint": "If document does not load, check «anyone with link» access in Google Drive.",
  "hr.document.previewUnavailable": "Embedded preview unavailable for this link. Open document in browser.",
  "hr.leave.archiveHint": "Each operation is written to employee document archive and journal — even without scan. Scan/PDF recommended for complex reports.",
  "hr.leave.dismissalHint": "Pay for worked days of month — in timesheet and finance (AV/salary). Button below records vacation payout snapshot in document archive and journal; if balance > 0 also writes off compensation.",
  "hr.leave.dismissalPay": "Compensation estimate: {days} × {rate} ₾ ≈ {amount} ₾ (daily average = salary / 30)",
  "hr.leave.openingHint": "Enter balance as of date (below). Auto-accrual +2 only for full months after that date — no double counting. Vacations after date are written off from record.",
  "hr.leave.rule": "For each full calendar month on staff, {n} days accrue. Hire/dismissal month «in the middle» gives no days.",
  "hr.nameBlock.autoHint": "Until Georgian field is edited manually — it is filled from Russian (draft, can be corrected).",
  "hr.registryImport.clearConfirm": "Delete all employees ({count}) and candidates? Timesheet and PPE issues will be unlinked. Action is irreversible.",
  "hr.registryImport.confirm": "Registry has {count} people, database has {existing}. Update records from registry?",
  "hr.registryImport.confirmByName": "Registry has {total} people. Matched by name in database: {matched}, new (not in database): {missing}. Currently {existing} in database. Update matched and choose who to create?",
  "hr.registryImport.done": "Done: updated by name {matched}, added {created} of {total}. Not created: {skipped}. Unchanged in database (not in registry): {left}.",
  "hr.registryImport.hint": "Upload Excel or ODS «EMPLOYEE REGISTRY». Records get: name, badge #, position, phone, email, IBAN (account), salary, contract dates, contract # and labor registry #, links to ID and contracts (Google Drive). Dismissed — status «Dismissed» with date.",
  "hr.registryImport.missingHint": "Matched by name {matched}. Check who from registry to add as new employees.",
  "hr.registryImport.replaceConfirm": "Replace entire employee list with registry rows only? «Yes» — clean import. «No» — merge with current database (match by badge # or name).",
  "hr.rs.hint": "Official tax service: taxpayer name by personal number / TIN. Does not verify IBAN.",
  "hr.sickOverLimit": "40 consecutive working days limit exceeded — further sick pay is limited by rules.",
  "hr.vacationPeriodHint": "Specify period from — to. «OT» is set only on shift days per schedule (like sick leave).",
  "hr.vacationPlanFact": "In timesheet plan and actual: «OT» only on schedule working days; days off stay «V». Working days counted.",
  "journals.subtitle": "Documents (statements, warehouse) stored permanently; change events — in ring journal",
  "month.cellRemoteChanged": "Day {day} ({mode}): code changed by another user ({was} → {now}). Code picker closed.",
  "month.confirmBulkCopyScoped": "Copy plan to actual only for selected brigades in your scope ({count})?",
  "month.confirmBulkHolidayScoped": "Set holiday «V» on holidays only in your brigades ({count})?",
  "month.confirmRegenerate": "Recalculate entire month plan from schedules? Manual plan edits will be lost. Actual untouched.",
  "month.confirmRegenerateRow": "Recalculate this row's plan from schedule? Manual plan edits for employee will be lost.",
  "month.masterBrigadesHint": "Highlighted brigades are yours. You can enable others if employees worked another shift.",
  "month.masterViewHint": "Default — your brigades. When employee moves to another shift, enable needed brigade in filter, mark actual (codes X, B, OT, etc.) and for substitution — RMB on cell → «Substitution». Entry/exit journal — «Prepare and print» button.",
  "month.planEditorScrollHint": "Scroll the table. In «Edit» mode — change codes and 2/2 group (A/B).",
  "nightShift.hint": "Select groups or brigades, mark people and post document — actual gets code N (+25%).",
  "planner.material.activateWarn": "Order lacks materials in warehouse. Start work anyway?",
  "planner.material.hintBody": "Need calculated from order: raw rolls (mesh / membrane / ratl), pallets and boxes. Reserve reduces free warehouse balance but does not write off material — write-off still via issue documents.",
  "planner.rawPlanHint": "Plan only here: which raw we plan to use. Actual raw specified at production.",
  "procurement.attach.hint": "Attach scans of contract, invoice, packing list, supplier correspondence. PDF and images up to 3 MB.",
  "procurement.linesNomenclatureHint": "Check «to nom.» — on save item appears in warehouse nomenclature (can pick existing above).",
  "procurement.tracking.apiHint": "For full auto-sync add API keys to server .env. Without keys use manual stage updates.",
  "procurement.tracking.apiNotConfigured": "API not configured — open line site and update status with buttons below",
  "procurement.tracking.manualHint": "1) Open line site → 2) Specify location (optional) → 3) Click stage",
  "procurement.tracking.mscPortalHint": "MSC: data loaded from public tracking, no keys needed",
  "procurement.tracking.noApiBody": "Lines do not return data without key. Open line site, check status and click needed stage below — status and journal update automatically. CMA CGM offers free key at api-portal.cma-cgm.com.",
  "procurement.tracking.portalManual": "Auto-load unavailable for this line — open site and click stage manually",
  "procurement.tracking.refreshJournalHint": "Pull status and route from carrier site into journal",
  "procurement.tracking.serverRestart": "Local server needs restart: stop «FiberCell local server» and start again, then refresh page (Ctrl+F5)",
  "procurement.tracking.subtitleShort": "Enter container number — status updates from line data (check every 12 h)",
  "procurement.tracking.wrongRefType": "Line returned no events for this number. Check number type (container / booking / B/L) or update stage manually",
  "production.duplicateWarn": "Request already exists for this date, line and shift. Open it in journal or change shift/date.",
  "production.packPlanStats": "{rolls} raw rolls · {pallets} pal. · {boxes} boxes · {perPallet} rolls/pallet",
  "production.plannerBannerBody": "Based on plan(s) {orders} formed automatically. Check volume and brigade before posting.",
  "production.plannerDayHint": "Planner already calculated volume by lines — pick up in request with one button.",
  "production.rosterAddExtraHint": "Employee from another brigade or newcomer — this request only, no timesheet change.",
  "rollcall.addDayHint": "Temporarily to this brigade for selected day. If employee has shift in another brigade — hours count only here.",
  "rollcall.permanentConfirm": "Assign employee to this brigade permanently (HR record will change)?",
  "rollcall.setBrigadierHint": "Permanent brigade leader. If primary is idle/on leave — choose deputy from list.",
  "settings.aiCloudWarning": "⚠ Cloud AI sends query text and employee names to OpenAI/Kimi server. For confidential data use built-in assistant.",
  "settings.aiCursorNote": "Cursor IDE subscription alone does not connect to the app — OpenAI or Kimi API key required.",
  "settings.aiGeminiHint": "Key from Google AI Studio (aistudio.google.com/apikey). Model e.g. gemini-2.0-flash-lite (higher limits) or gemini-2.0-flash. On 429 error enable project billing or wait a minute.",
  "settings.aiKeyAdminOnly": "API key visible and editable by administrator only. Other employees use assistant but cannot see key.",
  "settings.aiLocalHint": "Works without API. Searches employees in database (surname with typo — up to 2 letters), understands multiple and brigades. Type «help» in chat.",
  "settings.aiOpenaiHint": "Key from platform.openai.com. Same key can be set in Cursor → Settings → Models → OpenAI.",
  "settings.rs.envLocked": "Login set via server environment variables (RS_GE_USERNAME / RS_GE_PASSWORD) — change from UI disabled.",
  "settings.rs.err.rs_auth": "RS rejected login/password for SOAP API. Enter again same password as on site («Save and verify» button). If site works but here — no: sometimes cabinet has different password for web services.",
  "settings.rs.hint": "Same login and password as rs.ge / eservices.rs.ge (ERS-… allowed). Invoice su/sp password — only if same for site sign-in. After save we immediately verify access with tax service.",
  "settings.rs.security": "Stored on server only (secret document / env). Client does not read password.",
  "sharedRoot.employeesDirectories": "Same employee registry (AppStore). Full records and HR documents — in Personnel.",
  "sharedRoot.employeesFinance": "Same employee registry (AppStore) as in Personnel. Rates and salaries easier to edit here.",
  "sharedRoot.inspectorCompact": "Employee lists, documents and absences — in Personnel. Here — inspection (foreigners, attendance).",
  "sharedRoot.nomenclature": "Same warehouse nomenclature (store.warehouse). Here — directory; operations — in Warehouse.",
  "sharedRoot.orgDirectories": "Single root: hrPositions / hrStructuralUnits in AppStore.",
  "sharedRoot.orgFinance": "Same org structure and positions as Directories → Positions.",
  "sharedRoot.orgHrSettings": "Position editing — in Directories (single data root).",
  "sharedRoot.payrollHr": "Basic calculation from timesheet. Full statement with adjustments — in Finance.",
  "sharedRoot.sickFinance": "Confirmations written to store.finance — same data Personnel sees on absences tab.",
  "sharedRoot.sickHr": "Sick/vacation confirmations — shared store.finance (as in Finance).",
  "storage.quotaError": "Not enough browser storage. Make JSON backup and remove employee or warehouse item photos.",
  "technologist.mixCostMissingPrices": "Some prices not set in recipe and warehouse — cost incomplete",
  "technologist.mixNegativeConfirm": "Warehouse lacks raw material — balance will go negative. Post batch?",
  "technologist.mixSuccess": "Batch created and sent to storekeeper for confirmation. Write-off and receipt after confirmation.",
  "warehouse.batchConfirm.confirmAsk": "Confirm batch? Raw write-off and finished impregnation receipt will be posted.",
  "warehouse.batchConfirm.hint": "Technologist mixed cube. Check raw write-off and finished impregnation receipt and confirm — only then balances change.",
  "warehouse.batchConfirm.shortageWarn": "Warning: some items lack stock — warehouse will go negative.",
  "warehouse.doc.startHint": "Select document type. Document created only after filling and clicking «Save draft» or «Post» — number not reserved until then.",
  "warehouse.err.cannotDeleteHasHistory": "Cannot delete item: has movements or document lines. Move to archive.",
  "warehouse.err.cannotDeleteLinkedMovement": "Cannot delete operation created by document. Cancel or adjust document.",
  "warehouse.inventory.openingDone": "Opening balances set: {applied} items, skipped {skipped}.",
  "warehouse.inventory.openingHint": "Items with zero balance shown. Enter opening quantity — «Adjustment» operation created.",
  "warehouse.inventory.printHint": "Check warehouses and departments (categories) for the form. After printing enter actual balances in «Revision» tab.",
  "warehouse.inventory.revisionDocHint": "Revision as document: save draft, enter actual per item and post. Document appears in document and movement journal.",
  "warehouse.inventory.revisionDone": "Revision posted: adjusted {applied}, unchanged {unchanged}, skipped {skipped}.",
  "warehouse.inventory.revisionHint": "Enter actual balance only for recounted items. Empty rows not in document and do not change balance.",
  "warehouse.issue.overdraftBlocked": "Insufficient stock. Contact administrator or post receipt.",
  "warehouse.issue.overdraftConfirm": "Issue exceeds available stock. Post document anyway?",
  "warehouse.labels.hint": "Select items and mark which codes to print. Internal EAN-13 barcode can be generated automatically.",
  "warehouse.loading.container.c20": "Container 20'",
  "warehouse.loading.container.c40": "Container 40'",
  "warehouse.loading.container.c40hc": "Container 40' HC",
  "warehouse.loading.container.c45": "Container 45'",
  "warehouse.packagingHint": "Packaging of one product: «1 pack = 12 pcs», «1 box = 6 packs». On issue can write off by pack or box.",
  "warehouse.production.hint": "Saved requests from lines: fill actual and post to warehouse (output → packaging → finished goods).",
  "warehouse.rsQueue.hint": "Invoices, auto production documents (write-off/FG receipt) and shipments — for Balance export. Storekeeper mode unchanged.",
  "warehouse.unitConversionHint": "Link units: «1 box = 12 pcs», «1 crate = 6 boxes», «1000 g = 1 kg». Can chain from already added units.",
  "wastewater.hint": "Cube on line → fill → wastewater zone → use in impregnation. Status changes by stage.",
  "web.cloud.conflict": "Colleagues changed the same data ({count} conflict). Refresh to avoid losing edits.",
  "web.cloud.conflictMany": "Colleagues changed the same data ({count} conflicts). Refresh to avoid losing edits.",
  "web.cloud.loadTimeout": "Firestore load timeout. Check Firestore rules in otgruzka-tovara and click «Retry».",
  "web.cloud.readOnlyHint": "Changes visible locally but not saved to Firestore until load succeeds. Click «Retry».",
  "web.cloud.sizeWarn": "Database near Firestore limit ({size} KB of ~1024 KB). Run cleanup or remove employee photos.",
  "web.login.firebaseSetupHint": "Add VITE_FIREBASE_* variables in Vercel / fst-web/.env. See fst-web/.env.example.",
  "web.login.rememberHint": "On Windows password encrypted by system (safeStorage). Uncheck when signing in on someone else's PC.",
  "workwear.error.fixedTerm": "Employee on fixed-term contract. Workwear issued only under main contract.",
  "workwear.error.noAgreement": "Employee has no contract type in HR. Workwear issue not possible.",
};

function escapeSingle(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function formatEntry(key, value) {
  if (value.includes('\n') || value.length > 90) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    return `  '${key}': \`${escaped}\`,`;
  }
  if (value.includes("'") && !value.includes('"')) {
    return `  '${key}': "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}",`;
  }
  return `  '${key}': '${escapeSingle(value)}',`;
}

const enPath = path.join(root, 'src/i18n/en.ts');
let enContent = fs.readFileSync(enPath, 'utf8');

// Remove trailing locale.en if we're going to re-add at end with other new keys
// Actually locale.en already exists - don't duplicate

const lines = Object.keys(translations).sort().map((k) => formatEntry(k, translations[k]));
const block = '\n' + lines.join('\n') + '\n';

// Insert before closing };
if (!enContent.trimEnd().endsWith('}')) {
  console.error('Unexpected en.ts ending');
  process.exit(1);
}

enContent = enContent.replace(/\n}\s*$/, block + '}\n');
fs.writeFileSync(enPath, enContent, 'utf8');
console.log('Added', Object.keys(translations).length, 'keys to en.ts');
