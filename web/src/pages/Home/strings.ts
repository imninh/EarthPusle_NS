// Home page text in English and Vietnamese. The English text is the reference: existing
// tests read it, so it must not change. Vietnamese terms follow src/i18n/terms.ts.
import { defineStrings } from '../../i18n'

export const HOME_STRINGS = defineStrings(
  {
    eyebrow: 'NASA Space Apps 2026 · Earth system trend detective',
    headlinePre: 'Is that trend real, or ',
    headlineMark: 'a glitch in the data?',
    sub: 'EarthPulse cross-examines 24 years of NASA data: what is changing, where, how much, whether it is significant, and whether a second NASA dataset agrees.',
    audience:
      'For high-school and college students, and anyone curious about our planet: answer a few questions and read the evidence in about a minute.',
    start: 'Start an investigation',
    watch: 'Watch a worked case',
    exploreVariables: 'Explore variables',
    exploreMap: 'Explore the map',
    fineprint: (variables: number, periods: number, q: number) =>
      `${variables} verified variables · ${periods} analysis periods · FDR q < ${q} for “significant”.`,
    stepsLabel: 'How EarthPulse works',
    step1Title: 'Ask',
    step1Body: 'Pick a place and a question.',
    step2Title: 'Read the evidence',
    step2Body: 'Rate, 95% interval, significance.',
    step3Title: 'Cross-examine',
    step3Body: 'Data-quality flag, second dataset.',
    insightsKicker: 'From the real screener file',
    insightsTitle: 'What the data says now',
    sourceLead: (start: string, end: string) => `${start} to ${end} · global land ·`,
    loadError: (message: string) => `Could not load the screener file for Home. ${message}`,
    retry: 'Try again',
    computing: 'Computing headlines from the screener…',
    noCells: 'This screener file has no evaluated cells yet, so there is no headline to show.',
    insightsFootnote:
      'Every number above is computed from the published screener rows, area-weighted over evaluated land cells. A significant trend is evidence to read, not proof of cause.',
    exhibitLabel: (letter: string, kicker: string) => `Exhibit ${letter} · ${kicker}`,
    inspect: 'Inspect evidence',
    globeLoading: 'Loading the globe…',
    globeFailed: 'The globe could not be loaded. The rest of the page still works.',
    globeAria: (label: string, start: string, end: string) =>
      `Globe of the ${label.toLowerCase()} trend, ${start} to ${end}. Warm colours mean significant increase, cool colours significant decrease, yellow marks cells flagged for a sudden shift. One pulse marks each published case.`,
    globeCaption: (label: string, start: string, end: string) => `${label} trend · ${start} to ${end}`,
  },
  {
    eyebrow: 'NASA Space Apps 2026 · Thám tử xu hướng của hệ thống Trái Đất',
    headlinePre: 'Xu hướng đó có thật, hay ',
    headlineMark: 'chỉ là lỗi trong dữ liệu?',
    sub: 'EarthPulse thẩm vấn 24 năm dữ liệu NASA: điều gì đang thay đổi, ở đâu, nhiều đến mức nào, có ý nghĩa thống kê hay không, và bộ dữ liệu NASA thứ hai có đồng ý hay không.',
    audience:
      'Dành cho học sinh, sinh viên và bất kỳ ai tò mò về hành tinh của chúng ta: trả lời vài câu hỏi và đọc bằng chứng trong khoảng một phút.',
    start: 'Bắt đầu điều tra',
    watch: 'Xem một vụ việc mẫu',
    exploreVariables: 'Khám phá các biến',
    exploreMap: 'Khám phá bản đồ',
    fineprint: (variables: number, periods: number, q: number) =>
      `${variables} biến đã kiểm chứng · ${periods} giai đoạn phân tích · FDR q < ${q} cho “có ý nghĩa thống kê”.`,
    stepsLabel: 'EarthPulse hoạt động thế nào',
    step1Title: 'Đặt câu hỏi',
    step1Body: 'Chọn một nơi và một câu hỏi.',
    step2Title: 'Đọc bằng chứng',
    step2Body: 'Tốc độ thay đổi, khoảng tin cậy 95%, ý nghĩa thống kê.',
    step3Title: 'Thẩm vấn',
    step3Body: 'Cờ chất lượng dữ liệu, bộ dữ liệu NASA thứ hai.',
    insightsKicker: 'Từ tệp bảng sàng lọc thật',
    insightsTitle: 'Dữ liệu cho biết điều gì lúc này',
    sourceLead: (start: string, end: string) => `${start} đến ${end} · đất liền toàn cầu ·`,
    loadError: (message: string) => `Không tải được tệp bảng sàng lọc cho trang chủ. ${message}`,
    retry: 'Thử lại',
    computing: 'Đang tính các tiêu đề từ bảng sàng lọc…',
    noCells: 'Tệp bảng sàng lọc này chưa có ô lưới nào được đánh giá, nên chưa có tiêu đề để hiển thị.',
    insightsFootnote:
      'Mọi con số ở trên được tính từ các dòng đã công bố của bảng sàng lọc, có tính trọng số theo diện tích trên các ô lưới đất liền được đánh giá. Một xu hướng có ý nghĩa thống kê là bằng chứng để đọc, không phải chứng minh về nguyên nhân.',
    exhibitLabel: (letter: string, kicker: string) => `Tang vật ${letter} · ${kicker}`,
    inspect: 'Xem bằng chứng',
    globeLoading: 'Đang tải quả địa cầu…',
    globeFailed: 'Không tải được quả địa cầu. Phần còn lại của trang vẫn hoạt động.',
    globeAria: (label: string, start: string, end: string) =>
      `Quả địa cầu về xu hướng của ${label.toLowerCase()}, ${start} đến ${end}. Màu ấm là tăng có ý nghĩa thống kê, màu lạnh là giảm có ý nghĩa thống kê, màu vàng đánh dấu các ô lưới có cờ bước nhảy đột ngột. Mỗi chấm sáng đánh dấu một vụ việc đã công bố.`,
    globeCaption: (label: string, start: string, end: string) => `Xu hướng ${label.toLowerCase()} · ${start} đến ${end}`,
  },
)

/** Generated headline sentences (insights.ts) and the caution entry. */
export const INSIGHT_STRINGS = defineStrings(
  {
    warmingKicker: 'Warming signal',
    warmingUnit: 'of land is warming significantly',
    warmingTitle: (label: string) => `${label} is warming`,
    warmingDetail: (means: string, pct: string, period: string) =>
      `A significant ${means} trend over ${pct} of land, ${period}.`,
    witnessKicker: 'Second witness',
    witnessUnit: 'of this area is contradicted by a second NASA dataset',
    witnessTitle: 'The second witness disagrees',
    witnessDetail: (label: string, pct: string) =>
      `${label}: ${pct} of its significant area is contradicted by an independent NASA dataset, so read the evidence.`,
    breadthKicker: 'Across variables',
    breadthUnit: 'variables show broad significant change',
    breadthTitle: (broad: number, total: number) => `${broad} of ${total} variables show significant change`,
    breadthDetail: (percent: number, period: string) =>
      `Each has a significant increase or decrease over more than ${percent}% of land, ${period}.`,
    decreaseKicker: 'Loss signal',
    decreaseUnit: (label: string) => `of land shows a significant decrease in ${label.toLowerCase()}`,
    decreaseTitle: (label: string) => `${label}: significant decrease`,
    decreaseDetail: (label: string, pct: string, period: string) =>
      `${label} falls significantly over ${pct} of land, ${period}.`,
    contrastKicker: 'Regional contrast',
    contrastUnit: 'contrast score, 0 to 0.5',
    contrastTitle: (label: string) => `${label} changes in both directions`,
    contrastDetail: (up: string, down: string) =>
      `${up} of land increases and ${down} decreases. The score is near 0.5 when both directions cover similar area.`,
    qualityLine: (pct: string) => `${pct} of this area shows a sudden shift; read the evidence`,
    witnessLine: (pct: string) => `${pct} confirmed by a second NASA dataset`,
    cautionPlaceFallback: 'this place',
    cautionTitle: (place: string) => `Look closer: ${place}`,
  },
  {
    warmingKicker: 'Tín hiệu ấm lên',
    warmingUnit: 'diện tích đất liền đang ấm lên có ý nghĩa thống kê',
    warmingTitle: (label: string) => `${label} đang ấm lên`,
    warmingDetail: (means: string, pct: string, period: string) =>
      `Xu hướng ${means} có ý nghĩa thống kê trên ${pct} diện tích đất liền, giai đoạn ${period}.`,
    witnessKicker: 'Bộ dữ liệu NASA thứ hai',
    witnessUnit: 'diện tích này bị bộ dữ liệu NASA thứ hai phản bác',
    witnessTitle: 'Bộ dữ liệu NASA thứ hai không đồng ý',
    witnessDetail: (label: string, pct: string) =>
      `${label}: ${pct} diện tích có ý nghĩa thống kê bị một bộ dữ liệu NASA độc lập phản bác, nên hãy đọc kỹ bằng chứng.`,
    breadthKicker: 'Qua nhiều biến',
    breadthUnit: 'biến có thay đổi rộng và có ý nghĩa thống kê',
    breadthTitle: (broad: number, total: number) => `${broad} trên ${total} biến có thay đổi có ý nghĩa thống kê`,
    breadthDetail: (percent: number, period: string) =>
      `Mỗi biến có xu hướng tăng hoặc giảm có ý nghĩa thống kê trên hơn ${percent}% diện tích đất liền, giai đoạn ${period}.`,
    decreaseKicker: 'Tín hiệu suy giảm',
    decreaseUnit: (label: string) => `diện tích đất liền có ${label.toLowerCase()} giảm có ý nghĩa thống kê`,
    decreaseTitle: (label: string) => `${label}: giảm có ý nghĩa thống kê`,
    decreaseDetail: (label: string, pct: string, period: string) =>
      `${label} giảm có ý nghĩa thống kê trên ${pct} diện tích đất liền, giai đoạn ${period}.`,
    contrastKicker: 'Tương phản giữa các vùng',
    contrastUnit: 'điểm tương phản, từ 0 đến 0.5',
    contrastTitle: (label: string) => `${label} thay đổi theo cả hai hướng`,
    contrastDetail: (up: string, down: string) =>
      `${up} diện tích đất liền tăng và ${down} giảm. Điểm số gần 0.5 khi hai hướng phủ diện tích tương đương.`,
    qualityLine: (pct: string) => `${pct} diện tích này có bước nhảy đột ngột; hãy đọc kỹ bằng chứng`,
    witnessLine: (pct: string) => `${pct} được xác nhận bởi bộ dữ liệu NASA thứ hai`,
    cautionPlaceFallback: 'nơi này',
    cautionTitle: (place: string) => `Nhìn kỹ hơn: ${place}`,
  },
)
