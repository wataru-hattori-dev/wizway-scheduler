import assert from 'node:assert/strict'
import { HOURS } from './calendar'
import { candidateDays, candidateSlots, sharedOpenDays } from './candidates'
import { createInitialState } from './seed'

const state = createInitialState()
const openDays = (sectionId) => candidateDays(state, sectionId).filter((day) => day.open).map((day) => day.iso)

assert.deepEqual(sharedOpenDays(state).map((day) => day.iso), [
  '2026-12-01',
  '2026-12-02',
  '2026-12-04',
  '2026-12-07',
  '2026-12-08',
  '2026-12-09',
  '2026-12-10',
  '2026-12-11',
  '2026-12-14',
  '2026-12-16',
  '2026-12-17',
  '2026-12-18',
])
assert.deepEqual(openDays('meguro'), [
  '2026-12-02',
  '2026-12-04',
  '2026-12-07',
  '2026-12-08',
  '2026-12-10',
  '2026-12-11',
  '2026-12-14',
  '2026-12-16',
  '2026-12-18',
])
assert.deepEqual(openDays('yamamoto'), [
  '2026-12-01',
  '2026-12-04',
  '2026-12-07',
  '2026-12-08',
  '2026-12-09',
  '2026-12-11',
  '2026-12-14',
  '2026-12-16',
  '2026-12-17',
])
assert.deepEqual(openDays('ishibashi'), [
  '2026-12-01',
  '2026-12-02',
  '2026-12-04',
  '2026-12-07',
  '2026-12-08',
  '2026-12-09',
  '2026-12-10',
  '2026-12-16',
  '2026-12-17',
  '2026-12-18',
])
assert.deepEqual(openDays('tanaka'), [
  '2026-12-01',
  '2026-12-04',
  '2026-12-07',
  '2026-12-08',
  '2026-12-09',
  '2026-12-10',
  '2026-12-11',
  '2026-12-16',
  '2026-12-17',
  '2026-12-18',
])
assert.deepEqual(openDays('hamada'), [
  '2026-12-01',
  '2026-12-02',
  '2026-12-04',
  '2026-12-08',
  '2026-12-09',
  '2026-12-10',
  '2026-12-11',
  '2026-12-14',
  '2026-12-16',
  '2026-12-18',
])

const meguroSlots = candidateSlots(state, 'meguro')
assert.equal(meguroSlots.length, 9 * HOURS.length)
assert.equal(meguroSlots[0].start, '2026-12-02T10:00:00+09:00')
assert.equal(meguroSlots.some((slot) => slot.start === '2026-12-04T13:00:00+09:00'), false)
assert.equal(meguroSlots.some((slot) => slot.avoided && slot.start.endsWith('T10:00:00+09:00')), true)

const narrowed = {
  ...state,
  hourVotes: {
    meguro: { '2026-12-04': [11, 14] },
    hongo: { '2026-12-04': [14, 15] },
  },
}
const narrowedDay = candidateSlots(narrowed, 'meguro').filter((slot) => slot.day === '2026-12-04')
assert.deepEqual(narrowedDay.map((slot) => slot.start), ['2026-12-04T14:00:00+09:00'])

const withoutHongo = { ...state, hongoJoins: false }
assert.equal(candidateDays(state, 'meguro').some((day) => day.open && day.iso === '2026-12-15'), false)
assert.ok(candidateDays(withoutHongo, 'meguro').some((day) => day.open && day.iso === '2026-12-15'))

console.log('candidates.selfcheck: ok')
