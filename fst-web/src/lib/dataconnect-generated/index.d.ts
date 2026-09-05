import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, ExecuteQueryOptions, MutationRef, MutationPromise, DataConnectSettings } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;
export const dataConnectSettings: DataConnectSettings;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;




export interface CreateFstStoreData {
  fstStore_insert: FstStore_Key;
}

export interface CreateFstStoreVariables {
  id: string;
  payloadJson: string;
  fingerprint: string;
  updatedByUid: string;
}

export interface FstCommandReceipt_Key {
  id: string;
  __typename?: 'FstCommandReceipt_Key';
}

export interface FstCriticalStore_Key {
  id: string;
  __typename?: 'FstCriticalStore_Key';
}

export interface FstPrincipalAccess_Key {
  id: string;
  __typename?: 'FstPrincipalAccess_Key';
}

export interface FstStore_Key {
  id: string;
  __typename?: 'FstStore_Key';
}

export interface GetFstStoreData {
  fstStore?: {
    id: string;
    revision: number;
    payloadJson: string;
    fingerprint?: string | null;
    updatedByUid?: string | null;
    updatedAt: TimestampString;
  } & FstStore_Key;
}

export interface GetFstStoreMetaData {
  fstStore?: {
    id: string;
    revision: number;
    fingerprint?: string | null;
    updatedAt: TimestampString;
  } & FstStore_Key;
}

export interface GetFstStoreMetaVariables {
  id: string;
}

export interface GetFstStoreVariables {
  id: string;
}

export interface JournalEvent_Key {
  id: string;
  __typename?: 'JournalEvent_Key';
}

export interface ListJournalEventsData {
  journalEvents: ({
    id: string;
    at: TimestampString;
    category: string;
    title: string;
    detail: string;
    actor?: string | null;
    docDate?: string | null;
    docNumber?: string | null;
    docStatus?: string | null;
    linkKind?: string | null;
    linkRef?: string | null;
    storeRevision: number;
  } & JournalEvent_Key)[];
}

export interface ListJournalEventsVariables {
  limit: number;
}

export interface QcAttachmentRecord_Key {
  id: string;
  __typename?: 'QcAttachmentRecord_Key';
}

export interface QcFinishedGoodsLot_Key {
  id: string;
  __typename?: 'QcFinishedGoodsLot_Key';
}

export interface QcLotDecision_Key {
  id: string;
  __typename?: 'QcLotDecision_Key';
}

export interface QcPermission_Key {
  id: string;
  __typename?: 'QcPermission_Key';
}

export interface UpdateFstStoreData {
  fstStore_updateMany: number;
}

export interface UpdateFstStoreVariables {
  id: string;
  expectedRevision: number;
  revision: number;
  payloadJson: string;
  fingerprint: string;
  updatedByUid: string;
}

export interface UpsertJournalEventData {
  journalEvent_upsert: JournalEvent_Key;
}

export interface UpsertJournalEventVariables {
  id: string;
  at: TimestampString;
  category: string;
  title: string;
  detail: string;
  actor?: string | null;
  docDate?: string | null;
  docNumber?: string | null;
  docStatus?: string | null;
  linkKind?: string | null;
  linkRef?: string | null;
  storeRevision: number;
}

interface CreateFstStoreRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateFstStoreVariables): MutationRef<CreateFstStoreData, CreateFstStoreVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateFstStoreVariables): MutationRef<CreateFstStoreData, CreateFstStoreVariables>;
  operationName: string;
}
export const createFstStoreRef: CreateFstStoreRef;

export function createFstStore(vars: CreateFstStoreVariables): MutationPromise<CreateFstStoreData, CreateFstStoreVariables>;
export function createFstStore(dc: DataConnect, vars: CreateFstStoreVariables): MutationPromise<CreateFstStoreData, CreateFstStoreVariables>;

interface UpdateFstStoreRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateFstStoreVariables): MutationRef<UpdateFstStoreData, UpdateFstStoreVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdateFstStoreVariables): MutationRef<UpdateFstStoreData, UpdateFstStoreVariables>;
  operationName: string;
}
export const updateFstStoreRef: UpdateFstStoreRef;

export function updateFstStore(vars: UpdateFstStoreVariables): MutationPromise<UpdateFstStoreData, UpdateFstStoreVariables>;
export function updateFstStore(dc: DataConnect, vars: UpdateFstStoreVariables): MutationPromise<UpdateFstStoreData, UpdateFstStoreVariables>;

interface UpsertJournalEventRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpsertJournalEventVariables): MutationRef<UpsertJournalEventData, UpsertJournalEventVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpsertJournalEventVariables): MutationRef<UpsertJournalEventData, UpsertJournalEventVariables>;
  operationName: string;
}
export const upsertJournalEventRef: UpsertJournalEventRef;

export function upsertJournalEvent(vars: UpsertJournalEventVariables): MutationPromise<UpsertJournalEventData, UpsertJournalEventVariables>;
export function upsertJournalEvent(dc: DataConnect, vars: UpsertJournalEventVariables): MutationPromise<UpsertJournalEventData, UpsertJournalEventVariables>;

interface GetFstStoreRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetFstStoreVariables): QueryRef<GetFstStoreData, GetFstStoreVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetFstStoreVariables): QueryRef<GetFstStoreData, GetFstStoreVariables>;
  operationName: string;
}
export const getFstStoreRef: GetFstStoreRef;

export function getFstStore(vars: GetFstStoreVariables, options?: ExecuteQueryOptions): QueryPromise<GetFstStoreData, GetFstStoreVariables>;
export function getFstStore(dc: DataConnect, vars: GetFstStoreVariables, options?: ExecuteQueryOptions): QueryPromise<GetFstStoreData, GetFstStoreVariables>;

interface GetFstStoreMetaRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetFstStoreMetaVariables): QueryRef<GetFstStoreMetaData, GetFstStoreMetaVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: GetFstStoreMetaVariables): QueryRef<GetFstStoreMetaData, GetFstStoreMetaVariables>;
  operationName: string;
}
export const getFstStoreMetaRef: GetFstStoreMetaRef;

export function getFstStoreMeta(vars: GetFstStoreMetaVariables, options?: ExecuteQueryOptions): QueryPromise<GetFstStoreMetaData, GetFstStoreMetaVariables>;
export function getFstStoreMeta(dc: DataConnect, vars: GetFstStoreMetaVariables, options?: ExecuteQueryOptions): QueryPromise<GetFstStoreMetaData, GetFstStoreMetaVariables>;

interface ListJournalEventsRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: ListJournalEventsVariables): QueryRef<ListJournalEventsData, ListJournalEventsVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: ListJournalEventsVariables): QueryRef<ListJournalEventsData, ListJournalEventsVariables>;
  operationName: string;
}
export const listJournalEventsRef: ListJournalEventsRef;

export function listJournalEvents(vars: ListJournalEventsVariables, options?: ExecuteQueryOptions): QueryPromise<ListJournalEventsData, ListJournalEventsVariables>;
export function listJournalEvents(dc: DataConnect, vars: ListJournalEventsVariables, options?: ExecuteQueryOptions): QueryPromise<ListJournalEventsData, ListJournalEventsVariables>;

