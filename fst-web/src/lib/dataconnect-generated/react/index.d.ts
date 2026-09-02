import { CreateFstStoreData, CreateFstStoreVariables, UpdateFstStoreData, UpdateFstStoreVariables, UpsertJournalEventData, UpsertJournalEventVariables, GetFstStoreData, GetFstStoreVariables, GetFstStoreMetaData, GetFstStoreMetaVariables, ListJournalEventsData, ListJournalEventsVariables } from '../';
import { UseDataConnectQueryResult, useDataConnectQueryOptions, UseDataConnectMutationResult, useDataConnectMutationOptions} from '@tanstack-query-firebase/react/data-connect';
import { UseQueryResult, UseMutationResult} from '@tanstack/react-query';
import { DataConnect } from 'firebase/data-connect';
import { FirebaseError } from 'firebase/app';


export function useCreateFstStore(options?: useDataConnectMutationOptions<CreateFstStoreData, FirebaseError, CreateFstStoreVariables>): UseDataConnectMutationResult<CreateFstStoreData, CreateFstStoreVariables>;
export function useCreateFstStore(dc: DataConnect, options?: useDataConnectMutationOptions<CreateFstStoreData, FirebaseError, CreateFstStoreVariables>): UseDataConnectMutationResult<CreateFstStoreData, CreateFstStoreVariables>;

export function useUpdateFstStore(options?: useDataConnectMutationOptions<UpdateFstStoreData, FirebaseError, UpdateFstStoreVariables>): UseDataConnectMutationResult<UpdateFstStoreData, UpdateFstStoreVariables>;
export function useUpdateFstStore(dc: DataConnect, options?: useDataConnectMutationOptions<UpdateFstStoreData, FirebaseError, UpdateFstStoreVariables>): UseDataConnectMutationResult<UpdateFstStoreData, UpdateFstStoreVariables>;

export function useUpsertJournalEvent(options?: useDataConnectMutationOptions<UpsertJournalEventData, FirebaseError, UpsertJournalEventVariables>): UseDataConnectMutationResult<UpsertJournalEventData, UpsertJournalEventVariables>;
export function useUpsertJournalEvent(dc: DataConnect, options?: useDataConnectMutationOptions<UpsertJournalEventData, FirebaseError, UpsertJournalEventVariables>): UseDataConnectMutationResult<UpsertJournalEventData, UpsertJournalEventVariables>;

export function useGetFstStore(vars: GetFstStoreVariables, options?: useDataConnectQueryOptions<GetFstStoreData>): UseDataConnectQueryResult<GetFstStoreData, GetFstStoreVariables>;
export function useGetFstStore(dc: DataConnect, vars: GetFstStoreVariables, options?: useDataConnectQueryOptions<GetFstStoreData>): UseDataConnectQueryResult<GetFstStoreData, GetFstStoreVariables>;

export function useGetFstStoreMeta(vars: GetFstStoreMetaVariables, options?: useDataConnectQueryOptions<GetFstStoreMetaData>): UseDataConnectQueryResult<GetFstStoreMetaData, GetFstStoreMetaVariables>;
export function useGetFstStoreMeta(dc: DataConnect, vars: GetFstStoreMetaVariables, options?: useDataConnectQueryOptions<GetFstStoreMetaData>): UseDataConnectQueryResult<GetFstStoreMetaData, GetFstStoreMetaVariables>;

export function useListJournalEvents(vars: ListJournalEventsVariables, options?: useDataConnectQueryOptions<ListJournalEventsData>): UseDataConnectQueryResult<ListJournalEventsData, ListJournalEventsVariables>;
export function useListJournalEvents(dc: DataConnect, vars: ListJournalEventsVariables, options?: useDataConnectQueryOptions<ListJournalEventsData>): UseDataConnectQueryResult<ListJournalEventsData, ListJournalEventsVariables>;
