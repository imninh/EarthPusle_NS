// Generated sentences of the Region page (summary, quality, witness, detection, model,
// check-yourself). Every Vietnamese sentence is a whole template per case; fragments are
// never glued together in English word order. English output must stay identical to the
// text these functions produced before the strings moved here.
import { defineStrings } from '../../i18n'

export const SUMMARY_STRINGS = defineStrings(
  {
    selectedWindow: 'the selected window',
    insufficient: (range: string, subject: string) =>
      `Over ${range}, there are not enough valid months for ${subject} to estimate a trend reliably.`,
    noInfo: (range: string, subject: string) =>
      `Over ${range}, there is not enough information to summarise the trend in ${subject}.`,
    magnitudeUp: (warm: boolean) => (warm ? 'rose' : 'increased'),
    magnitudeDown: (warm: boolean) => (warm ? 'fell' : 'decreased'),
    intervalIncludesZero: (interval: string) => `the 95% interval ${interval} includes zero`,
    defaultTail: 'A longer record could change this.',
    notSignificantMoved: (
      range: string,
      subject: string,
      verb: string,
      magnitude: string,
      parenthetical: string,
      tail: string,
    ) =>
      `Over ${range}, ${subject} ${verb} by about ${magnitude}, but the evidence is not strong enough yet to call this significant${parenthetical}. ${tail}`,
    notSignificantFlat: (range: string, subject: string) =>
      `Over ${range}, the trend in ${subject} is not statistically significant. A longer record could change this.`,
    significanceWithStat: (label: string, value: string) =>
      `this trend is statistically significant (${label} = ${value})`,
    significancePlain: 'this trend is statistically significant',
    significant: (range: string, subject: string, verb: string, magnitude: string, significance: string, trail: string) =>
      `Over ${range}, ${subject} ${verb} by about ${magnitude}; ${significance}${trail}.`,
    // Clauses appended after a significant trend (they start with "; ").
    cautionKnown: (documented: string) =>
      `; a sudden shift during a ${documented}: possible data discontinuity; read the trend with caution`,
    cautionOther: (year: number | null) =>
      `; a sudden shift${year == null ? '' : ` around ${year}`} could be a real jump in the climate or a data artefact; the trend is still significant, and a step fits slightly better than a straight line`,
  },
  {
    selectedWindow: 'giai đoạn đã chọn',
    insufficient: (range: string, subject: string) =>
      `Trong giai đoạn ${range}, không đủ số tháng hợp lệ để ước tính xu hướng của ${subject} một cách đáng tin cậy.`,
    noInfo: (range: string, subject: string) =>
      `Trong giai đoạn ${range}, chưa đủ thông tin để tóm tắt xu hướng của ${subject}.`,
    magnitudeUp: (warm: boolean) => (warm ? 'tăng' : 'tăng'),
    magnitudeDown: (warm: boolean) => (warm ? 'giảm' : 'giảm'),
    intervalIncludesZero: (interval: string) => `khoảng tin cậy 95% ${interval} có chứa số 0`,
    defaultTail: 'Chuỗi dữ liệu dài hơn có thể thay đổi kết luận này.',
    notSignificantMoved: (
      range: string,
      subject: string,
      verb: string,
      magnitude: string,
      parenthetical: string,
      tail: string,
    ) =>
      `Trong giai đoạn ${range}, ${subject} ${verb} khoảng ${magnitude}, nhưng bằng chứng chưa đủ mạnh để coi xu hướng này là có ý nghĩa thống kê${parenthetical}. ${tail}`,
    notSignificantFlat: (range: string, subject: string) =>
      `Trong giai đoạn ${range}, xu hướng của ${subject} chưa có ý nghĩa thống kê. Chuỗi dữ liệu dài hơn có thể thay đổi kết luận này.`,
    significanceWithStat: (label: string, value: string) => `xu hướng này có ý nghĩa thống kê (${label} = ${value})`,
    significancePlain: 'xu hướng này có ý nghĩa thống kê',
    significant: (range: string, subject: string, verb: string, magnitude: string, significance: string, trail: string) =>
      `Trong giai đoạn ${range}, ${subject} ${verb} khoảng ${magnitude}; ${significance}${trail}.`,
    cautionKnown: (documented: string) =>
      `; có bước nhảy đột ngột trùng với ${documented}: có thể là gián đoạn dữ liệu; hãy đọc xu hướng một cách thận trọng`,
    cautionOther: (year: number | null) =>
      `; bước nhảy đột ngột${year == null ? '' : ` vào khoảng năm ${year}`} có thể là một bước nhảy thật của khí hậu hoặc một hiện tượng phát sinh từ dữ liệu; xu hướng vẫn có ý nghĩa thống kê, và một bậc thang khớp hơn đôi chút so với một đường thẳng`,
  },
)

export const QUALITY_STRINGS = defineStrings(
  {
    documentedChange: (family: string, period: string) => `documented ${family} input change (${period})`,
    codeTwo: (documented: string) =>
      `Sudden shift during a ${documented}: possible data discontinuity. Read the trend with caution.`,
    codeOne: (year: number | null) =>
      `Sudden shift${year == null ? '' : ` around ${year}`}: this could be a real jump in the climate or a data artefact. The trend is still significant; a step fits slightly better than a straight line.`,
    // Region sentences are "<lead> a sudden shift ...".
    leadBannerPct: (pct: number) => `About ${pct}% of evaluated cells in this region show`,
    leadBannerPart: 'Part of this change shows',
    leadDetailPct: (pct: number) => `${pct}% of evaluated cells show`,
    leadDetailFlagged: 'The flagged cells show',
    regionKnown: (lead: string, documented: string) =>
      `${lead} a sudden shift during a ${documented}: possible data discontinuity. Read the trend with caution.`,
    regionOther: (lead: string, year: number | null) =>
      `${lead} a sudden shift${year == null ? '' : ` around ${year}`}: this could be a real jump in the climate or a data artefact. The trend is still significant; a step fits slightly better than a straight line.`,
    cellNoFlag: 'No quality flag for this cell.',
    cellNotEvaluated: 'This cell was not evaluated for sudden shifts.',
    cellNoShift: 'No sudden shift detected in this cell.',
    regionNotEvaluated: 'No cells in this region were evaluated for sudden shifts.',
    regionNoShift: 'No sudden shift detected in the evaluated cells.',
  },
  {
    documentedChange: (family: string, period: string) =>
      `thay đổi dữ liệu đầu vào ${family} đã được ghi nhận (${period})`,
    codeTwo: (documented: string) =>
      `Bước nhảy đột ngột trùng với ${documented}: có thể là gián đoạn dữ liệu. Hãy đọc xu hướng một cách thận trọng.`,
    codeOne: (year: number | null) =>
      `Bước nhảy đột ngột${year == null ? '' : ` vào khoảng năm ${year}`}: đây có thể là một bước nhảy thật của khí hậu hoặc một hiện tượng phát sinh từ dữ liệu. Xu hướng vẫn có ý nghĩa thống kê; một bậc thang khớp hơn đôi chút so với một đường thẳng.`,
    leadBannerPct: (pct: number) => `Khoảng ${pct}% số ô lưới được đánh giá trong vùng này có`,
    leadBannerPart: 'Một phần của thay đổi này có',
    leadDetailPct: (pct: number) => `${pct}% số ô lưới được đánh giá có`,
    leadDetailFlagged: 'Các ô lưới bị gắn cờ có',
    regionKnown: (lead: string, documented: string) =>
      `${lead} bước nhảy đột ngột trùng với ${documented}: có thể là gián đoạn dữ liệu. Hãy đọc xu hướng một cách thận trọng.`,
    regionOther: (lead: string, year: number | null) =>
      `${lead} bước nhảy đột ngột${year == null ? '' : ` vào khoảng năm ${year}`}: đây có thể là một bước nhảy thật của khí hậu hoặc một hiện tượng phát sinh từ dữ liệu. Xu hướng vẫn có ý nghĩa thống kê; một bậc thang khớp hơn đôi chút so với một đường thẳng.`,
    cellNoFlag: 'Ô lưới này không có cờ chất lượng dữ liệu.',
    cellNotEvaluated: 'Ô lưới này chưa được đánh giá về bước nhảy đột ngột.',
    cellNoShift: 'Không phát hiện bước nhảy đột ngột nào ở ô lưới này.',
    regionNotEvaluated: 'Chưa có ô lưới nào trong vùng này được đánh giá về bước nhảy đột ngột.',
    regionNoShift: 'Không phát hiện bước nhảy đột ngột nào ở các ô lưới đã được đánh giá.',
  },
)

export const WITNESS_STRINGS = defineStrings(
  {
    corroborated: 'agrees: both trends are significant and point the same way',
    sameSign: 'same direction, but the trend in the second dataset is not significant',
    oppositeSign: 'opposite direction, but the trend in the second dataset is not significant',
    contradicted: 'disagrees: both trends are significant and point opposite ways',
    notApplicable: 'not applicable: the main trend is not significant',
    notEvaluated: 'not evaluated',
    fallbackLabel: 'an independent dataset',
    flaggedCorroborated: (label: string) =>
      `; a sudden shift, but ${label} shows the same trend: more likely a real change`,
    flaggedOther: (label: string) => `; a sudden shift not seen in ${label}: more likely a data artefact`,
    sameTrend: (label: string, warm: boolean) => `; ${label} shows the same ${warm ? 'warming' : 'trend'}`,
    oppositeTrend: (label: string) => `; ${label} shows the opposite trend: read with caution`,
    sameDirection: (label: string) => `; ${label} shows the same direction, but its trend is not significant`,
    oppositeDirection: (label: string) => `; ${label} shows the opposite direction, but its trend is not significant`,
  },
  {
    corroborated: 'khớp: cả hai xu hướng đều có ý nghĩa thống kê và cùng chiều',
    sameSign: 'cùng chiều, nhưng xu hướng trong bộ dữ liệu thứ hai chưa có ý nghĩa thống kê',
    oppositeSign: 'ngược chiều, nhưng xu hướng trong bộ dữ liệu thứ hai chưa có ý nghĩa thống kê',
    contradicted: 'không khớp: cả hai xu hướng đều có ý nghĩa thống kê nhưng ngược chiều nhau',
    notApplicable: 'không áp dụng: xu hướng chính chưa có ý nghĩa thống kê',
    notEvaluated: 'chưa đánh giá',
    fallbackLabel: 'một bộ dữ liệu độc lập',
    flaggedCorroborated: (label: string) =>
      `; có bước nhảy đột ngột, nhưng ${label} cũng cho thấy xu hướng tương tự: nhiều khả năng đây là thay đổi thật`,
    flaggedOther: (label: string) =>
      `; bước nhảy đột ngột không xuất hiện trong ${label}: nhiều khả năng đây là hiện tượng phát sinh từ dữ liệu`,
    sameTrend: (label: string, warm: boolean) =>
      warm ? `; ${label} cũng cho thấy xu hướng ấm lên` : `; ${label} cũng cho thấy xu hướng tương tự`,
    oppositeTrend: (label: string) => `; ${label} cho thấy xu hướng ngược lại: hãy đọc thận trọng`,
    sameDirection: (label: string) => `; ${label} cho thấy cùng chiều, nhưng xu hướng của nó chưa có ý nghĩa thống kê`,
    oppositeDirection: (label: string) =>
      `; ${label} cho thấy chiều ngược lại, nhưng xu hướng của nó chưa có ý nghĩa thống kê`,
  },
)

export const DETECTION_STRINGS = defineStrings(
  {
    sentence: (nStar: string, lower: string, upper: string, years: number) =>
      `A trend of this size would need about ${nStar} years of data ` +
      `to stand out from the natural ups and downs here (range ${lower}–` +
      `${upper}). The record has ${years}.`,
  },
  {
    sentence: (nStar: string, lower: string, upper: string, years: number) =>
      `Một xu hướng cỡ này cần khoảng ${nStar} năm dữ liệu để nổi bật so với các dao động lên xuống tự nhiên ở đây ` +
      `(khoảng từ ${lower} đến ${upper} năm). Chuỗi dữ liệu hiện có ${years} năm.`,
  },
)

export const MODEL_STRINGS = defineStrings(
  {
    to: 'to',
    precomputedRho: (rho: string, n: string) => `precomputed Spearman ρ = ${rho} (n = ${n})`,
    computedRho: (rho: string, n: string) => `computed here: Spearman ρ = ${rho} (n = ${n})`,
    bboxNumbers: 'Enter finite numbers for west, south, east, and north.',
    bboxLatitude: 'Latitude must be between −90 and 90.',
    bboxLongitude: 'Longitude must be between −180 and 180.',
    bboxSouthNorth: 'South must be less than north.',
    bboxWestEast: 'West must be less than east. Boxes that cross the dateline are not supported.',
  },
  {
    to: 'đến',
    precomputedRho: (rho: string, n: string) => `Spearman ρ đã tính sẵn = ${rho} (n = ${n})`,
    computedRho: (rho: string, n: string) => `Spearman ρ tính ngay tại đây = ${rho} (n = ${n})`,
    bboxNumbers: 'Hãy nhập số hợp lệ cho các giá trị tây, nam, đông và bắc.',
    bboxLatitude: 'Vĩ độ phải nằm trong khoảng từ −90 đến 90.',
    bboxLongitude: 'Kinh độ phải nằm trong khoảng từ −180 đến 180.',
    bboxSouthNorth: 'Vĩ độ nam phải nhỏ hơn vĩ độ bắc.',
    bboxWestEast: 'Kinh độ tây phải nhỏ hơn kinh độ đông. Chưa hỗ trợ khung đi qua đường đổi ngày.',
  },
)
