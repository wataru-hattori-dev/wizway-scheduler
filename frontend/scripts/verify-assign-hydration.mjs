/**
 * 静的 MEMBERS が空でも、レジストリ水和後に自動割当を紐づけられることを検証する。
 * 実行: node --experimental-strip-types は使わず、ロジックを JS で再現。
 */

function stripSectionNamePrefix(name) {
  const raw = String(name || '')
  const stripped = raw.replace(/^(?:.+セクション|Section\s+\w+)-/, '')
  return stripped || raw
}

function surnameOf(member) {
  if (member?.surname) return member.surname
  return stripSectionNamePrefix(String(member?.name || '')) || '—'
}

// --- strip tests ---
const stripCases = [
  ['Section A-Engineer02', 'Engineer02'],
  ['目黒セクション-鉄井', '鉄井'],
  ['NoPrefix', 'NoPrefix'],
  ['', ''],
]
for (const [input, expected] of stripCases) {
  const got = stripSectionNamePrefix(input)
  if (got !== expected) {
    console.error('strip fail', { input, expected, got })
    process.exit(1)
  }
}

// --- hydration linkage (HongoScheduleCalendar collect 相当) ---
const staticMembers = [] // API 本番ビルド相当
const registry = [
  {
    id: 2,
    surname: 'Engineer02',
    sectionId: 'meguro',
    name: 'Section A-Engineer02',
    role: 'engineer',
    isInterviewer: true,
  },
  {
    id: 9,
    surname: 'Engineer09',
    sectionId: 'meguro',
    name: 'Section A-Engineer09',
    role: 'engineer',
    isInterviewer: true,
  },
  {
    id: 3,
    surname: 'MgrA',
    sectionId: 'meguro',
    name: 'Section A-MgrA',
    role: 'mgr',
    isInterviewer: true,
  },
]

const assignments = new Map([
  [2, { start: '2026-12-01T11:00:00+09:00', salesId: 'salesA', day: '2026-12-01', hour: 11 }],
  [9, { start: '2026-12-01T14:00:00+09:00', salesId: 'salesB', day: '2026-12-01', hour: 14 }],
])

function collectWith(list) {
  const out = []
  for (const member of list.filter((m) => m.isInterviewer !== false)) {
    const assigned = assignments.get(member.id)
    if (!assigned?.start) continue
    out.push({
      memberId: member.id,
      surname: surnameOf(member),
      salesId: assigned.salesId,
    })
  }
  return out
}

const broken = collectWith(staticMembers)
const fixed = collectWith(registry)

if (broken.length !== 0) {
  console.error('expected static MEMBERS path to yield 0', broken)
  process.exit(1)
}
if (fixed.length !== 2) {
  console.error('expected registry path to yield 2', fixed)
  process.exit(1)
}
if (fixed[0].salesId !== 'salesA' || fixed[1].salesId !== 'salesB') {
  console.error('sales linkage mismatch', fixed)
  process.exit(1)
}
if (fixed[0].surname !== 'Engineer02' || fixed[1].surname !== 'Engineer09') {
  console.error('surname display mismatch', fixed)
  process.exit(1)
}

console.log('verify-assign-hydration: ok')
console.log(JSON.stringify({ brokenCount: broken.length, fixed }, null, 2))
