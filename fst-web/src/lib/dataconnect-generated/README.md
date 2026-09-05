# Generated TypeScript README
This README will guide you through the process of using the generated JavaScript SDK package for the connector `fst`. It will also provide examples on how to use your generated SDK to call your Data Connect queries and mutations.

**If you're looking for the `React README`, you can find it at [`dataconnect-generated/react/README.md`](./react/README.md)**

***NOTE:** This README is generated alongside the generated SDK. If you make changes to this file, they will be overwritten when the SDK is regenerated.*

# Table of Contents
- [**Overview**](#generated-javascript-readme)
- [**Accessing the connector**](#accessing-the-connector)
  - [*Connecting to the local Emulator*](#connecting-to-the-local-emulator)
- [**Queries**](#queries)
  - [*GetFstStore*](#getfststore)
  - [*GetFstStoreMeta*](#getfststoremeta)
  - [*ListJournalEvents*](#listjournalevents)
- [**Mutations**](#mutations)
  - [*CreateFstStore*](#createfststore)
  - [*UpdateFstStore*](#updatefststore)
  - [*UpsertJournalEvent*](#upsertjournalevent)

# Accessing the connector
A connector is a collection of Queries and Mutations. One SDK is generated for each connector - this SDK is generated for the connector `fst`. You can find more information about connectors in the [Data Connect documentation](https://firebase.google.com/docs/data-connect#how-does).

You can use this generated SDK by importing from the package `@fst/dataconnect-generated` as shown below. Both CommonJS and ESM imports are supported.

You can also follow the instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#set-client).

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@fst/dataconnect-generated';

const dataConnect = getDataConnect(connectorConfig);
```

## Connecting to the local Emulator
By default, the connector will connect to the production service.

To connect to the emulator, you can use the following code.
You can also follow the emulator instructions from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#instrument-clients).

```typescript
import { connectDataConnectEmulator, getDataConnect } from 'firebase/data-connect';
import { connectorConfig } from '@fst/dataconnect-generated';

const dataConnect = getDataConnect(connectorConfig);
connectDataConnectEmulator(dataConnect, 'localhost', 9399);
```

After it's initialized, you can call your Data Connect [queries](#queries) and [mutations](#mutations) from your generated SDK.

# Queries

There are two ways to execute a Data Connect Query using the generated Web SDK:
- Using a Query Reference function, which returns a `QueryRef`
  - The `QueryRef` can be used as an argument to `executeQuery()`, which will execute the Query and return a `QueryPromise`
- Using an action shortcut function, which returns a `QueryPromise`
  - Calling the action shortcut function will execute the Query and return a `QueryPromise`

The following is true for both the action shortcut function and the `QueryRef` function:
- The `QueryPromise` returned will resolve to the result of the Query once it has finished executing
- If the Query accepts arguments, both the action shortcut function and the `QueryRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Query
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `fst` connector's generated functions to execute each query. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-queries).

## GetFstStore
You can execute the `GetFstStore` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getFstStore(vars: GetFstStoreVariables, options?: ExecuteQueryOptions): QueryPromise<GetFstStoreData, GetFstStoreVariables>;

interface GetFstStoreRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetFstStoreVariables): QueryRef<GetFstStoreData, GetFstStoreVariables>;
}
export const getFstStoreRef: GetFstStoreRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getFstStore(dc: DataConnect, vars: GetFstStoreVariables, options?: ExecuteQueryOptions): QueryPromise<GetFstStoreData, GetFstStoreVariables>;

interface GetFstStoreRef {
  ...
  (dc: DataConnect, vars: GetFstStoreVariables): QueryRef<GetFstStoreData, GetFstStoreVariables>;
}
export const getFstStoreRef: GetFstStoreRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getFstStoreRef:
```typescript
const name = getFstStoreRef.operationName;
console.log(name);
```

### Variables
The `GetFstStore` query requires an argument of type `GetFstStoreVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetFstStoreVariables {
  id: string;
}
```
### Return Type
Recall that executing the `GetFstStore` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetFstStoreData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `GetFstStore`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getFstStore, GetFstStoreVariables } from '@fst/dataconnect-generated';

// The `GetFstStore` query requires an argument of type `GetFstStoreVariables`:
const getFstStoreVars: GetFstStoreVariables = {
  id: ..., 
};

// Call the `getFstStore()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getFstStore(getFstStoreVars);
// Variables can be defined inline as well.
const { data } = await getFstStore({ id: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getFstStore(dataConnect, getFstStoreVars);

console.log(data.fstStore);

// Or, you can use the `Promise` API.
getFstStore(getFstStoreVars).then((response) => {
  const data = response.data;
  console.log(data.fstStore);
});
```

### Using `GetFstStore`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getFstStoreRef, GetFstStoreVariables } from '@fst/dataconnect-generated';

// The `GetFstStore` query requires an argument of type `GetFstStoreVariables`:
const getFstStoreVars: GetFstStoreVariables = {
  id: ..., 
};

// Call the `getFstStoreRef()` function to get a reference to the query.
const ref = getFstStoreRef(getFstStoreVars);
// Variables can be defined inline as well.
const ref = getFstStoreRef({ id: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getFstStoreRef(dataConnect, getFstStoreVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.fstStore);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.fstStore);
});
```

## GetFstStoreMeta
You can execute the `GetFstStoreMeta` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
getFstStoreMeta(vars: GetFstStoreMetaVariables, options?: ExecuteQueryOptions): QueryPromise<GetFstStoreMetaData, GetFstStoreMetaVariables>;

interface GetFstStoreMetaRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: GetFstStoreMetaVariables): QueryRef<GetFstStoreMetaData, GetFstStoreMetaVariables>;
}
export const getFstStoreMetaRef: GetFstStoreMetaRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
getFstStoreMeta(dc: DataConnect, vars: GetFstStoreMetaVariables, options?: ExecuteQueryOptions): QueryPromise<GetFstStoreMetaData, GetFstStoreMetaVariables>;

interface GetFstStoreMetaRef {
  ...
  (dc: DataConnect, vars: GetFstStoreMetaVariables): QueryRef<GetFstStoreMetaData, GetFstStoreMetaVariables>;
}
export const getFstStoreMetaRef: GetFstStoreMetaRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the getFstStoreMetaRef:
```typescript
const name = getFstStoreMetaRef.operationName;
console.log(name);
```

### Variables
The `GetFstStoreMeta` query requires an argument of type `GetFstStoreMetaVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface GetFstStoreMetaVariables {
  id: string;
}
```
### Return Type
Recall that executing the `GetFstStoreMeta` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `GetFstStoreMetaData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface GetFstStoreMetaData {
  fstStore?: {
    id: string;
    revision: number;
    fingerprint?: string | null;
    updatedAt: TimestampString;
  } & FstStore_Key;
}
```
### Using `GetFstStoreMeta`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, getFstStoreMeta, GetFstStoreMetaVariables } from '@fst/dataconnect-generated';

// The `GetFstStoreMeta` query requires an argument of type `GetFstStoreMetaVariables`:
const getFstStoreMetaVars: GetFstStoreMetaVariables = {
  id: ..., 
};

// Call the `getFstStoreMeta()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await getFstStoreMeta(getFstStoreMetaVars);
// Variables can be defined inline as well.
const { data } = await getFstStoreMeta({ id: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await getFstStoreMeta(dataConnect, getFstStoreMetaVars);

console.log(data.fstStore);

// Or, you can use the `Promise` API.
getFstStoreMeta(getFstStoreMetaVars).then((response) => {
  const data = response.data;
  console.log(data.fstStore);
});
```

### Using `GetFstStoreMeta`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, getFstStoreMetaRef, GetFstStoreMetaVariables } from '@fst/dataconnect-generated';

// The `GetFstStoreMeta` query requires an argument of type `GetFstStoreMetaVariables`:
const getFstStoreMetaVars: GetFstStoreMetaVariables = {
  id: ..., 
};

// Call the `getFstStoreMetaRef()` function to get a reference to the query.
const ref = getFstStoreMetaRef(getFstStoreMetaVars);
// Variables can be defined inline as well.
const ref = getFstStoreMetaRef({ id: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = getFstStoreMetaRef(dataConnect, getFstStoreMetaVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.fstStore);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.fstStore);
});
```

## ListJournalEvents
You can execute the `ListJournalEvents` query using the following action shortcut function, or by calling `executeQuery()` after calling the following `QueryRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
listJournalEvents(vars: ListJournalEventsVariables, options?: ExecuteQueryOptions): QueryPromise<ListJournalEventsData, ListJournalEventsVariables>;

interface ListJournalEventsRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: ListJournalEventsVariables): QueryRef<ListJournalEventsData, ListJournalEventsVariables>;
}
export const listJournalEventsRef: ListJournalEventsRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `QueryRef` function.
```typescript
listJournalEvents(dc: DataConnect, vars: ListJournalEventsVariables, options?: ExecuteQueryOptions): QueryPromise<ListJournalEventsData, ListJournalEventsVariables>;

interface ListJournalEventsRef {
  ...
  (dc: DataConnect, vars: ListJournalEventsVariables): QueryRef<ListJournalEventsData, ListJournalEventsVariables>;
}
export const listJournalEventsRef: ListJournalEventsRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the listJournalEventsRef:
```typescript
const name = listJournalEventsRef.operationName;
console.log(name);
```

### Variables
The `ListJournalEvents` query requires an argument of type `ListJournalEventsVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface ListJournalEventsVariables {
  limit: number;
}
```
### Return Type
Recall that executing the `ListJournalEvents` query returns a `QueryPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `ListJournalEventsData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
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
```
### Using `ListJournalEvents`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, listJournalEvents, ListJournalEventsVariables } from '@fst/dataconnect-generated';

// The `ListJournalEvents` query requires an argument of type `ListJournalEventsVariables`:
const listJournalEventsVars: ListJournalEventsVariables = {
  limit: ..., 
};

// Call the `listJournalEvents()` function to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await listJournalEvents(listJournalEventsVars);
// Variables can be defined inline as well.
const { data } = await listJournalEvents({ limit: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await listJournalEvents(dataConnect, listJournalEventsVars);

console.log(data.journalEvents);

// Or, you can use the `Promise` API.
listJournalEvents(listJournalEventsVars).then((response) => {
  const data = response.data;
  console.log(data.journalEvents);
});
```

### Using `ListJournalEvents`'s `QueryRef` function

```typescript
import { getDataConnect, executeQuery } from 'firebase/data-connect';
import { connectorConfig, listJournalEventsRef, ListJournalEventsVariables } from '@fst/dataconnect-generated';

// The `ListJournalEvents` query requires an argument of type `ListJournalEventsVariables`:
const listJournalEventsVars: ListJournalEventsVariables = {
  limit: ..., 
};

// Call the `listJournalEventsRef()` function to get a reference to the query.
const ref = listJournalEventsRef(listJournalEventsVars);
// Variables can be defined inline as well.
const ref = listJournalEventsRef({ limit: ..., });

// You can also pass in a `DataConnect` instance to the `QueryRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = listJournalEventsRef(dataConnect, listJournalEventsVars);

// Call `executeQuery()` on the reference to execute the query.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeQuery(ref);

console.log(data.journalEvents);

// Or, you can use the `Promise` API.
executeQuery(ref).then((response) => {
  const data = response.data;
  console.log(data.journalEvents);
});
```

# Mutations

There are two ways to execute a Data Connect Mutation using the generated Web SDK:
- Using a Mutation Reference function, which returns a `MutationRef`
  - The `MutationRef` can be used as an argument to `executeMutation()`, which will execute the Mutation and return a `MutationPromise`
- Using an action shortcut function, which returns a `MutationPromise`
  - Calling the action shortcut function will execute the Mutation and return a `MutationPromise`

The following is true for both the action shortcut function and the `MutationRef` function:
- The `MutationPromise` returned will resolve to the result of the Mutation once it has finished executing
- If the Mutation accepts arguments, both the action shortcut function and the `MutationRef` function accept a single argument: an object that contains all the required variables (and the optional variables) for the Mutation
- Both functions can be called with or without passing in a `DataConnect` instance as an argument. If no `DataConnect` argument is passed in, then the generated SDK will call `getDataConnect(connectorConfig)` behind the scenes for you.

Below are examples of how to use the `fst` connector's generated functions to execute each mutation. You can also follow the examples from the [Data Connect documentation](https://firebase.google.com/docs/data-connect/web-sdk#using-mutations).

## CreateFstStore
You can execute the `CreateFstStore` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
createFstStore(vars: CreateFstStoreVariables): MutationPromise<CreateFstStoreData, CreateFstStoreVariables>;

interface CreateFstStoreRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateFstStoreVariables): MutationRef<CreateFstStoreData, CreateFstStoreVariables>;
}
export const createFstStoreRef: CreateFstStoreRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
createFstStore(dc: DataConnect, vars: CreateFstStoreVariables): MutationPromise<CreateFstStoreData, CreateFstStoreVariables>;

interface CreateFstStoreRef {
  ...
  (dc: DataConnect, vars: CreateFstStoreVariables): MutationRef<CreateFstStoreData, CreateFstStoreVariables>;
}
export const createFstStoreRef: CreateFstStoreRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the createFstStoreRef:
```typescript
const name = createFstStoreRef.operationName;
console.log(name);
```

### Variables
The `CreateFstStore` mutation requires an argument of type `CreateFstStoreVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface CreateFstStoreVariables {
  id: string;
  payloadJson: string;
  fingerprint: string;
  updatedByUid: string;
}
```
### Return Type
Recall that executing the `CreateFstStore` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `CreateFstStoreData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface CreateFstStoreData {
  fstStore_insert: FstStore_Key;
}
```
### Using `CreateFstStore`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, createFstStore, CreateFstStoreVariables } from '@fst/dataconnect-generated';

// The `CreateFstStore` mutation requires an argument of type `CreateFstStoreVariables`:
const createFstStoreVars: CreateFstStoreVariables = {
  id: ..., 
  payloadJson: ..., 
  fingerprint: ..., 
  updatedByUid: ..., 
};

// Call the `createFstStore()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await createFstStore(createFstStoreVars);
// Variables can be defined inline as well.
const { data } = await createFstStore({ id: ..., payloadJson: ..., fingerprint: ..., updatedByUid: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await createFstStore(dataConnect, createFstStoreVars);

console.log(data.fstStore_insert);

// Or, you can use the `Promise` API.
createFstStore(createFstStoreVars).then((response) => {
  const data = response.data;
  console.log(data.fstStore_insert);
});
```

### Using `CreateFstStore`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, createFstStoreRef, CreateFstStoreVariables } from '@fst/dataconnect-generated';

// The `CreateFstStore` mutation requires an argument of type `CreateFstStoreVariables`:
const createFstStoreVars: CreateFstStoreVariables = {
  id: ..., 
  payloadJson: ..., 
  fingerprint: ..., 
  updatedByUid: ..., 
};

// Call the `createFstStoreRef()` function to get a reference to the mutation.
const ref = createFstStoreRef(createFstStoreVars);
// Variables can be defined inline as well.
const ref = createFstStoreRef({ id: ..., payloadJson: ..., fingerprint: ..., updatedByUid: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = createFstStoreRef(dataConnect, createFstStoreVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.fstStore_insert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.fstStore_insert);
});
```

## UpdateFstStore
You can execute the `UpdateFstStore` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
updateFstStore(vars: UpdateFstStoreVariables): MutationPromise<UpdateFstStoreData, UpdateFstStoreVariables>;

interface UpdateFstStoreRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateFstStoreVariables): MutationRef<UpdateFstStoreData, UpdateFstStoreVariables>;
}
export const updateFstStoreRef: UpdateFstStoreRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
updateFstStore(dc: DataConnect, vars: UpdateFstStoreVariables): MutationPromise<UpdateFstStoreData, UpdateFstStoreVariables>;

interface UpdateFstStoreRef {
  ...
  (dc: DataConnect, vars: UpdateFstStoreVariables): MutationRef<UpdateFstStoreData, UpdateFstStoreVariables>;
}
export const updateFstStoreRef: UpdateFstStoreRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the updateFstStoreRef:
```typescript
const name = updateFstStoreRef.operationName;
console.log(name);
```

### Variables
The `UpdateFstStore` mutation requires an argument of type `UpdateFstStoreVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
export interface UpdateFstStoreVariables {
  id: string;
  expectedRevision: number;
  revision: number;
  payloadJson: string;
  fingerprint: string;
  updatedByUid: string;
}
```
### Return Type
Recall that executing the `UpdateFstStore` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UpdateFstStoreData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface UpdateFstStoreData {
  fstStore_updateMany: number;
}
```
### Using `UpdateFstStore`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, updateFstStore, UpdateFstStoreVariables } from '@fst/dataconnect-generated';

// The `UpdateFstStore` mutation requires an argument of type `UpdateFstStoreVariables`:
const updateFstStoreVars: UpdateFstStoreVariables = {
  id: ..., 
  expectedRevision: ..., 
  revision: ..., 
  payloadJson: ..., 
  fingerprint: ..., 
  updatedByUid: ..., 
};

// Call the `updateFstStore()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await updateFstStore(updateFstStoreVars);
// Variables can be defined inline as well.
const { data } = await updateFstStore({ id: ..., expectedRevision: ..., revision: ..., payloadJson: ..., fingerprint: ..., updatedByUid: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await updateFstStore(dataConnect, updateFstStoreVars);

console.log(data.fstStore_updateMany);

// Or, you can use the `Promise` API.
updateFstStore(updateFstStoreVars).then((response) => {
  const data = response.data;
  console.log(data.fstStore_updateMany);
});
```

### Using `UpdateFstStore`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, updateFstStoreRef, UpdateFstStoreVariables } from '@fst/dataconnect-generated';

// The `UpdateFstStore` mutation requires an argument of type `UpdateFstStoreVariables`:
const updateFstStoreVars: UpdateFstStoreVariables = {
  id: ..., 
  expectedRevision: ..., 
  revision: ..., 
  payloadJson: ..., 
  fingerprint: ..., 
  updatedByUid: ..., 
};

// Call the `updateFstStoreRef()` function to get a reference to the mutation.
const ref = updateFstStoreRef(updateFstStoreVars);
// Variables can be defined inline as well.
const ref = updateFstStoreRef({ id: ..., expectedRevision: ..., revision: ..., payloadJson: ..., fingerprint: ..., updatedByUid: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = updateFstStoreRef(dataConnect, updateFstStoreVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.fstStore_updateMany);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.fstStore_updateMany);
});
```

## UpsertJournalEvent
You can execute the `UpsertJournalEvent` mutation using the following action shortcut function, or by calling `executeMutation()` after calling the following `MutationRef` function, both of which are defined in [dataconnect-generated/index.d.ts](./index.d.ts):
```typescript
upsertJournalEvent(vars: UpsertJournalEventVariables): MutationPromise<UpsertJournalEventData, UpsertJournalEventVariables>;

interface UpsertJournalEventRef {
  ...
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpsertJournalEventVariables): MutationRef<UpsertJournalEventData, UpsertJournalEventVariables>;
}
export const upsertJournalEventRef: UpsertJournalEventRef;
```
You can also pass in a `DataConnect` instance to the action shortcut function or `MutationRef` function.
```typescript
upsertJournalEvent(dc: DataConnect, vars: UpsertJournalEventVariables): MutationPromise<UpsertJournalEventData, UpsertJournalEventVariables>;

interface UpsertJournalEventRef {
  ...
  (dc: DataConnect, vars: UpsertJournalEventVariables): MutationRef<UpsertJournalEventData, UpsertJournalEventVariables>;
}
export const upsertJournalEventRef: UpsertJournalEventRef;
```

If you need the name of the operation without creating a ref, you can retrieve the operation name by calling the `operationName` property on the upsertJournalEventRef:
```typescript
const name = upsertJournalEventRef.operationName;
console.log(name);
```

### Variables
The `UpsertJournalEvent` mutation requires an argument of type `UpsertJournalEventVariables`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:

```typescript
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
```
### Return Type
Recall that executing the `UpsertJournalEvent` mutation returns a `MutationPromise` that resolves to an object with a `data` property.

The `data` property is an object of type `UpsertJournalEventData`, which is defined in [dataconnect-generated/index.d.ts](./index.d.ts). It has the following fields:
```typescript
export interface UpsertJournalEventData {
  journalEvent_upsert: JournalEvent_Key;
}
```
### Using `UpsertJournalEvent`'s action shortcut function

```typescript
import { getDataConnect } from 'firebase/data-connect';
import { connectorConfig, upsertJournalEvent, UpsertJournalEventVariables } from '@fst/dataconnect-generated';

// The `UpsertJournalEvent` mutation requires an argument of type `UpsertJournalEventVariables`:
const upsertJournalEventVars: UpsertJournalEventVariables = {
  id: ..., 
  at: ..., 
  category: ..., 
  title: ..., 
  detail: ..., 
  actor: ..., // optional
  docDate: ..., // optional
  docNumber: ..., // optional
  docStatus: ..., // optional
  linkKind: ..., // optional
  linkRef: ..., // optional
  storeRevision: ..., 
};

// Call the `upsertJournalEvent()` function to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await upsertJournalEvent(upsertJournalEventVars);
// Variables can be defined inline as well.
const { data } = await upsertJournalEvent({ id: ..., at: ..., category: ..., title: ..., detail: ..., actor: ..., docDate: ..., docNumber: ..., docStatus: ..., linkKind: ..., linkRef: ..., storeRevision: ..., });

// You can also pass in a `DataConnect` instance to the action shortcut function.
const dataConnect = getDataConnect(connectorConfig);
const { data } = await upsertJournalEvent(dataConnect, upsertJournalEventVars);

console.log(data.journalEvent_upsert);

// Or, you can use the `Promise` API.
upsertJournalEvent(upsertJournalEventVars).then((response) => {
  const data = response.data;
  console.log(data.journalEvent_upsert);
});
```

### Using `UpsertJournalEvent`'s `MutationRef` function

```typescript
import { getDataConnect, executeMutation } from 'firebase/data-connect';
import { connectorConfig, upsertJournalEventRef, UpsertJournalEventVariables } from '@fst/dataconnect-generated';

// The `UpsertJournalEvent` mutation requires an argument of type `UpsertJournalEventVariables`:
const upsertJournalEventVars: UpsertJournalEventVariables = {
  id: ..., 
  at: ..., 
  category: ..., 
  title: ..., 
  detail: ..., 
  actor: ..., // optional
  docDate: ..., // optional
  docNumber: ..., // optional
  docStatus: ..., // optional
  linkKind: ..., // optional
  linkRef: ..., // optional
  storeRevision: ..., 
};

// Call the `upsertJournalEventRef()` function to get a reference to the mutation.
const ref = upsertJournalEventRef(upsertJournalEventVars);
// Variables can be defined inline as well.
const ref = upsertJournalEventRef({ id: ..., at: ..., category: ..., title: ..., detail: ..., actor: ..., docDate: ..., docNumber: ..., docStatus: ..., linkKind: ..., linkRef: ..., storeRevision: ..., });

// You can also pass in a `DataConnect` instance to the `MutationRef` function.
const dataConnect = getDataConnect(connectorConfig);
const ref = upsertJournalEventRef(dataConnect, upsertJournalEventVars);

// Call `executeMutation()` on the reference to execute the mutation.
// You can use the `await` keyword to wait for the promise to resolve.
const { data } = await executeMutation(ref);

console.log(data.journalEvent_upsert);

// Or, you can use the `Promise` API.
executeMutation(ref).then((response) => {
  const data = response.data;
  console.log(data.journalEvent_upsert);
});
```

