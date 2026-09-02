import { newId } from '@/lib/hr/files'
import type { CandidateQuestionnaire, CandidateQuestionnaireItem } from './types'

/** Вопросы шаблона «Анкета кандидата Fibercell» (HR заполняет ответы сама). */
export const FIBERCELL_QUESTIONNAIRE_TEMPLATE: { key: string; question: string }[] = [
  {
    key: 'fio',
    question: '1. Фамилия, имя, отчество / გვარი, სახელი, მამის სახელი',
  },
  {
    key: 'birthDate',
    question: '2. Число, месяц и год рождения / დაბადების წელი, თვე და რიცხვი',
  },
  {
    key: 'birthPlace',
    question: '3. Место рождения / დაბადების ადგილი',
  },
  {
    key: 'citizenship',
    question: '4. Гражданство, ВНЖ, ПМЖ / მოქალაქეობა, ბინადრობის უფლება',
  },
  {
    key: 'entryDate',
    question: '5. Дата въезда в страну (для иностранца) / ქვეყანაში შემოსვლის თარიღი',
  },
  {
    key: 'nameChange',
    question:
      '6. Если изменяли ФИО — когда, где и почему / თუ შეცვლილი გაქვთ გვარი/სახელი — რატომ და სად',
  },
  {
    key: 'regAddress',
    question: '7. Адрес регистрации / მისამართი სადაც ხართ ჩაწერილი',
  },
  {
    key: 'factAddress',
    question: '8. Адрес фактического проживания / ფაქტიური საცხოვრებელი მისამართი',
  },
  {
    key: 'phone',
    question:
      '9. Мобильный, WhatsApp, Telegram (ник) + телефон члена семьи / მობილური, WhatsApp, Telegram + ოჯახის წევრის ნომერი',
  },
  {
    key: 'personalId',
    question: '10. Личный номер / паспортные данные / პირადი ნომერი',
  },
  {
    key: 'passport',
    question: '11. Загранпаспорт (наличие, номер) / პასპორტის ნომერი',
  },
  {
    key: 'education',
    question:
      '12. Образование (годы, учебное заведение, факультет, форма, квалификация) / განათლება',
  },
  {
    key: 'languages',
    question:
      '13. Владение языками (грузинский / русский / английский — устный и письменный) / უცხო ენები',
  },
  {
    key: 'computer',
    question: '14. Владение ПК / программами (напр. Microsoft Office) / კომპიუტერული პროგრამები',
  },
  {
    key: 'career',
    question: '15. Профессиональная деятельность (должность, обязанности) / პროფესიული საქმიანობა',
  },
  {
    key: 'sideJob',
    question: '16. Работаете ли по совместительству? / მუშაობთ თუ არა შეთავსებით',
  },
  {
    key: 'business',
    question:
      '17. Являетесь ли учредителем или руководителем коммерческой структуры? / კომერციული სტრუქტურის დამფუძნებელი/ხელმძღვანელი',
  },
  {
    key: 'familyStatus',
    question: '18. Семейное положение / ოჯახური მდგომარეობა',
  },
  {
    key: 'relativesHere',
    question:
      '19. Есть ли родственники, работающие в нашей организации? / ნათესავი ჩვენს ორგანიზაციაში',
  },
  {
    key: 'credits',
    question: '20. Финансовые обязательства, займы, кредиты / ფინანსური ვალდებულებები, კრედიტები',
  },
  {
    key: 'military',
    question: '21. Служба в ВС, воинское звание / სამხედრო სამსახური, წოდება',
  },
  {
    key: 'health',
    question:
      '22. Ограничения по здоровью, аллергия и т.п. / შეზღუდვა ჯანმრთელობის მდგომარეობის მიზეზით',
  },
  {
    key: 'driver',
    question:
      '23. Водительское удостоверение (категория), наличие авто / მართვის უფლება, საკუთარი ავტომობილი',
  },
  {
    key: 'personal',
    question:
      '24. Личные качества, навыки которые хотите приобрести, хобби, сильные и слабые стороны / პიროვნული თვისებები, ჰობი, ძლიერი/სუსტი მხარეები',
  },
  {
    key: 'plans5y',
    question: '25. Профессиональные планы на ближайшие 5 лет / პროფესიული გეგმები 5 წელიწადში',
  },
  {
    key: 'dislikePrev',
    question:
      '26. Что не нравилось на предыдущей работе (зарплата, коллектив, рост, сверхурочные…) / რა არ მოგწონდათ წინა სამსახურში',
  },
  {
    key: 'disagreeBoss',
    question:
      '27. Ситуация несогласия с руководителем; реакция на публичное замечание / უთანხმოება ხელმძღვანელთან, საჯარო შენიშვნა',
  },
  {
    key: 'skipBoss',
    question:
      '33. Когда допустимо обращаться к вышестоящему, минуя непосредственного? / უფროსის გვერდის ავლით',
  },
  {
    key: 'jobMeaning',
    question: '34. Что для вас значит получение этой работы? / რას ნიშნავს აქ სამსახურის დაწყება',
  },
]

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

export function createEmptyQuestionnaireItem(question = ''): CandidateQuestionnaireItem {
  return { id: newId(), question, answer: '' }
}

export function createQuestionnaireFromTemplate(
  seed?: Partial<CandidateQuestionnaire>,
): CandidateQuestionnaire {
  const now = new Date().toISOString()
  const byKey = new Map(
    (seed?.items ?? [])
      .filter((i) => i.templateKey)
      .map((i) => [i.templateKey!, i] as const),
  )
  const items: CandidateQuestionnaireItem[] = FIBERCELL_QUESTIONNAIRE_TEMPLATE.map((t) => {
    const prev = byKey.get(t.key)
    return {
      id: prev?.id ?? newId(),
      templateKey: t.key,
      question: prev?.question?.trim() ? prev.question : t.question,
      answer: prev?.answer ?? '',
    }
  })
  // сохранить кастомные вопросы HR (без templateKey)
  for (const item of seed?.items ?? []) {
    if (!item.templateKey) {
      items.push({
        id: item.id || newId(),
        question: item.question ?? '',
        answer: item.answer ?? '',
      })
    }
  }
  return {
    filledAt: seed?.filledAt || todayYmd(),
    interviewerNote: seed?.interviewerNote ?? '',
    consent: seed?.consent ?? false,
    items,
    updatedAt: now,
  }
}

export function normalizeQuestionnaire(raw: unknown): CandidateQuestionnaire | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const itemsRaw = Array.isArray(r.items) ? r.items : []
  const items: CandidateQuestionnaireItem[] = itemsRaw.flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const x = row as Record<string, unknown>
    const item: CandidateQuestionnaireItem = {
      id: typeof x.id === 'string' && x.id ? x.id : newId(),
      question: typeof x.question === 'string' ? x.question : '',
      answer: typeof x.answer === 'string' ? x.answer : '',
    }
    if (typeof x.templateKey === 'string') item.templateKey = x.templateKey
    return [item]
  })

  if (items.length === 0 && !r.filledAt && !r.interviewerNote) return undefined

  return {
    filledAt: typeof r.filledAt === 'string' ? r.filledAt : undefined,
    interviewerNote: typeof r.interviewerNote === 'string' ? r.interviewerNote : undefined,
    consent: r.consent === true,
    items,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
  }
}

export function questionnaireAnsweredCount(q: CandidateQuestionnaire | undefined): number {
  if (!q) return 0
  return q.items.filter((i) => i.answer.trim()).length
}
