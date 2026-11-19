import { useState } from 'react'
import { businessDays, HOURS } from '../model/calendar'
import { formatDate } from '../model/format'

const DAY_MARKS = [
  { id: 'first', label: '◎', className: 'is-first' },
  { id: 'ok', label: '〇', className: 'is-ok' },
  { id: 'ng', label: '×', className: 'is-ng' },
]

const SYMBOL = { first: '◎', ok: '〇', ng: '×' }

function hourLabel(hour) {
  return `${String(hour).padStart(2, '0')}:00`
}

function selectedHours(hours, day) {
  const picked = hours?.[day]
  if (!Array.isArray(picked)) return HOURS.map((item) => item.hour)
  return picked
}

function hourSummary(picked) {
  if (picked.length === HOURS.length) return '終日'
  if (picked.length === 0) return '時間なし'
  return [...picked].sort((a, b) => a - b).map(hourLabel).join('、')
}

export function DayVoteList({ votes, hours, onChange, onHours, disabled }) {
  const [openDay, setOpenDay] = useState(null)

  return (
    <ul className="m-0 list-none p-0">
      {businessDays().map((day) => {
        const mark = votes?.[day.iso] || null
        const picked = selectedHours(hours, day.iso)
        const open = openDay === day.iso
        return (
          <li key={day.iso}>
            <div className="day-vote-main">
              <strong>{formatDate(day.iso)}</strong>
              <span className="flex flex-wrap gap-1.5">
                {DAY_MARKS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={mark === item.id ? `btn btn-small ${item.className}` : 'btn btn-ghost btn-small'}
                    disabled={disabled}
                    aria-pressed={mark === item.id}
                    onClick={() => onChange(day.iso, item.id)}
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  disabled={disabled || !mark}
                  onClick={() => onChange(day.iso, null)}
                >
                  取り消す
                </button>
              </span>
              <small>{SYMBOL[mark] || '未投票'}</small>
            </div>
            <div className="day-detail">
              <button
                type="button"
                className="btn btn-ghost btn-small"
                aria-expanded={open}
                disabled={disabled}
                onClick={() => setOpenDay(open ? null : day.iso)}
              >
                細かく設定
              </button>
              <small>{hourSummary(picked)}</small>
              {open ? (
                <div className="hour-panel" role="group" aria-label={`${formatDate(day.iso)}の時間`}>
                  {HOURS.map((hour) => {
                    const on = picked.includes(hour.hour)
                    return (
                      <button
                        key={hour.hour}
                        type="button"
                        className={on ? 'btn btn-small is-on' : 'btn btn-ghost btn-small'}
                        aria-pressed={on}
                        disabled={disabled}
                        onClick={() => {
                          const next = on
                            ? picked.filter((item) => item !== hour.hour)
                            : [...picked, hour.hour]
                          onHours?.(day.iso, next)
                        }}
                      >
                        {hourLabel(hour.hour)}{hour.avoided ? ' 避' : ''}
                      </button>
                    )
                  })}
                  <p className="text-sm text-muted">選んだ時間だけを空きにします。全部選ぶと終日です。×の日は時間を選んでも候補に入りません。</p>
                </div>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
