// Page chrome of the How it works (Method) page, in English and Vietnamese.
// The long explanatory content lives in content.ts (English) and content.vi.ts (Vietnamese).
// The English text is the reference and is read by existing tests: do not reword it.

import { defineStrings } from '../../i18n'

const en = {
  eyebrow: 'How it works',
  title: 'From a NASA file to a trend you can question',
  lede: 'EarthPulse turns monthly satellite and model data into one comparable grid, tests every cell for a trend, checks whether a sudden shift could explain it, and asks a second NASA dataset whether it sees the same thing.',
  publishedVariables: (n: number) => `${n} published variables`,
  fdrChip: (q: number) => `FDR q < ${q}`,
  witnessAvailable: 'Second witness available',
  witnessMissing: 'Second witness not in this export',

  challengeTitle: 'How EarthPulse answers the challenge',
  challengeNote:
    'The challenge asks for four things and names a few ideas worth adding. Here is where each one lives in the app.',
  thChallenge: 'The challenge says',
  thWhere: 'Where in EarthPulse',
  thGo: 'Go there',
  kindObjective: 'Objective',
  kindConsideration: 'Consideration',

  flowTitle: 'The pipeline at a glance',
  flowAria: 'Analysis steps',
  stepsTitle: 'Each step, in plain language',
  whyItMatters: 'Why it matters:',

  wordsTitle: 'Words we use',
  wordsNote:
    'Plain words first, with the exact method name in brackets for anyone who wants it. The same explanations appear behind the “?” buttons across the app.',

  productsTitle: 'Products and DOIs',
  productsNote:
    'Every card is read from the published index. A DOI link opens the product landing page; the product version is part of the card.',
  reportedIn: (units: string) => `Reported in ${units}`,
  doi: (doi: string) => `DOI ${doi}`,
  doiMissing: 'DOI not available in the index',
  witnessProductsTitle: 'Second-witness products',
  witnessChecks: (variable: string, source: string, version: string) =>
    `Checks ${variable} via ${source} · version ${version}`,
  witnessProductsLater: (schema: string) =>
    `Second-witness products appear automatically when a schema 1.3 export is published. The current export is schema ${schema}; all witness fields are optional and hidden in this build.`,

  limitsTitle: 'Limitations to keep in view',
  docsTitle: 'Repository documentation',
  docsNote: 'The app is the short version; the repository holds the full method, limits and file contract.',
  toolsTitle: 'Tools to check our numbers',

  classTitle: 'Use it in class (15 minutes)',
  classNote:
    'A one-page activity for a teacher or a student. Choose a language, print it, and work through the tasks in the app.',
  sheetLanguage: 'Sheet language',
}

type MethodStrings = typeof en

const vi: MethodStrings = {
  eyebrow: 'Cách hoạt động',
  title: 'Từ một tệp NASA đến một xu hướng bạn có thể đặt câu hỏi',
  lede: 'EarthPulse biến dữ liệu vệ tinh và mô hình theo tháng thành một lưới có thể so sánh, kiểm định xu hướng ở từng ô lưới, kiểm tra xem một bước nhảy đột ngột có thể giải thích xu hướng đó hay không, và hỏi một bộ dữ liệu NASA thứ hai xem nó có thấy điều tương tự không.',
  publishedVariables: (n) => `${n} biến đã công bố`,
  fdrChip: (q) => `FDR q < ${q}`,
  witnessAvailable: 'Có bộ dữ liệu NASA thứ hai',
  witnessMissing: 'Bản xuất này chưa có bộ dữ liệu NASA thứ hai',

  challengeTitle: 'EarthPulse trả lời thử thách như thế nào',
  challengeNote:
    'Thử thách yêu cầu bốn việc và nêu thêm vài ý tưởng đáng bổ sung. Đây là nơi từng việc nằm trong ứng dụng.',
  thChallenge: 'Thử thách nói gì',
  thWhere: 'Ở đâu trong EarthPulse',
  thGo: 'Đi tới đó',
  kindObjective: 'Mục tiêu',
  kindConsideration: 'Lưu ý',

  flowTitle: 'Quy trình trong một cái nhìn',
  flowAria: 'Các bước phân tích',
  stepsTitle: 'Từng bước, bằng ngôn ngữ đơn giản',
  whyItMatters: 'Vì sao điều này quan trọng:',

  wordsTitle: 'Các thuật ngữ chúng tôi dùng',
  wordsNote:
    'Lời giải thích đơn giản đứng trước, tên phương pháp chính xác nằm trong ngoặc cho ai muốn biết. Các giải thích này cũng xuất hiện sau các nút “?” trong toàn bộ ứng dụng.',

  productsTitle: 'Sản phẩm dữ liệu và DOI',
  productsNote:
    'Mỗi thẻ được đọc từ chỉ mục đã công bố. Liên kết DOI mở trang giới thiệu sản phẩm; phiên bản sản phẩm nằm trong thẻ.',
  reportedIn: (units) => `Đơn vị báo cáo: ${units}`,
  doi: (doi) => `DOI ${doi}`,
  doiMissing: 'Chỉ mục không có DOI',
  witnessProductsTitle: 'Sản phẩm của bộ dữ liệu NASA thứ hai',
  witnessChecks: (variable, source, version) => `Đối chiếu ${variable} qua ${source} · phiên bản ${version}`,
  witnessProductsLater: (schema) =>
    `Sản phẩm của bộ dữ liệu NASA thứ hai sẽ tự động xuất hiện khi một bản xuất schema 1.3 được công bố. Bản xuất hiện tại là schema ${schema}; mọi trường của bộ dữ liệu thứ hai đều là tùy chọn và bị ẩn trong bản dựng này.`,

  limitsTitle: 'Những hạn chế cần luôn lưu ý',
  docsTitle: 'Tài liệu trong kho mã',
  docsNote: 'Ứng dụng là bản rút gọn; kho mã chứa phương pháp đầy đủ, các hạn chế và quy ước về tệp dữ liệu.',
  toolsTitle: 'Công cụ để kiểm tra số liệu của chúng tôi',

  classTitle: 'Dùng trong lớp học (15 phút)',
  classNote:
    'Một hoạt động một trang cho giáo viên hoặc học sinh. Chọn ngôn ngữ, in ra và làm các nhiệm vụ trong ứng dụng.',
  sheetLanguage: 'Ngôn ngữ của phiếu',
}

export const METHOD_STRINGS = defineStrings<MethodStrings>(en, vi)
