// Every user-visible string of the Investigate page, in English and Vietnamese.
// English is the reference (existing tests read it); Vietnamese uses the shared terms
// in src/i18n/terms.ts. Product, method and dataset names stay as published.
import { defineStrings } from '../../i18n'

/** The six verdict meanings; the English words come from the shared verdict vocabulary. */
export type VerdictKind = 'strongIncrease' | 'strongDecrease' | 'caution' | 'notYet' | 'noClear' | 'notEnough'

export type FixedTopicId = 'heat' | 'rain' | 'drought' | 'moisture' | 'all'

function capitalised(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1)
}

/** Vietnamese direction phrases keyed by the registry's `increase_means`. */
const VI_DIRECTION: Record<string, { up: string; down: string }> = {
  warmer: { up: 'ấm lên', down: 'lạnh đi' },
  wetter: { up: 'ẩm hơn', down: 'khô hơn' },
  'more humid': { up: 'ẩm hơn', down: 'khô hơn' },
  'more ozone': { up: 'nhiều ô-dôn hơn', down: 'ít ô-dôn hơn' },
  'more water vapour': { up: 'nhiều hơi nước hơn', down: 'ít hơi nước hơn' },
  'more evaporation': { up: 'bốc hơi nhiều hơn', down: 'bốc hơi ít hơn' },
}

const VI_CATEGORY: Record<string, string> = {
  atmosphere: 'Khí quyển',
  temperature: 'Nhiệt độ',
  water: 'Nước',
}

const EN = {
  // Page head
  eyebrow: 'Investigate',
  title: 'Start an investigation',
  promise:
    'Answer three short questions and get a ranked shortlist of NASA variables for that place and period. Every number comes from the published data; nothing is estimated in your browser.',

  // Question 1
  q1Label: '1 · Where',
  q1Title: 'Where do you want to look?',
  q1Help: 'Pick a country, a published region, or the whole world. The answer uses only land cells with data.',
  searchPlaceholder: 'Search a country or region',
  worldButton: 'The whole world (land)',
  lookingAtBefore: 'Looking at ',
  lookingAtAfter: '.',
  suggestLabel: 'Or start from a place with a published worked example:',
  worldLabel: 'the whole world',

  // Question 2
  q2Label: '2 · What',
  q2Title: 'What are you curious about?',
  q2Help: 'Choose one topic. You can change it at any time.',
  topicCount: (count: number): string => (count === 1 ? '1 variable' : `${count} variables`),
  whySummary: 'Why these variables?',
  whyIntro:
    'Each topic is a fixed list written in the code. A variable appears only when this data export contains it; anything new appears under a card named after its category and under “Show me everything”.',
  whyAllTitle: 'Show me everything',
  whyAllBody: 'every variable listed above.',

  // Question 3
  q3Label: '3 · When',
  q3Title: 'Which years?',
  q3Help: 'Each period was analysed separately; longer records see slower changes.',
  windowNotes: {
    '2001-2024': 'The full record: 24 years, best for slow changes.',
    '2001-2012': 'The first half: compare it with the recent period.',
    '2013-2024': 'The recent period: what changed in the last twelve years.',
  } as Record<string, string>,
  windowNoteFallback: (id: string): string => `Published analysis period ${id}.`,

  // Answer area
  answerKicker: 'Report',
  answerTitle: 'What the evidence says',
  reportKicker: 'Country report',
  productsAria: 'NASA products used',
  doi: 'DOI',
  doiNotListed: 'DOI not listed',
  print: 'Print this report',
  copyLink: 'Copy link',
  downloadImage: 'Download image',
  linkCopied: 'Link copied.',
  linkFailed: 'Could not copy the link. Copy it from the address bar.',
  imageDone: 'Image downloaded.',
  imageFailed: (message: string): string => `Could not create the image. ${message}`,
  loadingAria: (place: string, years: string): string =>
    `Loading the published screener file for ${place} and ${years}`,
  loadError: (place: string, years: string, error: string): string =>
    `Could not load the screener file for ${place} and ${years}. ${error}`,
  tryAgain: 'Try again',
  noDataLabel: 'No data for this selection',
  notPublished: (place: string, years: string): string =>
    `No screener file is published for ${place} in ${years}. The whole-world answer is still available.`,
  noRows: (place: string): string => `This period has no evaluated rows for ${place} in these topics.`,
  tryWorld: 'Try the whole world',
  exampleAria: 'Worked example',
  exampleCaution: 'Published caution case',
  exampleFinding: 'Published finding',
  exampleNote: 'A worked example from the same published data, chosen for this place or these variables.',
  exampleButton: 'Watch a worked example',

  // Cards
  barAria: (increase: string, decrease: string): string =>
    `Significant increase ${increase}, significant decrease ${decrease}, the rest not significant`,
  numIncrease: (percent: string): string => `▲ ${percent} increase`,
  numDecrease: (percent: string): string => `▼ ${percent} decrease`,
  howSummary: 'How do we know?',
  openEvidence: 'Open the evidence',
  openEvidenceAria: (label: string): string => `Open the evidence for ${label}`,
  seeOnMap: 'See it on the map',
  seeOnMapAria: (label: string): string => `See it on the map: ${label}`,
  rule: (place: string, years: string): string =>
    `Ordered by the share of land with a significant change (increase + decrease), largest first. Each share is the area-weighted fraction of evaluated land cells in the published screener file for ${place} and ${years}.`,

  // Topics (model)
  topics: {
    heat: { label: 'Heat', blurb: 'How warm the air and the land surface are.' },
    rain: { label: 'Rain', blurb: 'How much rain and snow reaches the ground.' },
    drought: { label: 'Drought and soil water', blurb: 'Water stored in the soil, and how much evaporates.' },
    moisture: { label: 'Air moisture', blurb: 'How much water vapour the near-surface air carries.' },
    all: { label: 'Show me everything', blurb: 'Every published variable, one card each.' },
  } as Record<FixedTopicId, { label: string; blurb: string }>,
  categoryLabel: (category: string): string =>
    category.trim() === '' ? 'Other' : category.charAt(0).toUpperCase() + category.slice(1),
  categoryBlurb: (label: string): string => `Other ${label.toLowerCase()} variables published in this export.`,

  // Card wording (model)
  landGlobal: 'global land',
  landCountry: (label: string): string => `${label}'s land`,
  landRegion: (plain: string): string => `the ${plain}`,
  /** Direction phrase from the registry's `increase_means`; "falling" for a decrease. */
  dirPhrase: (means: string, direction: 'increase' | 'decrease'): string =>
    direction === 'decrease' ? 'falling' : means.trim() || 'rising',
  verdictLabel: (kind: VerdictKind, dir: string): string => {
    switch (kind) {
      case 'strongIncrease':
      case 'strongDecrease':
        return `${capitalised(dir)}, strong evidence`
      case 'caution':
        return 'Read with caution'
      case 'notYet':
        return 'A direction, not yet significant'
      case 'noClear':
        return 'No clear trend'
      default:
        return 'Not enough data'
    }
  },
  headlineStrong: (dir: string, percent: string, land: string): string =>
    `${dir} over ${percent} of ${land}, strong evidence`,
  headlineCaution: (dir: string, percent: string, land: string): string =>
    `${dir} over ${percent} of ${land}, read with caution`,
  headlineNotYet: (verdict: string, dirLower: string, percent: string, land: string): string =>
    `${verdict}: ${dirLower} over ${percent} of ${land}`,
  headlineNone: (verdict: string, land: string): string => `${verdict} across ${land}`,
  cautionFlagged: (percent: string): string =>
    `Sudden-shift flags cover ${percent} of the area with a significant trend: possible data discontinuity; read the trend with caution.`,
  cautionContradicted: (percent: string): string =>
    `An independent NASA dataset points the opposite way over ${percent} of the significant area: read the trend with caution.`,
  witnessNote: (percent: string): string => `${percent} confirmed by a second NASA dataset`,
  notYetNote: 'A direction is visible, but the evidence is not strong enough yet; a longer record can change this.',

  // Report header (report.ts)
  reportCredit: 'Report generated from NASA data by EarthPulse',
  reportLimitation: 'A country figure is an area-weighted summary of 1° grid cells.',
  exportDate: (day: number, month: number, year: string): string =>
    `${day} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]} ${year}`,
  exportLine: (date: string): string => `Data export of ${date}`,
  exportLineMissing: 'Data export date not available',
  productText: (productAndVersion: string, doi: string | null): string =>
    `${productAndVersion} · ${doi ? `DOI ${doi}` : 'DOI not listed'}`,
  summaryNone: 'No variable is shown for this selection.',
  summaryNoSignificant: (total: number, place: string): string =>
    `None of the ${total} variables shown has a significant change over a broad area of ${place}.`,
  summarySome: (significant: number, total: number, place: string): string =>
    `${significant} of ${total} variables shown ${significant === 1 ? 'has' : 'have'} a significant change over a broad area of ${place}.`,
  /** The Vietnamese line for Vietnam, shown only on the English page. */
  localLine: 'Báo cáo cho Việt Nam: xem bằng chứng, cảnh báo dữ liệu và bộ dữ liệu NASA thứ hai.',

  // Downloadable image (image.ts)
  imageKicker: 'EARTHPULSE · COUNTRY REPORT',
  imageLegend: 'Warm = increase, cool = decrease.',
  imageNoCanvas: 'Canvas is not available in this browser.',
  imageNoBlob: 'The browser could not create the image.',
}

type PageStrings = typeof EN

const VI: PageStrings = {
  eyebrow: 'Điều tra',
  title: 'Bắt đầu một cuộc điều tra',
  promise:
    'Trả lời ba câu hỏi ngắn để nhận danh sách rút gọn, có xếp hạng, các biến NASA cho địa điểm và giai đoạn bạn chọn. Mọi con số đều lấy từ dữ liệu đã công bố; trình duyệt của bạn không ước tính gì cả.',

  q1Label: '1 · Ở đâu',
  q1Title: 'Bạn muốn xem ở đâu?',
  q1Help:
    'Chọn một quốc gia, một vùng đã công bố, hoặc toàn thế giới. Kết quả chỉ dùng các ô lưới đất liền có dữ liệu.',
  searchPlaceholder: 'Tìm một quốc gia hoặc vùng',
  worldButton: 'Toàn thế giới (đất liền)',
  lookingAtBefore: 'Đang xem ',
  lookingAtAfter: '.',
  suggestLabel: 'Hoặc bắt đầu từ một nơi đã có ví dụ minh họa được công bố:',
  worldLabel: 'toàn thế giới',

  q2Label: '2 · Điều gì',
  q2Title: 'Bạn tò mò về điều gì?',
  q2Help: 'Chọn một chủ đề. Bạn có thể đổi bất cứ lúc nào.',
  topicCount: (count: number): string => `${count} biến`,
  whySummary: 'Vì sao có những biến này?',
  whyIntro:
    'Mỗi chủ đề là một danh sách cố định được viết trong mã nguồn. Một biến chỉ xuất hiện khi bản xuất dữ liệu này có biến đó; biến mới sẽ xuất hiện dưới thẻ mang tên nhóm của nó và dưới “Xem tất cả”.',
  whyAllTitle: 'Xem tất cả',
  whyAllBody: 'mọi biến được liệt kê ở trên.',

  q3Label: '3 · Khi nào',
  q3Title: 'Những năm nào?',
  q3Help: 'Mỗi giai đoạn được phân tích riêng; chuỗi dữ liệu càng dài thì càng thấy được những thay đổi chậm.',
  windowNotes: {
    '2001-2024': 'Toàn bộ chuỗi dữ liệu: 24 năm, phù hợp nhất để thấy những thay đổi chậm.',
    '2001-2012': 'Nửa đầu: hãy so sánh với giai đoạn gần đây.',
    '2013-2024': 'Giai đoạn gần đây: điều gì đã thay đổi trong mười hai năm qua.',
  },
  windowNoteFallback: (id: string): string => `Giai đoạn phân tích đã công bố ${id}.`,

  answerKicker: 'Báo cáo',
  answerTitle: 'Bằng chứng cho thấy điều gì',
  reportKicker: 'Báo cáo quốc gia',
  productsAria: 'Các sản phẩm NASA đã dùng',
  doi: 'DOI',
  doiNotListed: 'Chưa có DOI trong danh mục',
  print: 'In báo cáo này',
  copyLink: 'Sao chép liên kết',
  downloadImage: 'Tải ảnh xuống',
  linkCopied: 'Đã sao chép liên kết.',
  linkFailed: 'Không sao chép được liên kết. Hãy sao chép từ thanh địa chỉ.',
  imageDone: 'Đã tải ảnh xuống.',
  imageFailed: (message: string): string => `Không tạo được ảnh. ${message}`,
  loadingAria: (place: string, years: string): string =>
    `Đang tải tệp bảng sàng lọc biến đã công bố cho ${place}, giai đoạn ${years}`,
  loadError: (place: string, years: string, error: string): string =>
    `Không tải được tệp bảng sàng lọc biến cho ${place}, giai đoạn ${years}. ${error}`,
  tryAgain: 'Thử lại',
  noDataLabel: 'Không có dữ liệu cho lựa chọn này',
  notPublished: (place: string, years: string): string =>
    `Chưa có tệp bảng sàng lọc biến nào được công bố cho ${place}, giai đoạn ${years}. Kết quả cho toàn thế giới vẫn xem được.`,
  noRows: (place: string): string => `Giai đoạn này không có dòng dữ liệu nào được đánh giá cho ${place} trong các chủ đề này.`,
  tryWorld: 'Thử với toàn thế giới',
  exampleAria: 'Ví dụ minh họa',
  exampleCaution: 'Hồ sơ vụ việc cần đọc thận trọng đã công bố',
  exampleFinding: 'Phát hiện đã công bố',
  exampleNote:
    'Một ví dụ minh họa từ chính dữ liệu đã công bố, được chọn theo địa điểm hoặc các biến này.',
  exampleButton: 'Xem một ví dụ minh họa',

  barAria: (increase: string, decrease: string): string =>
    `Tăng có ý nghĩa thống kê ${increase}, giảm có ý nghĩa thống kê ${decrease}, phần còn lại chưa có ý nghĩa thống kê`,
  numIncrease: (percent: string): string => `▲ ${percent} tăng`,
  numDecrease: (percent: string): string => `▼ ${percent} giảm`,
  howSummary: 'Chúng ta biết bằng cách nào?',
  openEvidence: 'Mở bằng chứng',
  openEvidenceAria: (label: string): string => `Mở bằng chứng cho ${label}`,
  seeOnMap: 'Xem trên bản đồ',
  seeOnMapAria: (label: string): string => `Xem trên bản đồ: ${label}`,
  rule: (place: string, years: string): string =>
    `Sắp xếp theo tỷ lệ diện tích đất liền có thay đổi có ý nghĩa thống kê (tăng + giảm), từ lớn nhất xuống. Mỗi tỷ lệ là phần diện tích đất liền được đánh giá, tính theo trọng số diện tích, trong tệp bảng sàng lọc biến đã công bố cho ${place}, giai đoạn ${years}.`,

  topics: {
    heat: { label: 'Độ nóng', blurb: 'Không khí và bề mặt đất nóng đến mức nào.' },
    rain: { label: 'Mưa', blurb: 'Lượng mưa và tuyết rơi xuống mặt đất.' },
    drought: { label: 'Hạn hán và nước trong đất', blurb: 'Lượng nước tích trữ trong đất và lượng nước bốc hơi.' },
    moisture: { label: 'Độ ẩm không khí', blurb: 'Lượng hơi nước mà không khí gần mặt đất chứa.' },
    all: { label: 'Xem tất cả', blurb: 'Mọi biến đã công bố, mỗi biến một thẻ.' },
  },
  categoryLabel: (category: string): string => {
    const trimmed = category.trim()
    if (trimmed === '') return 'Khác'
    return VI_CATEGORY[trimmed.toLowerCase()] ?? capitalised(trimmed)
  },
  categoryBlurb: (label: string): string =>
    `Các biến khác thuộc nhóm ${label.toLowerCase()} được công bố trong bản xuất dữ liệu này.`,

  landGlobal: 'diện tích đất liền toàn cầu',
  landCountry: (label: string): string => `diện tích đất liền của ${label}`,
  landRegion: (plain: string): string => `diện tích vùng ${plain}`,
  dirPhrase: (means: string, direction: 'increase' | 'decrease'): string => {
    const known = VI_DIRECTION[means.trim().toLowerCase()]
    if (known) return direction === 'decrease' ? known.down : known.up
    return direction === 'decrease' ? 'giảm' : 'tăng'
  },
  verdictLabel: (kind: VerdictKind, dir: string): string => {
    switch (kind) {
      case 'strongIncrease':
      case 'strongDecrease':
        return `${capitalised(dir)}, bằng chứng mạnh`
      case 'caution':
        return 'ĐỌC THẬN TRỌNG'
      case 'notYet':
        return 'Có một hướng thay đổi, chưa có ý nghĩa thống kê'
      case 'noClear':
        return 'Chưa thấy xu hướng rõ ràng'
      default:
        return 'Chưa đủ dữ liệu'
    }
  },
  headlineStrong: (dir: string, percent: string, land: string): string =>
    `${dir} trên ${percent} ${land}, bằng chứng mạnh`,
  headlineCaution: (dir: string, percent: string, land: string): string =>
    `${dir} trên ${percent} ${land}, đọc thận trọng`,
  headlineNotYet: (verdict: string, dirLower: string, percent: string, land: string): string =>
    `${verdict}: ${dirLower} trên ${percent} ${land}`,
  headlineNone: (verdict: string, land: string): string => `${verdict} trên ${land}`,
  cautionFlagged: (percent: string): string =>
    `Cờ bước nhảy đột ngột phủ ${percent} diện tích có xu hướng có ý nghĩa thống kê: có thể dữ liệu bị gián đoạn; hãy đọc xu hướng một cách thận trọng.`,
  cautionContradicted: (percent: string): string =>
    `Bộ dữ liệu NASA thứ hai cho kết quả ngược chiều trên ${percent} diện tích có ý nghĩa thống kê: hãy đọc xu hướng một cách thận trọng.`,
  witnessNote: (percent: string): string => `${percent} được xác nhận bởi bộ dữ liệu NASA thứ hai`,
  notYetNote:
    'Đã thấy một hướng thay đổi, nhưng bằng chứng chưa đủ mạnh; một chuỗi dữ liệu dài hơn có thể làm kết luận này thay đổi.',

  reportCredit: 'Báo cáo được EarthPulse tạo từ dữ liệu NASA',
  reportLimitation: 'Số liệu của một quốc gia là giá trị tóm tắt tính theo trọng số diện tích của các ô lưới 1°.',
  exportDate: (day: number, month: number, year: string): string => `${day} tháng ${month} năm ${year}`,
  exportLine: (date: string): string => `Bản xuất dữ liệu ngày ${date}`,
  exportLineMissing: 'Chưa có ngày của bản xuất dữ liệu',
  productText: (productAndVersion: string, doi: string | null): string =>
    `${productAndVersion} · ${doi ? `DOI ${doi}` : 'Chưa có DOI trong danh mục'}`,
  summaryNone: 'Không có biến nào được hiển thị cho lựa chọn này.',
  summaryNoSignificant: (total: number, place: string): string =>
    `Không biến nào trong ${total} biến được hiển thị có thay đổi có ý nghĩa thống kê trên diện rộng ở ${place}.`,
  summarySome: (significant: number, total: number, place: string): string =>
    `${significant} trong ${total} biến được hiển thị có thay đổi có ý nghĩa thống kê trên diện rộng ở ${place}.`,
  // Not shown on the Vietnamese page (buildReportHeader returns null there).
  localLine: 'Báo cáo cho Việt Nam: xem bằng chứng, cảnh báo dữ liệu và bộ dữ liệu NASA thứ hai.',

  imageKicker: 'EARTHPULSE · BÁO CÁO QUỐC GIA',
  imageLegend: 'Màu ấm = tăng, màu lạnh = giảm.',
  imageNoCanvas: 'Trình duyệt này không hỗ trợ canvas.',
  imageNoBlob: 'Trình duyệt không tạo được ảnh.',
}

export const STRINGS = defineStrings<PageStrings>(EN, VI)
