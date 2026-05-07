import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Factory,
  FolderOpen,
  ImagePlus,
  PackageCheck,
  Search,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { auth, createAuthUserByAdmin, db } from './firebase'
import {
  allocateDocumentNumber,
  categoryRu,
  defaultJournalCategory,
  docKindRu,
  statusRu,
  type DocJournalCategory,
  type DocStatus,
  type ErpDocumentBase,
} from './documentsLogic'
import {
  defaultWarehousesSeed,
  ledgerEntry,
  movementTypeRu,
  type StockLedgerEntry,
  type WarehouseRecord,
} from './warehouseTis'

type Stage = 'raw' | 'impregnation' | 'qc' | 'warehouse' | 'shipment'
type Role = 'admin' | 'line' | 'qc' | 'warehouse' | 'logistics' | 'accounting' | 'hr'
type ViewKey =
  | 'dashboard'
  | 'documents'
  | 'production_request'
  | 'lots'
  | 'runs'
  | 'rolls'
  | 'qc'
  | 'inventory'
  | 'suppliers'
  | 'receipts'
  | 'orders'
  | 'shipping'
  | 'trace'
  | 'products'
  | 'hr'
  | 'users'
type DocDialogKind = 'pn' | 'pm' | 'sp' | 'zk' | 'otg'

type Lot = {
  id?: string
  productId?: string
  productName?: string
  supplier: string
  material: string
  product: string
  widthMm: number
  gsm: number
  rolls: number
  meters: number
  stage: Stage
  note?: string
  /** Склад / зона хранения (документ перемещения) */
  warehouseLocation?: string
}

type HrEmployee = {
  id: string
  name: string
  role: string
  shift: string
  status: 'active' | 'vacation' | 'sick'
}

type Product = {
  id?: string
  internalId: string
  name: string
  category: string
  uom: 'roll'
  imageUrl?: string
  imageBase64?: string
  isActive: boolean
}

type OrderLine = {
  productId: string
  productName: string
  qty: number
  reservedQty: number
}

type SalesOrder = {
  id?: string
  customer: string
  status: 'open' | 'closed' | 'cancelled'
  items: OrderLine[]
  createdAt?: unknown
}

type PermissionSet = {
  dashboard: boolean
  documents: boolean
  lots: boolean
  runs: boolean
  rolls: boolean
  qc: boolean
  inventory: boolean
  orders: boolean
  products: boolean
  hr: boolean
  users: boolean
}

type UserProfile = {
  id?: string
  email: string
  name: string
  role: Role
  permissions: PermissionSet
  active: boolean
}

type SessionUser = {
  uid: string
  role: Role
  name: string
  permissions: PermissionSet
}

type ProductionRun = {
  id?: string
  productId: string
  productName: string
  recipeCode: string
  line: string
  shift: 'День' | 'Ночь'
  status: 'planned' | 'running' | 'paused' | 'completed'
  plannedRolls: number
}

type ProducedRoll = {
  id?: string
  rollCode: string
  runId: string
  productId: string
  productName: string
  lengthM: number
  widthMm: number
  status: 'awaiting_qc' | 'approved' | 'reserved_for_shipment' | 'quarantine' | 'rejected' | 'shipped'
  /** Склад / зона учёта готовой продукции (ТиС) */
  warehouseLocation?: string
}

type Shipment = {
  id?: string
  customer: string
  palletCode: string
  rollIds: string[]
  rollCodes: string[]
  status: 'planned' | 'shipped'
}

type Supplier = {
  id?: string
  name: string
  country: string
  contact: string
  status: 'active' | 'blocked'
}

type Receipt = {
  id?: string
  supplierId: string
  supplierName: string
  productId: string
  productName: string
  qtyRolls: number
  note?: string
}

type ProductionRequestRawLine = {
  lotId: string
  lotLabel: string
  qty: number
  note?: string
}

type ProductionRequestRecord = {
  id: string
  date: string
  lineNumber: string
  lineName: string
  customer: string
  packaging: string
  density: string
  categoryLabel: string
  color: string
  plannedQty: number
  foremanId: string
  foremanName: string
  brigadeIds: string[]
  brigadeNames: string[]
  rawLines: ProductionRequestRawLine[]
  actualC1: number
  actualC2: number
  actualC3: number
  actualC4: number
  defectQty: number
  packedRolls: number
  packedBoxes: number
  packedPallets: number
  comment: string
  planStatus: 'Недовыполнен' | 'Выполнен' | 'Перевыполнен'
  status: 'draft' | 'posted'
  createdAt: string
}

type UnpackedOutputRecord = {
  id: string
  sourceRequestId: string
  date: string
  lineNumber: string
  lineName: string
  productName: string
  qtyRolls: number
  status: 'unpacked' | 'packaged'
}

type PackagingRequestRecord = {
  id: string
  outputId: string
  date: string
  sourceDate: string
  lineNumber: string
  lineName: string
  productName: string
  planRolls: number
  factRolls: number
  factBoxes: number
  factPallets: number
  labelItem: string
  labelQty: number
  stretchQty: number
  thermoQty: number
  comment: string
  status: 'draft' | 'posted'
}

const stageLabels: Record<Stage, string> = {
  raw: 'Сырьё',
  impregnation: 'Пропитка',
  qc: 'Контроль качества',
  warehouse: 'Склад',
  shipment: 'Отгрузка',
}

const roleLabels: Record<Role, string> = {
  admin: 'Админ',
  line: 'Технолог линии',
  qc: 'ОТК / QC',
  warehouse: 'Склад',
  logistics: 'Логистика',
  accounting: 'Бухгалтерия',
  hr: 'HR',
}

const defaultPermissionsByRole: Record<Role, PermissionSet> = {
  admin: { dashboard: true, documents: true, lots: true, runs: true, rolls: true, qc: true, inventory: true, orders: true, products: true, hr: true, users: true },
  line: { dashboard: true, documents: true, lots: true, runs: true, rolls: true, qc: false, inventory: false, orders: false, products: false, hr: false, users: false },
  qc: { dashboard: true, documents: true, lots: true, runs: false, rolls: true, qc: true, inventory: true, orders: false, products: false, hr: false, users: false },
  warehouse: { dashboard: true, documents: true, lots: true, runs: false, rolls: true, qc: false, inventory: true, orders: true, products: false, hr: false, users: false },
  logistics: { dashboard: true, documents: true, lots: true, runs: false, rolls: true, qc: false, inventory: true, orders: true, products: false, hr: false, users: false },
  accounting: { dashboard: true, documents: true, lots: false, runs: false, rolls: false, qc: false, inventory: true, orders: true, products: false, hr: false, users: false },
  hr: { dashboard: true, documents: false, lots: false, runs: false, rolls: false, qc: false, inventory: false, orders: false, products: false, hr: true, users: false },
}

function resolvePermissions(role: Role, raw?: Partial<PermissionSet>): PermissionSet {
  return { ...defaultPermissionsByRole[role], ...(raw || {}) }
}

const bootstrapByEmail: Record<string, { role: Role; name: string }> = {
  'admin@otgruzka.local': { role: 'admin', name: 'Системный админ' },
  'line@otgruzka.local': { role: 'line', name: 'Технолог линии' },
  'qc@otgruzka.local': { role: 'qc', name: 'Инженер ОТК' },
  'warehouse@otgruzka.local': { role: 'warehouse', name: 'Кладовщик' },
  'logistics@otgruzka.local': { role: 'logistics', name: 'Логист' },
  'accounting@otgruzka.local': { role: 'accounting', name: 'Бухгалтер' },
  'hr@otgruzka.local': { role: 'hr', name: 'HR менеджер' },
}

const loginOptions = [
  { id: 'admin', label: 'Админ', email: 'admin@otgruzka.local' },
  { id: 'line', label: 'Технолог линии', email: 'line@otgruzka.local' },
  { id: 'qc', label: 'ОТК / QC', email: 'qc@otgruzka.local' },
  { id: 'warehouse', label: 'Склад', email: 'warehouse@otgruzka.local' },
  { id: 'logistics', label: 'Логистика', email: 'logistics@otgruzka.local' },
  { id: 'accounting', label: 'Бухгалтерия', email: 'accounting@otgruzka.local' },
  { id: 'hr', label: 'HR', email: 'hr@otgruzka.local' },
]

const lots: Lot[] = [
  {
    id: 'LOT-2026-001',
    supplier: 'SIMO',
    material: 'Сетка',
    product: 'Celloplex 160',
    widthMm: 1000,
    gsm: 160,
    rolls: 220,
    meters: 11000,
    stage: 'impregnation',
    note: 'Партия на вечернюю смену',
  },
  {
    id: 'LOT-2026-002',
    supplier: 'SIMO',
    material: 'Стеклоткань',
    product: '7628',
    widthMm: 1000,
    gsm: 210,
    rolls: 95,
    meters: 3800,
    stage: 'qc',
  },
  {
    id: 'LOT-2026-003',
    supplier: 'Local',
    material: 'Ратл',
    product: 'Rooflex 190(100)',
    widthMm: 1000,
    gsm: 190,
    rolls: 64,
    meters: 2500,
    stage: 'warehouse',
  },
]

const initialProducts: Omit<Product, 'id'>[] = [
  { internalId: 'FC-MESH-165U', name: 'Celloplex 165 Ultra', category: 'Glass mesh', uom: 'roll', isActive: true },
  { internalId: 'FC-MESH-145U', name: 'Celloplex 145 Ultra', category: 'Glass mesh', uom: 'roll', isActive: true },
  { internalId: 'FC-MESH-160', name: 'Celloplex 160', category: 'Glass mesh', uom: 'roll', isActive: true },
  { internalId: 'FC-MESH-145', name: 'Celloplex 145', category: 'Glass mesh', uom: 'roll', isActive: true },
  { internalId: 'FC-MESH-130', name: 'Celloplex 130', category: 'Glass mesh', uom: 'roll', isActive: true },
  { internalId: 'FC-MESH-110', name: 'Celloplex 110', category: 'Glass mesh', uom: 'roll', isActive: true },
  { internalId: 'FC-MESH-075', name: 'Celloplex 75', category: 'Glass mesh', uom: 'roll', isActive: true },
  { internalId: 'FC-MEM-001', name: 'Fiberglass Membrane', category: 'Membrane', uom: 'roll', isActive: true },
  { internalId: 'FC-ROOF-190', name: 'Rooflex 190(100)', category: 'Roofing glass fabric', uom: 'roll', isActive: true },
  { internalId: 'FC-ROOF-200', name: 'Rooflex 200(100)', category: 'Roofing glass fabric', uom: 'roll', isActive: true },
  { internalId: 'FC-EI-1080', name: '1080', category: 'Electrical insulation glass fabric', uom: 'roll', isActive: true },
  { internalId: 'FC-EI-2116', name: '2116', category: 'Electrical insulation glass fabric', uom: 'roll', isActive: true },
  { internalId: 'FC-EI-2165', name: '2165', category: 'Electrical insulation glass fabric', uom: 'roll', isActive: true },
  { internalId: 'FC-EI-7628', name: '7628', category: 'Electrical insulation glass fabric', uom: 'roll', isActive: true },
  { internalId: 'FC-EI-7637', name: '7637', category: 'Electrical insulation glass fabric', uom: 'roll', isActive: true },
  { internalId: 'FC-CI-TG430', name: 'TG-430', category: 'Glass fabric for coating/impregnation', uom: 'roll', isActive: true },
  { internalId: 'FC-CI-7628LS', name: '7628 loomstate', category: 'Glass fabric for coating/impregnation', uom: 'roll', isActive: true },
]

const employees: HrEmployee[] = [
  { id: 'EMP-001', name: 'Георгий Л.', role: 'Оператор линии', shift: 'День', status: 'active' },
  { id: 'EMP-002', name: 'Ника Ч.', role: 'ОТК', shift: 'День', status: 'vacation' },
  { id: 'EMP-003', name: 'Ираклий С.', role: 'Склад', shift: 'Ночь', status: 'active' },
  { id: 'EMP-004', name: 'Мариам Д.', role: 'Логистика', shift: 'День', status: 'sick' },
]

function App() {
  const [selectedLogin, setSelectedLogin] = useState(loginOptions[0].id)
  const [password, setPassword] = useState('')
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)
  const [lotsState, setLotsState] = useState<Lot[]>([])
  const [productsState, setProductsState] = useState<Product[]>([])
  const [ordersState, setOrdersState] = useState<SalesOrder[]>([])
  const [runsState, setRunsState] = useState<ProductionRun[]>([])
  const [rollsState, setRollsState] = useState<ProducedRoll[]>([])
  const [shipmentsState, setShipmentsState] = useState<Shipment[]>([])
  const [suppliersState, setSuppliersState] = useState<Supplier[]>([])
  const [receiptsState, setReceiptsState] = useState<Receipt[]>([])
  const [warehousesState, setWarehousesState] = useState<WarehouseRecord[]>([])
  const [stockLedgerState, setStockLedgerState] = useState<StockLedgerEntry[]>([])
  const [inventorySubView, setInventorySubView] = useState<'balances' | 'movements' | 'warehouses'>('balances')
  const [balancesWarehouseFilter, setBalancesWarehouseFilter] = useState<string>('__all__')
  const [newWarehouse, setNewWarehouse] = useState({ code: '', name: '' })

  const [documentsState, setDocumentsState] = useState<ErpDocumentBase[]>([])
  const [docCategoryFilter, setDocCategoryFilter] = useState<DocJournalCategory>('all')
  const [docStatusFilter, setDocStatusFilter] = useState<'all' | DocStatus>('all')
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)

  const [newDocPn, setNewDocPn] = useState({
    supplierId: '',
    productId: '',
    qtyRolls: 0,
    meters: 0,
    warehouse: defaultWarehousesSeed[0]?.name ?? 'СКЛ — Сырьё и материалы',
    docDate: new Date().toISOString().slice(0, 10),
    comment: '',
  })
  const [newDocPm, setNewDocPm] = useState({
    lotId: '',
    warehouseFrom: defaultWarehousesSeed[0]?.name ?? '',
    warehouseTo: defaultWarehousesSeed[2]?.name ?? '',
    docDate: new Date().toISOString().slice(0, 10),
    comment: '',
  })
  const [newDocSp, setNewDocSp] = useState({
    lotId: '',
    qtyRolls: 0,
    warehouse: defaultWarehousesSeed[0]?.name ?? '',
    docDate: new Date().toISOString().slice(0, 10),
    reason: '',
  })
  const [newDocZk, setNewDocZk] = useState({
    customer: '',
    productId: '',
    qty: 0,
    docDate: new Date().toISOString().slice(0, 10),
    comment: '',
  })
  const [newDocOtg, setNewDocOtg] = useState({
    customer: '',
    selectedRollIds: [] as string[],
    docDate: new Date().toISOString().slice(0, 10),
    comment: '',
  })
  const [productionRequests, setProductionRequests] = useState<ProductionRequestRecord[]>([])
  const [unpackedOutputs, setUnpackedOutputs] = useState<UnpackedOutputRecord[]>([])
  const [packagingRequests, setPackagingRequests] = useState<PackagingRequestRecord[]>([])
  const [packagedStock, setPackagedStock] = useState<Record<string, number>>({})
  const [consumablesStock, setConsumablesStock] = useState<Record<string, number>>({
    'Этикетка 160 сетка': 4000,
    'Этикетка 145 сетка': 3000,
    'Этикетка 130 сетка': 2500,
    Стрейч: 600,
    Термопленка: 420,
  })
  const [selectedProductionRequestId, setSelectedProductionRequestId] = useState<string | null>(null)
  const [isProductionDialogOpen, setIsProductionDialogOpen] = useState(false)
  const [isBrigadierDialogOpen, setIsBrigadierDialogOpen] = useState(false)
  const [isPackagingDialogOpen, setIsPackagingDialogOpen] = useState(false)
  const [brigadierIds, setBrigadierIds] = useState<string[]>([])
  const [newRawLine, setNewRawLine] = useState({ lotId: '', qty: 0, note: '' })
  const [productionForm, setProductionForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    lineNumber: '',
    lineName: '',
    customer: '',
    packaging: '',
    density: '',
    categoryLabel: '',
    color: '',
    plannedQty: 0,
    foremanId: '',
    brigadeIds: [] as string[],
    rawLines: [] as ProductionRequestRawLine[],
    actualC1: 0,
    actualC2: 0,
    actualC3: 0,
    actualC4: 0,
    defectQty: 0,
    packedRolls: 0,
    packedBoxes: 0,
    packedPallets: 0,
    comment: '',
  })
  const [packagingForm, setPackagingForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    sourceDate: new Date().toISOString().slice(0, 10),
    outputId: '',
    lineNumber: '',
    lineName: '',
    productName: '',
    planRolls: 0,
    factRolls: 0,
    factBoxes: 0,
    factPallets: 0,
    labelItem: 'Этикетка 160 сетка',
    labelQty: 0,
    stretchQty: 0,
    thermoQty: 0,
    comment: '',
  })

  const [usersState, setUsersState] = useState<UserProfile[]>([])
  const [employeesState, setEmployeesState] = useState<HrEmployee[]>([])
  const [authLoading, setAuthLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeStageFilter, setActiveStageFilter] = useState<'all' | Stage>('all')
  const [view, setView] = useState<ViewKey>('dashboard')
  const [navMode, setNavMode] = useState<'workspace' | 'sections'>('workspace')
  const [activeDocDialog, setActiveDocDialog] = useState<DocDialogKind | null>(null)
  const [newLot, setNewLot] = useState({
    productId: '',
    supplier: 'SIMO',
    material: 'Сетка',
    widthMm: 1000,
    gsm: 160,
    rolls: 0,
    meters: 0,
    note: '',
  })
  const [newEmployee, setNewEmployee] = useState({
    name: '',
    role: 'Оператор линии',
    shift: 'День',
  })
  const [newOrder, setNewOrder] = useState({ customer: '', productId: '', qty: 0 })
  const [newRun, setNewRun] = useState({
    productId: '',
    recipeCode: 'REC-v1',
    line: 'Impregnation Line 1',
    shift: 'День' as 'День' | 'Ночь',
    plannedRolls: 10,
  })
  const [newRoll, setNewRoll] = useState({ runId: '', lengthM: 50, widthMm: 1000 })
  const [newShipment, setNewShipment] = useState({ customer: '', selectedRollIds: [] as string[] })
  const [traceRollCode, setTraceRollCode] = useState('')
  const [newSupplier, setNewSupplier] = useState({ name: '', country: 'Georgia', contact: '' })
  const [newReceipt, setNewReceipt] = useState({ supplierId: '', productId: '', qtyRolls: 0, note: '' })
  const [newUser, setNewUser] = useState({
    email: '',
    password: '',
    name: '',
    role: 'line' as Role,
  })
  const [newProduct, setNewProduct] = useState({
    internalId: '',
    name: '',
    category: 'Custom',
  })

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user)
      if (!user) {
        setCurrentUser(null)
        setAuthLoading(false)
        return
      }
      try {
        const ref = doc(db, 'users', user.uid)
        const snap = await getDoc(ref)
        if (snap.exists()) {
          const data = snap.data() as { role: Role; name: string; permissions?: Partial<PermissionSet> }
          setCurrentUser({
            uid: user.uid,
            role: data.role,
            name: data.name,
            permissions: resolvePermissions(data.role, data.permissions),
          })
        } else {
          const fallback = bootstrapByEmail[user.email || '']
          setError(
            fallback
              ? 'Профиль найден в Auth, но не создан в системе. Зайдите под админом и создайте пользователя заново.'
              : 'Для пользователя нет роли в системе. Обратитесь к администратору.',
          )
          await signOut(auth)
        }
      } catch {
        setError('Ошибка загрузки профиля пользователя.')
      } finally {
        setAuthLoading(false)
      }
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (!firebaseUser || !currentUser) {
      setLotsState([])
      setEmployeesState([])
      setDataLoading(false)
      return
    }
    setDataLoading(true)

    const lotsQuery = query(collection(db, 'lots'), orderBy('createdAt', 'desc'))
    const unsubLots = onSnapshot(
      lotsQuery,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Lot, 'id'>) }))
        setLotsState(items)
        setDataLoading(false)
      },
      () => {
        setError('Ошибка чтения партий')
        setDataLoading(false)
      },
    )

    const productsQuery = query(collection(db, 'products'), orderBy('name', 'asc'))
    const unsubProducts = onSnapshot(
      productsQuery,
      async (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }))
        if (!items.length && currentUser.role === 'admin') {
          for (const product of initialProducts) {
            await addDoc(collection(db, 'products'), {
              ...product,
              imageUrl: `https://placehold.co/600x400/f2f2f2/333333?text=${encodeURIComponent(product.name)}`,
              createdAt: serverTimestamp(),
            })
          }
        } else {
          setProductsState(items)
        }
      },
      () => setError('Ошибка чтения номенклатуры'),
    )

    const ordersQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
    const unsubOrders = onSnapshot(
      ordersQuery,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SalesOrder, 'id'>) }))
        setOrdersState(items)
      },
      () => setError('Ошибка чтения заказов'),
    )

    const runsQuery = query(collection(db, 'productionRuns'), orderBy('createdAt', 'desc'))
    const unsubRuns = onSnapshot(
      runsQuery,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProductionRun, 'id'>) }))
        setRunsState(items)
      },
      () => setError('Ошибка чтения запусков'),
    )

    const rollsQuery = query(collection(db, 'rolls'), orderBy('createdAt', 'desc'))
    const unsubRolls = onSnapshot(
      rollsQuery,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProducedRoll, 'id'>) }))
        setRollsState(items)
      },
      () => setError('Ошибка чтения рулонов'),
    )

    const shipmentsQuery = query(collection(db, 'shipments'), orderBy('createdAt', 'desc'))
    const unsubShipments = onSnapshot(
      shipmentsQuery,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Shipment, 'id'>) }))
        setShipmentsState(items)
      },
      () => setError('Ошибка чтения отгрузок'),
    )

    const suppliersQuery = query(collection(db, 'suppliers'), orderBy('name', 'asc'))
    const unsubSuppliers = onSnapshot(
      suppliersQuery,
      async (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Supplier, 'id'>) }))
        if (!items.length && currentUser.role === 'admin') {
          await addDoc(collection(db, 'suppliers'), {
            name: 'SIMO',
            country: 'China',
            contact: 'sales@simo.example',
            status: 'active',
            createdAt: serverTimestamp(),
          })
          await addDoc(collection(db, 'suppliers'), {
            name: 'Local Supplier',
            country: 'Georgia',
            contact: '+995 000 000 000',
            status: 'active',
            createdAt: serverTimestamp(),
          })
        } else {
          setSuppliersState(items)
        }
      },
      () => setError('Ошибка чтения поставщиков'),
    )

    const receiptsQuery = query(collection(db, 'receipts'), orderBy('createdAt', 'desc'))
    const unsubReceipts = onSnapshot(
      receiptsQuery,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Receipt, 'id'>) }))
        setReceiptsState(items)
      },
      () => setError('Ошибка чтения поступлений'),
    )

    const warehousesQuery = query(collection(db, 'warehouses'), orderBy('sortOrder', 'asc'))
    const unsubWarehouses = onSnapshot(
      warehousesQuery,
      async (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WarehouseRecord, 'id'>) }))
        if (!items.length && currentUser.role === 'admin') {
          for (const w of defaultWarehousesSeed) {
            await addDoc(collection(db, 'warehouses'), { ...w, createdAt: serverTimestamp() })
          }
        } else {
          setWarehousesState(items as WarehouseRecord[])
        }
      },
      () => setError('Ошибка чтения складов'),
    )

    const ledgerQuery = query(collection(db, 'stockLedger'), orderBy('createdAt', 'desc'), limit(400))
    const unsubLedger = onSnapshot(
      ledgerQuery,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockLedgerEntry, 'id'>) }))
        setStockLedgerState(items as StockLedgerEntry[])
      },
      () => setError('Ошибка чтения движений ТМЦ'),
    )

    const documentsQuery = query(collection(db, 'documents'), orderBy('createdAt', 'desc'))
    const unsubDocuments = onSnapshot(
      documentsQuery,
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ErpDocumentBase, 'id'>) }))
        setDocumentsState(items as ErpDocumentBase[])
      },
      () => setError('Ошибка чтения журнала документов'),
    )

    const usersQuery = query(collection(db, 'users'), orderBy('name', 'asc'))
    const unsubUsers = onSnapshot(usersQuery, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UserProfile, 'id'>) }))
      setUsersState(items)
    })

    let unsubEmployees = () => {}
    if (currentUser.role === 'admin' || currentUser.role === 'hr') {
      const empQuery = query(collection(db, 'employees'), orderBy('name', 'asc'))
      unsubEmployees = onSnapshot(empQuery, (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<HrEmployee, 'id'>) }))
        setEmployeesState(items)
      })
    }

    return () => {
      unsubLots()
      unsubProducts()
      unsubOrders()
      unsubRuns()
      unsubRolls()
      unsubShipments()
      unsubSuppliers()
      unsubReceipts()
      unsubWarehouses()
      unsubLedger()
      unsubDocuments()
      unsubUsers()
      unsubEmployees()
    }
  }, [firebaseUser, currentUser])

  const allowedStages = useMemo(() => {
    if (!currentUser) return [] as Stage[]
    const map: Record<Role, Stage[]> = {
      admin: ['raw', 'impregnation', 'qc', 'warehouse', 'shipment'],
      line: ['raw', 'impregnation'],
      qc: ['impregnation', 'qc'],
      warehouse: ['warehouse'],
      logistics: ['shipment', 'warehouse'],
      accounting: ['shipment', 'warehouse'],
      hr: [],
    }
    return map[currentUser.role]
  }, [currentUser])

  const effectiveLots = lotsState.length ? lotsState : lots
  const totals = effectiveLots.reduce(
    (acc, lot) => {
      acc.rolls += lot.rolls
      acc.meters += lot.meters
      if (lot.stage === 'shipment') acc.shipment += lot.rolls
      if (lot.stage === 'qc') acc.qc += lot.rolls
      return acc
    },
    { rolls: 0, meters: 0, shipment: 0, qc: 0 },
  )

  const stageCounts = Object.keys(stageLabels).map((stage) => {
    const key = stage as Stage
    const count = effectiveLots.filter((lot) => lot.stage === key).length
    return { key, label: stageLabels[key], count }
  })

  const canSeeFlow = !!currentUser && currentUser.permissions.dashboard
  const canSeeLots = !!currentUser && currentUser.permissions.lots
  const canSeeFinance = !!currentUser && currentUser.permissions.dashboard && currentUser.permissions.inventory
  const canSeeHr = !!currentUser && currentUser.permissions.hr
  const canCreateLots = !!currentUser && currentUser.permissions.lots && ['admin', 'line', 'warehouse'].includes(currentUser.role)
  const canManageLots = !!currentUser && currentUser.permissions.lots
  const canManageRuns = !!currentUser && currentUser.permissions.runs
  const canManageRolls = !!currentUser && currentUser.permissions.rolls
  const canManageQc = !!currentUser && currentUser.permissions.qc
  const canManageProducts = !!currentUser && currentUser.permissions.products
  const canManageOrders = !!currentUser && currentUser.permissions.orders
  const canManageUsers = !!currentUser && currentUser.permissions.users
  const canManageShipping =
    !!currentUser &&
    currentUser.permissions.orders &&
    (currentUser.role === 'admin' || currentUser.role === 'warehouse' || currentUser.role === 'logistics')
  const canManageSuppliers = !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'warehouse')
  const canManageReceipts = !!currentUser && (currentUser.role === 'admin' || currentUser.role === 'warehouse')
  const canManageProductionRequest = !!currentUser && ['admin', 'warehouse', 'line', 'logistics'].includes(currentUser.role)
  const canSeeDocuments = !!currentUser && currentUser.permissions.documents
  const canWriteDocuments =
    !!currentUser &&
    currentUser.permissions.documents &&
    ['admin', 'warehouse', 'logistics', 'accounting'].includes(currentUser.role)
  const draftDocsCount = documentsState.filter((d) => d.status === 'draft').length
  const pendingShipmentsCount = shipmentsState.filter((s) => s.status === 'planned').length
  const qcQueueCount = rollsState.filter((r) => r.status === 'awaiting_qc').length
  const activeLotsCount = effectiveLots.length
  const canAccessSection = (key: ViewKey): boolean => {
    if (!currentUser) return false
    if (key === 'dashboard') return true
    if (key === 'documents') return canSeeDocuments
    if (key === 'production_request') return canManageProductionRequest
    if (key === 'lots') return currentUser.permissions.lots
    if (key === 'runs') return currentUser.permissions.runs
    if (key === 'rolls') return currentUser.permissions.rolls
    if (key === 'qc') return currentUser.permissions.qc
    if (key === 'inventory') return currentUser.permissions.inventory
    if (key === 'suppliers') return canManageSuppliers
    if (key === 'receipts') return canManageReceipts
    if (key === 'orders') return currentUser.permissions.orders
    if (key === 'shipping') return canManageShipping
    if (key === 'trace') return currentUser.permissions.dashboard
    if (key === 'products') return currentUser.permissions.products
    if (key === 'hr') return currentUser.permissions.hr
    if (key === 'users') return currentUser.permissions.users
    return false
  }

  const openSection = (key: ViewKey) => {
    setView(key)
    setNavMode('sections')
  }

  const navItems: Array<[ViewKey, string, typeof PackageCheck]> = [
    ['dashboard', 'Дашборд', PackageCheck],
    ['documents', 'Документы', FolderOpen],
    ['production_request', 'Заявка линии', ClipboardList],
    ['lots', 'Партии', Factory],
    ['runs', 'Запуски MES', Factory],
    ['rolls', 'Рулоны', PackageCheck],
    ['qc', 'Контроль качества', CheckCircle2],
    ['inventory', 'ТиС / Склад', Boxes],
    ['suppliers', 'Поставщики', Users],
    ['receipts', 'Поступления', ClipboardList],
    ['orders', 'Заказы/резервы', ClipboardList],
    ['shipping', 'Паллеты/отгрузка', Truck],
    ['trace', 'Traceability', Search],
    ['products', 'Номенклатура', ImagePlus],
    ['hr', 'HR', Users],
    ['users', 'Пользователи', ShieldCheck],
  ]

  const workspaceCardsByRole: Record<Role, Array<{ title: string; description: string; view: ViewKey }>> = {
    admin: [
      { title: 'Документы', description: 'Проведение ПН/ПМ/СП/ОТГ и контроль статусов', view: 'documents' },
      { title: 'ТиС / Склад', description: 'Остатки, движения, склады', view: 'inventory' },
      { title: 'Отгрузка', description: 'Паллеты и статусы отгрузок', view: 'shipping' },
      { title: 'Пользователи', description: 'Роли и доступы', view: 'users' },
    ],
    warehouse: [
      { title: 'Документы склада', description: 'Создание и проведение ПН/ПМ/СП/ОТГ', view: 'documents' },
      { title: 'Заявка линии', description: 'Приемка выработки и списание сырья по смене', view: 'production_request' },
      { title: 'Остатки и движения', description: 'Быстрый контроль складского регистра', view: 'inventory' },
      { title: 'Поступления', description: 'Приёмка и оформление сырья', view: 'receipts' },
      { title: 'Паллеты', description: 'Сборка и подготовка отгрузки', view: 'shipping' },
    ],
    logistics: [
      { title: 'Отгрузка', description: 'Паллеты, статусы, клиент', view: 'shipping' },
      { title: 'Заказы и резервы', description: 'Контроль резервов под отгрузку', view: 'orders' },
      { title: 'Документы', description: 'ОТГ и связанные документы', view: 'documents' },
      { title: 'ТиС / Склад', description: 'Проверка движений', view: 'inventory' },
    ],
    accounting: [
      { title: 'Документы', description: 'Контроль проведённых документов', view: 'documents' },
      { title: 'ТиС / Склад', description: 'Проверка движения товаров', view: 'inventory' },
      { title: 'Заказы', description: 'Проверка резервов и статусов', view: 'orders' },
      { title: 'Traceability', description: 'Поиск по рулону и истории', view: 'trace' },
    ],
    line: [
      { title: 'Заявка линии', description: 'План / факт по категориям и брак за смену', view: 'production_request' },
      { title: 'Партии', description: 'Управление этапами сырья и производства', view: 'lots' },
      { title: 'MES Запуски', description: 'Создание и контроль запусков', view: 'runs' },
      { title: 'Рулоны', description: 'Выпуск рулонов для QC', view: 'rolls' },
      { title: 'Дашборд', description: 'Обзор по производственной цепочке', view: 'dashboard' },
    ],
    qc: [
      { title: 'QC контроль', description: 'Проверка рулонов и изменение статуса', view: 'qc' },
      { title: 'Рулоны', description: 'Список выпущенных рулонов', view: 'rolls' },
      { title: 'Партии', description: 'Контроль переходов между этапами', view: 'lots' },
      { title: 'Traceability', description: 'Поиск по коду рулона', view: 'trace' },
    ],
    hr: [
      { title: 'HR', description: 'Сотрудники, статусы и смены', view: 'hr' },
      { title: 'Дашборд', description: 'Общий обзор состояния процесса', view: 'dashboard' },
      { title: 'Пользователи', description: 'Проверка доступов (если разрешено)', view: 'users' },
      { title: 'Документы', description: 'Просмотр журнала (если разрешено)', view: 'documents' },
    ],
  }

  const workspaceMetricByView: Partial<Record<ViewKey, string>> = {
    documents: `${draftDocsCount} черновиков`,
    inventory: `${stockLedgerState.length} движений`,
    shipping: `${pendingShipmentsCount} паллет в работе`,
    qc: `${qcQueueCount} рулонов в очереди`,
    lots: `${activeLotsCount} партий`,
    orders: `${ordersState.length} заказов`,
    receipts: `${receiptsState.length} поступлений`,
    users: `${usersState.length} пользователей`,
    products: `${productsState.length} позиций`,
    hr: `${employeesState.length} сотрудников`,
  }
  const effectiveEmployees = employeesState.length ? employeesState : employees
  const activeEmployees = effectiveEmployees.filter((e) => e.status === 'active')
  const availableRawLots = effectiveLots.filter((l) => (l.rolls || 0) > 0)
  const productionRequestCount = productionRequests.length
  const postedProductionRequestCount = productionRequests.filter((r) => r.status === 'posted').length
  workspaceMetricByView.production_request = `${postedProductionRequestCount}/${productionRequestCount} проведено`

  const resetProductionForm = () => {
    setProductionForm({
      date: new Date().toISOString().slice(0, 10),
      lineNumber: '',
      lineName: '',
      customer: '',
      packaging: '',
      density: '',
      categoryLabel: '',
      color: '',
      plannedQty: 0,
      foremanId: '',
      brigadeIds: [],
      rawLines: [],
      actualC1: 0,
      actualC2: 0,
      actualC3: 0,
      actualC4: 0,
      defectQty: 0,
      packedRolls: 0,
      packedBoxes: 0,
      packedPallets: 0,
      comment: '',
    })
    setNewRawLine({ lotId: '', qty: 0, note: '' })
    setSelectedProductionRequestId(null)
  }

  const selectedProductionRequest = productionRequests.find((r) => r.id === selectedProductionRequestId) || null
  const productionReadonly = selectedProductionRequest?.status === 'posted'
  const packagingReadonly = false
  const getProductionPlanStatus = (planned: number, actual: number): ProductionRequestRecord['planStatus'] => {
    if (actual > planned) return 'Перевыполнен'
    if (actual < planned) return 'Недовыполнен'
    return 'Выполнен'
  }

  const openNewProductionRequestDialog = () => {
    resetProductionForm()
    setIsProductionDialogOpen(true)
  }

  const resetPackagingForm = () => {
    setPackagingForm({
      date: new Date().toISOString().slice(0, 10),
      sourceDate: new Date().toISOString().slice(0, 10),
      outputId: '',
      lineNumber: '',
      lineName: '',
      productName: '',
      planRolls: 0,
      factRolls: 0,
      factBoxes: 0,
      factPallets: 0,
      labelItem: 'Этикетка 160 сетка',
      labelQty: 0,
      stretchQty: 0,
      thermoQty: 0,
      comment: '',
    })
  }

  const openNewPackagingDialog = () => {
    resetPackagingForm()
    setIsPackagingDialogOpen(true)
  }

  const openExistingProductionRequest = (id: string) => {
    const req = productionRequests.find((r) => r.id === id)
    if (!req) return
    setSelectedProductionRequestId(id)
    setProductionForm({
      date: req.date,
      lineNumber: req.lineNumber,
      lineName: req.lineName,
      customer: req.customer,
      packaging: req.packaging,
      density: req.density,
      categoryLabel: req.categoryLabel,
      color: req.color,
      plannedQty: req.plannedQty,
      foremanId: req.foremanId,
      brigadeIds: req.brigadeIds,
      rawLines: req.rawLines,
      actualC1: req.actualC1,
      actualC2: req.actualC2,
      actualC3: req.actualC3,
      actualC4: req.actualC4,
      defectQty: req.defectQty,
      packedRolls: req.packedRolls,
      packedBoxes: req.packedBoxes,
      packedPallets: req.packedPallets,
      comment: req.comment,
    })
    setIsProductionDialogOpen(true)
  }

  const addBrigadier = (employeeId: string) => {
    if (!employeeId || brigadierIds.includes(employeeId)) return
    setBrigadierIds((s) => [...s, employeeId])
    if (!productionForm.foremanId) {
      setProductionForm((s) => ({ ...s, foremanId: employeeId }))
    }
  }

  const toggleBrigadeMember = (employeeId: string) => {
    setProductionForm((s) => ({
      ...s,
      brigadeIds: s.brigadeIds.includes(employeeId) ? s.brigadeIds.filter((id) => id !== employeeId) : [...s.brigadeIds, employeeId],
    }))
  }

  const addRawLineToProduction = () => {
    const lot = availableRawLots.find((l) => l.id === newRawLine.lotId)
    if (!lot || !newRawLine.qty || newRawLine.qty <= 0) return
    const label = `${lot.product} • ${(lot.id || '').slice(0, 18)}`
    setProductionForm((s) => ({
      ...s,
      rawLines: [...s.rawLines, { lotId: lot.id || '', lotLabel: label, qty: newRawLine.qty, note: newRawLine.note.trim() }],
    }))
    setNewRawLine({ lotId: '', qty: 0, note: '' })
  }

  const removeRawLineFromProduction = (idx: number) => {
    setProductionForm((s) => ({ ...s, rawLines: s.rawLines.filter((_, i) => i !== idx) }))
  }

  const saveProductionRequestDraft = () => {
    const foreman = activeEmployees.find((e) => e.id === productionForm.foremanId)
    if (!productionForm.lineNumber.trim() || !productionForm.lineName.trim() || !foreman) {
      setError('Заявка: заполните номер линии, наименование и выберите бригадира')
      return
    }
    const actualTotal = productionForm.actualC1 + productionForm.actualC2 + productionForm.actualC3 + productionForm.actualC4
    const planStatus = getProductionPlanStatus(productionForm.plannedQty || 0, actualTotal)
    const brigade = activeEmployees.filter((e) => productionForm.brigadeIds.includes(e.id))
    const payload: ProductionRequestRecord = {
      id: selectedProductionRequestId || `REQ-${Date.now()}`,
      date: productionForm.date,
      lineNumber: productionForm.lineNumber.trim(),
      lineName: productionForm.lineName.trim(),
      customer: productionForm.customer.trim(),
      packaging: productionForm.packaging.trim(),
      density: productionForm.density.trim(),
      categoryLabel: productionForm.categoryLabel.trim(),
      color: productionForm.color.trim(),
      plannedQty: Number(productionForm.plannedQty) || 0,
      foremanId: foreman.id,
      foremanName: foreman.name,
      brigadeIds: productionForm.brigadeIds,
      brigadeNames: brigade.map((b) => b.name),
      rawLines: productionForm.rawLines,
      actualC1: Number(productionForm.actualC1) || 0,
      actualC2: Number(productionForm.actualC2) || 0,
      actualC3: Number(productionForm.actualC3) || 0,
      actualC4: Number(productionForm.actualC4) || 0,
      defectQty: Number(productionForm.defectQty) || 0,
      packedRolls: Number(productionForm.packedRolls) || 0,
      packedBoxes: Number(productionForm.packedBoxes) || 0,
      packedPallets: Number(productionForm.packedPallets) || 0,
      comment: productionForm.comment.trim(),
      planStatus,
      status: selectedProductionRequest?.status === 'posted' ? 'posted' : 'draft',
      createdAt: selectedProductionRequest?.createdAt || new Date().toISOString(),
    }
    setProductionRequests((rows) => {
      const i = rows.findIndex((r) => r.id === payload.id)
      if (i < 0) return [payload, ...rows]
      const copy = [...rows]
      copy[i] = payload
      return copy
    })
    setError('')
    setIsProductionDialogOpen(false)
  }

  const postProductionRequest = async (id: string) => {
    const req = productionRequests.find((r) => r.id === id)
    if (!req || req.status === 'posted') return
    for (const row of req.rawLines) {
      const lot = lotsState.find((l) => l.id === row.lotId)
      if (!lot || !lot.id) continue
      const nextRolls = Math.max(0, (lot.rolls || 0) - (row.qty || 0))
      await updateDoc(doc(db, 'lots', lot.id), { rolls: nextRolls, updatedAt: serverTimestamp() }).catch(() => {})
    }
    const outputQty = Math.max(0, req.actualC1 + req.actualC2 + req.actualC3 + req.actualC4 - req.defectQty)
    const output: UnpackedOutputRecord = {
      id: `UO-${Date.now()}`,
      sourceRequestId: req.id,
      date: req.date,
      lineNumber: req.lineNumber,
      lineName: req.lineName,
      productName: req.lineName || req.categoryLabel || 'Готовая продукция',
      qtyRolls: outputQty,
      status: 'unpacked',
    }
    setUnpackedOutputs((s) => [output, ...s])
    setProductionRequests((rows) => rows.map((r) => (r.id === id ? { ...r, status: 'posted' } : r)))
    await logAction('production_request.post', { requestId: id, outputQty })
    if (selectedProductionRequestId === id) {
      setSelectedProductionRequestId(id)
    }
  }

  const selectOutputForPackaging = (outputId: string) => {
    const out = unpackedOutputs.find((o) => o.id === outputId && o.status === 'unpacked')
    if (!out) return
    setPackagingForm((s) => ({
      ...s,
      outputId,
      sourceDate: out.date,
      lineNumber: out.lineNumber,
      lineName: out.lineName,
      productName: out.productName,
      planRolls: out.qtyRolls,
      factRolls: out.qtyRolls,
    }))
  }

  const savePackagingDraft = () => {
    if (!packagingForm.outputId || !packagingForm.lineName.trim()) {
      setError('Упаковка: выберите выработку предыдущего дня')
      return
    }
    const payload: PackagingRequestRecord = {
      id: `PKG-${Date.now()}`,
      outputId: packagingForm.outputId,
      date: packagingForm.date,
      sourceDate: packagingForm.sourceDate,
      lineNumber: packagingForm.lineNumber.trim(),
      lineName: packagingForm.lineName.trim(),
      productName: packagingForm.productName.trim(),
      planRolls: Number(packagingForm.planRolls) || 0,
      factRolls: Number(packagingForm.factRolls) || 0,
      factBoxes: Number(packagingForm.factBoxes) || 0,
      factPallets: Number(packagingForm.factPallets) || 0,
      labelItem: packagingForm.labelItem,
      labelQty: Number(packagingForm.labelQty) || 0,
      stretchQty: Number(packagingForm.stretchQty) || 0,
      thermoQty: Number(packagingForm.thermoQty) || 0,
      comment: packagingForm.comment.trim(),
      status: 'draft',
    }
    setPackagingRequests((rows) => [payload, ...rows])
    setIsPackagingDialogOpen(false)
    setError('')
  }

  const postPackagingRequest = async (id: string) => {
    const req = packagingRequests.find((r) => r.id === id)
    if (!req || req.status === 'posted') return
    setConsumablesStock((s) => ({
      ...s,
      [req.labelItem]: Math.max(0, (s[req.labelItem] || 0) - req.labelQty),
      Стрейч: Math.max(0, (s.Стрейч || 0) - req.stretchQty),
      Термопленка: Math.max(0, (s.Термопленка || 0) - req.thermoQty),
    }))
    setPackagedStock((s) => ({ ...s, [req.productName]: (s[req.productName] || 0) + req.factRolls }))
    setUnpackedOutputs((rows) => rows.map((o) => (o.id === req.outputId ? { ...o, status: 'packaged' } : o)))
    setPackagingRequests((rows) => rows.map((r) => (r.id === id ? { ...r, status: 'posted' } : r)))
    await logAction('packaging_request.post', { requestId: id, factRolls: req.factRolls })
  }
  const docDialogTitle: Record<DocDialogKind, string> = {
    pn: 'Новый документ: Приходная (ПН)',
    pm: 'Новый документ: Перемещение (ПМ)',
    sp: 'Новый документ: Списание ТМЦ (СП)',
    zk: 'Новый документ: Заказ клиента (ЗК)',
    otg: 'Новый документ: Отгрузка (ОТГ)',
  }

  async function logAction(action: string, payload: Record<string, unknown>) {
    if (!currentUser) return
    try {
      await addDoc(collection(db, 'auditLogs'), {
        action,
        payload,
        userId: currentUser.uid,
        userName: currentUser.name,
        role: currentUser.role,
        createdAt: serverTimestamp(),
      })
    } catch {
      // Do not block user workflow when audit write fails.
    }
  }

  async function handleLogin() {
    setError('')
    try {
      const selected = loginOptions.find((item) => item.id === selectedLogin)
      if (!selected) {
        setError('Выберите пользователя')
        return
      }
      await signInWithEmailAndPassword(auth, selected.email, password.trim())
    } catch {
      setError('Неверный логин или пароль')
    }
  }

  async function logout() {
    await signOut(auth)
    setCurrentUser(null)
    setFirebaseUser(null)
    setSelectedLogin(loginOptions[0].id)
    setPassword('')
    setError('')
  }

  function roleCanOperateStage(role: Role, stage: Stage) {
    const map: Record<Role, Stage[]> = {
      admin: ['raw', 'impregnation', 'qc', 'warehouse', 'shipment'],
      line: ['raw', 'impregnation'],
      qc: ['qc'],
      warehouse: ['warehouse'],
      logistics: ['warehouse', 'shipment'],
      accounting: [],
      hr: [],
    }
    return map[role].includes(stage)
  }

  const orderedStages: Stage[] = ['raw', 'impregnation', 'qc', 'warehouse', 'shipment']

  async function moveLot(lot: Lot, direction: 'next' | 'prev') {
    if (!lot.id || !currentUser) return
    const idx = orderedStages.indexOf(lot.stage)
    const nextIdx = direction === 'next' ? idx + 1 : idx - 1
    if (nextIdx < 0 || nextIdx >= orderedStages.length) return
    const target = orderedStages[nextIdx]
    if (currentUser.role !== 'admin' && (!roleCanOperateStage(currentUser.role, lot.stage) || !roleCanOperateStage(currentUser.role, target)))
      return
    await updateDoc(doc(db, 'lots', lot.id), {
      stage: target,
      updatedAt: serverTimestamp(),
    })
    await logAction('lot.move', { lotId: lot.id, from: lot.stage, to: target })
  }

  async function createLot() {
    if (!currentUser || !canCreateLots) return
    const selectedProduct = productsState.find((p) => p.id === newLot.productId)
    if (!selectedProduct || newLot.rolls <= 0 || newLot.meters <= 0) {
      setError('Заполните продукт, рулоны и метры для новой партии')
      return
    }
    setError('')
    await addDoc(collection(db, 'lots'), {
      supplier: newLot.supplier,
      material: newLot.material,
      productId: selectedProduct.id,
      product: selectedProduct.name,
      productName: selectedProduct.name,
      widthMm: Number(newLot.widthMm),
      gsm: Number(newLot.gsm),
      rolls: Number(newLot.rolls),
      meters: Number(newLot.meters),
      stage: 'raw',
      note: newLot.note.trim(),
      createdAt: serverTimestamp(),
      createdBy: firebaseUser?.uid || '',
    })
    await logAction('lot.create', { productId: selectedProduct.id, rolls: newLot.rolls, meters: newLot.meters })
    setNewLot({
      productId: '',
      supplier: 'SIMO',
      material: 'Сетка',
      widthMm: 1000,
      gsm: 160,
      rolls: 0,
      meters: 0,
      note: '',
    })
  }

  async function seedDemoLots() {
    if (!currentUser || currentUser.role !== 'admin') return
    for (const lot of lots) {
      const byName = productsState.find((p) => p.name === lot.product)
      await addDoc(collection(db, 'lots'), {
        ...lot,
        productId: byName?.id || '',
        productName: lot.product,
        createdAt: serverTimestamp(),
        createdBy: firebaseUser?.uid || '',
      })
    }
  }

  async function addEmployee() {
    if (!currentUser || !(currentUser.role === 'admin' || currentUser.role === 'hr')) return
    if (!newEmployee.name.trim()) return
    await addDoc(collection(db, 'employees'), {
      name: newEmployee.name.trim(),
      role: newEmployee.role,
      shift: newEmployee.shift,
      status: 'active',
      createdAt: serverTimestamp(),
    })
    await logAction('employee.create', { name: newEmployee.name.trim(), role: newEmployee.role })
    setNewEmployee({ name: '', role: 'Оператор линии', shift: 'День' })
  }

  async function setEmployeeStatus(id: string, status: HrEmployee['status']) {
    if (!currentUser || !(currentUser.role === 'admin' || currentUser.role === 'hr')) return
    await updateDoc(doc(db, 'employees', id), { status, updatedAt: serverTimestamp() })
    await logAction('employee.status', { employeeId: id, status })
  }

  const reservationsByProduct = useMemo(() => {
    const map: Record<string, number> = {}
    for (const order of ordersState) {
      if (order.status !== 'open') continue
      for (const line of order.items) {
        map[line.productId] = (map[line.productId] || 0) + line.reservedQty
      }
    }
    return map
  }, [ordersState])

  const readyByProduct = useMemo(() => {
    const map: Record<string, number> = {}
    if (rollsState.length) {
      for (const roll of rollsState) {
        if (roll.status !== 'approved' && roll.status !== 'reserved_for_shipment') continue
        const key = roll.productId || ''
        map[key] = (map[key] || 0) + 1
      }
      return map
    }
    for (const lot of effectiveLots) {
      if (lot.stage !== 'shipment') continue
      const key = lot.productId || ''
      map[key] = (map[key] || 0) + lot.rolls
    }
    return map
  }, [effectiveLots, rollsState])

  type TisBalanceRow = {
    key: string
    warehouse: string
    register: string
    productId: string
    productName: string
    internalId: string
    qty: number
    uom: string
  }

  const tisBalanceRows = useMemo(() => {
    const rawDefault = warehousesState[0]?.name || defaultWarehousesSeed[0]?.name || '—'
    const fgDefault =
      warehousesState.find((w) => w.code === 'SKL-GP')?.name || defaultWarehousesSeed[2]?.name || '—'
    type Agg = Omit<TisBalanceRow, 'key'>
    const agg = new Map<string, Agg>()
    function bump(
      warehouse: string,
      productId: string,
      productName: string,
      internalId: string,
      register: string,
      qty: number,
      uom: string,
    ) {
      const bucket = `${warehouse}|${productId}|${register}`
      const prev = agg.get(bucket)
      if (prev) prev.qty += qty
      else agg.set(bucket, { warehouse, register, productId, productName, internalId, qty, uom })
    }
    for (const lot of lotsState) {
      const wh = (lot.warehouseLocation || '').trim() || rawDefault
      const pid = lot.productId || '_'
      const prod = productsState.find((p) => p.id === pid)
      bump(wh, pid, lot.productName || lot.product, prod?.internalId || '—', 'Партии (сырьё / WIP)', lot.rolls, 'рул.')
    }
    for (const roll of rollsState) {
      if (roll.status === 'shipped') continue
      const wh = (roll.warehouseLocation || '').trim() || fgDefault
      const pid = roll.productId || '_'
      const prod = productsState.find((p) => p.id === pid)
      bump(wh, pid, roll.productName, prod?.internalId || '—', 'Готовая продукция (рулоны)', 1, 'рул.')
    }
    for (const output of unpackedOutputs) {
      if (output.status !== 'unpacked') continue
      bump(fgDefault, `UNPK-${output.productName}`, output.productName, '—', 'ГП неупакованная (выработка)', output.qtyRolls, 'рул.')
    }
    for (const [productName, qty] of Object.entries(packagedStock)) {
      bump(fgDefault, `PKG-${productName}`, productName, '—', 'ГП упакованная (рулоны)', qty, 'рул.')
    }
    for (const [item, qty] of Object.entries(consumablesStock)) {
      bump(rawDefault, `CONS-${item}`, item, '—', 'Расходные материалы', qty, 'шт.')
    }
    let rows: TisBalanceRow[] = Array.from(agg.entries()).map(([bucket, r]) => ({
      key: bucket,
      warehouse: r.warehouse,
      register: r.register,
      productId: r.productId,
      productName: r.productName,
      internalId: r.internalId,
      qty: r.qty,
      uom: r.uom,
    }))
    rows.sort((a, b) => a.warehouse.localeCompare(b.warehouse) || a.productName.localeCompare(b.productName))
    if (balancesWarehouseFilter !== '__all__')
      rows = rows.filter((r) => r.warehouse === balancesWarehouseFilter)
    return rows
  }, [lotsState, rollsState, productsState, warehousesState, balancesWarehouseFilter, unpackedOutputs, packagedStock, consumablesStock])

  const filteredDocuments = useMemo(() => {
    return documentsState.filter((d) => {
      if (docStatusFilter !== 'all' && d.status !== docStatusFilter) return false
      if (docCategoryFilter === 'archive') return d.status === 'cancelled' || d.status === 'archived'
      if (docCategoryFilter === 'all') return true
      return (d.journalCategory || '') === docCategoryFilter
    })
  }, [documentsState, docCategoryFilter, docStatusFilter])

  const selectedErpDoc = useMemo(
    () => documentsState.find((d) => d.id === selectedDocId) ?? null,
    [documentsState, selectedDocId],
  )

  async function createOrder() {
    if (!canManageOrders || !newOrder.customer.trim() || !newOrder.productId || newOrder.qty <= 0) return
    const available = Math.max(0, (readyByProduct[newOrder.productId] || 0) - (reservationsByProduct[newOrder.productId] || 0))
    const reserved = Math.min(available, newOrder.qty)
    const product = productsState.find((p) => p.id === newOrder.productId)
    if (!product) return
    await addDoc(collection(db, 'orders'), {
      customer: newOrder.customer,
      status: 'open',
      items: [{ productId: newOrder.productId, productName: product.name, qty: newOrder.qty, reservedQty: reserved }],
      createdAt: serverTimestamp(),
    })
    await logAction('order.create', { customer: newOrder.customer, productId: newOrder.productId, qty: newOrder.qty, reserved })
    setNewOrder({ customer: '', productId: '', qty: 0 })
  }

  async function setOrderStatus(orderId: string, status: SalesOrder['status']) {
    await updateDoc(doc(db, 'orders', orderId), { status, updatedAt: serverTimestamp() })
    await logAction('order.status', { orderId, status })
  }

  async function createRun() {
    if (!canManageRuns) return
    const product = productsState.find((p) => p.id === newRun.productId)
    if (!product || newRun.plannedRolls <= 0) return
    await addDoc(collection(db, 'productionRuns'), {
      productId: product.id,
      productName: product.name,
      recipeCode: newRun.recipeCode,
      line: newRun.line,
      shift: newRun.shift,
      status: 'planned',
      plannedRolls: newRun.plannedRolls,
      createdAt: serverTimestamp(),
    })
    await logAction('run.create', { productId: product.id, recipeCode: newRun.recipeCode, plannedRolls: newRun.plannedRolls })
    setNewRun((s) => ({ ...s, productId: '', plannedRolls: 10 }))
  }

  async function setRunStatus(runId: string, status: ProductionRun['status']) {
    await updateDoc(doc(db, 'productionRuns', runId), { status, updatedAt: serverTimestamp() })
    await logAction('run.status', { runId, status })
  }

  function nextRollCode() {
    const seq = String(rollsState.length + 1).padStart(6, '0')
    return `R-${new Date().getFullYear()}-${seq}`
  }

  async function createRoll() {
    if (!canManageRolls) return
    const run = runsState.find((r) => r.id === newRoll.runId)
    if (!run || newRoll.lengthM <= 0 || newRoll.widthMm <= 0) return
    const rollCode = nextRollCode()
    const wipWh = warehousesState.find((w) => w.code === 'SKL-WIP')?.name || defaultWarehousesSeed[1]?.name || 'Цех / ожидание ОТК'
    await addDoc(collection(db, 'rolls'), {
      rollCode,
      runId: run.id,
      productId: run.productId,
      productName: run.productName,
      lengthM: newRoll.lengthM,
      widthMm: newRoll.widthMm,
      status: 'awaiting_qc',
      warehouseLocation: wipWh,
      createdAt: serverTimestamp(),
    })
    await logAction('roll.create', { runId: run.id, rollCode, lengthM: newRoll.lengthM, widthMm: newRoll.widthMm })
    setNewRoll({ runId: '', lengthM: 50, widthMm: 1000 })
  }

  async function setRollQcStatus(rollId: string, status: ProducedRoll['status']) {
    if (!canManageQc && !canManageRuns) return
    const current = rollsState.find((r) => r.id === rollId)
    const patch: Record<string, unknown> = { status, updatedAt: serverTimestamp() }
    if (status === 'approved' && !current?.warehouseLocation) {
      patch.warehouseLocation =
        warehousesState.find((w) => w.code === 'SKL-GP')?.name ||
        defaultWarehousesSeed[2]?.name ||
        'СКЛ — Готовая продукция'
    }
    await updateDoc(doc(db, 'rolls', rollId), patch)
    await logAction('roll.qc.status', { rollId, status })
  }

  async function addWarehouseCatalog() {
    if (!canManageReceipts || !firebaseUser) return
    const code = newWarehouse.code.trim().toUpperCase()
    const name = newWarehouse.name.trim()
    if (!code || !name) return
    await addDoc(collection(db, 'warehouses'), {
      code,
      name,
      isActive: true,
      sortOrder: (warehousesState.length + 1) * 10,
      createdAt: serverTimestamp(),
    })
    await logAction('warehouse.create', { code, name })
    setNewWarehouse({ code: '', name: '' })
  }

  async function createSupplier() {
    if (!canManageSuppliers || !newSupplier.name.trim()) return
    await addDoc(collection(db, 'suppliers'), {
      name: newSupplier.name.trim(),
      country: newSupplier.country.trim(),
      contact: newSupplier.contact.trim(),
      status: 'active',
      createdAt: serverTimestamp(),
    })
    await logAction('supplier.create', { name: newSupplier.name })
    setNewSupplier({ name: '', country: 'Georgia', contact: '' })
  }

  async function setSupplierStatus(id: string, status: Supplier['status']) {
    if (!canManageSuppliers) return
    await updateDoc(doc(db, 'suppliers', id), { status, updatedAt: serverTimestamp() })
    await logAction('supplier.status', { supplierId: id, status })
  }

  function toggleDocOtgRoll(rollId: string) {
    setNewDocOtg((s) => ({
      ...s,
      selectedRollIds: s.selectedRollIds.includes(rollId)
        ? s.selectedRollIds.filter((id) => id !== rollId)
        : [...s.selectedRollIds, rollId],
    }))
  }

  async function createDraftPnDocument() {
    if (!canWriteDocuments || !firebaseUser || !currentUser) return
    const supplier = suppliersState.find((s) => s.id === newDocPn.supplierId)
    const product = productsState.find((p) => p.id === newDocPn.productId)
    if (!supplier || !product || newDocPn.qtyRolls <= 0) {
      setError('ПН черновик: выберите поставщика, номенклатуру и количество')
      return
    }
    setError('')
    const year = Number(newDocPn.docDate.slice(0, 4)) || new Date().getFullYear()
    await runTransaction(db, async (tx) => {
      const number = await allocateDocumentNumber(tx, db, 'incoming', year)
      const docRef = doc(collection(db, 'documents'))
      tx.set(docRef, {
        kind: 'incoming',
        journalCategory: defaultJournalCategory('incoming'),
        number,
        status: 'draft',
        docDate: newDocPn.docDate,
        warehouse: newDocPn.warehouse.trim() || 'Склад сырья',
        contractorId: supplier.id,
        contractorName: supplier.name,
        basis: 'Ручное оформление приходной',
        lines: [
          {
            productId: product.id,
            productName: product.name,
            qty: newDocPn.qtyRolls,
            uom: 'рул.',
            note: `Метров: ${newDocPn.meters || 0}`,
          },
        ],
        comment: newDocPn.comment.trim(),
        authorUid: firebaseUser.uid,
        authorName: currentUser.name,
        createdAt: serverTimestamp(),
      })
    })
    await logAction('document.create', { kind: 'incoming' })
    setNewDocPn((s) => ({
      ...s,
      supplierId: '',
      productId: '',
      qtyRolls: 0,
      meters: 0,
      comment: '',
    }))
    setActiveDocDialog(null)
  }

  async function createDraftPmDocument() {
    if (!canWriteDocuments || !firebaseUser || !currentUser) return
    const lot = lotsState.find((l) => l.id === newDocPm.lotId)
    if (!lot || !newDocPm.warehouseFrom.trim() || !newDocPm.warehouseTo.trim()) {
      setError('ПМ черновик: партия и склады отправитель/получатель обязательны')
      return
    }
    setError('')
    const year = Number(newDocPm.docDate.slice(0, 4)) || new Date().getFullYear()
    await runTransaction(db, async (tx) => {
      const number = await allocateDocumentNumber(tx, db, 'movement', year)
      const docRef = doc(collection(db, 'documents'))
      tx.set(docRef, {
        kind: 'movement',
        journalCategory: defaultJournalCategory('movement'),
        number,
        status: 'draft',
        docDate: newDocPm.docDate,
        warehouseFrom: newDocPm.warehouseFrom.trim(),
        warehouseTo: newDocPm.warehouseTo.trim(),
        basis: `Партия ${lot.id}`,
        lines: [{ lotId: lot.id, productName: `${lot.product}`, qty: lot.rolls, uom: 'рул.', note: lot.note || '' }],
        comment: newDocPm.comment.trim(),
        authorUid: firebaseUser.uid,
        authorName: currentUser.name,
        createdAt: serverTimestamp(),
      })
    })
    await logAction('document.create', { kind: 'movement' })
    setNewDocPm((s) => ({
      ...s,
      lotId: '',
      comment: '',
    }))
    setActiveDocDialog(null)
  }

  async function createDraftSpDocument() {
    if (!canWriteDocuments || !firebaseUser || !currentUser) return
    const lot = lotsState.find((l) => l.id === newDocSp.lotId)
    const qty = Number(newDocSp.qtyRolls) || 0
    if (!lot || qty <= 0 || qty > (lot.rolls || 0)) {
      setError('СП черновик: выберите партию с остатком и количество рулонов от 1 до остатка партии')
      return
    }
    if (!newDocSp.warehouse.trim()) {
      setError('СП: укажите склад списания')
      return
    }
    setError('')
    const year = Number(newDocSp.docDate.slice(0, 4)) || new Date().getFullYear()
    await runTransaction(db, async (tx) => {
      const number = await allocateDocumentNumber(tx, db, 'writeoff', year)
      const docRef = doc(collection(db, 'documents'))
      tx.set(docRef, {
        kind: 'writeoff',
        journalCategory: defaultJournalCategory('writeoff'),
        number,
        status: 'draft',
        docDate: newDocSp.docDate,
        warehouse: newDocSp.warehouse.trim(),
        basis: `Списание партии ${lot.id}`,
        lines: [
          {
            lotId: lot.id,
            productId: lot.productId,
            productName: lot.productName || lot.product,
            qty,
            uom: 'рул.',
            note: newDocSp.reason.trim() || undefined,
          },
        ],
        comment: newDocSp.reason.trim(),
        authorUid: firebaseUser.uid,
        authorName: currentUser.name,
        createdAt: serverTimestamp(),
      })
    })
    await logAction('document.create', { kind: 'writeoff' })
    setNewDocSp((s) => ({
      ...s,
      lotId: '',
      qtyRolls: 0,
      reason: '',
    }))
    setActiveDocDialog(null)
  }

  async function createDraftZkDocument() {
    if (!canWriteDocuments || !firebaseUser || !currentUser) return
    const product = productsState.find((p) => p.id === newDocZk.productId)
    if (!newDocZk.customer.trim() || !product || newDocZk.qty <= 0) {
      setError('ЗК черновик: клиент, продукт и количество')
      return
    }
    setError('')
    const year = Number(newDocZk.docDate.slice(0, 4)) || new Date().getFullYear()
    await runTransaction(db, async (tx) => {
      const number = await allocateDocumentNumber(tx, db, 'customer_order', year)
      const docRef = doc(collection(db, 'documents'))
      tx.set(docRef, {
        kind: 'customer_order',
        journalCategory: defaultJournalCategory('customer_order'),
        number,
        status: 'draft',
        docDate: newDocZk.docDate,
        contractorName: newDocZk.customer.trim(),
        lines: [{ productId: product.id, productName: product.name, qty: newDocZk.qty, uom: 'рул.' }],
        comment: newDocZk.comment.trim(),
        authorUid: firebaseUser.uid,
        authorName: currentUser.name,
        createdAt: serverTimestamp(),
      })
    })
    await logAction('document.create', { kind: 'customer_order' })
    setNewDocZk((s) => ({ ...s, customer: '', productId: '', qty: 0, comment: '' }))
    setActiveDocDialog(null)
  }

  async function createDraftOtgDocument() {
    if (!canWriteDocuments || !firebaseUser || !currentUser) return
    if (!newDocOtg.customer.trim() || !newDocOtg.selectedRollIds.length) {
      setError('ОТГ черновик: клиент и хотя бы один рулон (только со статусом approved)')
      return
    }
    setError('')
    const rolls = rollsState.filter((r) => r.id && newDocOtg.selectedRollIds.includes(r.id))
    if (!rolls.length || rolls.some((r) => r.status !== 'approved')) {
      setError('ОТГ: доступны только рулоны в статусе approved')
      return
    }
    const year = Number(newDocOtg.docDate.slice(0, 4)) || new Date().getFullYear()
    await runTransaction(db, async (tx) => {
      const number = await allocateDocumentNumber(tx, db, 'shipment_out', year)
      const docRef = doc(collection(db, 'documents'))
      tx.set(docRef, {
        kind: 'shipment_out',
        journalCategory: defaultJournalCategory('shipment_out'),
        number,
        status: 'draft',
        docDate: newDocOtg.docDate,
        contractorName: newDocOtg.customer.trim(),
        warehouse: defaultWarehousesSeed[2]?.name || 'СКЛ — Готовая продукция',
        shipmentRollIds: rolls.map((r) => r.id as string),
        lines: rolls.map((r) => ({
          productId: r.productId,
          productName: r.productName,
          qty: 1,
          uom: 'рул.',
          note: r.rollCode,
        })),
        comment: newDocOtg.comment.trim(),
        authorUid: firebaseUser.uid,
        authorName: currentUser.name,
        createdAt: serverTimestamp(),
      })
    })
    await logAction('document.create', { kind: 'shipment_out' })
    setNewDocOtg({ customer: '', selectedRollIds: [], docDate: new Date().toISOString().slice(0, 10), comment: '' })
    setActiveDocDialog(null)
  }

  async function cancelErpDocument(documentId: string) {
    if (!canWriteDocuments) return
    const d = documentsState.find((x) => x.id === documentId)
    if (!d || d.status !== 'draft') return
    await updateDoc(doc(db, 'documents', documentId), { status: 'cancelled', updatedAt: serverTimestamp() })
    await logAction('document.cancel', { documentId, number: d.number })
  }

  async function postErpDocument(documentId: string) {
    if (!canWriteDocuments || !firebaseUser || !currentUser) return
    setError('')
    const outerReservations: Record<string, number> = {}
    for (const order of ordersState) {
      if (order.status !== 'open') continue
      for (const line of order.items) {
        outerReservations[line.productId] = (outerReservations[line.productId] || 0) + line.reservedQty
      }
    }
    const outerReady: Record<string, number> = {}
    if (rollsState.length) {
      for (const roll of rollsState) {
        if (roll.status !== 'approved' && roll.status !== 'reserved_for_shipment') continue
        const key = roll.productId || ''
        outerReady[key] = (outerReady[key] || 0) + 1
      }
    } else {
      for (const lot of lotsState.length ? lotsState : lots) {
        if (lot.stage !== 'shipment') continue
        const key = lot.productId || ''
        outerReady[key] = (outerReady[key] || 0) + lot.rolls
      }
    }

    try {
      await runTransaction(db, async (tx) => {
        const dRef = doc(db, 'documents', documentId)
        const snap = await tx.get(dRef)
        if (!snap.exists()) throw new Error('doc_missing')
        const d = snap.data() as ErpDocumentBase
        if (d.status !== 'draft') throw new Error('not_draft')

        if (d.kind === 'incoming') {
          const lotIds: string[] = []
          const receiptIds: string[] = []
          const wh = (d.warehouse || '').trim() || defaultWarehousesSeed[0]?.name || 'СКЛ — Сырьё и материалы'
          for (const line of d.lines) {
            const receiptRef = doc(collection(db, 'receipts'))
            const lotRef = doc(collection(db, 'lots'))
            tx.set(receiptRef, {
              supplierId: d.contractorId || '',
              supplierName: d.contractorName || '',
              productId: line.productId || '',
              productName: line.productName,
              qtyRolls: line.qty,
              note: `${d.comment || ''} (${d.number})`.trim(),
              sourceDocumentId: documentId,
              createdAt: serverTimestamp(),
            })
            receiptIds.push(receiptRef.id)
            tx.set(lotRef, {
              supplier: d.contractorName || '',
              material: 'Сырьё',
              productId: line.productId || '',
              product: line.productName,
              productName: line.productName,
              widthMm: 1000,
              gsm: 0,
              rolls: line.qty,
              meters: 0,
              stage: 'raw',
              warehouseLocation: wh,
              note: `ПН ${d.number}. ${line.note || ''}`,
              createdAt: serverTimestamp(),
              createdBy: firebaseUser.uid,
            })
            lotIds.push(lotRef.id)
            ledgerEntry(tx, db, {
              docId: documentId,
              docNumber: d.number,
              docKind: 'incoming',
              movementType: 'purchase_in',
              warehouse: wh,
              productId: line.productId || '',
              productName: line.productName,
              qtyDelta: line.qty,
              uom: line.uom,
              nomenclatureKind: 'raw_lot',
              comment: line.note || '',
            })
          }
          tx.update(dRef, {
            status: 'posted',
            postedAt: serverTimestamp(),
            postedByUid: currentUser.uid,
            postedByName: currentUser.name,
            linkedLotIds: lotIds,
            linkedReceiptIds: receiptIds,
          })
          return
        }

        if (d.kind === 'movement') {
          const dest = (d.warehouseTo || '').trim()
          if (!dest) throw new Error('no_warehouse_to')
          for (const line of d.lines) {
            if (!line.lotId) throw new Error('no_lot_line')
            const lotRef = doc(db, 'lots', line.lotId)
            const ls = await tx.get(lotRef)
            if (!ls.exists()) throw new Error('lot_missing')
            const ld = ls.data() as Lot
            const qtyMv = ld.rolls
            const fromWh =
              ((d.warehouseFrom || '').trim() || ld.warehouseLocation || defaultWarehousesSeed[0]?.name || '').trim() ||
              'СКЛ'
            ledgerEntry(tx, db, {
              docId: documentId,
              docNumber: d.number,
              docKind: 'movement',
              movementType: 'transfer_out',
              warehouse: fromWh,
              productId: ld.productId || '',
              productName: ld.productName || ld.product,
              qtyDelta: -qtyMv,
              uom: 'рул.',
              nomenclatureKind: 'raw_lot',
              comment: `На ${dest}`,
            })
            ledgerEntry(tx, db, {
              docId: documentId,
              docNumber: d.number,
              docKind: 'movement',
              movementType: 'transfer_in',
              warehouse: dest,
              productId: ld.productId || '',
              productName: ld.productName || ld.product,
              qtyDelta: qtyMv,
              uom: 'рул.',
              nomenclatureKind: 'raw_lot',
              comment: `С ${fromWh}`,
            })
            tx.update(lotRef, { warehouseLocation: dest, updatedAt: serverTimestamp() })
          }
          tx.update(dRef, {
            status: 'posted',
            postedAt: serverTimestamp(),
            postedByUid: currentUser.uid,
            postedByName: currentUser.name,
          })
          return
        }

        if (d.kind === 'writeoff') {
          const docWh = (d.warehouse || '').trim() || defaultWarehousesSeed[0]?.name || 'СКЛ'
          const linkedLotIds: string[] = []
          for (const line of d.lines) {
            if (!line.lotId || !line.qty || line.qty <= 0) throw new Error('sp_invalid_line')
            const lotRef = doc(db, 'lots', line.lotId)
            const ls = await tx.get(lotRef)
            if (!ls.exists()) throw new Error('lot_missing')
            const ld = ls.data() as Lot
            const currentRolls = Number(ld.rolls) || 0
            if (line.qty > currentRolls) throw new Error('sp_over_qty')
            const lotWh = (ld.warehouseLocation || '').trim() || docWh
            if (lotWh !== docWh) throw new Error('sp_warehouse_mismatch')
            const newRolls = currentRolls - line.qty
            ledgerEntry(tx, db, {
              docId: documentId,
              docNumber: d.number,
              docKind: 'writeoff',
              movementType: 'writeoff',
              warehouse: lotWh,
              productId: ld.productId || '',
              productName: ld.productName || ld.product,
              qtyDelta: -line.qty,
              uom: line.uom || 'рул.',
              nomenclatureKind: 'raw_lot',
              comment: (line.note || d.comment || '').trim() || 'Списание ТМЦ',
            })
            tx.update(lotRef, { rolls: newRolls, updatedAt: serverTimestamp() })
            linkedLotIds.push(line.lotId)
          }
          tx.update(dRef, {
            status: 'posted',
            postedAt: serverTimestamp(),
            postedByUid: currentUser.uid,
            postedByName: currentUser.name,
            linkedLotIds,
          })
          return
        }

        if (d.kind === 'customer_order') {
          const item = d.lines[0]
          if (!item?.productId) throw new Error('no_product')
          const available = Math.max(0, (outerReady[item.productId] || 0) - (outerReservations[item.productId] || 0))
          const reserved = Math.min(available, item.qty)
          const orderRef = doc(collection(db, 'orders'))
          tx.set(orderRef, {
            customer: d.contractorName || '',
            status: 'open',
            items: [
              {
                productId: item.productId,
                productName: item.productName,
                qty: item.qty,
                reservedQty: reserved,
              },
            ],
            sourceDocumentId: documentId,
            createdAt: serverTimestamp(),
          })
          tx.update(dRef, {
            status: 'posted',
            postedAt: serverTimestamp(),
            postedByUid: currentUser.uid,
            postedByName: currentUser.name,
            linkedOrderId: orderRef.id,
          })
          return
        }

        if (d.kind === 'shipment_out') {
          const rollIds = d.shipmentRollIds || []
          if (!rollIds.length || !(d.contractorName || '').trim()) throw new Error('otg_invalid')
          const rollsSnapshot: ProducedRoll[] = []
          const rollCodes: string[] = []
          for (const id of rollIds) {
            const rRef = doc(db, 'rolls', id)
            const rs = await tx.get(rRef)
            if (!rs.exists()) throw new Error('roll_missing')
            const pdata = rs.data() as ProducedRoll
            if (pdata.status !== 'approved') throw new Error('roll_not_available')
            rollsSnapshot.push(pdata)
            rollCodes.push(pdata.rollCode)
          }
          const palletCode = `PAL-${new Date().getFullYear()}-${String(shipmentsState.length + 1).padStart(5, '0')}`
          const shipmentRef = doc(collection(db, 'shipments'))
          tx.set(shipmentRef, {
            customer: (d.contractorName || '').trim(),
            palletCode,
            rollIds,
            rollCodes,
            status: 'planned',
            sourceDocumentId: documentId,
            createdAt: serverTimestamp(),
          })
          for (const id of rollIds) {
            const rRef = doc(db, 'rolls', id)
            tx.update(rRef, { status: 'reserved_for_shipment', updatedAt: serverTimestamp() })
          }
          for (const pdata of rollsSnapshot) {
            const fgWh =
              pdata.warehouseLocation?.trim() ||
              warehousesState.find((w) => w.code === 'SKL-GP')?.name ||
              defaultWarehousesSeed[2]?.name ||
              'СКЛ — Готовая продукция'
            ledgerEntry(tx, db, {
              docId: shipmentRef.id,
              docNumber: `${d.number} / ${palletCode}`,
              docKind: 'shipment_out',
              movementType: 'shipment_out',
              warehouse: fgWh,
              productId: pdata.productId || '',
              productName: pdata.productName,
              qtyDelta: -1,
              uom: 'рул.',
              nomenclatureKind: 'finished_roll',
              comment: `Отгрузка ${(d.contractorName || '').trim()}`,
            })
          }
          tx.update(dRef, {
            status: 'posted',
            postedAt: serverTimestamp(),
            postedByUid: currentUser.uid,
            postedByName: currentUser.name,
            linkedShipmentId: shipmentRef.id,
          })
          return
        }

        throw new Error('unknown_kind')
      })
      await logAction('document.post', { documentId })
    } catch (e) {
      const code = e instanceof Error ? e.message : ''
      const hint =
        code === 'sp_over_qty'
          ? 'СП: нельзя списать больше остатка партии.'
          : code === 'sp_warehouse_mismatch'
            ? 'СП: склад документа должен совпадать со складом учёта партии.'
            : code === 'sp_invalid_line'
              ? 'СП: проверьте строки (партия и количество).'
              : 'Проверьте статусы рулонов, остатки партий и заполнение полей.'
      await updateDoc(doc(db, 'documents', documentId), {
        postingError: hint,
        updatedAt: serverTimestamp(),
      }).catch(() => {})
      setError(`Не удалось провести документ. ${hint}`)
    }
  }

  function buildPrintableDocument(d: ErpDocumentBase) {
    const lines = d.lines.map((l, i) => `${i + 1}. ${l.productName} — ${l.qty} ${l.uom}${l.note ? ` (${l.note})` : ''}`).join('\n')
    return `
${docKindRu(d.kind)} ${d.number}
Дата: ${d.docDate}
Статус: ${statusRu(d.status)}
Склады: ${d.warehouseFrom || '—'} → ${d.warehouseTo || d.warehouse || '—'}
Контрагент: ${d.contractorName || '—'}
Автор: ${d.authorName}
Основание: ${d.basis || '—'}
Строки:
${lines}
Связи: паллета ${d.linkedShipmentId || '—'}, заказ ${d.linkedOrderId || '—'}, партии ${(d.linkedLotIds || []).join(', ') || '—'}
`
  }

  async function createReceipt() {
    if (!canManageReceipts || !firebaseUser || !currentUser) return
    const supplier = suppliersState.find((s) => s.id === newReceipt.supplierId)
    const product = productsState.find((p) => p.id === newReceipt.productId)
    if (!supplier || !product || newReceipt.qtyRolls <= 0) return
    setError('')
    const year = new Date().getFullYear()
    try {
      const whReceiving = defaultWarehousesSeed[0]?.name ?? 'СКЛ — Сырьё и материалы'
      await runTransaction(db, async (tx) => {
        const number = await allocateDocumentNumber(tx, db, 'incoming', year)
        const erpDocRef = doc(collection(db, 'documents'))
        const receiptRef = doc(collection(db, 'receipts'))
        const lotRef = doc(collection(db, 'lots'))
        tx.set(receiptRef, {
          supplierId: supplier.id,
          supplierName: supplier.name,
          productId: product.id,
          productName: product.name,
          qtyRolls: newReceipt.qtyRolls,
          note: newReceipt.note.trim(),
          sourceDocumentNumber: number,
          createdAt: serverTimestamp(),
        })
        tx.set(lotRef, {
          supplier: supplier.name,
          material: 'Сырье',
          productId: product.id,
          product: product.name,
          productName: product.name,
          widthMm: 1000,
          gsm: 0,
          rolls: newReceipt.qtyRolls,
          meters: 0,
          stage: 'raw',
          warehouseLocation: whReceiving,
          note: `${newReceipt.note.trim() || 'Поступление'} | ${number}`,
          createdAt: serverTimestamp(),
          createdBy: firebaseUser.uid,
        })
        ledgerEntry(tx, db, {
          docId: erpDocRef.id,
          docNumber: number,
          docKind: 'incoming',
          movementType: 'purchase_in',
          warehouse: whReceiving,
          productId: product.id || '',
          productName: product.name,
          qtyDelta: newReceipt.qtyRolls,
          uom: 'рул.',
          nomenclatureKind: 'raw_lot',
          comment: 'Быстрое поступление',
        })
        tx.set(erpDocRef, {
          kind: 'incoming',
          journalCategory: defaultJournalCategory('incoming'),
          number,
          status: 'posted',
          docDate: new Date().toISOString().slice(0, 10),
          warehouse: whReceiving,
          contractorId: supplier.id,
          contractorName: supplier.name,
          basis: 'Поступление (форма быстрой приёмки)',
          lines: [{ productId: product.id, productName: product.name, qty: newReceipt.qtyRolls, uom: 'рул.' }],
          comment: newReceipt.note.trim(),
          authorUid: firebaseUser.uid,
          authorName: currentUser.name,
          postedByUid: firebaseUser.uid,
          postedByName: currentUser.name,
          linkedLotIds: [lotRef.id],
          linkedReceiptIds: [receiptRef.id],
          createdAt: serverTimestamp(),
          postedAt: serverTimestamp(),
        })
      })
      await logAction('receipt.create', { supplierId: supplier.id, productId: product.id, qtyRolls: newReceipt.qtyRolls })
      setNewReceipt({ supplierId: '', productId: '', qtyRolls: 0, note: '' })
    } catch {
      setError('Ошибка при проведении приходной')
    }
  }

  function toggleRollForShipment(rollId: string) {
    setNewShipment((s) => ({
      ...s,
      selectedRollIds: s.selectedRollIds.includes(rollId)
        ? s.selectedRollIds.filter((id) => id !== rollId)
        : [...s.selectedRollIds, rollId],
    }))
  }

  function nextPalletCode() {
    return `PAL-${new Date().getFullYear()}-${String(shipmentsState.length + 1).padStart(5, '0')}`
  }

  async function createShipment() {
    if (!canManageShipping || !newShipment.customer.trim() || !newShipment.selectedRollIds.length) return
    const selectedRolls = rollsState.filter((r) => r.id && newShipment.selectedRollIds.includes(r.id))
    const palletCode = nextPalletCode()
    const shipmentRef = doc(collection(db, 'shipments'))
    const customerName = newShipment.customer.trim()
    await runTransaction(db, async (tx) => {
      const pdataArr: ProducedRoll[] = []
      for (const roll of selectedRolls) {
        const rollRef = doc(db, 'rolls', roll.id || '')
        const rollSnap = await tx.get(rollRef)
        if (!rollSnap.exists()) throw new Error('roll_missing')
        const data = rollSnap.data() as ProducedRoll
        if (data.status !== 'approved') throw new Error('roll_not_available')
        pdataArr.push(data)
      }
      tx.set(shipmentRef, {
        customer: customerName,
        palletCode,
        rollIds: selectedRolls.map((r) => r.id),
        rollCodes: selectedRolls.map((r) => r.rollCode),
        status: 'planned',
        createdAt: serverTimestamp(),
      })
      for (const roll of selectedRolls) {
        const rollRef = doc(db, 'rolls', roll.id || '')
        tx.update(rollRef, { status: 'reserved_for_shipment', updatedAt: serverTimestamp() })
      }
      for (const pdata of pdataArr) {
        const fgWh =
          pdata.warehouseLocation?.trim() ||
          warehousesState.find((w) => w.code === 'SKL-GP')?.name ||
          defaultWarehousesSeed[2]?.name ||
          'СКЛ — Готовая продукция'
        ledgerEntry(tx, db, {
          docId: shipmentRef.id,
          docNumber: palletCode,
          docKind: 'shipment_quick',
          movementType: 'shipment_out',
          warehouse: fgWh,
          productId: pdata.productId || '',
          productName: pdata.productName,
          qtyDelta: -1,
          uom: 'рул.',
          nomenclatureKind: 'finished_roll',
          comment: `Отгрузка (${customerName})`,
        })
      }
    })
    await logAction('shipment.create', { customer: newShipment.customer, palletCode, rolls: selectedRolls.length })
    setNewShipment({ customer: '', selectedRollIds: [] })
  }

  async function setShipmentStatus(shipmentId: string, status: Shipment['status']) {
    const shipment = shipmentsState.find((s) => s.id === shipmentId)
    await runTransaction(db, async (tx) => {
      const shipRef = doc(db, 'shipments', shipmentId)
      tx.update(shipRef, { status, updatedAt: serverTimestamp() })
      if (shipment) {
        for (const rollId of shipment.rollIds) {
          if (!rollId) continue
          const rollRef = doc(db, 'rolls', rollId)
          tx.update(rollRef, {
            status: status === 'shipped' ? 'shipped' : 'approved',
            updatedAt: serverTimestamp(),
          })
        }
      }
    })
    await logAction('shipment.status', { shipmentId, status })
  }

  function buildShipmentDoc(shipment: Shipment) {
    return `Packing List / CoA (draft)
Shipment: ${shipment.id}
Customer: ${shipment.customer}
Pallet: ${shipment.palletCode}
Status: ${shipment.status}
Rolls:
${shipment.rollCodes.map((code, idx) => `${idx + 1}. ${code}`).join('\n')}
`
  }

  function copyText(text: string) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text)
  }

  const traceRoll = rollsState.find((r) => r.rollCode.toLowerCase() === traceRollCode.trim().toLowerCase())
  const traceRun = traceRoll ? runsState.find((run) => run.id === traceRoll.runId) : null
  const traceShipment = traceRoll
    ? [...shipmentsState]
        .filter((s) => s.rollIds.includes(traceRoll.id || ''))
        .sort((a, b) => {
          if (a.status === b.status) return 0
          if (a.status === 'shipped') return -1
          if (b.status === 'shipped') return 1
          return 0
        })[0] || null
    : null

  async function compressImage(file: File): Promise<string> {
    const imageBitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1200 / imageBitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(imageBitmap.width * scale)
    canvas.height = Math.round(imageBitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.75)
  }

  async function updateProductImage(productId: string, file?: File | null) {
    if (!file) return
    const imageBase64 = await compressImage(file)
    await updateDoc(doc(db, 'products', productId), { imageBase64, updatedAt: serverTimestamp() })
    await logAction('product.image.update', { productId, fileName: file.name, size: file.size })
  }

  async function addProduct() {
    if (!canManageProducts) return
    const internalId = newProduct.internalId.trim().toUpperCase()
    const name = newProduct.name.trim()
    const category = newProduct.category.trim() || 'Custom'
    if (!internalId || !name) {
      setError('Для товара заполните код и название')
      return
    }
    if (productsState.some((p) => p.internalId.toUpperCase() === internalId)) {
      setError('Товар с таким внутренним кодом уже существует')
      return
    }
    setError('')
    await addDoc(collection(db, 'products'), {
      internalId,
      name,
      category,
      uom: 'roll',
      isActive: true,
      createdAt: serverTimestamp(),
    })
    await logAction('product.create', { internalId, name })
    setNewProduct({ internalId: '', name: '', category: 'Custom' })
  }

  async function createSystemUser() {
    if (!canManageUsers) return
    const email = newUser.email.trim()
    if (!email || !newUser.password || !newUser.name.trim()) return
    const { uid } = await createAuthUserByAdmin(email, newUser.password)
    await setDoc(doc(db, 'users', uid), {
      email,
      name: newUser.name.trim(),
      role: newUser.role,
      permissions: defaultPermissionsByRole[newUser.role],
      active: true,
      createdAt: serverTimestamp(),
    })
    await logAction('user.create', { email, role: newUser.role })
    setNewUser({ email: '', password: '', name: '', role: 'line' })
  }

  async function togglePermission(userId: string, key: keyof PermissionSet, current: boolean) {
    if (!canManageUsers) return
    await updateDoc(doc(db, 'users', userId), { [`permissions.${key}`]: !current, updatedAt: serverTimestamp() })
    await logAction('user.permission.toggle', { userId, permission: key, value: !current })
  }

  if (authLoading) {
    return (
      <main className="page auth-page">
        <section className="auth-card">
          <h1>Загрузка...</h1>
        </section>
      </main>
    )
  }

  if (!currentUser) {
    return (
      <main className="page auth-page">
        <section className="auth-card">
          <p className="eyebrow">Fibercell Manufacturing OS</p>
          <h1>Вход в систему</h1>
          <p className="subtitle dark">Роль определяет интерфейс: каждый видит только свой участок работы.</p>
          <label className="field-label">Пользователь</label>
          <select
            className="field-input"
            value={selectedLogin}
            onChange={(e) => setSelectedLogin(e.target.value)}
          >
            {loginOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <label className="field-label">Пароль</label>
          <input
            className="field-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="action-btn" onClick={handleLogin} type="button">
            Войти
          </button>
          {error ? <div className="error">{error}</div> : null}
        </section>
      </main>
    )
  }

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Fibercell Manufacturing OS / MVP</p>
          <h1>Отгрузка товара и пропиточная линия</h1>
          <p className="subtitle">
            Цепочка производства: прием сырья (SIMO и другие поставщики), пропитка, контроль качества,
            склад и отгрузка. Основа для будущих модулей складского учета и бухгалтерии.
          </p>
          <div className="user-row">
            <span className="role-pill">
              <ShieldCheck size={14} />
              {currentUser.name} • {roleLabels[currentUser.role]} {firebaseUser?.email ? `(${firebaseUser.email})` : ''}
            </span>
            <button className="logout-btn" onClick={logout} type="button">
              Выйти
            </button>
          </div>
        </div>
      </header>

      {error ? <section className="board error-banner">{error}</section> : null}

      <section className="stats">
        <article className="card">
          <div className="card-title">Всего рулонов в работе</div>
          <div className="card-value">{totals.rolls.toLocaleString('ru-RU')}</div>
        </article>
        <article className="card">
          <div className="card-title">Всего метров</div>
          <div className="card-value">{totals.meters.toLocaleString('ru-RU')} м</div>
        </article>
        <article className="card">
          <div className="card-title">На контроле качества</div>
          <div className="card-value warn">{totals.qc.toLocaleString('ru-RU')} рул.</div>
        </article>
        <article className="card">
          <div className="card-title">Готово к отгрузке</div>
          <div className="card-value good">{totals.shipment.toLocaleString('ru-RU')} рул.</div>
        </article>
      </section>

      <section className="board nav-board">
        <div className="actions workspace-mode-tabs">
          <button
            type="button"
            className={`action-btn slim ghost ${navMode === 'workspace' ? 'active' : ''}`}
            onClick={() => setNavMode('workspace')}
          >
            Рабочее место роли
          </button>
          <button
            type="button"
            className={`action-btn slim ghost ${navMode === 'sections' ? 'active' : ''}`}
            onClick={() => setNavMode('sections')}
          >
            Все разделы
          </button>
        </div>
        {navMode === 'sections' ? (
          <div className="actions view-tabs">
            {navItems.map(([key, label, Icon]) => {
              if (!canAccessSection(key)) return null
              return (
                <button
                  key={key}
                  className={`action-btn slim ghost ${view === key ? 'active' : ''}`}
                  type="button"
                  onClick={() => setView(key)}
                >
                  <Icon size={15} /> {label}
                </button>
              )
            })}
          </div>
        ) : null}
      </section>

      {navMode === 'workspace' ? (
        <section className="board workspace-board">
          <h2>Рабочее место: {roleLabels[currentUser.role]}</h2>
          <p className="lot-line workspace-subtitle">Короткий путь к ежедневным операциям вашей роли.</p>
          <div className="workspace-actions">
            {canWriteDocuments ? (
              <>
                <button type="button" className="action-btn slim" onClick={() => openSection('documents')}>
                  Создать/провести документ
                </button>
                <button
                  type="button"
                  className="action-btn slim ghost"
                  onClick={() => {
                    setDocStatusFilter('draft')
                    openSection('documents')
                  }}
                >
                  Черновики документов
                </button>
              </>
            ) : null}
            {currentUser.permissions.inventory ? (
              <button
                type="button"
                className="action-btn slim ghost"
                onClick={() => {
                  setInventorySubView('balances')
                  openSection('inventory')
                }}
              >
                Остатки ТМЦ
              </button>
            ) : null}
            {canManageShipping ? (
              <button type="button" className="action-btn slim ghost" onClick={() => openSection('shipping')}>
                Отгрузка и паллеты
              </button>
            ) : null}
            {canManageQc ? (
              <button type="button" className="action-btn slim ghost" onClick={() => openSection('qc')}>
                Очередь QC
              </button>
            ) : null}
            {canManageProductionRequest ? (
              <button type="button" className="action-btn slim ghost" onClick={() => openSection('production_request')}>
                Заявка по линии
              </button>
            ) : null}
          </div>
          <div className="workspace-grid">
            {workspaceCardsByRole[currentUser.role]
              .filter((card) => canAccessSection(card.view))
              .map((card) => (
                <article key={`${currentUser.role}-${card.view}`} className="workspace-card">
                  <div className="workspace-card-top">
                    <strong>{card.title}</strong>
                    <span>{workspaceMetricByView[card.view] || 'Открыть рабочий блок'}</span>
                  </div>
                  <div className="lot-line">{card.description}</div>
                  <button type="button" className="action-btn slim ghost" onClick={() => openSection(card.view)}>
                    Открыть раздел
                  </button>
                </article>
              ))}
          </div>
        </section>
      ) : null}

      {navMode === 'sections' && view === 'documents' && canSeeDocuments ? (
        <section className="board documents-board">
          <h2>
            <FolderOpen size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            Журнал документов
          </h2>
          <p className="lot-line" style={{ marginBottom: 12 }}>
            Черновики не меняют учёт. Проведение создаёт движения (партии, заказы, отгрузки). Номер присваивается при создании черновика.
          </p>
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            {(
              [
                ['all', 'Все'],
                ['purchasing', 'Закупки'],
                ['warehouse', 'Склад'],
                ['sales', 'Продажи / отгрузки'],
                ['production', 'Производство'],
                ['finance', 'Финансы'],
                ['maintenance', 'Ремонты'],
                ['archive', 'Архив / отменённые'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`action-btn slim ghost ${docCategoryFilter === k ? 'active' : ''}`}
                onClick={() => setDocCategoryFilter(k)}
              >
                {label}
              </button>
            ))}
            <select
              className="field-input"
              style={{ maxWidth: 200, marginLeft: 'auto' }}
              value={docStatusFilter}
              onChange={(e) => setDocStatusFilter(e.target.value as 'all' | DocStatus)}
            >
              <option value="all">Все статусы</option>
              <option value="draft">Черновик</option>
              <option value="posted">Проведен</option>
              <option value="cancelled">Отменен</option>
              <option value="on_review">На проверке</option>
              <option value="awaiting_approval">На согласовании</option>
              <option value="archived">Архив</option>
            </select>
          </div>

          <div className="doc-split">
            <div className="doc-journal">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Номер</th>
                    <th>Тип</th>
                    <th>Статус</th>
                    <th>Раздел</th>
                    <th>Контрагент / склады</th>
                    <th/>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocuments.map((d) => (
                    <tr key={d.id || d.number}>
                      <td>{d.docDate}</td>
                      <td>{d.number}</td>
                      <td>{docKindRu(d.kind)}</td>
                      <td>{statusRu(d.status)}</td>
                      <td>{categoryRu((d.journalCategory || 'warehouse') as DocJournalCategory)}</td>
                      <td>
                        {d.kind === 'writeoff'
                          ? `Склад: ${d.warehouse || '—'}`
                          : `${d.contractorName || '—'} ${d.kind === 'movement' ? `(${d.warehouseFrom || '?'}→${d.warehouseTo || '?'})` : ''}`}
                      </td>
                      <td>
                        <button type="button" className="action-btn slim ghost" onClick={() => setSelectedDocId(d.id || null)}>
                          Открыть
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredDocuments.length ? <div className="lot-line">Нет документов по фильтру</div> : null}
            </div>

            <div className="doc-detail">
              {selectedErpDoc ? (
                <>
                  <h3>
                    {selectedErpDoc.number} — {docKindRu(selectedErpDoc.kind)}
                  </h3>
                  <div className="lot-line">Статус: {statusRu(selectedErpDoc.status)}</div>
                  <div className="lot-line">
                    Связь: склад/поставка {selectedErpDoc.linkedShipmentId || '—'}, заказ {selectedErpDoc.linkedOrderId || '—'}
                    {selectedErpDoc.kind === 'writeoff' ? `, склад списания ${selectedErpDoc.warehouse || '—'}` : ''}
                  </div>
                  {selectedErpDoc.lines.map((ln, idx) => (
                    <div key={`${selectedErpDoc.id}-ln-${idx}`} className="lot-line">
                      {idx + 1}. {ln.productName} × {ln.qty} {ln.uom}
                      {ln.note ? ` (${ln.note})` : ''}
                    </div>
                  ))}
                  <div className="actions lot-actions">
                    {canWriteDocuments && selectedErpDoc.status === 'draft' ? (
                      <>
                        <button type="button" className="action-btn slim" onClick={() => postErpDocument(selectedErpDoc.id || '')}>
                          Провести
                        </button>
                        <button type="button" className="action-btn slim ghost" onClick={() => cancelErpDocument(selectedErpDoc.id || '')}>
                          Отменить черновик
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="action-btn slim ghost"
                      onClick={() => copyText(buildPrintableDocument(selectedErpDoc))}
                    >
                      Копировать печатную форму
                    </button>
                  </div>
                </>
              ) : (
                <div className="lot-line">Выберите документ строкой «Открыть»</div>
              )}
            </div>
          </div>

          {canWriteDocuments ? (
            <>
              <h3 style={{ marginTop: 22 }}>Создание документов</h3>
              <div className="actions doc-create-actions">
                <button type="button" className="action-btn slim add-btn" onClick={() => setActiveDocDialog('pn')}>+ Поступление (ПН)</button>
                <button type="button" className="action-btn slim add-btn" onClick={() => setActiveDocDialog('pm')}>+ Перемещение (ПМ)</button>
                <button type="button" className="action-btn slim add-btn" onClick={() => setActiveDocDialog('sp')}>+ Списание ТМЦ (СП)</button>
                <button type="button" className="action-btn slim add-btn" onClick={() => setActiveDocDialog('zk')}>+ Заказ клиента (ЗК)</button>
                <button type="button" className="action-btn slim add-btn" onClick={() => setActiveDocDialog('otg')}>+ Отгрузка (ОТГ)</button>
              </div>
              {activeDocDialog ? (
                <div className="modal-backdrop" onClick={() => setActiveDocDialog(null)}>
                  <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="stage-head">
                      <strong>{docDialogTitle[activeDocDialog]}</strong>
                      <button type="button" className="action-btn slim ghost" onClick={() => setActiveDocDialog(null)}>Закрыть</button>
                    </div>

                    {activeDocDialog === 'pn' ? (
                      <div className="doc-modal-grid">
                        <select className="field-input" value={newDocPn.supplierId} onChange={(e) => setNewDocPn((s) => ({ ...s, supplierId: e.target.value }))}>
                          <option value="">Поставщик</option>
                          {suppliersState.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                        <select className="field-input" value={newDocPn.productId} onChange={(e) => setNewDocPn((s) => ({ ...s, productId: e.target.value }))}>
                          <option value="">Номенклатура</option>
                          {productsState.map((p) => <option key={p.id} value={p.id}>{p.internalId} — {p.name}</option>)}
                        </select>
                        <input type="number" className="field-input" placeholder="Рулоны" value={newDocPn.qtyRolls || ''} onChange={(e) => setNewDocPn((s) => ({ ...s, qtyRolls: Number(e.target.value) }))} />
                        <input type="number" className="field-input" placeholder="Метры (учётный коммент.)" value={newDocPn.meters || ''} onChange={(e) => setNewDocPn((s) => ({ ...s, meters: Number(e.target.value) }))} />
                        <select className="field-input" value={newDocPn.warehouse} onChange={(e) => setNewDocPn((s) => ({ ...s, warehouse: e.target.value }))}>
                          {(warehousesState.some((w) => w.isActive) ? warehousesState.filter((w) => w.isActive) : defaultWarehousesSeed.map((w, idx) => ({ ...w, id: `seed-${idx}` }))).map((w) => (
                            <option key={w.id} value={w.name}>{w.code} — {w.name}</option>
                          ))}
                        </select>
                        <input type="date" className="field-input" value={newDocPn.docDate} onChange={(e) => setNewDocPn((s) => ({ ...s, docDate: e.target.value }))} />
                        <input className="field-input" placeholder="Комментарий" value={newDocPn.comment} onChange={(e) => setNewDocPn((s) => ({ ...s, comment: e.target.value }))} />
                        <button type="button" className="action-btn slim" onClick={() => createDraftPnDocument()}>Создать черновик ПН</button>
                      </div>
                    ) : null}

                    {activeDocDialog === 'pm' ? (
                      <div className="doc-modal-grid">
                        <select className="field-input" value={newDocPm.lotId} onChange={(e) => setNewDocPm((s) => ({ ...s, lotId: e.target.value }))}>
                          <option value="">Партия (lot)</option>
                          {lotsState.map((l) => <option key={l.id} value={l.id}>{(l.id || '').slice(0, 18)} • {l.product} • {l.rolls} рул.</option>)}
                        </select>
                        <select className="field-input" value={newDocPm.warehouseFrom} onChange={(e) => setNewDocPm((s) => ({ ...s, warehouseFrom: e.target.value }))}>
                          {(warehousesState.some((w) => w.isActive) ? warehousesState.filter((w) => w.isActive) : defaultWarehousesSeed.map((w, idx) => ({ ...w, id: `seed-${idx}` }))).map((w) => (
                            <option key={`f-${w.id}`} value={w.name}>{w.code} — {w.name}</option>
                          ))}
                        </select>
                        <select className="field-input" value={newDocPm.warehouseTo} onChange={(e) => setNewDocPm((s) => ({ ...s, warehouseTo: e.target.value }))}>
                          {(warehousesState.some((w) => w.isActive) ? warehousesState.filter((w) => w.isActive) : defaultWarehousesSeed.map((w, idx) => ({ ...w, id: `seed-${idx}` }))).map((w) => (
                            <option key={`t-${w.id}`} value={w.name}>{w.code} — {w.name}</option>
                          ))}
                        </select>
                        <input type="date" className="field-input" value={newDocPm.docDate} onChange={(e) => setNewDocPm((s) => ({ ...s, docDate: e.target.value }))} />
                        <input className="field-input" placeholder="Комментарий" value={newDocPm.comment} onChange={(e) => setNewDocPm((s) => ({ ...s, comment: e.target.value }))} />
                        <button type="button" className="action-btn slim" onClick={() => createDraftPmDocument()}>Создать черновик ПМ</button>
                      </div>
                    ) : null}

                    {activeDocDialog === 'sp' ? (
                      <div className="doc-modal-grid">
                        <select
                          className="field-input"
                          value={newDocSp.lotId}
                          onChange={(e) => {
                            const id = e.target.value
                            const lot = lotsState.find((l) => l.id === id)
                            setNewDocSp((s) => ({ ...s, lotId: id, warehouse: lot?.warehouseLocation?.trim() || s.warehouse, qtyRolls: lot ? lot.rolls : 0 }))
                          }}
                        >
                          <option value="">Партия (остаток &gt; 0)</option>
                          {lotsState.filter((l) => (l.rolls || 0) > 0).map((l) => <option key={l.id} value={l.id}>{(l.id || '').slice(0, 18)} • {l.product} • {l.rolls} рул.</option>)}
                        </select>
                        <input type="number" min={1} className="field-input" placeholder="Рулонов к списанию" value={newDocSp.qtyRolls || ''} onChange={(e) => setNewDocSp((s) => ({ ...s, qtyRolls: Number(e.target.value) }))} />
                        <select className="field-input" value={newDocSp.warehouse} onChange={(e) => setNewDocSp((s) => ({ ...s, warehouse: e.target.value }))}>
                          {(warehousesState.some((w) => w.isActive) ? warehousesState.filter((w) => w.isActive) : defaultWarehousesSeed.map((w, idx) => ({ ...w, id: `seed-${idx}` }))).map((w) => (
                            <option key={`sp-${w.id}`} value={w.name}>{w.code} — {w.name}</option>
                          ))}
                        </select>
                        <input type="date" className="field-input" value={newDocSp.docDate} onChange={(e) => setNewDocSp((s) => ({ ...s, docDate: e.target.value }))} />
                        <input className="field-input" placeholder="Причина списания" value={newDocSp.reason} onChange={(e) => setNewDocSp((s) => ({ ...s, reason: e.target.value }))} />
                        <button type="button" className="action-btn slim" onClick={() => createDraftSpDocument()}>Создать черновик СП</button>
                      </div>
                    ) : null}

                    {activeDocDialog === 'zk' ? (
                      <div className="doc-modal-grid">
                        <input className="field-input" placeholder="Клиент" value={newDocZk.customer} onChange={(e) => setNewDocZk((s) => ({ ...s, customer: e.target.value }))} />
                        <select className="field-input" value={newDocZk.productId} onChange={(e) => setNewDocZk((s) => ({ ...s, productId: e.target.value }))}>
                          <option value="">Номенклатура</option>
                          {productsState.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <input type="number" className="field-input" placeholder="Количество, рул." value={newDocZk.qty || ''} onChange={(e) => setNewDocZk((s) => ({ ...s, qty: Number(e.target.value) }))} />
                        <input type="date" className="field-input" value={newDocZk.docDate} onChange={(e) => setNewDocZk((s) => ({ ...s, docDate: e.target.value }))} />
                        <input className="field-input" placeholder="Комментарий" value={newDocZk.comment} onChange={(e) => setNewDocZk((s) => ({ ...s, comment: e.target.value }))} />
                        <button type="button" className="action-btn slim" onClick={() => createDraftZkDocument()}>Создать черновик ЗК</button>
                      </div>
                    ) : null}

                    {activeDocDialog === 'otg' ? (
                      <div className="doc-modal-grid">
                        <input className="field-input" placeholder="Клиент" value={newDocOtg.customer} onChange={(e) => setNewDocOtg((s) => ({ ...s, customer: e.target.value }))} />
                        <input type="date" className="field-input" value={newDocOtg.docDate} onChange={(e) => setNewDocOtg((s) => ({ ...s, docDate: e.target.value }))} />
                        <div className="lot-line">Выберите рулоны (только approved):</div>
                        <div className="actions" style={{ flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto' }}>
                          {rollsState.filter((r) => r.status === 'approved').map((roll) => (
                            <button
                              key={roll.id}
                              type="button"
                              className={`action-btn slim ghost ${newDocOtg.selectedRollIds.includes(roll.id || '') ? 'active' : ''}`}
                              onClick={() => toggleDocOtgRoll(roll.id || '')}
                            >
                              {roll.rollCode}
                            </button>
                          ))}
                        </div>
                        <input className="field-input" placeholder="Комментарий" value={newDocOtg.comment} onChange={(e) => setNewDocOtg((s) => ({ ...s, comment: e.target.value }))} />
                        <button type="button" className="action-btn slim" onClick={() => createDraftOtgDocument()}>Создать черновик ОТГ</button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {navMode === 'sections' && view === 'production_request' && canManageProductionRequest ? (
        <section className="board">
          <h2>Заявка на производство (симуляция)</h2>
          <p className="lot-line" style={{ marginBottom: 12 }}>
            Дата редактируется, но после проведения заявка становится только для чтения. Бригадир и бригада выбираются из сотрудников.
          </p>
          <div className="actions">
            <button type="button" className="action-btn slim add-btn" onClick={openNewProductionRequestDialog}>
              + Добавить заявку
            </button>
          </div>

          <div className="doc-journal">
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Линия</th>
                  <th>Наименование</th>
                  <th>Бригадир</th>
                  <th>План</th>
                  <th>Факт</th>
                  <th>Статус плана</th>
                  <th>Документ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {productionRequests.map((r) => {
                  const fact = r.actualC1 + r.actualC2 + r.actualC3 + r.actualC4
                  return (
                    <tr key={r.id}>
                      <td>{r.date}</td>
                      <td>{r.lineNumber}</td>
                      <td>{r.lineName}</td>
                      <td>{r.foremanName}</td>
                      <td>{r.plannedQty}</td>
                      <td>{fact}</td>
                      <td>{r.planStatus}</td>
                      <td>{r.status === 'posted' ? 'Проведен' : 'Черновик'}</td>
                      <td>
                        <div className="actions" style={{ marginBottom: 0 }}>
                          <button type="button" className="action-btn slim ghost" onClick={() => openExistingProductionRequest(r.id)}>
                            Открыть
                          </button>
                          {r.status === 'draft' ? (
                            <button type="button" className="action-btn slim" onClick={() => postProductionRequest(r.id)}>
                              Провести
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!productionRequests.length ? <div className="lot-line">Заявок пока нет</div> : null}
          </div>

          <h3 style={{ marginTop: 18 }}>Линия упаковки (на основании выработки предыдущего дня)</h3>
          <div className="actions">
            <button type="button" className="action-btn slim add-btn" onClick={openNewPackagingDialog}>
              + Документ упаковки
            </button>
          </div>
          <div className="stage-grid">
            <article className="stage-card">
              <div className="stage-head">
                <strong>Неупакованная выработка</strong>
                <span>{unpackedOutputs.filter((o) => o.status === 'unpacked').length}</span>
              </div>
              {unpackedOutputs
                .filter((o) => o.status === 'unpacked')
                .map((o) => (
                  <div className="lot" key={o.id}>
                    <div className="lot-top">
                      <b>{o.lineName}</b>
                      <span>{o.date}</span>
                    </div>
                    <div className="lot-line">{o.productName}</div>
                    <div className="lot-line">{o.qtyRolls} рул. (не упаковано)</div>
                  </div>
                ))}
            </article>
            <article className="stage-card">
              <div className="stage-head">
                <strong>Расходники упаковки</strong>
                <span>остаток</span>
              </div>
              {Object.entries(consumablesStock).map(([k, v]) => (
                <div key={k} className="lot-line">
                  {k}: {v} шт.
                </div>
              ))}
            </article>
            <article className="stage-card">
              <div className="stage-head">
                <strong>Упакованный остаток</strong>
                <span>рулоны</span>
              </div>
              {Object.entries(packagedStock).map(([k, v]) => (
                <div key={k} className="lot-line">
                  {k}: {v}
                </div>
              ))}
              {!Object.keys(packagedStock).length ? <div className="lot-line">Пока пусто</div> : null}
            </article>
          </div>
          <div className="doc-journal" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Основание (дата)</th>
                  <th>Линия</th>
                  <th>Продукция</th>
                  <th>План / факт рул.</th>
                  <th>Коробки / поддоны</th>
                  <th>Списание расходников</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {packagingRequests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>{r.sourceDate}</td>
                    <td>{r.lineNumber}</td>
                    <td>{r.productName}</td>
                    <td>
                      {r.planRolls} / {r.factRolls}
                    </td>
                    <td>
                      {r.factBoxes} / {r.factPallets}
                    </td>
                    <td>
                      {r.labelItem}: {r.labelQty}, Стрейч: {r.stretchQty}, Термо: {r.thermoQty}
                    </td>
                    <td>{r.status === 'posted' ? 'Проведен' : 'Черновик'}</td>
                    <td>
                      {r.status === 'draft' ? (
                        <button type="button" className="action-btn slim" onClick={() => postPackagingRequest(r.id)}>
                          Провести
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!packagingRequests.length ? <div className="lot-line">Документов упаковки пока нет</div> : null}
          </div>

          {isProductionDialogOpen ? (
            <div className="modal-backdrop" onClick={() => setIsProductionDialogOpen(false)}>
              <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
                <div className="stage-head">
                  <strong>{selectedProductionRequestId ? 'Редактирование заявки' : 'Новая заявка'}</strong>
                  <button type="button" className="action-btn slim ghost" onClick={() => setIsProductionDialogOpen(false)}>
                    Закрыть
                  </button>
                </div>
                {productionReadonly ? <div className="error">Документ проведен и недоступен для редактирования.</div> : null}
                <div className="doc-modal-grid">
                  <input className="field-input" type="date" value={productionForm.date} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, date: e.target.value }))} />
                  <input className="field-input" placeholder="№ линии" value={productionForm.lineNumber} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, lineNumber: e.target.value }))} />
                  <input className="field-input" placeholder="Наименование" value={productionForm.lineName} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, lineName: e.target.value }))} />
                  <input className="field-input" placeholder="Заказчик" value={productionForm.customer} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, customer: e.target.value }))} />
                  <input className="field-input" placeholder="Упаковка" value={productionForm.packaging} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, packaging: e.target.value }))} />
                  <input className="field-input" placeholder="Плотность" value={productionForm.density} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, density: e.target.value }))} />
                  <input className="field-input" placeholder="Категория" value={productionForm.categoryLabel} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, categoryLabel: e.target.value }))} />
                  <input className="field-input" placeholder="Цвет" value={productionForm.color} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, color: e.target.value }))} />
                  <input type="number" className="field-input" placeholder="План (кол-во)" value={productionForm.plannedQty || ''} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, plannedQty: Number(e.target.value) }))} />
                  <div className="actions" style={{ marginBottom: 0 }}>
                    <select className="field-input" value={productionForm.foremanId} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, foremanId: e.target.value }))}>
                      <option value="">Бригадир</option>
                      {activeEmployees.filter((e) => brigadierIds.includes(e.id)).map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} ({e.role})
                        </option>
                      ))}
                    </select>
                    <button type="button" className="action-btn slim ghost" disabled={productionReadonly} onClick={() => setIsBrigadierDialogOpen(true)}>
                      + Добавить бригадира
                    </button>
                  </div>

                  <div className="stage-card">
                    <div className="stage-head">
                      <strong>Бригада</strong>
                    </div>
                    <div className="actions" style={{ marginBottom: 0 }}>
                      {activeEmployees.map((e) => (
                        <button key={e.id} type="button" disabled={productionReadonly} className={`action-btn slim ghost ${productionForm.brigadeIds.includes(e.id) ? 'active' : ''}`} onClick={() => toggleBrigadeMember(e.id)}>
                          {e.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="stage-card">
                    <div className="stage-head">
                      <strong>Сырьё (из остатков)</strong>
                    </div>
                    <div className="form-grid" style={{ marginBottom: 8 }}>
                      <select className="field-input" value={newRawLine.lotId} disabled={productionReadonly} onChange={(e) => setNewRawLine((s) => ({ ...s, lotId: e.target.value }))}>
                        <option value="">Партия сырья</option>
                        {availableRawLots.map((l) => (
                          <option key={l.id} value={l.id}>
                            {(l.id || '').slice(0, 16)} • {l.product} • остаток {l.rolls}
                          </option>
                        ))}
                      </select>
                      <input type="number" className="field-input" placeholder="Кол-во (рул.)" value={newRawLine.qty || ''} disabled={productionReadonly} onChange={(e) => setNewRawLine((s) => ({ ...s, qty: Number(e.target.value) }))} />
                      <input className="field-input" placeholder="Примечание" value={newRawLine.note} disabled={productionReadonly} onChange={(e) => setNewRawLine((s) => ({ ...s, note: e.target.value }))} />
                      <button type="button" className="action-btn slim ghost" disabled={productionReadonly} onClick={addRawLineToProduction}>
                        + Добавить сырьё
                      </button>
                    </div>
                    {productionForm.rawLines.map((row, idx) => (
                      <div key={`${row.lotId}-${idx}`} className="lot">
                        <div className="lot-top">
                          <b>{row.lotLabel}</b>
                          <span>{row.qty} рул.</span>
                        </div>
                        <div className="lot-line">{row.note || '—'}</div>
                        {!productionReadonly ? (
                          <button type="button" className="action-btn slim ghost" onClick={() => removeRawLineFromProduction(idx)}>
                            Удалить
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <div className="stage-card">
                    <div className="stage-head">
                      <strong>Факт по категориям</strong>
                    </div>
                    <div className="form-grid">
                      <input type="number" className="field-input" placeholder="Категория 1" value={productionForm.actualC1 || ''} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, actualC1: Number(e.target.value) }))} />
                      <input type="number" className="field-input" placeholder="Категория 2" value={productionForm.actualC2 || ''} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, actualC2: Number(e.target.value) }))} />
                      <input type="number" className="field-input" placeholder="Категория 3" value={productionForm.actualC3 || ''} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, actualC3: Number(e.target.value) }))} />
                      <input type="number" className="field-input" placeholder="Категория 4" value={productionForm.actualC4 || ''} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, actualC4: Number(e.target.value) }))} />
                      <input type="number" className="field-input" placeholder="Брак" value={productionForm.defectQty || ''} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, defectQty: Number(e.target.value) }))} />
                    </div>
                  </div>

                  <div className="stage-card">
                    <div className="stage-head">
                      <strong>Упаковка</strong>
                    </div>
                    <div className="form-grid">
                      <input type="number" className="field-input" placeholder="Рулоны" value={productionForm.packedRolls || ''} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, packedRolls: Number(e.target.value) }))} />
                      <input type="number" className="field-input" placeholder="Коробки" value={productionForm.packedBoxes || ''} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, packedBoxes: Number(e.target.value) }))} />
                      <input type="number" className="field-input" placeholder="Поддоны" value={productionForm.packedPallets || ''} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, packedPallets: Number(e.target.value) }))} />
                    </div>
                  </div>

                  <input className="field-input" placeholder="Примечание" value={productionForm.comment} disabled={productionReadonly} onChange={(e) => setProductionForm((s) => ({ ...s, comment: e.target.value }))} />
                  {!productionReadonly ? (
                    <button type="button" className="action-btn slim" onClick={saveProductionRequestDraft}>
                      Сохранить заявку
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {isBrigadierDialogOpen ? (
            <div className="modal-backdrop" onClick={() => setIsBrigadierDialogOpen(false)}>
              <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
                <div className="stage-head">
                  <strong>Добавить бригадира</strong>
                  <button type="button" className="action-btn slim ghost" onClick={() => setIsBrigadierDialogOpen(false)}>
                    Закрыть
                  </button>
                </div>
                <div className="stage-grid">
                  {activeEmployees.map((emp) => (
                    <article className="stage-card" key={`brigadier-${emp.id}`}>
                      <div className="stage-head">
                        <strong>{emp.name}</strong>
                        <span>{emp.role}</span>
                      </div>
                      <button
                        type="button"
                        className={`action-btn slim ghost ${brigadierIds.includes(emp.id) ? 'active' : ''}`}
                        onClick={() => addBrigadier(emp.id)}
                      >
                        {brigadierIds.includes(emp.id) ? 'Уже в списке' : 'Добавить в список бригадиров'}
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {isPackagingDialogOpen ? (
            <div className="modal-backdrop" onClick={() => setIsPackagingDialogOpen(false)}>
              <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
                <div className="stage-head">
                  <strong>Документ линии упаковки</strong>
                  <button type="button" className="action-btn slim ghost" onClick={() => setIsPackagingDialogOpen(false)}>
                    Закрыть
                  </button>
                </div>
                {packagingReadonly ? <div className="lot-line"> </div> : null}
                <div className="doc-modal-grid">
                  <input className="field-input" type="date" value={packagingForm.date} onChange={(e) => setPackagingForm((s) => ({ ...s, date: e.target.value }))} />
                  <select className="field-input" value={packagingForm.outputId} onChange={(e) => selectOutputForPackaging(e.target.value)}>
                    <option value="">Выработка предыдущего дня</option>
                    {unpackedOutputs
                      .filter((o) => o.status === 'unpacked')
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.date} • {o.lineNumber} • {o.productName} • {o.qtyRolls} рул.
                        </option>
                      ))}
                  </select>
                  <input className="field-input" type="date" value={packagingForm.sourceDate} onChange={(e) => setPackagingForm((s) => ({ ...s, sourceDate: e.target.value }))} />
                  <input className="field-input" placeholder="№ линии упаковки" value={packagingForm.lineNumber} onChange={(e) => setPackagingForm((s) => ({ ...s, lineNumber: e.target.value }))} />
                  <input className="field-input" placeholder="Наименование" value={packagingForm.lineName} onChange={(e) => setPackagingForm((s) => ({ ...s, lineName: e.target.value }))} />
                  <input className="field-input" placeholder="Продукция" value={packagingForm.productName} onChange={(e) => setPackagingForm((s) => ({ ...s, productName: e.target.value }))} />
                  <input type="number" className="field-input" placeholder="План рулонов" value={packagingForm.planRolls || ''} onChange={(e) => setPackagingForm((s) => ({ ...s, planRolls: Number(e.target.value) }))} />
                  <input type="number" className="field-input" placeholder="Факт рулонов" value={packagingForm.factRolls || ''} onChange={(e) => setPackagingForm((s) => ({ ...s, factRolls: Number(e.target.value) }))} />
                  <input type="number" className="field-input" placeholder="Факт коробок" value={packagingForm.factBoxes || ''} onChange={(e) => setPackagingForm((s) => ({ ...s, factBoxes: Number(e.target.value) }))} />
                  <input type="number" className="field-input" placeholder="Факт поддонов" value={packagingForm.factPallets || ''} onChange={(e) => setPackagingForm((s) => ({ ...s, factPallets: Number(e.target.value) }))} />
                  <select className="field-input" value={packagingForm.labelItem} onChange={(e) => setPackagingForm((s) => ({ ...s, labelItem: e.target.value }))}>
                    {Object.keys(consumablesStock)
                      .filter((k) => k.startsWith('Этикетка'))
                      .map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                  </select>
                  <input type="number" className="field-input" placeholder="Списание этикеток" value={packagingForm.labelQty || ''} onChange={(e) => setPackagingForm((s) => ({ ...s, labelQty: Number(e.target.value) }))} />
                  <input type="number" className="field-input" placeholder="Списание стрейча" value={packagingForm.stretchQty || ''} onChange={(e) => setPackagingForm((s) => ({ ...s, stretchQty: Number(e.target.value) }))} />
                  <input type="number" className="field-input" placeholder="Списание термопленки" value={packagingForm.thermoQty || ''} onChange={(e) => setPackagingForm((s) => ({ ...s, thermoQty: Number(e.target.value) }))} />
                  <input className="field-input" placeholder="Примечание" value={packagingForm.comment} onChange={(e) => setPackagingForm((s) => ({ ...s, comment: e.target.value }))} />
                  <button type="button" className="action-btn slim" onClick={savePackagingDraft}>
                    Сохранить документ упаковки
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {navMode === 'sections' && view === 'lots' && canCreateLots ? (
        <section className="board">
          <h2>Создать новую партию</h2>
          <div className="form-grid">
            <input
              className="field-input"
              placeholder="Поставщик"
              value={newLot.supplier}
              onChange={(e) => setNewLot((s) => ({ ...s, supplier: e.target.value }))}
            />
            <input
              className="field-input"
              placeholder="Материал"
              value={newLot.material}
              onChange={(e) => setNewLot((s) => ({ ...s, material: e.target.value }))}
            />
            <select
              className="field-input"
              value={newLot.productId}
              onChange={(e) => setNewLot((s) => ({ ...s, productId: e.target.value }))}
            >
              <option value="">Выбери продукт</option>
              {productsState.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.internalId} — {p.name}
                </option>
              ))}
            </select>
            <input
              className="field-input"
              placeholder="Ширина (мм)"
              type="number"
              value={newLot.widthMm}
              onChange={(e) => setNewLot((s) => ({ ...s, widthMm: Number(e.target.value) }))}
            />
            <input
              className="field-input"
              placeholder="Плотность (г/м2)"
              type="number"
              value={newLot.gsm}
              onChange={(e) => setNewLot((s) => ({ ...s, gsm: Number(e.target.value) }))}
            />
            <input
              className="field-input"
              placeholder="Рулоны"
              type="number"
              value={newLot.rolls}
              onChange={(e) => setNewLot((s) => ({ ...s, rolls: Number(e.target.value) }))}
            />
            <input
              className="field-input"
              placeholder="Метры"
              type="number"
              value={newLot.meters}
              onChange={(e) => setNewLot((s) => ({ ...s, meters: Number(e.target.value) }))}
            />
            <input
              className="field-input"
              placeholder="Примечание"
              value={newLot.note}
              onChange={(e) => setNewLot((s) => ({ ...s, note: e.target.value }))}
            />
          </div>
          <div className="actions">
            <button className="action-btn slim" type="button" onClick={createLot}>
              Добавить партию
            </button>
            {currentUser?.role === 'admin' ? (
              <button className="action-btn slim ghost" type="button" onClick={seedDemoLots}>
                Заполнить демо-партиями
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {navMode === 'sections' && view === 'dashboard' && canSeeFlow ? (
        <section className="flow">
          <h2>Логическая цепочка</h2>
          <div className="flow-grid">
            <div className="flow-step">
              <PackageCheck size={18} />
              Прием сырья
            </div>
            <div className="flow-step">
              <Factory size={18} />
              Пропиточная линия
            </div>
            <div className="flow-step">
              <CheckCircle2 size={18} />
              QC и сертификаты
            </div>
            <div className="flow-step">
              <AlertTriangle size={18} />
              Резервы/брак
            </div>
            <div className="flow-step">
              <Truck size={18} />
              Отгрузка клиенту
            </div>
          </div>
        </section>
      ) : null}

      {navMode === 'sections' && view === 'lots' && canSeeLots ? (
        <section className="board">
          <h2>Партии по этапам ({roleLabels[currentUser.role]})</h2>
          <div className="actions">
            <button
              className={`action-btn slim ghost ${activeStageFilter === 'all' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveStageFilter('all')}
            >
              Все этапы
            </button>
            {orderedStages.map((st) => (
              <button
                key={st}
                className={`action-btn slim ghost ${activeStageFilter === st ? 'active' : ''}`}
                type="button"
                onClick={() => setActiveStageFilter(st)}
              >
                {stageLabels[st]}
              </button>
            ))}
          </div>

          {dataLoading ? <div className="lot-line">Загрузка данных...</div> : null}

          <div className="stage-grid">
            {stageCounts
              .filter((stage) => activeStageFilter === 'all' || stage.key === activeStageFilter)
              .filter((stage) => allowedStages.includes(stage.key))
              .map((stage) => (
                <article className="stage-card" key={stage.key}>
                  <div className="stage-head">
                    <strong>{stage.label}</strong>
                    <span>{stage.count}</span>
                  </div>
                  {effectiveLots
                    .filter((lot) => lot.stage === stage.key)
                    .map((lot) => (
                      <div className="lot" key={lot.id || `${lot.product}-${lot.rolls}`}>
                        <div className="lot-top">
                          <b>{lot.id}</b>
                          <span>{lot.supplier}</span>
                        </div>
                        <div className="lot-line">
                          {lot.material} / {lot.product}
                        </div>
                        <div className="lot-line">
                          {lot.rolls} рул. • {lot.meters} м • {lot.widthMm} мм • {lot.gsm} г/м2
                        </div>
                        {lot.note ? <div className="lot-note">{lot.note}</div> : null}
                        {canManageLots ? (
                          <div className="actions lot-actions">
                            <button
                              className="action-btn slim ghost"
                              type="button"
                              onClick={() => moveLot(lot, 'prev')}
                            >
                              ← Назад
                            </button>
                            <button className="action-btn slim" type="button" onClick={() => moveLot(lot, 'next')}>
                              Вперед →
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                </article>
              ))}
          </div>
        </section>
      ) : null}

      {navMode === 'sections' && view === 'runs' && canManageRuns ? (
        <section className="board">
          <h2>MES: производственные запуски</h2>
          <div className="form-grid">
            <select
              className="field-input"
              value={newRun.productId}
              onChange={(e) => setNewRun((s) => ({ ...s, productId: e.target.value }))}
            >
              <option value="">Продукт</option>
              {productsState.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.internalId} — {p.name}
                </option>
              ))}
            </select>
            <input
              className="field-input"
              placeholder="Код рецептуры"
              value={newRun.recipeCode}
              onChange={(e) => setNewRun((s) => ({ ...s, recipeCode: e.target.value }))}
            />
            <input
              className="field-input"
              placeholder="Линия"
              value={newRun.line}
              onChange={(e) => setNewRun((s) => ({ ...s, line: e.target.value }))}
            />
            <select
              className="field-input"
              value={newRun.shift}
              onChange={(e) => setNewRun((s) => ({ ...s, shift: e.target.value as 'День' | 'Ночь' }))}
            >
              <option>День</option>
              <option>Ночь</option>
            </select>
            <input
              className="field-input"
              type="number"
              placeholder="План рулонов"
              value={newRun.plannedRolls}
              onChange={(e) => setNewRun((s) => ({ ...s, plannedRolls: Number(e.target.value) }))}
            />
          </div>
          <div className="actions">
            <button className="action-btn slim" type="button" onClick={createRun}>
              Создать запуск
            </button>
          </div>
          {runsState.map((run) => (
            <div className="lot" key={run.id}>
              <div className="lot-top">
                <b>{run.productName}</b>
                <span>{run.line} • {run.shift}</span>
              </div>
              <div className="lot-line">Рецептура: {run.recipeCode}</div>
              <div className="lot-line">План: {run.plannedRolls} рул. • Статус: {run.status}</div>
              <div className="actions lot-actions">
                <button className="action-btn slim ghost" type="button" onClick={() => setRunStatus(run.id || '', 'planned')}>
                  planned
                </button>
                <button className="action-btn slim ghost" type="button" onClick={() => setRunStatus(run.id || '', 'running')}>
                  running
                </button>
                <button className="action-btn slim ghost" type="button" onClick={() => setRunStatus(run.id || '', 'paused')}>
                  paused
                </button>
                <button className="action-btn slim ghost" type="button" onClick={() => setRunStatus(run.id || '', 'completed')}>
                  completed
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {navMode === 'sections' && view === 'rolls' && canManageRolls ? (
        <section className="board">
          <h2>Рулонный учет (traceability)</h2>
          <div className="form-grid">
            <select
              className="field-input"
              value={newRoll.runId}
              onChange={(e) => setNewRoll((s) => ({ ...s, runId: e.target.value }))}
            >
              <option value="">Производственный запуск</option>
              {runsState.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.productName} / {run.recipeCode} / {run.shift}
                </option>
              ))}
            </select>
            <input
              className="field-input"
              type="number"
              placeholder="Длина, м"
              value={newRoll.lengthM}
              onChange={(e) => setNewRoll((s) => ({ ...s, lengthM: Number(e.target.value) }))}
            />
            <input
              className="field-input"
              type="number"
              placeholder="Ширина, мм"
              value={newRoll.widthMm}
              onChange={(e) => setNewRoll((s) => ({ ...s, widthMm: Number(e.target.value) }))}
            />
          </div>
          <div className="actions">
            <button className="action-btn slim" type="button" onClick={createRoll}>
              Выпустить рулон
            </button>
          </div>
          {rollsState.map((roll) => (
            <div className="lot" key={roll.id}>
              <div className="lot-top">
                <b>{roll.rollCode}</b>
                <span>{roll.productName}</span>
              </div>
              <div className="lot-line">Run: {roll.runId}</div>
              <div className="lot-line">
                {roll.lengthM} м • {roll.widthMm} мм • Статус: {roll.status}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {navMode === 'sections' && view === 'qc' && canManageQc ? (
        <section className="board">
          <h2>QC лаборатория: решение по рулонам</h2>
          {rollsState.map((roll) => (
            <div className="lot" key={roll.id}>
              <div className="lot-top">
                <b>{roll.rollCode}</b>
                <span>{roll.productName}</span>
              </div>
              <div className="lot-line">Текущий статус: {roll.status}</div>
              <div className="actions lot-actions">
                <button
                  className="action-btn slim ghost"
                  type="button"
                  onClick={() => setRollQcStatus(roll.id || '', 'awaiting_qc')}
                >
                  awaiting_qc
                </button>
                <button className="action-btn slim ghost" type="button" onClick={() => setRollQcStatus(roll.id || '', 'approved')}>
                  approved
                </button>
                <button
                  className="action-btn slim ghost"
                  type="button"
                  onClick={() => setRollQcStatus(roll.id || '', 'quarantine')}
                >
                  quarantine
                </button>
                <button className="action-btn slim ghost" type="button" onClick={() => setRollQcStatus(roll.id || '', 'rejected')}>
                  rejected
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {navMode === 'sections' && view === 'orders' && canManageOrders ? (
        <section className="board">
          <h2>Формирование заказа и резервы</h2>
          <div className="form-grid">
            <input
              className="field-input"
              placeholder="Клиент"
              value={newOrder.customer}
              onChange={(e) => setNewOrder((s) => ({ ...s, customer: e.target.value }))}
            />
            <select
              className="field-input"
              value={newOrder.productId}
              onChange={(e) => setNewOrder((s) => ({ ...s, productId: e.target.value }))}
            >
              <option value="">Продукт</option>
              {productsState.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              className="field-input"
              type="number"
              placeholder="Количество (рул.)"
              value={newOrder.qty}
              onChange={(e) => setNewOrder((s) => ({ ...s, qty: Number(e.target.value) }))}
            />
          </div>
          <div className="actions">
            <button className="action-btn slim" type="button" onClick={createOrder}>
              Создать заказ + резерв
            </button>
          </div>

          {ordersState.map((order) => (
            <div className="lot" key={order.id}>
              <div className="lot-top">
                <b>Заказ {order.id}</b>
                <span>{order.customer}</span>
              </div>
              {order.items.map((item, idx) => (
                <div key={`${order.id}-${idx}`} className="lot-line">
                  {item.productName}: заказано {item.qty}, резерв {item.reservedQty}
                </div>
              ))}
              <div className="actions lot-actions">
                <button className="action-btn slim ghost" type="button" onClick={() => setOrderStatus(order.id || '', 'open')}>
                  open
                </button>
                <button className="action-btn slim ghost" type="button" onClick={() => setOrderStatus(order.id || '', 'closed')}>
                  closed
                </button>
                <button
                  className="action-btn slim ghost"
                  type="button"
                  onClick={() => setOrderStatus(order.id || '', 'cancelled')}
                >
                  cancelled
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {navMode === 'sections' && view === 'suppliers' && canManageSuppliers ? (
        <section className="board">
          <h2>Поставщики</h2>
          <div className="form-grid">
            <input
              className="field-input"
              placeholder="Название поставщика"
              value={newSupplier.name}
              onChange={(e) => setNewSupplier((s) => ({ ...s, name: e.target.value }))}
            />
            <input
              className="field-input"
              placeholder="Страна"
              value={newSupplier.country}
              onChange={(e) => setNewSupplier((s) => ({ ...s, country: e.target.value }))}
            />
            <input
              className="field-input"
              placeholder="Контакт"
              value={newSupplier.contact}
              onChange={(e) => setNewSupplier((s) => ({ ...s, contact: e.target.value }))}
            />
          </div>
          <div className="actions">
            <button className="action-btn slim" type="button" onClick={createSupplier}>
              Добавить поставщика
            </button>
          </div>
          {suppliersState.map((supplier) => (
            <div className="lot" key={supplier.id}>
              <div className="lot-top">
                <b>{supplier.name}</b>
                <span>
                  {supplier.country} • {supplier.contact}
                </span>
              </div>
              <div className="lot-line">Статус: {supplier.status}</div>
              <div className="actions lot-actions">
                <button className="action-btn slim ghost" type="button" onClick={() => setSupplierStatus(supplier.id || '', 'active')}>
                  active
                </button>
                <button className="action-btn slim ghost" type="button" onClick={() => setSupplierStatus(supplier.id || '', 'blocked')}>
                  blocked
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {navMode === 'sections' && view === 'receipts' && canManageReceipts ? (
        <section className="board">
          <h2>Поступление товара / сырья</h2>
          <div className="form-grid">
            <select
              className="field-input"
              value={newReceipt.supplierId}
              onChange={(e) => setNewReceipt((s) => ({ ...s, supplierId: e.target.value }))}
            >
              <option value="">Поставщик</option>
              {suppliersState
                .filter((s) => s.status === 'active')
                .map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
            </select>
            <select
              className="field-input"
              value={newReceipt.productId}
              onChange={(e) => setNewReceipt((s) => ({ ...s, productId: e.target.value }))}
            >
              <option value="">Номенклатура</option>
              {productsState.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.internalId} — {product.name}
                </option>
              ))}
            </select>
            <input
              className="field-input"
              type="number"
              placeholder="Количество, рул."
              value={newReceipt.qtyRolls}
              onChange={(e) => setNewReceipt((s) => ({ ...s, qtyRolls: Number(e.target.value) }))}
            />
            <input
              className="field-input"
              placeholder="Примечание"
              value={newReceipt.note}
              onChange={(e) => setNewReceipt((s) => ({ ...s, note: e.target.value }))}
            />
          </div>
          <div className="actions">
            <button className="action-btn slim" type="button" onClick={createReceipt}>
              Провести поступление
            </button>
          </div>
          {receiptsState.map((receipt) => (
            <div className="lot" key={receipt.id}>
              <div className="lot-top">
                <b>{receipt.supplierName}</b>
                <span>{receipt.productName}</span>
              </div>
              <div className="lot-line">Количество: {receipt.qtyRolls} рул.</div>
              <div className="lot-line">{receipt.note || '—'}</div>
            </div>
          ))}
        </section>
      ) : null}

      {navMode === 'sections' && view === 'shipping' && canManageShipping ? (
        <section className="board">
          <h2>Паллеты и отгрузка</h2>
          <div className="form-grid">
            <input
              className="field-input"
              placeholder="Клиент"
              value={newShipment.customer}
              onChange={(e) => setNewShipment((s) => ({ ...s, customer: e.target.value }))}
            />
          </div>
          <div className="lot-line">Выберите рулоны со статусом approved:</div>
          <div className="actions">
            {rollsState
              .filter((roll) => roll.status === 'approved')
              .map((roll) => (
                <button
                  key={roll.id}
                  type="button"
                  className={`action-btn slim ghost ${newShipment.selectedRollIds.includes(roll.id || '') ? 'active' : ''}`}
                  onClick={() => toggleRollForShipment(roll.id || '')}
                >
                  {roll.rollCode}
                </button>
              ))}
          </div>
          <div className="actions">
            <button className="action-btn slim" type="button" onClick={createShipment}>
              Создать паллету/отгрузку
            </button>
          </div>
          {shipmentsState.map((ship) => (
            <div className="lot" key={ship.id}>
              <div className="lot-top">
                <b>{ship.palletCode}</b>
                <span>{ship.customer}</span>
              </div>
              <div className="lot-line">
                Рулонов: {ship.rollCodes.length} • Статус: {ship.status}
              </div>
              <div className="actions lot-actions">
                <button className="action-btn slim ghost" type="button" onClick={() => setShipmentStatus(ship.id || '', 'planned')}>
                  planned
                </button>
                <button className="action-btn slim ghost" type="button" onClick={() => setShipmentStatus(ship.id || '', 'shipped')}>
                  shipped
                </button>
                <button className="action-btn slim" type="button" onClick={() => copyText(buildShipmentDoc(ship))}>
                  Копировать Packing List / CoA
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {navMode === 'sections' && view === 'trace' ? (
        <section className="board">
          <h2>Traceability рулона</h2>
          <div className="form-grid">
            <input
              className="field-input"
              placeholder="Введите код рулона, например R-2026-000001"
              value={traceRollCode}
              onChange={(e) => setTraceRollCode(e.target.value)}
            />
          </div>
          {traceRoll ? (
            <div className="lot">
              <div className="lot-line">Рулон: {traceRoll.rollCode}</div>
              <div className="lot-line">Продукт: {traceRoll.productName}</div>
              <div className="lot-line">QC статус: {traceRoll.status}</div>
              <div className="lot-line">Запуск: {traceRun ? `${traceRun.productName} / ${traceRun.recipeCode} / ${traceRun.line}` : '—'}</div>
              <div className="lot-line">
                Отгрузка: {traceShipment ? `${traceShipment.palletCode} / ${traceShipment.customer} / ${traceShipment.status}` : 'еще не отгружен'}
              </div>
            </div>
          ) : (
            <div className="lot-line">Рулон не найден</div>
          )}
        </section>
      ) : null}

      {navMode === 'sections' && view === 'inventory' && (
        <section className="board tis-board">
          <h2>Складской учёт («1С: Торговля и склад» — упрощённо)</h2>
          <p className="subtitle" style={{ marginTop: '-6px', color: '#475569', fontSize: '14px' }}>
            Справочник складов, остатки по складам и регистрам, журнал движений после проведения документов (ПН / ПМ / отгрузка).
            Полный функционал 1С здесь имитируется постепенно; числа по партиям и рулонам — отражение текущей модели Fibercell.
          </p>
          <div className="actions" style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={`action-btn slim ghost ${inventorySubView === 'balances' ? 'active' : ''}`}
              onClick={() => setInventorySubView('balances')}
            >
              Остатки ТМЦ
            </button>
            <button
              type="button"
              className={`action-btn slim ghost ${inventorySubView === 'movements' ? 'active' : ''}`}
              onClick={() => setInventorySubView('movements')}
            >
              Движение товаров
            </button>
            <button
              type="button"
              className={`action-btn slim ghost ${inventorySubView === 'warehouses' ? 'active' : ''}`}
              onClick={() => setInventorySubView('warehouses')}
            >
              Справочник складов
            </button>
          </div>

          {inventorySubView === 'balances' ? (
            <>
              <div className="form-grid" style={{ marginBottom: 12 }}>
                <select
                  className="field-input"
                  value={balancesWarehouseFilter}
                  onChange={(e) => setBalancesWarehouseFilter(e.target.value)}
                >
                  <option value="__all__">Все склады</option>
                  {warehousesState.map((w) => (
                    <option key={w.id} value={w.name}>
                      {w.code} — {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="doc-journal">
                <table>
                  <thead>
                    <tr>
                      <th>Склад</th>
                      <th>Регистр</th>
                      <th>Код</th>
                      <th>Номенклатура</th>
                      <th>Остаток</th>
                      <th>Ед.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tisBalanceRows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.warehouse}</td>
                        <td>{row.register}</td>
                        <td>{row.internalId}</td>
                        <td>{row.productName}</td>
                        <td>{row.qty.toLocaleString('ru-RU')}</td>
                        <td>{row.uom}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!tisBalanceRows.length ? <div className="lot-line">Нет учётных остатков по правилам ТиС</div> : null}
              </div>
              <div className="stage-grid" style={{ marginTop: 18 }}>
                {productsState.map((product) => {
                  const ready = readyByProduct[product.id || ''] || 0
                  const reserved = reservationsByProduct[product.id || ''] || 0
                  const free = Math.max(0, ready - reserved)
                  return (
                    <article className="stage-card" key={product.id}>
                      <div className="stage-head">
                        <strong>Резервы по заказам</strong>
                        <span>{product.internalId}</span>
                      </div>
                      <div className="lot-line">{product.name}</div>
                      <div className="lot-line">ГП (все склады): {ready} рул.</div>
                      <div className="lot-line">В резерве: {reserved} рул.</div>
                      <div className="lot-line">Свободно: {free} рул.</div>
                    </article>
                  )
                })}
              </div>
            </>
          ) : null}

          {inventorySubView === 'movements' ? (
            <div className="doc-journal">
              <table>
                <thead>
                  <tr>
                    <th>Документ</th>
                    <th>Тип</th>
                    <th>Склад</th>
                    <th>Номенклатура</th>
                    <th>Изм.</th>
                    <th>Ед.</th>
                  </tr>
                </thead>
                <tbody>
                  {stockLedgerState.map((e) => (
                    <tr key={e.id}>
                      <td>{e.docNumber}</td>
                      <td>{movementTypeRu(e.movementType)}</td>
                      <td>{e.warehouse}</td>
                      <td>{e.productName}</td>
                      <td>{e.qtyDelta > 0 ? `+${e.qtyDelta}` : e.qtyDelta}</td>
                      <td>{e.uom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!stockLedgerState.length ? <div className="lot-line">Движений пока нет — проведите приход или отгрузку</div> : null}
            </div>
          ) : null}

          {inventorySubView === 'warehouses' ? (
            <>
              {canManageReceipts ? (
                <div className="form-grid" style={{ marginBottom: 14 }}>
                  <input
                    className="field-input"
                    placeholder="Код (например SKL-NEW)"
                    value={newWarehouse.code}
                    onChange={(v) => setNewWarehouse((s) => ({ ...s, code: v.target.value }))}
                  />
                  <input
                    className="field-input"
                    placeholder="Наименование склада"
                    value={newWarehouse.name}
                    onChange={(v) => setNewWarehouse((s) => ({ ...s, name: v.target.value }))}
                  />
                  <button type="button" className="action-btn slim" onClick={() => addWarehouseCatalog()}>
                    Добавить склад
                  </button>
                </div>
              ) : null}
              <div className="stage-grid">
                {warehousesState.map((w) => (
                  <article className="stage-card" key={w.id}>
                    <div className="stage-head">
                      <strong>{w.name}</strong>
                      <span>{w.code}</span>
                    </div>
                    <div className="lot-line">{w.isActive ? 'Активен' : 'Не используется'}</div>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </section>
      )}

      {navMode === 'sections' && view === 'products' && canManageProducts ? (
        <section className="board">
          <h2>Номенклатура (ID неизменяемый)</h2>
          <div className="form-grid">
            <input
              className="field-input"
              placeholder="Внутренний код (например FC-MESH-999)"
              value={newProduct.internalId}
              onChange={(e) => setNewProduct((s) => ({ ...s, internalId: e.target.value }))}
            />
            <input
              className="field-input"
              placeholder="Название товара"
              value={newProduct.name}
              onChange={(e) => setNewProduct((s) => ({ ...s, name: e.target.value }))}
            />
            <input
              className="field-input"
              placeholder="Категория"
              value={newProduct.category}
              onChange={(e) => setNewProduct((s) => ({ ...s, category: e.target.value }))}
            />
          </div>
          <div className="actions">
            <button className="action-btn slim" type="button" onClick={addProduct}>
              Добавить номенклатуру
            </button>
          </div>
          <div className="stage-grid">
            {productsState.map((product) => (
              <article className="stage-card" key={product.id}>
                <div className="stage-head">
                  <strong>{product.name}</strong>
                  <span>{product.internalId}</span>
                </div>
                <div className="lot-line">Категория: {product.category}</div>
                <div className="lot-line">Ед. изм.: {product.uom}</div>
                <img
                  className="product-image"
                  src={product.imageBase64 || product.imageUrl || 'https://placehold.co/600x400?text=No+Image'}
                  alt={product.name}
                />
                <label className="field-label">Загрузить новое фото (с авто-сжатием)</label>
                <input
                  className="field-input"
                  type="file"
                  accept="image/*"
                  onChange={(e) => updateProductImage(product.id || '', e.target.files?.[0])}
                />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {view === 'dashboard' && canSeeFinance ? (
        <section className="board">
          <h2>Бухгалтерия / финансы</h2>
          <div className="flow-grid">
            <div className="flow-step">Себестоимость партии: в следующем этапе (по сырью + пропитке + труду)</div>
            <div className="flow-step">НЗП: контроль партий между этапами</div>
            <div className="flow-step">Закрытие периода: отчет по выпуску и отгрузке</div>
            <div className="flow-step">Дебиторка: после добавления контрагентов и счетов</div>
            <div className="flow-step">Экспорт в Excel/PDF: следующий этап</div>
          </div>
        </section>
      ) : null}

      {navMode === 'sections' && view === 'hr' && canSeeHr ? (
        <section className="board">
          <h2>
            <Users size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            HR модуль
          </h2>
          <div className="form-grid">
            <input
              className="field-input"
              placeholder="ФИО"
              value={newEmployee.name}
              onChange={(e) => setNewEmployee((s) => ({ ...s, name: e.target.value }))}
            />
            <input
              className="field-input"
              placeholder="Должность"
              value={newEmployee.role}
              onChange={(e) => setNewEmployee((s) => ({ ...s, role: e.target.value }))}
            />
            <select
              className="field-input"
              value={newEmployee.shift}
              onChange={(e) => setNewEmployee((s) => ({ ...s, shift: e.target.value }))}
            >
              <option>День</option>
              <option>Ночь</option>
            </select>
          </div>
          <div className="actions">
            <button className="action-btn slim" type="button" onClick={addEmployee}>
              Добавить сотрудника
            </button>
          </div>
          <div className="stage-grid hr-grid">
            {(employeesState.length ? employeesState : employees).map((emp) => (
              <article className="stage-card" key={emp.id}>
                <div className="stage-head">
                  <strong>{emp.name}</strong>
                  <span>{emp.id}</span>
                </div>
                <div className="lot-line">Роль: {emp.role}</div>
                <div className="lot-line">Смена: {emp.shift}</div>
                <div className="lot-line">Статус: {emp.status}</div>
                {emp.id ? (
                  <div className="actions lot-actions">
                    <button className="action-btn slim ghost" type="button" onClick={() => setEmployeeStatus(emp.id, 'active')}>
                      active
                    </button>
                    <button className="action-btn slim ghost" type="button" onClick={() => setEmployeeStatus(emp.id, 'vacation')}>
                      vacation
                    </button>
                    <button className="action-btn slim ghost" type="button" onClick={() => setEmployeeStatus(emp.id, 'sick')}>
                      sick
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {navMode === 'sections' && view === 'users' && canManageUsers ? (
        <section className="board">
          <h2>Админ: пользователи и разрешения (как в 1С)</h2>
          <div className="form-grid">
            <input
              className="field-input"
              placeholder="Email"
              value={newUser.email}
              onChange={(e) => setNewUser((s) => ({ ...s, email: e.target.value }))}
            />
            <input
              className="field-input"
              type="password"
              placeholder="Пароль"
              value={newUser.password}
              onChange={(e) => setNewUser((s) => ({ ...s, password: e.target.value }))}
            />
            <input
              className="field-input"
              placeholder="Имя"
              value={newUser.name}
              onChange={(e) => setNewUser((s) => ({ ...s, name: e.target.value }))}
            />
            <select
              className="field-input"
              value={newUser.role}
              onChange={(e) => setNewUser((s) => ({ ...s, role: e.target.value as Role }))}
            >
              {Object.entries(roleLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="actions">
            <button className="action-btn slim" type="button" onClick={createSystemUser}>
              Создать пользователя для интерфейса
            </button>
          </div>
          {usersState.map((u) => (
            <div className="lot" key={u.id}>
              <div className="lot-top">
                <b>{u.name}</b>
                <span>
                  {u.email} • {roleLabels[u.role]}
                </span>
              </div>
              <div className="actions lot-actions">
                {Object.entries(resolvePermissions(u.role, u.permissions)).map(([perm, val]) => (
                  <button
                    key={`${u.id}-${perm}`}
                    className={`action-btn slim ghost ${val ? 'active' : ''}`}
                    type="button"
                    onClick={() => togglePermission(u.id || '', perm as keyof PermissionSet, val)}
                  >
                    {perm}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </main>
  )
}

export default App
