/** 投票期間外の告知のみ。画面自体は隠さない */
export function VotingPeriodBanner({ show }: { show: boolean }) {
  if (!show) return null
  return (
    <div
      className="rounded-2xl bg-warn-bg px-3.5 py-3 text-warn"
      role="status"
      data-testid="voting-period-banner"
    >
      ⚠️ 現在は投票期間外です（開発中表示）
    </div>
  )
}
