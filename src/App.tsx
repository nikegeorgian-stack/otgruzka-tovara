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

type Stage = 'raw' | 'impregnation' | 'qc' | 'warehouse' | 'shipment'
type Role = 'admin' | 'line' | 'qc' | 'warehouse' | 'logistics' | 'accounting' | 'hr'
type ViewKey =
  | 'dashboard'
  | 'documents'
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
  const [documentsState, setDocumentsState] = useState<ErpDocumentBase[]>([])
  const [docCategoryFilter, setDocCategoryFilter] = useState<DocJournalCategory>('all')
  const [docStatusFilter, setDocStatusFilter] = useState<'all' | DocStatus>('all')
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)

  const [newDocPn, setNewDocPn] = useState({
    supplierId: '',
    productId: '',
    qtyRolls: 0,
    meters: 0,
    warehouse: 'Склад сырья',
    docDate: new Date().toISOString().slice(0, 10),
    comment: '',
  })
  const [newDocPm, setNewDocPm] = useState({
    lotId: '',
    warehouseFrom: '',
    warehouseTo: '',
    docDate: new Date().toISOString().slice(0, 10),
    comment: '',
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

  const [usersState, setUsersState] = useState<UserProfile[]>([])
  const [employeesState, setEmployeesState] = useState<HrEmployee[]>([])
  const [authLoading, setAuthLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeStageFilter, setActiveStageFilter] = useState<'all' | Stage>('all')
  const [view, setView] = useState<ViewKey>('dashboard')
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
  const canSeeDocuments = !!currentUser && currentUser.permissions.documents
  const canWriteDocuments =
    !!currentUser &&
    currentUser.permissions.documents &&
    ['admin', 'warehouse', 'logistics', 'accounting'].includes(currentUser.role)

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
    await addDoc(collection(db, 'rolls'), {
      rollCode,
      runId: run.id,
      productId: run.productId,
      productName: run.productName,
      lengthM: newRoll.lengthM,
      widthMm: newRoll.widthMm,
      status: 'awaiting_qc',
      createdAt: serverTimestamp(),
    })
    await logAction('roll.create', { runId: run.id, rollCode, lengthM: newRoll.lengthM, widthMm: newRoll.widthMm })
    setNewRoll({ runId: '', lengthM: 50, widthMm: 1000 })
  }

  async function setRollQcStatus(rollId: string, status: ProducedRoll['status']) {
    if (!canManageQc && !canManageRuns) return
    await updateDoc(doc(db, 'rolls', rollId), { status, updatedAt: serverTimestamp() })
    await logAction('roll.qc.status', { rollId, status })
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
        warehouse: 'Склад ГП',
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
          const wh = (d.warehouse || 'Склад сырья').trim()
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
          const rollCodes: string[] = []
          for (const id of rollIds) {
            const rRef = doc(db, 'rolls', id)
            const rs = await tx.get(rRef)
            if (!rs.exists()) throw new Error('roll_missing')
            const data = rs.data() as ProducedRoll
            if (data.status !== 'approved') throw new Error('roll_not_available')
            rollCodes.push(data.rollCode)
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
    } catch {
      await updateDoc(doc(db, 'documents', documentId), {
        postingError: 'Проверьте статусы рулонов и заполнение полей',
        updatedAt: serverTimestamp(),
      }).catch(() => {})
      setError('Не удалось провести документ. Для отгрузки нужны только approved рулоны.')
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
          warehouseLocation: 'Склад сырья',
          note: `${newReceipt.note.trim() || 'Поступление'} | ${number}`,
          createdAt: serverTimestamp(),
          createdBy: firebaseUser.uid,
        })
        tx.set(erpDocRef, {
          kind: 'incoming',
          journalCategory: defaultJournalCategory('incoming'),
          number,
          status: 'posted',
          docDate: new Date().toISOString().slice(0, 10),
          warehouse: 'Склад сырья',
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
    await runTransaction(db, async (tx) => {
      for (const roll of selectedRolls) {
        const rollRef = doc(db, 'rolls', roll.id || '')
        const rollSnap = await tx.get(rollRef)
        if (!rollSnap.exists()) throw new Error('roll_missing')
        const data = rollSnap.data() as ProducedRoll
        if (data.status !== 'approved') throw new Error('roll_not_available')
      }
      tx.set(shipmentRef, {
        customer: newShipment.customer.trim(),
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
        <div className="actions view-tabs">
          {(
            [
              ['dashboard', 'Дашборд', PackageCheck],
              ['documents', 'Документы', FolderOpen],
              ['lots', 'Партии', Factory],
              ['runs', 'Запуски MES', Factory],
              ['rolls', 'Рулоны', PackageCheck],
              ['qc', 'Контроль качества', CheckCircle2],
              ['inventory', 'Остатки', Boxes],
              ['suppliers', 'Поставщики', Users],
              ['receipts', 'Поступления', ClipboardList],
              ['orders', 'Заказы/резервы', ClipboardList],
              ['shipping', 'Паллеты/отгрузка', Truck],
              ['trace', 'Traceability', Search],
              ['products', 'Номенклатура', ImagePlus],
              ['hr', 'HR', Users],
              ['users', 'Пользователи', ShieldCheck],
            ] as Array<[ViewKey, string, typeof PackageCheck]>
          ).map(([key, label, Icon]) => {
            const allowed =
              key === 'dashboard' ||
              (key === 'documents' && canSeeDocuments) ||
              (key === 'lots' && currentUser.permissions.lots) ||
              (key === 'runs' && currentUser.permissions.runs) ||
              (key === 'rolls' && currentUser.permissions.rolls) ||
              (key === 'qc' && currentUser.permissions.qc) ||
              (key === 'inventory' && currentUser.permissions.inventory) ||
              (key === 'suppliers' && canManageSuppliers) ||
              (key === 'receipts' && canManageReceipts) ||
              (key === 'orders' && currentUser.permissions.orders) ||
              (key === 'shipping' && canManageShipping && (currentUser.role === 'admin' || currentUser.role === 'warehouse' || currentUser.role === 'logistics')) ||
              (key === 'trace' && currentUser.permissions.dashboard) ||
              (key === 'products' && currentUser.permissions.products) ||
              (key === 'hr' && currentUser.permissions.hr) ||
              (key === 'users' && currentUser.permissions.users)
            if (!allowed) return null
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
      </section>

      {view === 'documents' && canSeeDocuments ? (
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
                        {d.contractorName || '—'}{' '}
                        {d.kind === 'movement' ? `(${d.warehouseFrom || '?'}→${d.warehouseTo || '?'})` : ''}
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
              <h3 style={{ marginTop: 22 }}>Создание документов (черновик)</h3>
              <div className="doc-forms-grid">
                <article className="stage-card">
                  <div className="stage-head">
                    <strong>Приходная (ПН)</strong>
                  </div>
                  <select
                    className="field-input"
                    value={newDocPn.supplierId}
                    onChange={(e) => setNewDocPn((s) => ({ ...s, supplierId: e.target.value }))}
                  >
                    <option value="">Поставщик</option>
                    {suppliersState
                      .filter((s) => s.status === 'active')
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                  <select
                    className="field-input"
                    value={newDocPn.productId}
                    onChange={(e) => setNewDocPn((s) => ({ ...s, productId: e.target.value }))}
                  >
                    <option value="">Номенклатура</option>
                    {productsState.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.internalId} — {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="field-input"
                    placeholder="Рулоны"
                    value={newDocPn.qtyRolls || ''}
                    onChange={(e) => setNewDocPn((s) => ({ ...s, qtyRolls: Number(e.target.value) }))}
                  />
                  <input
                    type="number"
                    className="field-input"
                    placeholder="Метры (учётный коммент.)"
                    value={newDocPn.meters || ''}
                    onChange={(e) => setNewDocPn((s) => ({ ...s, meters: Number(e.target.value) }))}
                  />
                  <input
                    className="field-input"
                    placeholder="Склад приёмки"
                    value={newDocPn.warehouse}
                    onChange={(e) => setNewDocPn((s) => ({ ...s, warehouse: e.target.value }))}
                  />
                  <input
                    type="date"
                    className="field-input"
                    value={newDocPn.docDate}
                    onChange={(e) => setNewDocPn((s) => ({ ...s, docDate: e.target.value }))}
                  />
                  <input
                    className="field-input"
                    placeholder="Комментарий"
                    value={newDocPn.comment}
                    onChange={(e) => setNewDocPn((s) => ({ ...s, comment: e.target.value }))}
                  />
                  <button type="button" className="action-btn slim" onClick={() => createDraftPnDocument()}>
                    Создать черновик ПН
                  </button>
                </article>

                <article className="stage-card">
                  <div className="stage-head">
                    <strong>Перемещение (ПМ)</strong>
                  </div>
                  <select
                    className="field-input"
                    value={newDocPm.lotId}
                    onChange={(e) => setNewDocPm((s) => ({ ...s, lotId: e.target.value }))}
                  >
                    <option value="">Партия (lot)</option>
                    {lotsState.map((l) => (
                      <option key={l.id} value={l.id}>
                        {(l.id || '').slice(0, 18)} • {l.product} • {l.rolls} рул.
                      </option>
                    ))}
                  </select>
                  <input
                    className="field-input"
                    placeholder="Склад отправитель"
                    value={newDocPm.warehouseFrom}
                    onChange={(e) => setNewDocPm((s) => ({ ...s, warehouseFrom: e.target.value }))}
                  />
                  <input
                    className="field-input"
                    placeholder="Склад получатель"
                    value={newDocPm.warehouseTo}
                    onChange={(e) => setNewDocPm((s) => ({ ...s, warehouseTo: e.target.value }))}
                  />
                  <input type="date" className="field-input" value={newDocPm.docDate} onChange={(e) => setNewDocPm((s) => ({ ...s, docDate: e.target.value }))} />
                  <input className="field-input" placeholder="Комментарий" value={newDocPm.comment} onChange={(e) => setNewDocPm((s) => ({ ...s, comment: e.target.value }))} />
                  <button type="button" className="action-btn slim" onClick={() => createDraftPmDocument()}>
                    Создать черновик ПМ
                  </button>
                </article>

                <article className="stage-card">
                  <div className="stage-head">
                    <strong>Заказ клиента (ЗК)</strong>
                  </div>
                  <input
                    className="field-input"
                    placeholder="Клиент"
                    value={newDocZk.customer}
                    onChange={(e) => setNewDocZk((s) => ({ ...s, customer: e.target.value }))}
                  />
                  <select
                    className="field-input"
                    value={newDocZk.productId}
                    onChange={(e) => setNewDocZk((s) => ({ ...s, productId: e.target.value }))}
                  >
                    <option value="">Номенклатура</option>
                    {productsState.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="field-input"
                    placeholder="Количество, рул."
                    value={newDocZk.qty || ''}
                    onChange={(e) => setNewDocZk((s) => ({ ...s, qty: Number(e.target.value) }))}
                  />
                  <input type="date" className="field-input" value={newDocZk.docDate} onChange={(e) => setNewDocZk((s) => ({ ...s, docDate: e.target.value }))} />
                  <input className="field-input" placeholder="Комментарий" value={newDocZk.comment} onChange={(e) => setNewDocZk((s) => ({ ...s, comment: e.target.value }))} />
                  <button type="button" className="action-btn slim" onClick={() => createDraftZkDocument()}>
                    Создать черновик ЗК
                  </button>
                </article>

                <article className="stage-card">
                  <div className="stage-head">
                    <strong>Отгрузка (ОТГ)</strong>
                  </div>
                  <input
                    className="field-input"
                    placeholder="Клиент"
                    value={newDocOtg.customer}
                    onChange={(e) => setNewDocOtg((s) => ({ ...s, customer: e.target.value }))}
                  />
                  <input type="date" className="field-input" value={newDocOtg.docDate} onChange={(e) => setNewDocOtg((s) => ({ ...s, docDate: e.target.value }))} />
                  <div className="lot-line">Выберите рулоны (только approved):</div>
                  <div className="actions" style={{ flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto' }}>
                    {rollsState
                      .filter((r) => r.status === 'approved')
                      .map((roll) => (
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
                  <button type="button" className="action-btn slim" onClick={() => createDraftOtgDocument()}>
                    Создать черновик ОТГ
                  </button>
                </article>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      {view === 'lots' && canCreateLots ? (
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

      {view === 'dashboard' && canSeeFlow ? (
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

      {view === 'lots' && canSeeLots ? (
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

      {view === 'runs' && canManageRuns ? (
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

      {view === 'rolls' && canManageRolls ? (
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

      {view === 'qc' && canManageQc ? (
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

      {view === 'orders' && canManageOrders ? (
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

      {view === 'suppliers' && canManageSuppliers ? (
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

      {view === 'receipts' && canManageReceipts ? (
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

      {view === 'shipping' && canManageShipping ? (
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

      {view === 'trace' ? (
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

      {view === 'inventory' && (
        <section className="board">
          <h2>Интерфейс менеджера: остатки готовой продукции и резервы</h2>
          <div className="stage-grid">
            {productsState.map((product) => {
              const ready = readyByProduct[product.id || ''] || 0
              const reserved = reservationsByProduct[product.id || ''] || 0
              const free = Math.max(0, ready - reserved)
              return (
                <article className="stage-card" key={product.id}>
                  <div className="stage-head">
                    <strong>{product.name}</strong>
                    <span>{product.internalId}</span>
                  </div>
                  <div className="lot-line">Готово: {ready} рул.</div>
                  <div className="lot-line">В резерве: {reserved} рул.</div>
                  <div className="lot-line">Свободно: {free} рул.</div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {view === 'products' && canManageProducts ? (
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

      {view === 'hr' && canSeeHr ? (
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

      {view === 'users' && canManageUsers ? (
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
