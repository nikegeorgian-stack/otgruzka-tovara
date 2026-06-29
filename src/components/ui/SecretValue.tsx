import { useState } from 'react'

import { useI18n } from '@/context/I18nContext'

import { EyeIcon, EyeOffIcon } from '@/components/ui/icons'



/**

 * Скрытое значение «как спойлер в Telegram»: размыто, пока не нажмёшь.

 * Повторное нажатие снова прячет.

 */

export function SecretValue({

  value,

  placeholder = '•••••',

  className = '',

}: {

  value: string

  placeholder?: string

  className?: string

}) {

  const { t } = useI18n()

  const [shown, setShown] = useState(false)



  return (

    <button

      type="button"

      onClick={(e) => {

        e.stopPropagation()

        setShown((v) => !v)

      }}

      title={shown ? t('common.hide') : t('common.reveal')}

      className={`inline-flex items-center gap-1 rounded-sm transition ${className}`}

    >

      {shown ? (

        <span className="font-medium text-ink">{value}</span>

      ) : (

        <span

          className="select-none rounded-sm bg-stone-200/70 px-2 text-transparent blur-[3px]"

          aria-hidden

        >

          {value || placeholder}

        </span>

      )}

      <span className="text-stone-400">{shown ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}</span>

    </button>

  )

}

