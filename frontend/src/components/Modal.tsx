import { useEffect, useRef } from 'react'

export function Modal({ title, children, onClose, footer, closeDisabled = false }) {
  const ref = useRef(null)
  const onCloseRef = useRef(onClose)
  const closeDisabledRef = useRef(closeDisabled)
  onCloseRef.current = onClose
  closeDisabledRef.current = closeDisabled

  const requestClose = () => {
    if (closeDisabledRef.current) return
    onCloseRef.current()
  }

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', onKey)
    const previously = document.activeElement
    const timer = setTimeout(() => {
      ref.current?.querySelector('input, textarea, select, button')?.focus()
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('keydown', onKey)
      if (previously instanceof HTMLElement) previously.focus()
    }
  }, [])

  return (
    <div className="modal-back" onMouseDown={requestClose}>
      <div
        className="modal max-h-[min(90vh,720px)] w-[min(560px,calc(100vw-24px))] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={ref}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button
            type="button"
            className="icon-btn disabled:opacity-40"
            onClick={requestClose}
            aria-label="閉じる"
            disabled={closeDisabled}
          >
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  )
}
