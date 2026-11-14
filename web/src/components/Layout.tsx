import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../data/AppState'
import type { Page } from '../data/types'
import { LANGS, defineStrings, useLang, useStrings } from '../i18n'
import { CoachMark, shouldShowCoach } from './ui'
import { VariableSelect, WindowSelect } from './VariableSelect'

const VIEW_IDS: Extract<Page, 'home' | 'investigate' | 'screener' | 'discovery' | 'story' | 'method'>[] = ['home', 'investigate', 'screener', 'discovery', 'story', 'method']

export const STRINGS = defineStrings(
  {
    home: 'Home',
    investigate: 'Investigate',
    screener: 'Variables',
    discovery: 'Map',
    story: 'Cases',
    method: 'How it works',
    tourOpen: 'Open the guided tour',
    tourTitle: 'Guided tour',
    skip: 'Skip to content',
    synthetic: '{s.synthetic}',
    views: 'Views',
    dataControls: 'Data controls',
    language: 'Language',
    footerData:
      "Data: NASA GES DISC (GLDAS-2.1, GPM IMERG). Map coastlines: Natural Earth. Method: Sen's slope + Hamed–Rao Mann–Kendall with FDR correction.",
    footerNote: 'Not a verdict: a significant trend is evidence to read, not proof of cause.',
  },
  {
    home: 'Trang chủ',
    investigate: 'Điều tra',
    screener: 'Các biến',
    discovery: 'Bản đồ',
    story: 'Vụ việc',
    method: 'Cách hoạt động',
    tourOpen: 'Mở phần hướng dẫn',
    tourTitle: 'Hướng dẫn nhanh',
    skip: 'Chuyển đến nội dung chính',
    synthetic: 'DỮ LIỆU GIẢ LẬP: bản thử nghiệm, không phải kết quả của NASA',
    views: 'Các trang',
    dataControls: 'Chọn dữ liệu',
    language: 'Ngôn ngữ',
    footerData:
      'Dữ liệu: NASA GES DISC (GLDAS-2.1, GPM IMERG). Đường bờ biển trên bản đồ: Natural Earth. Phương pháp: độ dốc Sen + kiểm định Mann–Kendall Hamed–Rao, có kiểm soát tỷ lệ phát hiện giả (FDR).',
    footerNote: 'Đây không phải phán quyết: xu hướng có ý nghĩa thống kê là bằng chứng để đọc, không phải bằng chứng về nguyên nhân.',
  },
)

export function Layout({ children }: { children: ReactNode }) {
  const { index, page, setPage } = useApp()
  const s = useStrings(STRINGS)
  const { lang, setLang } = useLang()
  // The first-visit coach mark belongs on Home only. A deep link must never be
  // covered by it, even when the dismissal flag has not been stored yet.
  const [coachOpen, setCoachOpen] = useState(() => page === 'home' && shouldShowCoach())
  const helpButtonRef = useRef<HTMLButtonElement>(null)
  const showVariable = page === 'discovery' || page === 'region'
  const showPeriod = page === 'screener' || page === 'discovery' || page === 'region'
  const showContextBar = showVariable || showPeriod

  // Leaving Home closes an auto-opened tour; the "?" button can still open it
  // deliberately on any page.
  useEffect(() => {
    if (page !== 'home') setCoachOpen(false)
  }, [page])

  // One help button. With a context bar it lives there; otherwise it stays in the night
  // header so the guided tour is reachable on every page.
  const helpButton = (
    <button
      ref={helpButtonRef}
      type="button"
      className={showContextBar ? 'help-button' : 'help-button help-button--night'}
      onClick={() => setCoachOpen(true)}
      aria-label={s.tourOpen}
      title={s.tourTitle}
    >
      ?
    </button>
  )

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {s.skip}
      </a>
      {index.synthetic && (
        <div className="synthetic-banner" role="alert">
          {s.synthetic}
        </div>
      )}
      <header className="app-header">
        <button type="button" className="brand" onClick={() => setPage('home')}>
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-orbit" />
            <span className="brand-planet" />
          </span>
          <span className="brand-text">
            <strong>EarthPulse</strong>
          </span>
        </button>

        <nav className="tabs" aria-label={s.views}>
          {VIEW_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={id === page ? 'tab active' : 'tab'}
              onClick={() => setPage(id)}
              aria-current={id === page ? 'page' : undefined}
            >
              {s[id]}
            </button>
          ))}
        </nav>

        <div className="header-tools">
          <div className="lang-switch" role="group" aria-label={s.language}>
            {LANGS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="lang-switch__button"
                lang={entry.id}
                title={entry.name}
                aria-pressed={entry.id === lang}
                onClick={() => setLang(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {showContextBar ? null : helpButton}
        </div>
      </header>
      {showContextBar ? (
        <div className="context-bar">
          <div className="context-bar-inner">
            <div className="controls" role="group" aria-label={s.dataControls}>
              {showVariable ? <VariableSelect /> : null}
              {showPeriod ? <WindowSelect /> : null}
            </div>
            {helpButton}
          </div>
        </div>
      ) : null}
      <main id="main" className="app-main" tabIndex={-1}>
        {children}
      </main>
      <footer className="app-footer">
        <span>{s.footerData}</span>
        <span>{s.footerNote}</span>
        <button type="button" className="button ghost" onClick={() => setPage('method')}>
          {s.method}
        </button>
      </footer>
      <CoachMark
        open={coachOpen}
        onClose={() => setCoachOpen(false)}
        returnFocusRef={helpButtonRef}
      />
    </div>
  )
}
