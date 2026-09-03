import { ConnectorConfig, DataConnect, OperationOptions, ExecuteOperationResponse } from 'firebase-admin/data-connect';

export const connectorConfig: ConnectorConfig;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;


export interface FstStore_Key {
  id: string;
  __typename?: 'FstStore_Key';
}

export interface GetLatestQcLotDecisionData {
  qcLotDecisions: ({
    id: string;
    storeId: string;
    lotId: string;
    lotRevision: number;
    decisionVersion: number;
    status: string;
    passportAttachmentId?: string | null;
    protocolAttachmentId?: string | null;
    targetFinishedProductId?: string | null;
    reason?: string | null;
    decidedByUid?: string | null;
    decidedAt?: TimestampString | null;
    revision: number;
    idempotencyKey: string;
  } & QcLotDecision_Key)[];
}

export interface GetLatestQcLotDecisionVariables {
  storeId: string;
  lotId: string;
}

export interface GetQcAttachmentByIdempotencyData {
  qcAttachmentRecords: ({
    id: string;
    storeId: string;
    lotId: string;
    documentKind: string;
    storagePath: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
    objectGeneration?: string | null;
    status: string;
    uploadedByUid: string;
    verifiedAt?: TimestampString | null;
    revision: number;
    idempotencyKey: string;
  } & QcAttachmentRecord_Key)[];
}

export interface GetQcAttachmentByIdempotencyVariables {
  idempotencyKey: string;
}

export interface GetQcAttachmentRecordData {
  qcAttachmentRecord?: {
    id: string;
    storeId: string;
    lotId: string;
    documentKind: string;
    storagePath: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
    objectGeneration?: string | null;
    status: string;
    uploadedByUid: string;
    verifiedAt?: TimestampString | null;
    revision: number;
    idempotencyKey: string;
    createdAt: TimestampString;
    updatedAt: TimestampString;
  } & QcAttachmentRecord_Key;
}

export interface GetQcAttachmentRecordVariables {
  id: string;
}

export interface GetQcFinishedGoodsLotData {
  qcFinishedGoodsLot?: {
    id: string;
    storeId: string;
    finishedProductId: string;
    warehouseItemId: string;
    batchNo: string;
    quantityProduced: number;
    quantityShipped: number;
    packagingReportId: string;
    status: string;
    revision: number;
    updatedAt: TimestampString;
    updatedByUid?: string | null;
  } & QcFinishedGoodsLot_Key;
}

export interface GetQcFinishedGoodsLotVariables {
  id: string;
}

export interface GetQcLotDecisionByIdempotencyData {
  qcLotDecisions: ({
    id: string;
    storeId: string;
    lotId: string;
    decisionVersion: number;
    status: string;
    revision: number;
    idempotencyKey: string;
    decidedByUid?: string | null;
    decidedAt?: TimestampString | null;
  } & QcLotDecision_Key)[];
}

export interface GetQcLotDecisionByIdempotencyVariables {
  idempotencyKey: string;
}

export interface GetQcLotDecisionData {
  qcLotDecision?: {
    id: string;
    storeId: string;
    lotId: string;
    lotRevision: number;
    decisionVersion: number;
    status: string;
    passportAttachmentId?: string | null;
    protocolAttachmentId?: string | null;
    targetFinishedProductId?: string | null;
    reason?: string | null;
    decidedByUid?: string | null;
    decidedAt?: TimestampString | null;
    revision: number;
    idempotencyKey: string;
    createdAt: TimestampString;
    updatedAt: TimestampString;
  } & QcLotDecision_Key;
}

export interface GetQcLotDecisionVariables {
  id: string;
}

export interface GetQcPermissionByIdData {
  qcPermission?: {
    id: string;
    firebaseUid: string;
    storeId: string;
    active: boolean;
    canView: boolean;
    canUpload: boolean;
    canRelease: boolean;
    canRegrade: boolean;
    canReject: boolean;
    canPostShipment: boolean;
    revision: number;
    createdAt: TimestampString;
    createdByUid: string;
    updatedAt: TimestampString;
    updatedByUid: string;
    revokedAt?: TimestampString | null;
    revokedByUid?: string | null;
    revokeReason?: string | null;
  } & QcPermission_Key;
}

export interface GetQcPermissionByIdVariables {
  id: string;
}

export interface GetQcPermissionByUidStoreData {
  qcPermissions: ({
    id: string;
    firebaseUid: string;
    storeId: string;
    active: boolean;
    canView: boolean;
    canUpload: boolean;
    canRelease: boolean;
    canRegrade: boolean;
    canReject: boolean;
    canPostShipment: boolean;
    revision: number;
    createdAt: TimestampString;
    createdByUid: string;
    updatedAt: TimestampString;
    updatedByUid: string;
    revokedAt?: TimestampString | null;
    revokedByUid?: string | null;
    revokeReason?: string | null;
  } & QcPermission_Key)[];
}

export interface GetQcPermissionByUidStoreVariables {
  firebaseUid: string;
  storeId: string;
}

export interface InsertQcAttachmentRecordData {
  qcAttachmentRecord_insert: QcAttachmentRecord_Key;
}

export interface InsertQcAttachmentRecordVariables {
  id: string;
  storeId: string;
  lotId: string;
  documentKind: string;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  objectGeneration?: string | null;
  status: string;
  uploadedByUid: string;
  revision: number;
  idempotencyKey: string;
}

export interface InsertQcLotDecisionData {
  qcLotDecision_insert: QcLotDecision_Key;
}

export interface InsertQcLotDecisionVariables {
  id: string;
  storeId: string;
  lotId: string;
  lotRevision: number;
  decisionVersion: number;
  status: string;
  passportAttachmentId?: string | null;
  protocolAttachmentId?: string | null;
  targetFinishedProductId?: string | null;
  reason?: string | null;
  decidedByUid: string;
  decidedAt: TimestampString;
  revision: number;
  idempotencyKey: string;
}

export interface JournalEvent_Key {
  id: string;
  __typename?: 'JournalEvent_Key';
}

export interface ListQcPermissionsForStoreData {
  qcPermissions: ({
    id: string;
    firebaseUid: string;
    storeId: string;
    active: boolean;
    canView: boolean;
    canUpload: boolean;
    canRelease: boolean;
    canRegrade: boolean;
    canReject: boolean;
    canPostShipment: boolean;
    revision: number;
    updatedAt: TimestampString;
    revokedAt?: TimestampString | null;
    revokeReason?: string | null;
  } & QcPermission_Key)[];
}

export interface ListQcPermissionsForStoreVariables {
  storeId: string;
  limit: number;
}

export interface ListVerifiedLotAttachmentsData {
  qcAttachmentRecords: ({
    id: string;
    documentKind: string;
    storagePath: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
    objectGeneration?: string | null;
    status: string;
    revision: number;
  } & QcAttachmentRecord_Key)[];
}

export interface ListVerifiedLotAttachmentsVariables {
  storeId: string;
  lotId: string;
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

export interface UpdateQcAttachmentRecordData {
  qcAttachmentRecord_updateMany: number;
}

export interface UpdateQcAttachmentRecordVariables {
  id: string;
  expectedRevision: number;
  revision: number;
  status: string;
  objectGeneration?: string | null;
  checksum: string;
  sizeBytes: number;
  contentType: string;
  verifiedAt?: TimestampString | null;
}

export interface UpdateQcFinishedGoodsLotShippedData {
  qcFinishedGoodsLot_updateMany: number;
}

export interface UpdateQcFinishedGoodsLotShippedVariables {
  id: string;
  expectedRevision: number;
  revision: number;
  quantityShipped: number;
  updatedByUid: string;
}

export interface UpsertQcFinishedGoodsLotData {
  qcFinishedGoodsLot_upsert: QcFinishedGoodsLot_Key;
}

export interface UpsertQcFinishedGoodsLotVariables {
  id: string;
  storeId: string;
  finishedProductId: string;
  warehouseItemId: string;
  batchNo: string;
  quantityProduced: number;
  quantityShipped: number;
  packagingReportId: string;
  status: string;
  revision: number;
  updatedByUid?: string | null;
}

export interface UpsertQcPermissionData {
  qcPermission_upsert: QcPermission_Key;
}

export interface UpsertQcPermissionVariables {
  id: string;
  firebaseUid: string;
  storeId: string;
  active: boolean;
  canView: boolean;
  canUpload: boolean;
  canRelease: boolean;
  canRegrade: boolean;
  canReject: boolean;
  canPostShipment: boolean;
  revision: number;
  createdByUid: string;
  updatedByUid: string;
  revokedAt?: TimestampString | null;
  revokedByUid?: string | null;
  revokeReason?: string | null;
}

/** Generated Node Admin SDK operation action function for the 'UpsertQcPermission' Mutation. Allow users to execute without passing in DataConnect. */
export function upsertQcPermission(dc: DataConnect, vars: UpsertQcPermissionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpsertQcPermissionData>>;
/** Generated Node Admin SDK operation action function for the 'UpsertQcPermission' Mutation. Allow users to pass in custom DataConnect instances. */
export function upsertQcPermission(vars: UpsertQcPermissionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpsertQcPermissionData>>;

/** Generated Node Admin SDK operation action function for the 'InsertQcAttachmentRecord' Mutation. Allow users to execute without passing in DataConnect. */
export function insertQcAttachmentRecord(dc: DataConnect, vars: InsertQcAttachmentRecordVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<InsertQcAttachmentRecordData>>;
/** Generated Node Admin SDK operation action function for the 'InsertQcAttachmentRecord' Mutation. Allow users to pass in custom DataConnect instances. */
export function insertQcAttachmentRecord(vars: InsertQcAttachmentRecordVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<InsertQcAttachmentRecordData>>;

/** Generated Node Admin SDK operation action function for the 'UpdateQcAttachmentRecord' Mutation. Allow users to execute without passing in DataConnect. */
export function updateQcAttachmentRecord(dc: DataConnect, vars: UpdateQcAttachmentRecordVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateQcAttachmentRecordData>>;
/** Generated Node Admin SDK operation action function for the 'UpdateQcAttachmentRecord' Mutation. Allow users to pass in custom DataConnect instances. */
export function updateQcAttachmentRecord(vars: UpdateQcAttachmentRecordVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateQcAttachmentRecordData>>;

/** Generated Node Admin SDK operation action function for the 'UpsertQcFinishedGoodsLot' Mutation. Allow users to execute without passing in DataConnect. */
export function upsertQcFinishedGoodsLot(dc: DataConnect, vars: UpsertQcFinishedGoodsLotVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpsertQcFinishedGoodsLotData>>;
/** Generated Node Admin SDK operation action function for the 'UpsertQcFinishedGoodsLot' Mutation. Allow users to pass in custom DataConnect instances. */
export function upsertQcFinishedGoodsLot(vars: UpsertQcFinishedGoodsLotVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpsertQcFinishedGoodsLotData>>;

/** Generated Node Admin SDK operation action function for the 'UpdateQcFinishedGoodsLotShipped' Mutation. Allow users to execute without passing in DataConnect. */
export function updateQcFinishedGoodsLotShipped(dc: DataConnect, vars: UpdateQcFinishedGoodsLotShippedVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateQcFinishedGoodsLotShippedData>>;
/** Generated Node Admin SDK operation action function for the 'UpdateQcFinishedGoodsLotShipped' Mutation. Allow users to pass in custom DataConnect instances. */
export function updateQcFinishedGoodsLotShipped(vars: UpdateQcFinishedGoodsLotShippedVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<UpdateQcFinishedGoodsLotShippedData>>;

/** Generated Node Admin SDK operation action function for the 'InsertQcLotDecision' Mutation. Allow users to execute without passing in DataConnect. */
export function insertQcLotDecision(dc: DataConnect, vars: InsertQcLotDecisionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<InsertQcLotDecisionData>>;
/** Generated Node Admin SDK operation action function for the 'InsertQcLotDecision' Mutation. Allow users to pass in custom DataConnect instances. */
export function insertQcLotDecision(vars: InsertQcLotDecisionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<InsertQcLotDecisionData>>;

/** Generated Node Admin SDK operation action function for the 'GetQcPermissionByUidStore' Query. Allow users to execute without passing in DataConnect. */
export function getQcPermissionByUidStore(dc: DataConnect, vars: GetQcPermissionByUidStoreVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcPermissionByUidStoreData>>;
/** Generated Node Admin SDK operation action function for the 'GetQcPermissionByUidStore' Query. Allow users to pass in custom DataConnect instances. */
export function getQcPermissionByUidStore(vars: GetQcPermissionByUidStoreVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcPermissionByUidStoreData>>;

/** Generated Node Admin SDK operation action function for the 'GetQcPermissionById' Query. Allow users to execute without passing in DataConnect. */
export function getQcPermissionById(dc: DataConnect, vars: GetQcPermissionByIdVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcPermissionByIdData>>;
/** Generated Node Admin SDK operation action function for the 'GetQcPermissionById' Query. Allow users to pass in custom DataConnect instances. */
export function getQcPermissionById(vars: GetQcPermissionByIdVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcPermissionByIdData>>;

/** Generated Node Admin SDK operation action function for the 'ListQcPermissionsForStore' Query. Allow users to execute without passing in DataConnect. */
export function listQcPermissionsForStore(dc: DataConnect, vars: ListQcPermissionsForStoreVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<ListQcPermissionsForStoreData>>;
/** Generated Node Admin SDK operation action function for the 'ListQcPermissionsForStore' Query. Allow users to pass in custom DataConnect instances. */
export function listQcPermissionsForStore(vars: ListQcPermissionsForStoreVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<ListQcPermissionsForStoreData>>;

/** Generated Node Admin SDK operation action function for the 'GetQcAttachmentRecord' Query. Allow users to execute without passing in DataConnect. */
export function getQcAttachmentRecord(dc: DataConnect, vars: GetQcAttachmentRecordVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcAttachmentRecordData>>;
/** Generated Node Admin SDK operation action function for the 'GetQcAttachmentRecord' Query. Allow users to pass in custom DataConnect instances. */
export function getQcAttachmentRecord(vars: GetQcAttachmentRecordVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcAttachmentRecordData>>;

/** Generated Node Admin SDK operation action function for the 'GetQcAttachmentByIdempotency' Query. Allow users to execute without passing in DataConnect. */
export function getQcAttachmentByIdempotency(dc: DataConnect, vars: GetQcAttachmentByIdempotencyVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcAttachmentByIdempotencyData>>;
/** Generated Node Admin SDK operation action function for the 'GetQcAttachmentByIdempotency' Query. Allow users to pass in custom DataConnect instances. */
export function getQcAttachmentByIdempotency(vars: GetQcAttachmentByIdempotencyVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcAttachmentByIdempotencyData>>;

/** Generated Node Admin SDK operation action function for the 'ListVerifiedLotAttachments' Query. Allow users to execute without passing in DataConnect. */
export function listVerifiedLotAttachments(dc: DataConnect, vars: ListVerifiedLotAttachmentsVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<ListVerifiedLotAttachmentsData>>;
/** Generated Node Admin SDK operation action function for the 'ListVerifiedLotAttachments' Query. Allow users to pass in custom DataConnect instances. */
export function listVerifiedLotAttachments(vars: ListVerifiedLotAttachmentsVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<ListVerifiedLotAttachmentsData>>;

/** Generated Node Admin SDK operation action function for the 'GetQcLotDecision' Query. Allow users to execute without passing in DataConnect. */
export function getQcLotDecision(dc: DataConnect, vars: GetQcLotDecisionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcLotDecisionData>>;
/** Generated Node Admin SDK operation action function for the 'GetQcLotDecision' Query. Allow users to pass in custom DataConnect instances. */
export function getQcLotDecision(vars: GetQcLotDecisionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcLotDecisionData>>;

/** Generated Node Admin SDK operation action function for the 'GetLatestQcLotDecision' Query. Allow users to execute without passing in DataConnect. */
export function getLatestQcLotDecision(dc: DataConnect, vars: GetLatestQcLotDecisionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetLatestQcLotDecisionData>>;
/** Generated Node Admin SDK operation action function for the 'GetLatestQcLotDecision' Query. Allow users to pass in custom DataConnect instances. */
export function getLatestQcLotDecision(vars: GetLatestQcLotDecisionVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetLatestQcLotDecisionData>>;

/** Generated Node Admin SDK operation action function for the 'GetQcFinishedGoodsLot' Query. Allow users to execute without passing in DataConnect. */
export function getQcFinishedGoodsLot(dc: DataConnect, vars: GetQcFinishedGoodsLotVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcFinishedGoodsLotData>>;
/** Generated Node Admin SDK operation action function for the 'GetQcFinishedGoodsLot' Query. Allow users to pass in custom DataConnect instances. */
export function getQcFinishedGoodsLot(vars: GetQcFinishedGoodsLotVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcFinishedGoodsLotData>>;

/** Generated Node Admin SDK operation action function for the 'GetQcLotDecisionByIdempotency' Query. Allow users to execute without passing in DataConnect. */
export function getQcLotDecisionByIdempotency(dc: DataConnect, vars: GetQcLotDecisionByIdempotencyVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcLotDecisionByIdempotencyData>>;
/** Generated Node Admin SDK operation action function for the 'GetQcLotDecisionByIdempotency' Query. Allow users to pass in custom DataConnect instances. */
export function getQcLotDecisionByIdempotency(vars: GetQcLotDecisionByIdempotencyVariables, options?: OperationOptions): Promise<ExecuteOperationResponse<GetQcLotDecisionByIdempotencyData>>;

