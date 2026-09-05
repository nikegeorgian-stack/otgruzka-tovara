import { FiberCellBrand } from '@/components/brand/FiberCellBrand'

export type ProtocolAckBlankData = {
  organization: string
  protocolNumber: string
  meetingAtLabel: string
  topic: string
  itemSortOrder: number
  decision: string
  assignmentText: string
  assigneeName: string
  dueDateLabel: string
  controllerName: string
  secretaryNote?: string
  printedAt: string
}

/** Бланк ознакомления с поручением (A4 portrait). */
export function ProtocolAckBlankSheet({ data }: { data: ProtocolAckBlankData }) {
  return (
    <div className="protocol-ack-print-page print-sheet-page mx-auto max-w-[210mm] bg-white p-8 text-stone-900">
      <header className="mb-6 flex items-start justify-between gap-4 border-b border-stone-300 pb-4">
        <FiberCellBrand variant="print" />
        <div className="text-right text-xs text-stone-600">
          <div className="font-semibold text-stone-800">{data.organization || '—'}</div>
          <div className="mt-1">{data.printedAt}</div>
        </div>
      </header>

      <h1 className="mb-4 text-center text-base font-bold uppercase tracking-wide">
        Бланк ознакомления с поручением
      </h1>

      <table className="mb-4 w-full border-collapse text-sm">
        <tbody>
          <tr className="border-b border-stone-200">
            <th className="w-[34%] py-1.5 pr-2 text-left font-medium text-stone-500">
              № протокола
            </th>
            <td className="py-1.5 font-semibold">{data.protocolNumber}</td>
          </tr>
          <tr className="border-b border-stone-200">
            <th className="py-1.5 pr-2 text-left font-medium text-stone-500">Дата совещания</th>
            <td className="py-1.5">{data.meetingAtLabel}</td>
          </tr>
          <tr className="border-b border-stone-200">
            <th className="py-1.5 pr-2 text-left font-medium text-stone-500">Тема</th>
            <td className="py-1.5">{data.topic || '—'}</td>
          </tr>
          <tr className="border-b border-stone-200">
            <th className="py-1.5 pr-2 text-left font-medium text-stone-500">Пункт №</th>
            <td className="py-1.5">{data.itemSortOrder}</td>
          </tr>
          <tr className="border-b border-stone-200">
            <th className="py-1.5 pr-2 text-left font-medium text-stone-500 align-top">Решение</th>
            <td className="py-1.5 whitespace-pre-wrap">{data.decision || '—'}</td>
          </tr>
          <tr className="border-b border-stone-200">
            <th className="py-1.5 pr-2 text-left font-medium text-stone-500 align-top">
              Поручение
            </th>
            <td className="py-1.5 whitespace-pre-wrap">{data.assignmentText || '—'}</td>
          </tr>
          <tr className="border-b border-stone-200">
            <th className="py-1.5 pr-2 text-left font-medium text-stone-500">Исполнитель</th>
            <td className="py-1.5">{data.assigneeName}</td>
          </tr>
          <tr className="border-b border-stone-200">
            <th className="py-1.5 pr-2 text-left font-medium text-stone-500">Срок</th>
            <td className="py-1.5">{data.dueDateLabel || '—'}</td>
          </tr>
          <tr className="border-b border-stone-200">
            <th className="py-1.5 pr-2 text-left font-medium text-stone-500">Контролёр</th>
            <td className="py-1.5">{data.controllerName || '—'}</td>
          </tr>
          {data.secretaryNote ? (
            <tr className="border-b border-stone-200">
              <th className="py-1.5 pr-2 text-left font-medium text-stone-500 align-top">
                Примечание секретаря
              </th>
              <td className="py-1.5 whitespace-pre-wrap">{data.secretaryNote}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <p className="mb-8 text-sm text-stone-700">
        Настоящим подтверждаю, что с содержанием поручения ознакомлен(а) и обязуюсь выполнить его
        в установленный срок.
      </p>

      <div className="mt-10 grid gap-8 text-sm sm:grid-cols-2">
        <div>
          <div className="mb-8 border-b border-stone-400 pb-1 text-stone-500">
            Дата ознакомления
          </div>
          <div className="h-8" />
        </div>
        <div>
          <div className="mb-8 border-b border-stone-400 pb-1 text-stone-500">
            Подпись исполнителя / расшифровка
          </div>
          <div className="h-8" />
        </div>
      </div>
    </div>
  )
}
