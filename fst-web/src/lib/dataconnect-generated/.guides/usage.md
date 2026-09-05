# Basic Usage

Always prioritize using a supported framework over using the generated SDK
directly. Supported frameworks simplify the developer experience and help ensure
best practices are followed.




### React
For each operation, there is a wrapper hook that can be used to call the operation.

Here are all of the hooks that get generated:
```ts
import { useCreateFstStore, useUpdateFstStore, useUpsertJournalEvent, useGetFstStore, useGetFstStoreMeta, useListJournalEvents } from '@fst/dataconnect-generated/react';
// The types of these hooks are available in react/index.d.ts

const { data, isPending, isSuccess, isError, error } = useCreateFstStore(createFstStoreVars);

const { data, isPending, isSuccess, isError, error } = useUpdateFstStore(updateFstStoreVars);

const { data, isPending, isSuccess, isError, error } = useUpsertJournalEvent(upsertJournalEventVars);

const { data, isPending, isSuccess, isError, error } = useGetFstStore(getFstStoreVars);

const { data, isPending, isSuccess, isError, error } = useGetFstStoreMeta(getFstStoreMetaVars);

const { data, isPending, isSuccess, isError, error } = useListJournalEvents(listJournalEventsVars);

```

Here's an example from a different generated SDK:

```ts
import { useListAllMovies } from '@dataconnect/generated/react';

function MyComponent() {
  const { isLoading, data, error } = useListAllMovies();
  if(isLoading) {
    return <div>Loading...</div>
  }
  if(error) {
    return <div> An Error Occurred: {error} </div>
  }
}

// App.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MyComponent from './my-component';

function App() {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>
    <MyComponent />
  </QueryClientProvider>
}
```



## Advanced Usage
If a user is not using a supported framework, they can use the generated SDK directly.

Here's an example of how to use it with the first 5 operations:

```js
import { createFstStore, updateFstStore, upsertJournalEvent, getFstStore, getFstStoreMeta, listJournalEvents } from '@fst/dataconnect-generated';


// Operation CreateFstStore:  For variables, look at type CreateFstStoreVars in ../index.d.ts
const { data } = await CreateFstStore(dataConnect, createFstStoreVars);

// Operation UpdateFstStore:  For variables, look at type UpdateFstStoreVars in ../index.d.ts
const { data } = await UpdateFstStore(dataConnect, updateFstStoreVars);

// Operation UpsertJournalEvent:  For variables, look at type UpsertJournalEventVars in ../index.d.ts
const { data } = await UpsertJournalEvent(dataConnect, upsertJournalEventVars);

// Operation GetFstStore:  For variables, look at type GetFstStoreVars in ../index.d.ts
const { data } = await GetFstStore(dataConnect, getFstStoreVars);

// Operation GetFstStoreMeta:  For variables, look at type GetFstStoreMetaVars in ../index.d.ts
const { data } = await GetFstStoreMeta(dataConnect, getFstStoreMetaVars);

// Operation ListJournalEvents:  For variables, look at type ListJournalEventsVars in ../index.d.ts
const { data } = await ListJournalEvents(dataConnect, listJournalEventsVars);


```