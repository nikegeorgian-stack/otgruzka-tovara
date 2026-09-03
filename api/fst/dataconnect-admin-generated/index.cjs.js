const { validateAdminArgs } = require('firebase-admin/data-connect');

const connectorConfig = {
  connector: 'fst-admin',
  serviceId: 'otgruzka-tovara-service',
  location: 'europe-west3'
};
exports.connectorConfig = connectorConfig;

function upsertQcPermission(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeMutation('UpsertQcPermission', inputVars, inputOpts);
}
exports.upsertQcPermission = upsertQcPermission;

function insertQcAttachmentRecord(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeMutation('InsertQcAttachmentRecord', inputVars, inputOpts);
}
exports.insertQcAttachmentRecord = insertQcAttachmentRecord;

function updateQcAttachmentRecord(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeMutation('UpdateQcAttachmentRecord', inputVars, inputOpts);
}
exports.updateQcAttachmentRecord = updateQcAttachmentRecord;

function upsertQcFinishedGoodsLot(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeMutation('UpsertQcFinishedGoodsLot', inputVars, inputOpts);
}
exports.upsertQcFinishedGoodsLot = upsertQcFinishedGoodsLot;

function updateQcFinishedGoodsLotShipped(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeMutation('UpdateQcFinishedGoodsLotShipped', inputVars, inputOpts);
}
exports.updateQcFinishedGoodsLotShipped = updateQcFinishedGoodsLotShipped;

function insertQcLotDecision(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeMutation('InsertQcLotDecision', inputVars, inputOpts);
}
exports.insertQcLotDecision = insertQcLotDecision;

function getQcPermissionByUidStore(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('GetQcPermissionByUidStore', inputVars, inputOpts);
}
exports.getQcPermissionByUidStore = getQcPermissionByUidStore;

function getQcPermissionById(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('GetQcPermissionById', inputVars, inputOpts);
}
exports.getQcPermissionById = getQcPermissionById;

function listQcPermissionsForStore(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('ListQcPermissionsForStore', inputVars, inputOpts);
}
exports.listQcPermissionsForStore = listQcPermissionsForStore;

function getQcAttachmentRecord(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('GetQcAttachmentRecord', inputVars, inputOpts);
}
exports.getQcAttachmentRecord = getQcAttachmentRecord;

function getQcAttachmentByIdempotency(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('GetQcAttachmentByIdempotency', inputVars, inputOpts);
}
exports.getQcAttachmentByIdempotency = getQcAttachmentByIdempotency;

function listVerifiedLotAttachments(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('ListVerifiedLotAttachments', inputVars, inputOpts);
}
exports.listVerifiedLotAttachments = listVerifiedLotAttachments;

function getQcLotDecision(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('GetQcLotDecision', inputVars, inputOpts);
}
exports.getQcLotDecision = getQcLotDecision;

function getLatestQcLotDecision(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('GetLatestQcLotDecision', inputVars, inputOpts);
}
exports.getLatestQcLotDecision = getLatestQcLotDecision;

function getQcFinishedGoodsLot(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('GetQcFinishedGoodsLot', inputVars, inputOpts);
}
exports.getQcFinishedGoodsLot = getQcFinishedGoodsLot;

function getQcLotDecisionByIdempotency(dcOrVarsOrOptions, varsOrOptions, options) {
  const { dc: dcInstance, vars: inputVars, options: inputOpts} = validateAdminArgs(connectorConfig, dcOrVarsOrOptions, varsOrOptions, options, true, true);
  dcInstance.useGen(true);
  return dcInstance.executeQuery('GetQcLotDecisionByIdempotency', inputVars, inputOpts);
}
exports.getQcLotDecisionByIdempotency = getQcLotDecisionByIdempotency;

