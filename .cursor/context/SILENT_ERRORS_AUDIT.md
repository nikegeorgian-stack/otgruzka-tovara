# Silent errors audit

generated: 2026-08-13T13:25:42.973Z

total=57 HIGH=9 MED=5 LOW=43

## By kind
```
{
  "ignore_or_empty_catch": 44,
  "void_swallowed": 2,
  "empty_promise_catch": 4,
  "null_promise_catch": 3,
  "console_only_catch": 3,
  "ignore_comment_catch": 1
}
```

## HIGH (sync / cloud / storage)

- **empty_promise_catch** `src/components/system/LocalDbSync.tsx:168` —  .catch(() => {})
- **empty_promise_catch** `src/components/system/LocalDbSync.tsx:203` —  .catch(() => {})
- **console_only_catch** `src/components/web/FstSqlConnectSync.tsx:199` —  } catch (err) { console.warn('FST SQL pull failed', err) } finally { pullInFlight.current = false if (force) { const dirty = editGen.curren
- **ignore_or_empty_catch** `src/lib/cloud/firestoreSync.ts:85` —  } catch { /* ignore transient reload errors */ } const forceRefresh = attempt > 0 const tokenResult = await user.getIdTokenResult(forceRefr
- **ignore_or_empty_catch** `src/lib/cloud/firestoreSync.ts:109` —  } catch (err) { if (!isPermissionDenied(err)) throw err saveAuthCache = null const user = getFirebaseAuth().currentUser if (!user) throw er
- **empty_promise_catch** `src/lib/cloud/firestoreSync.ts:114` —  await user.reload().catch(() => {})
- **ignore_or_empty_catch** `src/lib/storage.ts:615` —  } catch { try { localStorage.setItem(CORRUPT_BACKUP_KEY, raw) } catch { /* ignore */ }
- **ignore_or_empty_catch** `src/lib/storage.ts:618` —  } catch { /* ignore */ } const recovered = tryRestoreCorruptBackup() if (recovered) { return { store: recovered, warning: 'corrupt_recovere
- **ignore_or_empty_catch** `src/lib/storage.ts:637` —  } catch { /* fall through */ } const recovered = tryRestoreCorruptBackup() if (recovered) {

## MED (domain)

- **void_swallowed** `src/components/finance/FinanceDashboardPanel.tsx:87` —  void runExport('salary_calculation_1c', store, { month, locale }).catch(() => {
- **ignore_or_empty_catch** `src/components/procurement/ProcurementTrackingSync.tsx:40` —  } catch { /* skip */ } } } finally { busy.current = false
- **ignore_or_empty_catch** `src/lib/access/adminCabinet.ts:36` —  } catch { /* ignore */ } return 'full' }
- **ignore_or_empty_catch** `src/lib/access/adminCabinet.ts:45` —  } catch { /* ignore */ } } /**
- **ignore_comment_catch** `src/lib/ai/warehousePickEvent.ts:14` —  } catch { // ignore quota errors } window.dispatchEvent(new CustomEvent(WAREHOUSE_PICK_EVENT, { detail })) }

## LOW sample (first 40)

- **ignore_or_empty_catch** `src/components/ai/FeedbackAdminBell.tsx:85` —  } catch { /* ignore */ } setToast(newestNew) const tmr = window.setTimeout(() => setToast(null), 8000) return () => window.clearTimeout(tmr
- **ignore_or_empty_catch** `src/components/ai/FeedbackWidget.tsx:79` —  } catch { /* show toast */ } return s } return null
- **ignore_or_empty_catch** `src/components/ai/FeedbackWidget.tsx:93` —  } catch { /* ignore */ } setReplyToast(newestUnseenReply) try { if (typeof Notification !== 'undefined' && Notification.permission === 'gra
- **ignore_or_empty_catch** `src/components/ai/FeedbackWidget.tsx:104` —  } catch { /* ignore */ } const tmr = window.setTimeout(() => setReplyToast(null), 12000) return () => window.clearTimeout(tmr) }, [newestUn
- **empty_promise_catch** `src/components/hr/CecPortalModal.tsx:74` —  void navigator.clipboard?.writeText(`${pn}\n${sn}`).catch(() => {})
- **null_promise_catch** `src/components/hr/HrAttendanceBiometricsPanel.tsx:59` —  await videoRef.current.play().catch(() => undefined)
- **ignore_or_empty_catch** `src/components/hr/HrCardSections.tsx:208` —  } catch { /* clipboard недоступен */ } } return (
- **ignore_or_empty_catch** `src/components/hr/HrPersonalFile.tsx:81` —  } catch { /* clipboard недоступен */ } } const genderLabel = employee.gender
- **ignore_or_empty_catch** `src/components/month/MonthWorkspaceAccordion.tsx:26` —  } catch { /* ignore */ } } export function useMonthAccordionSections(storageKey = DEFAULT_STORAGE_KEY) {
- **ignore_or_empty_catch** `src/components/production/ProductionDayOutputReport.tsx:69` —  } catch { /* ignore */ } printBusy.current = false }, 400) }
- **console_only_catch** `src/components/web/FstLoginScreen.tsx:91` —  } catch (bioErr) { console.warn('FST biometric registration skipped', bioErr) } } } catch (err) { const code =
- **ignore_or_empty_catch** `src/hooks/useVoiceRecognition.ts:60` —  } catch { /* grammar optional */ } } }
- **ignore_or_empty_catch** `src/hooks/useVoiceRecognition.ts:93` —  } catch { /* ignore */ } } }
- **ignore_or_empty_catch** `src/lib/ai/queryLog.ts:26` —  } catch { /* ignore */ } } export function getAiQueryLog(): AiQueryLogEntry[] {
- **ignore_or_empty_catch** `src/lib/ai/queryLog.ts:43` —  } catch { /* ignore */ } } export function exportAiQueryLog(): void {
- **ignore_or_empty_catch** `src/lib/aiChat/init.ts:112` —  } catch { /* ignore */ } } export function normalizeAiChatStore(raw: unknown): AiChatStore {
- **ignore_or_empty_catch** `src/lib/backup.ts:23` —  } catch { /* ignore */ } return { ...store,
- **ignore_or_empty_catch** `src/lib/cloud/employeePhotoStorage.ts:151` —  } catch { /* already gone */ } }
- **ignore_or_empty_catch** `src/lib/cloud/passwordChangeSession.ts:6` —  } catch { /* ignore */ } } export function isPasswordChangeComplete(email: string | null | undefined): boolean {
- **ignore_or_empty_catch** `src/lib/cloud/passwordChangeSession.ts:24` —  } catch { /* ignore */ } }
- **ignore_or_empty_catch** `src/lib/cloud/storeTabSync.ts:12` —  } catch { /* BroadcastChannel unsupported */ } } export function requestStoreTabsRefresh(): void {
- **ignore_or_empty_catch** `src/lib/cloud/storeTabSync.ts:22` —  } catch { /* ignore */ } } export function listenStoreTabMessages(
- **console_only_catch** `src/lib/cloud/webAccessConfig.ts:33` —  } catch (err) { console.warn('FST: could not load web access config', err) } return [...FST_WEB_ALLOWED_EMAILS] }
- **null_promise_catch** `src/lib/cloud/webUserAdmin.ts:56` —  const body = (await res.json().catch(() => null)) as {
- **ignore_or_empty_catch** `src/lib/coach/depth.ts:31` —  } catch { /* ignore */ } } /** Шаги, видимые на выбранной глубине (minDepth ≤ depth). */
- **ignore_or_empty_catch** `src/lib/directories/openIntent.ts:14` —  } catch { /* ignore */ } } export function consumeDirectoryOpenIntent(
- **ignore_or_empty_catch** `src/lib/editLocks/firestoreLocks.ts:95` —  } catch { /* ignore */ } } export function subscribeFirestoreLock(
- **ignore_or_empty_catch** `src/lib/editLocks/localChannel.ts:73` —  } catch { /* ignore */ } } export function localGetLock(resourceId: string): EditLockRecord | null {
- **ignore_or_empty_catch** `src/lib/greetings/welcomeMessage.ts:43` —  } catch { /* ignore */ } }
- **ignore_or_empty_catch** `src/lib/hr/attendanceLog.ts:221` —  } catch { /* ignore quota */ } } export function formatWeekRange(mondayIso: string, locale: Locale): string {
- **ignore_or_empty_catch** `src/lib/i18n/uiLocalePrefs.ts:27` —  } catch { /* ignore quota / private mode */ } }
- **ignore_or_empty_catch** `src/lib/localDb/client.ts:63` —  } catch { /* use default */ } return createDefaultStore() }
- **ignore_or_empty_catch** `src/lib/persistence/broadcast.ts:14` —  } catch { /* BroadcastChannel unavailable */ } } export function subscribeStoreSaved(
- **ignore_or_empty_catch** `src/lib/persistence/workspaceDrafts.ts:24` —  } catch { /* quota or private mode */ } } export function loadWorkspacePanesJson(): string | null {
- **ignore_or_empty_catch** `src/lib/persistence/workspaceDrafts.ts:41` —  } catch { /* ignore */ } }
- **ignore_or_empty_catch** `src/lib/safeStorage.ts:19` —  } catch { /* ignore */ } } return false }
- **ignore_or_empty_catch** `src/lib/safeStorage.ts:40` —  } catch { /* ignore */ } } export function safeSessionSet(key: string, value: string): boolean {
- **ignore_or_empty_catch** `src/lib/safeStorage.ts:71` —  } catch { /* ignore */ } } /** Глобальный обработчик quota-ошибок (Firestore IndexedDB / storage). */
- **ignore_or_empty_catch** `src/lib/sales/directorActions.ts:289` —  } catch { /* ignore quota */ } } export function markRisksSeen(currentIds: string[]): void {
- **ignore_or_empty_catch** `src/lib/sales/directorActions.ts:317` —  } catch { /* ignore */ } } export function consumeDirectorNavHint(): DirectorNavHint | null {
