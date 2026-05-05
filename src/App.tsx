import { AlertTriangle, CheckCircle2, Factory, PackageCheck, Truck } from 'lucide-react'

type Stage = 'raw' | 'impregnation' | 'qc' | 'warehouse' | 'shipment'

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

const stageLabels: Record<Stage, string> = {
  raw: 'Сырьё',
  impregnation: 'Пропитка',
  qc: 'Контроль качества',
  warehouse: 'Склад',
  shipment: 'Отгрузка',
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

function App() {
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

      <section className="board">
        <h2>Доска партий по этапам</h2>
        <div className="stage-grid">
          {stageCounts.map((stage) => (
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
    </main>
  )
}

export default App
