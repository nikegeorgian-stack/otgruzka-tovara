const { queryRef, executeQuery, validateArgsWithOptions, mutationRef, executeMutation, validateArgs, makeMemoryCacheProvider } = require('firebase/data-connect');

const connectorConfig = {
  connector: 'fst',
  service: 'otgruzka-tovara-service',
  location: 'europe-west3'
};
exports.connectorConfig = connectorConfig;
const dataConnectSettings = {
  cacheSettings: {
    cacheProvider: makeMemoryCacheProvider(),
    maxAgeSeconds: 5
  }
};
exports.dataConnectSettings = dataConnectSettings;

const createFstStoreRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'CreateFstStore', inputVars);
}
createFstStoreRef.operationName = 'CreateFstStore';
exports.createFstStoreRef = createFstStoreRef;

exports.createFstStore = function createFstStore(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(createFstStoreRef(dcInstance, inputVars));
}
;

const updateFstStoreRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpdateFstStore', inputVars);
}
updateFstStoreRef.operationName = 'UpdateFstStore';
exports.updateFstStoreRef = updateFstStoreRef;

exports.updateFstStore = function updateFstStore(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(updateFstStoreRef(dcInstance, inputVars));
}
;

const upsertJournalEventRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return mutationRef(dcInstance, 'UpsertJournalEvent', inputVars);
}
upsertJournalEventRef.operationName = 'UpsertJournalEvent';
exports.upsertJournalEventRef = upsertJournalEventRef;

exports.upsertJournalEvent = function upsertJournalEvent(dcOrVars, vars) {
  const { dc: dcInstance, vars: inputVars } = validateArgs(connectorConfig, dcOrVars, vars, true);
  return executeMutation(upsertJournalEventRef(dcInstance, inputVars));
}
;

const getFstStoreRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetFstStore', inputVars);
}
getFstStoreRef.operationName = 'GetFstStore';
exports.getFstStoreRef = getFstStoreRef;

exports.getFstStore = function getFstStore(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getFstStoreRef(dcInstance, inputVars), inputOpts && { fetchPolicy: inputOpts.fetchPolicy });
}
;

const getFstStoreMetaRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'GetFstStoreMeta', inputVars);
}
getFstStoreMetaRef.operationName = 'GetFstStoreMeta';
exports.getFstStoreMetaRef = getFstStoreMetaRef;

exports.getFstStoreMeta = function getFstStoreMeta(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(getFstStoreMetaRef(dcInstance, inputVars), inputOpts && { fetchPolicy: inputOpts.fetchPolicy });
}
;

const listJournalEventsRef = (dcOrVars, vars) => {
  const { dc: dcInstance, vars: inputVars} = validateArgs(connectorConfig, dcOrVars, vars, true);
  dcInstance._useGeneratedSdk();
  return queryRef(dcInstance, 'ListJournalEvents', inputVars);
}
listJournalEventsRef.operationName = 'ListJournalEvents';
exports.listJournalEventsRef = listJournalEventsRef;

exports.listJournalEvents = function listJournalEvents(dcOrVars, varsOrOptions, options) {
  
  const { dc: dcInstance, vars: inputVars, options: inputOpts } = validateArgsWithOptions(connectorConfig, dcOrVars, varsOrOptions, options, true, true);
  return executeQuery(listJournalEventsRef(dcInstance, inputVars), inputOpts && { fetchPolicy: inputOpts.fetchPolicy });
}
;
