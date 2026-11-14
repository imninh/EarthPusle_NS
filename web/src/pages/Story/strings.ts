// Story (Cases) page text in English and Vietnamese. The English text is the reference:
// existing tests read it, so it must not change. Vietnamese terms follow src/i18n/terms.ts.
// Case titles, summaries, details, region labels, limitations, methods and product names
// come from cases.json and stay as published.
import { defineStrings } from '../../i18n'

export const STORY_STRINGS = defineStrings(
  {
    storyMode: 'Story mode',
    loadError: (message: string) => `Could not load cases.json. ${message}`,
    retry: 'Try again',
    loading: 'Loading detective cases…',
    progressNone: 'No cases published',
    progressIntro: (total: number) => `Intro · ${total} cases`,
    progressCase: (step: number, total: number, sub: number, count: number) =>
      `Case ${step} of ${total} · Step ${sub} of ${count}`,
    nextStart: 'Start with case 1',
    nextStep: 'Next step',
    nextBackToIntro: 'Back to intro',
    nextCase: 'Next case',
    prevStep: 'Previous step',
    prevIntro: 'Intro',
    prevCase: 'Previous case',
    headTitle: 'Follow the evidence',
    promise: 'Walk through published detective cases step by step. Every number and region comes from computed outputs.',
    synthetic: 'This cases file is synthetic development data, not a NASA result.',
    emptyTitle: 'No detective cases are published in this build yet',
    emptyBefore: 'Story mode reads ',
    emptyAfter:
      ' and never invents a case. When the case builder publishes entries, this page becomes the guided tour. In the meantime, the Screener and the map already contain the same computed evidence.',
    exploreVariables: 'Explore variables',
    exploreMap: 'Explore the map',
    stepsNavLabel: 'Case steps',
    introNumber: 'Intro',
    introName: 'How to read a case',
    caseSelectLabel: 'Case',
    introOption: 'Intro · How to read a case',
    railLabel: 'Steps in this case',
    footer: "Case windows come from cases.json. The map and Region Explorer open the case's own window.",
    // Intro card
    readFirst: 'Read this first',
    sigHeading: 'What “significant” means',
    sigBody:
      'The test asks whether a monotonic trend is unlikely under no change. The q-value is corrected across all evaluated cells, so “significant” is stronger evidence than a raw p-value alone.',
    shiftHeading: 'Sudden shifts and quality flags',
    shiftBody: (hasQuality: boolean) =>
      (hasQuality
        ? 'This export includes data-quality layers. '
        : 'When the export includes data-quality layers, ') +
      'Code 1 means a sudden shift around a break year: this could be a real jump in the climate or a data artefact. The trend is still significant; a step fits slightly better than a straight line. Code 2 means the shift falls during a documented GLDAS input change (2008–2012): possible data discontinuity, so read the trend with caution.',
    caseHeading: 'What a case is',
    caseBody:
      'A case is a computed region and window where the evidence is interesting enough to explain. The title and why-selected text are editorial; the evidence numbers are not.',
    howChosenAll: 'How these cases were chosen',
    howChosenOne: 'How this case was chosen',
    hint: 'Use Next, the arrow keys, the case list, or the browser back button to move through cases.',
    // Case stage
    stepLabel: (n: number, count: number, name: string) => `Step ${n} of ${count} · ${name}`,
    caseCount: (n: number, total: number) => `Case ${n} of ${total}`,
    exhibitLabel: (letter: string, label: string) => `Exhibit ${letter} · ${label}`,
    factRate: 'Rate of change (Sen slope) per decade',
    factStrength: 'Evidence strength (p / q)',
    factDirection: 'Direction (trend class)',
    factMonths: 'Months with data',
    factCoverage: 'Coverage',
    secondWitness: 'Second witness',
    witnessLine: (variable: string, words: string, slope: string, unit: string, q: string) =>
      `${variable} ${words}; slope ${slope} ${unit}; q ${q}.`,
    cautionStamp: 'Read with caution',
    limitations: 'Limitations',
    noLimitations: 'No limitations were listed for this case.',
    openEvidencePage: 'Open this case in the evidence page',
    ownInvestigation: 'Start your own investigation',
    // model.ts
    howToRead: 'How to read a case',
    caseFallback: 'Case',
    trendIncrease: (means: string) => `significant increase (${means})`,
    trendDecrease: 'significant decrease',
    trendNotSignificant: 'not significant',
    trendInsufficient: 'insufficient data',
    trendOutside: 'outside the domain',
    trendUnknown: (code: number) => `unknown class (${code})`,
    witnessAgree: 'a second, independent NASA dataset agrees',
    witnessDisagree: 'an independent NASA dataset disagrees: read with caution',
    witnessSameNotSig: 'same direction, but not significant in the second dataset',
    witnessOppositeNotSig: 'opposite direction, but not significant in the second dataset',
    witnessMainNotSig: 'main trend not significant',
    witnessNotEvaluated: 'not evaluated',
    witnessUnknown: (code: number) => `unknown witness agreement (${code})`,
    combinedAgree:
      'A sudden shift is flagged, but an independent dataset shows the same trend: more likely a real change.',
    combinedDisagree:
      'A sudden shift is flagged, and an independent dataset shows a significant trend in the opposite direction: the trend is disputed.',
    combinedNotSig:
      'A sudden shift is flagged, but an independent dataset does not show a significant trend in the same direction: more likely a data artefact.',
    combinedNone: 'No independent witness value is available for this case.',
    unnamedPlace: 'Unnamed place',
    regionCountry: 'country boundary',
    regionGlobal: 'all evaluated land',
    regionBox: (box: string) => `approximate box ${box}`,
    actionGlobal: 'Open in Explore variables',
    actionEvidence: 'Open evidence',
    mapCaption: 'Approximate case box. Not a country boundary.',
    breakYearLead: (year: number) => `The median break year across these cells is ${year}`,
    significance: (q: number) =>
      `Significant means a trend whose FDR-adjusted q-value is below ${q}. The test is a Hamed–Rao modified Mann–Kendall test over monthly anomalies, with Benjamini–Hochberg correction across thousands of cells. A significant trend is evidence to read, not proof of cause, and "not significant" does not mean "no change".`,
    stepQuestion: 'The question',
    stepEvidence: 'The evidence',
    stepWitness: 'Second dataset',
    stepCaution: 'The caution',
    stepLimits: 'Limits and next steps',
    cautionText:
      'A sudden shift can be a real jump in the climate or a data artefact. The trend is still significant; read the evidence rather than treating the flag as a verdict.',
    // increase_means values published in index.json
    increaseMeans: {} as Record<string, string>,
  },
  {
    storyMode: 'Chế độ kể chuyện',
    loadError: (message: string) => `Không tải được cases.json. ${message}`,
    retry: 'Thử lại',
    loading: 'Đang tải các vụ việc điều tra…',
    progressNone: 'Chưa có vụ việc nào được công bố',
    progressIntro: (total: number) => `Giới thiệu · ${total} vụ việc`,
    progressCase: (step: number, total: number, sub: number, count: number) =>
      `Vụ việc ${step} trên ${total} · Bước ${sub} trên ${count}`,
    nextStart: 'Bắt đầu với vụ việc 1',
    nextStep: 'Bước tiếp theo',
    nextBackToIntro: 'Quay lại phần giới thiệu',
    nextCase: 'Vụ việc tiếp theo',
    prevStep: 'Bước trước',
    prevIntro: 'Giới thiệu',
    prevCase: 'Vụ việc trước',
    headTitle: 'Lần theo bằng chứng',
    promise:
      'Đi qua từng bước các vụ việc điều tra đã công bố. Mọi con số và mọi vùng đều lấy từ kết quả đã tính.',
    synthetic: 'Tệp vụ việc này là dữ liệu giả lập để phát triển, không phải kết quả của NASA.',
    emptyTitle: 'Bản dựng này chưa công bố vụ việc điều tra nào',
    emptyBefore: 'Chế độ kể chuyện đọc ',
    emptyAfter:
      ' và không bao giờ tự bịa ra vụ việc. Khi bộ dựng vụ việc công bố các mục, trang này sẽ trở thành chuyến tham quan có hướng dẫn. Trong lúc chờ, bảng sàng lọc biến và bản đồ đã chứa cùng những bằng chứng đã tính đó.',
    exploreVariables: 'Khám phá các biến',
    exploreMap: 'Khám phá bản đồ',
    stepsNavLabel: 'Các bước của vụ việc',
    introNumber: 'Giới thiệu',
    introName: 'Cách đọc một vụ việc',
    caseSelectLabel: 'Vụ việc',
    introOption: 'Giới thiệu · Cách đọc một vụ việc',
    railLabel: 'Các bước trong vụ việc này',
    footer:
      'Giai đoạn của các vụ việc lấy từ cases.json. Bản đồ và trang khám phá vùng mở đúng giai đoạn của vụ việc.',
    readFirst: 'Đọc phần này trước',
    sigHeading: 'Thế nào là “có ý nghĩa thống kê”',
    sigBody:
      'Phép kiểm định hỏi liệu một xu hướng đơn điệu có khó xảy ra nếu thực tế không có thay đổi hay không. Giá trị q được hiệu chỉnh trên toàn bộ các ô lưới được đánh giá, nên “có ý nghĩa thống kê” là bằng chứng mạnh hơn so với giá trị p thô.',
    shiftHeading: 'Bước nhảy đột ngột và cờ chất lượng dữ liệu',
    shiftBody: (hasQuality: boolean) =>
      (hasQuality
        ? 'Bản xuất dữ liệu này có các lớp chất lượng dữ liệu. '
        : 'Khi bản xuất dữ liệu có các lớp chất lượng dữ liệu, ') +
      'Mã 1 nghĩa là có bước nhảy đột ngột quanh một năm gãy: đó có thể là một cú nhảy thật của khí hậu, hoặc là sai lệch của dữ liệu. Xu hướng vẫn có ý nghĩa thống kê; một bậc thang khớp với dữ liệu tốt hơn một chút so với đường thẳng. Mã 2 nghĩa là bước nhảy rơi vào lúc dữ liệu đầu vào của GLDAS có thay đổi đã được ghi nhận (2008–2012): có thể dữ liệu bị gián đoạn, nên hãy đọc xu hướng một cách thận trọng.',
    caseHeading: 'Vụ việc là gì',
    caseBody:
      'Một vụ việc là một vùng và một giai đoạn đã được tính toán, nơi bằng chứng đủ thú vị để giải thích. Tiêu đề và lý do chọn là phần biên tập; các con số bằng chứng thì không.',
    howChosenAll: 'Các vụ việc này được chọn như thế nào',
    howChosenOne: 'Vụ việc này được chọn như thế nào',
    hint: 'Dùng nút Tiếp theo, phím mũi tên, danh sách vụ việc hoặc nút quay lại của trình duyệt để di chuyển giữa các vụ việc.',
    stepLabel: (n: number, count: number, name: string) => `Bước ${n} trên ${count} · ${name}`,
    caseCount: (n: number, total: number) => `Vụ việc ${n} trên ${total}`,
    exhibitLabel: (letter: string, label: string) => `Tang vật ${letter} · ${label}`,
    factRate: 'Tốc độ thay đổi (Sen slope) mỗi thập kỷ',
    factStrength: 'Độ mạnh của bằng chứng (p / q)',
    factDirection: 'Hướng (nhóm xu hướng)',
    factMonths: 'Số tháng có dữ liệu',
    factCoverage: 'Độ phủ dữ liệu',
    secondWitness: 'Bộ dữ liệu NASA thứ hai',
    witnessLine: (variable: string, words: string, slope: string, unit: string, q: string) =>
      `${variable}: ${words}; tốc độ thay đổi ${slope} ${unit}; q ${q}.`,
    cautionStamp: 'ĐỌC THẬN TRỌNG',
    limitations: 'Giới hạn',
    noLimitations: 'Vụ việc này không liệt kê giới hạn nào.',
    openEvidencePage: 'Mở vụ việc này trong trang bằng chứng',
    ownInvestigation: 'Tự bắt đầu một cuộc điều tra',
    howToRead: 'Cách đọc một vụ việc',
    caseFallback: 'Vụ việc',
    trendIncrease: (means: string) => `tăng có ý nghĩa thống kê (${means})`,
    trendDecrease: 'giảm có ý nghĩa thống kê',
    trendNotSignificant: 'chưa có ý nghĩa thống kê',
    trendInsufficient: 'không đủ dữ liệu',
    trendOutside: 'nằm ngoài phạm vi phân tích',
    trendUnknown: (code: number) => `nhóm không xác định (${code})`,
    witnessAgree: 'được xác nhận bởi bộ dữ liệu NASA thứ hai, độc lập',
    witnessDisagree: 'bị một bộ dữ liệu NASA độc lập phản bác: đọc thận trọng',
    witnessSameNotSig: 'cùng hướng, nhưng chưa có ý nghĩa thống kê ở bộ dữ liệu thứ hai',
    witnessOppositeNotSig: 'ngược hướng, nhưng chưa có ý nghĩa thống kê ở bộ dữ liệu thứ hai',
    witnessMainNotSig: 'xu hướng chính chưa có ý nghĩa thống kê',
    witnessNotEvaluated: 'chưa đối chiếu',
    witnessUnknown: (code: number) => `mức đồng thuận không xác định (${code})`,
    combinedAgree:
      'Có cờ bước nhảy đột ngột, nhưng một bộ dữ liệu độc lập cho thấy cùng xu hướng: nhiều khả năng đây là thay đổi thật.',
    combinedDisagree:
      'Có cờ bước nhảy đột ngột, và một bộ dữ liệu độc lập cho thấy xu hướng có ý nghĩa thống kê theo hướng ngược lại: xu hướng này đang bị tranh cãi.',
    combinedNotSig:
      'Có cờ bước nhảy đột ngột, nhưng một bộ dữ liệu độc lập không cho thấy xu hướng có ý nghĩa thống kê theo cùng hướng: nhiều khả năng đây là sai lệch của dữ liệu.',
    combinedNone: 'Vụ việc này chưa có giá trị đối chiếu độc lập.',
    unnamedPlace: 'Nơi chưa có tên',
    regionCountry: 'ranh giới quốc gia',
    regionGlobal: 'toàn bộ đất liền được đánh giá',
    regionBox: (box: string) => `khung xấp xỉ ${box}`,
    actionGlobal: 'Mở trong Khám phá các biến',
    actionEvidence: 'Mở bằng chứng',
    mapCaption: 'Khung xấp xỉ của vụ việc. Không phải ranh giới quốc gia.',
    breakYearLead: (year: number) => `Năm gãy trung vị của các ô lưới này là ${year}`,
    significance: (q: number) =>
      `Có ý nghĩa thống kê nghĩa là xu hướng có giá trị q đã hiệu chỉnh FDR nhỏ hơn ${q}. Phép kiểm định là Mann–Kendall hiệu chỉnh Hamed–Rao trên độ lệch so với mức trung bình hằng tháng, kèm hiệu chỉnh Benjamini–Hochberg trên hàng nghìn ô lưới. Một xu hướng có ý nghĩa thống kê là bằng chứng để đọc, không phải chứng minh về nguyên nhân, và "chưa có ý nghĩa thống kê" không có nghĩa là "không có thay đổi".`,
    stepQuestion: 'Câu hỏi',
    stepEvidence: 'Bằng chứng',
    stepWitness: 'Bộ dữ liệu thứ hai',
    stepCaution: 'Lưu ý thận trọng',
    stepLimits: 'Giới hạn và bước tiếp theo',
    cautionText:
      'Bước nhảy đột ngột có thể là một cú nhảy thật của khí hậu, hoặc là sai lệch của dữ liệu. Xu hướng vẫn có ý nghĩa thống kê; hãy đọc bằng chứng thay vì xem cờ này là phán quyết.',
    increaseMeans: {
      warmer: 'ấm lên',
      wetter: 'ẩm hơn',
      'more humid': 'không khí ẩm hơn',
      'more evaporation': 'bốc hơi nhiều hơn',
      'more water vapour': 'nhiều hơi nước hơn',
      'more ozone': 'nhiều ô-dôn hơn',
    } as Record<string, string>,
  },
)

/** Quality caution panel text. */
export const CAUTION_STRINGS = defineStrings(
  {
    ariaLabel: 'Data-quality caution',
    chip: 'Read with caution',
    shareUnavailable: 'Flagged share not available',
    shareText: (pct: number) => `${pct}% of the case's source cells carry a sudden-shift flag`,
    noBreakYear: 'The published quality layers do not give a break year for this case.',
    inForcing: (lead: string, change: string) =>
      `${lead}, inside a ${change}: possible data discontinuity. Read the trend with caution.`,
    notForcing: (lead: string) =>
      `${lead}. A sudden shift can be a real jump in the climate or a data artefact. The trend is still significant; read the evidence rather than treating the flag as a verdict.`,
    checking: ' Checking the published quality layers…',
    // Documented input change phrase (family is e.g. GLDAS, period e.g. 2008–2012).
    inputChange: (family: string, period: string) => `documented ${family} input change (${period})`,
    labelShare: (pct: number) => `${pct}% of cells flagged`,
    labelNoBreak: 'break year not available',
    labelBreak: (year: number) => `median break year ${year}`,
    labelJoin: (share: string, year: string) => `${share}; ${year}.`,
  },
  {
    ariaLabel: 'Lưu ý về chất lượng dữ liệu',
    chip: 'ĐỌC THẬN TRỌNG',
    shareUnavailable: 'Chưa có tỷ lệ ô lưới bị gắn cờ',
    shareText: (pct: number) => `${pct}% ô lưới nguồn của vụ việc có cờ bước nhảy đột ngột`,
    noBreakYear: 'Các lớp chất lượng đã công bố không cho biết năm gãy của vụ việc này.',
    inForcing: (lead: string, change: string) =>
      `${lead}, nằm trong ${change}: có thể dữ liệu bị gián đoạn. Hãy đọc xu hướng một cách thận trọng.`,
    notForcing: (lead: string) =>
      `${lead}. Bước nhảy đột ngột có thể là một cú nhảy thật của khí hậu, hoặc là sai lệch của dữ liệu. Xu hướng vẫn có ý nghĩa thống kê; hãy đọc bằng chứng thay vì xem cờ này là phán quyết.`,
    checking: ' Đang kiểm tra các lớp chất lượng đã công bố…',
    inputChange: (family: string, period: string) =>
      `giai đoạn dữ liệu đầu vào của ${family} có thay đổi đã được ghi nhận (${period})`,
    labelShare: (pct: number) => `${pct}% ô lưới bị gắn cờ`,
    labelNoBreak: 'chưa có năm gãy',
    labelBreak: (year: number) => `năm gãy trung vị ${year}`,
    labelJoin: (share: string, year: string) => `${share}; ${year}.`,
  },
)

/** Map figure text. */
export const MAP_STRINGS = defineStrings(
  {
    defaultCaption: 'Approximate case box. Not a country boundary.',
    ariaBox: (label: string) => `Global trend map for ${label}, with the approximate case box outlined.`,
    ariaArea: (label: string) => `Global trend map for ${label}, with the case area outlined.`,
    loading: 'Loading case map…',
    failed: 'Could not draw the case map.',
  },
  {
    defaultCaption: 'Khung xấp xỉ của vụ việc. Không phải ranh giới quốc gia.',
    ariaBox: (label: string) => `Bản đồ xu hướng toàn cầu của ${label}, có viền khung xấp xỉ của vụ việc.`,
    ariaArea: (label: string) => `Bản đồ xu hướng toàn cầu của ${label}, có viền vùng của vụ việc.`,
    loading: 'Đang tải bản đồ vụ việc…',
    failed: 'Không vẽ được bản đồ vụ việc.',
  },
)
