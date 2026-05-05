import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Factory, PackageCheck, ShieldCheck, Truck, Users } from 'lucide-react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase'

type Stage = 'raw' | 'impregnation' | 'qc' | 'warehouse' | 'shipment'
type Role = 'admin' | 'line' | 'qc' | 'warehouse' | 'logistics' | 'accounting' | 'hr'

type Lot = {
  id: string
  supplier: string
  material: string
  product: string
  widthMm: number
  gsm: number
  rolls: number
  meters: number
  stage: Stage
  note?: string
}

type HrEmployee = {
  id: string
  name: string
  role: string
  shift: string
  status: 'active' | 'vacation' | 'sick'
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

const bootstrapByEmail: Record<string, { role: Role; name: string }> = {
  'admin@otgruzka.local': { role: 'admin', name: 'Системный админ' },
  'line@otgruzka.local': { role: 'line', name: 'Технолог линии' },
  'qc@otgruzka.local': { role: 'qc', name: 'Инженер ОТК' },
  'warehouse@otgruzka.local': { role: 'warehouse', name: 'Кладовщик' },
  'logistics@otgruzka.local': { role: 'logistics', name: 'Логист' },
  'accounting@otgruzka.local': { role: 'accounting', name: 'Бухгалтер' },
  'hr@otgruzka.local': { role: 'hr', name: 'HR менеджер' },
}

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

const employees: HrEmployee[] = [
  { id: 'EMP-001', name: 'Георгий Л.', role: 'Оператор линии', shift: 'День', status: 'active' },
  { id: 'EMP-002', name: 'Ника Ч.', role: 'ОТК', shift: 'День', status: 'vacation' },
  { id: 'EMP-003', name: 'Ираклий С.', role: 'Склад', shift: 'Ночь', status: 'active' },
  { id: 'EMP-004', name: 'Мариам Д.', role: 'Логистика', shift: 'День', status: 'sick' },
]

function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null)
  const [currentUser, setCurrentUser] = useState<{ role: Role; name: string } | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [error, setError] = useState('')

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
          const data = snap.data() as { role: Role; name: string }
          setCurrentUser({ role: data.role, name: data.name })
        } else {
          const fallback = bootstrapByEmail[user.email || '']
          if (!fallback) {
            setError('Для пользователя нет роли в системе. Обратитесь к администратору.')
            await signOut(auth)
          } else {
            await setDoc(ref, { email: user.email, role: fallback.role, name: fallback.name, active: true })
            setCurrentUser(fallback)
          }
        }
      } catch {
        setError('Ошибка загрузки профиля пользователя.')
      } finally {
        setAuthLoading(false)
      }
    })
    return () => unsub()
  }, [])

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

  const totals = lots.reduce(
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
    const count = lots.filter((lot) => lot.stage === key).length
    return { key, label: stageLabels[key], count }
  })

  const canSeeFlow = currentUser && currentUser.role !== 'hr'
  const canSeeLots = currentUser && currentUser.role !== 'hr'
  const canSeeFinance = currentUser && (currentUser.role === 'admin' || currentUser.role === 'accounting')
  const canSeeHr = currentUser && (currentUser.role === 'admin' || currentUser.role === 'hr')

  async function handleLogin() {
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password.trim())
    } catch {
      setError('Неверный логин или пароль')
    }
  }

  async function logout() {
    await signOut(auth)
    setCurrentUser(null)
    setFirebaseUser(null)
    setEmail('')
    setPassword('')
    setError('')
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
          <label className="field-label">Email</label>
          <input className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} />
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

      {canSeeFlow ? (
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

      {canSeeLots ? (
        <section className="board">
          <h2>Партии по этапам ({roleLabels[currentUser.role]})</h2>
          <div className="stage-grid">
            {stageCounts
              .filter((stage) => allowedStages.includes(stage.key))
              .map((stage) => (
                <article className="stage-card" key={stage.key}>
                  <div className="stage-head">
                    <strong>{stage.label}</strong>
                    <span>{stage.count}</span>
                  </div>
                  {lots
                    .filter((lot) => lot.stage === stage.key)
                    .map((lot) => (
                      <div className="lot" key={lot.id}>
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
                      </div>
                    ))}
                </article>
              ))}
          </div>
        </section>
      ) : null}

      {canSeeFinance ? (
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

      {canSeeHr ? (
        <section className="board">
          <h2>
            <Users size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            HR модуль
          </h2>
          <div className="stage-grid hr-grid">
            {employees.map((emp) => (
              <article className="stage-card" key={emp.id}>
                <div className="stage-head">
                  <strong>{emp.name}</strong>
                  <span>{emp.id}</span>
                </div>
                <div className="lot-line">Роль: {emp.role}</div>
                <div className="lot-line">Смена: {emp.shift}</div>
                <div className="lot-line">Статус: {emp.status}</div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}

export default App
