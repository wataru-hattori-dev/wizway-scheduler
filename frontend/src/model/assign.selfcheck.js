import assert from 'node:assert/strict'
import { assignSection } from './assign'

const slots = [
  { id: 'a1', start: '2026-11-16T10:00:00+09:00' },
  { id: 'a2', start: '2026-11-16T14:00:00+09:00' },
  { id: 'a4', start: '2026-11-18T15:00:00+09:00' },
  { id: 'a5', start: '2026-11-19T11:00:00+09:00' },
  { id: 'a6', start: '2026-11-20T10:00:00+09:00' },
]

const base = [
  {
    id: 'takahashi',
    status: 'adjusting',
    submittedAt: '2026-10-20T09:12:00+09:00',
    confirmedSlotId: null,
    votes: { a1: 'first', a2: 'ok', a4: 'ok' },
  },
  {
    id: 'suzuki',
    status: 'adjusting',
    submittedAt: '2026-10-21T11:03:00+09:00',
    confirmedSlotId: null,
    votes: { a1: 'first', a4: 'ok', a5: 'ok' },
  },
  {
    id: 'sato',
    status: 'adjusting',
    submittedAt: '2026-10-22T18:40:00+09:00',
    confirmedSlotId: null,
    votes: { a6: 'first', a2: 'ok', a5: 'ok' },
  },
  {
    id: 'yamada',
    status: 'adjusting',
    submittedAt: null,
    confirmedSlotId: null,
    votes: {},
  },
  {
    id: 'kato',
    status: 'unadjusted',
    submittedAt: null,
    confirmedSlotId: null,
    votes: {},
  },
]

const answered = assignSection({ slots, members: base, assignUnanswered: false })
const byId = Object.fromEntries(answered.assignments.map((item) => [item.memberId, item]))

assert.equal(byId.takahashi.slotId, 'a1')
assert.equal(byId.takahashi.salesId, 'salesA')
assert.match(byId.takahashi.reason, /第一希望で確定/)
assert.equal(byId.suzuki.slotId, 'a4')
assert.match(byId.suzuki.reason, /〇枠へスライド/)
assert.equal(byId.sato.slotId, 'a6')
assert.equal(answered.assignments.some((item) => item.memberId === 'yamada'), false)
assert.equal(answered.assignments.some((item) => item.memberId === 'kato'), false)

const full = assignSection({ slots, members: base, assignUnanswered: true })
assert.equal(full.assignments.some((item) => item.memberId === 'yamada'), true)
assert.equal(full.assignments.some((item) => item.memberId === 'kato'), false)
assert.notEqual(
  full.assignments.find((item) => item.memberId === 'yamada').slotId,
  'a1',
)

const held = assignSection({
  slots,
  assignUnanswered: true,
  members: base.map((member) =>
    member.id === 'takahashi'
      ? {
          ...member,
          status: 'confirmed',
          confirmedSlotId: 'a1',
          confirmedSalesId: 'salesA',
          submittedAt: '2026-10-01T00:00:00+09:00',
        }
      : member,
  ),
})
assert.equal(held.assignments.some((item) => item.memberId === 'takahashi'), false)
assert.notEqual(held.assignments.find((item) => item.memberId === 'suzuki')?.slotId, 'a1')

const unique = assignSection({
  slots,
  assignUnanswered: false,
  members: [
    {
      id: 'a',
      status: 'adjusting',
      submittedAt: '2026-10-02T00:00:00+09:00',
      votes: { a1: 'first', a2: 'ok', a4: 'ok' },
    },
    {
      id: 'b',
      status: 'adjusting',
      submittedAt: '2026-10-03T00:00:00+09:00',
      votes: { a6: 'first', a5: 'ok', a4: 'ok' },
    },
  ],
})
assert.deepEqual(
  unique.assignments.map((item) => item.reason),
  ['第一希望で確定（Sales A担当）', '第一希望で確定（Sales A担当）'],
)

const salesConflict = assignSection({
  slots,
  assignUnanswered: false,
  salesOffers: {
    takahashi: { a1: ['salesA'], a2: ['salesA'], a4: ['salesA'] },
    suzuki: { a1: ['salesA'], a2: ['salesA'], a4: ['salesA'], a5: ['salesA'] },
  },
  members: [
    {
      id: 'takahashi',
      status: 'adjusting',
      submittedAt: '2026-10-20T09:12:00+09:00',
      votes: { a1: 'first', a2: 'ok', a4: 'ok' },
    },
    {
      id: 'suzuki',
      status: 'adjusting',
      submittedAt: '2026-10-21T11:03:00+09:00',
      votes: { a1: 'first', a2: 'ok', a4: 'ok' },
    },
  ],
})
assert.equal(salesConflict.assignments.find((item) => item.memberId === 'takahashi').slotId, 'a1')
assert.equal(salesConflict.assignments.find((item) => item.memberId === 'suzuki').slotId, 'a2')
assert.equal(salesConflict.assignments.every((item) => item.salesId === 'salesA'), true)

console.log('assign.selfcheck: ok')
