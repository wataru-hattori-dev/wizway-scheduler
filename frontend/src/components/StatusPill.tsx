import { stripSectionNamePrefix } from '../model/format'
import { progressStatus, SALES_LABEL, salesNamesJoined, statusTone } from '../model/rules'

export function StatusPill({ interview, hasSlots = false, hasSalesOffer = false }) {
  const tone = statusTone(interview, { hasSlots, hasSalesOffer })
  const { label } = progressStatus(interview, { hasSlots, hasSalesOffer })
  return <span className={`pill pill-${tone}`}>{label}</span>
}

const TONE = {
  エンジニア: 'self',
  Mgr: 'mgr',
  営業: 'sales',
  初回参加: 'guest',
}

export function ParticipantList({ section, member, hongoJoins, salesId, assignedOnly = false }) {
  const salesName = salesId ? SALES_LABEL[salesId] : null
  const people = [
    { role: 'エンジニア', name: member.name },
    { role: 'Mgr', name: section.mgr },
  ]
  if (salesName) {
    people.push({ role: '営業', name: salesName })
  } else if (!assignedOnly) {
    people.push({
      role: '営業',
      name: `${salesNamesJoined(' または ')}（確定時に1名）`,
    })
  }
  if (hongoJoins) people.push({ role: '初回参加', name: '本郷' })

  return (
    <ul className="flex list-none flex-wrap gap-3 p-0">
      {people.map((person) => (
        <li key={`${person.role}-${person.name}`}>
          <span className={`avatar tone-${TONE[person.role]}`}>{stripSectionNamePrefix(person.name).slice(0, 2)}</span>
          <span>
            <small>{person.role}</small>
            {person.name}
          </span>
        </li>
      ))}
    </ul>
  )
}
