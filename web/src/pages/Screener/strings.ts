// Every user-visible string of the Variables (Screener) page, in English and Vietnamese.
// The English text is the reference and is read by existing tests: do not reword it.
// Dataset names, method names, units and numbers stay as they are in both languages.

import { defineStrings } from '../../i18n'

const en = {
  eyebrow: 'Evidence ranking',
  title: 'Variable Screener',
  promise: 'Which variables are changing, over how much area, how strongly, and where the directions disagree.',
  /** `end` is null when the window id is not in the index; then the id alone is shown. */
  period: (start: string, end: string | null, q: number) =>
    end == null ? `Period ${start} · FDR q < ${q}` : `Period ${start} to ${end} · FDR q < ${q}`,
  domain: 'Domain',
  globalLand: 'Global land',
  globalLandLower: 'global land',
  searchPlaceholder: 'Search a country or region',
  sortBy: 'Sort by',
  dirAscAria: 'Order: smallest first. Switch to largest first',
  dirDescAria: 'Order: largest first. Switch to smallest first',
  dirAscText: '↑ Smallest first',
  dirDescText: '↓ Largest first',
  loadingDomains: 'Loading domains…',
  domainsError: (message: string) => `Could not load domains. ${message}`,
  loadingRanking: (domainLabel: string) => `Loading the ranking for ${domainLabel}…`,
  domainError: (message: string) => `Could not load this domain. ${message}`,
  missingLast: 'Missing values sort last.',
  emptyDomain: (domainLabel: string) =>
    `No cells were evaluated in ${domainLabel} for this period, so there is nothing to rank.`,
  categoryVariables: (category: string) => `${category} variables`,
  categories: { temperature: 'temperature', water: 'water', atmosphere: 'atmosphere' } as Record<string, string>,

  // Sort columns
  sort: {
    significantArea: 'Area with significant change (increase + decrease)',
    magnitude: 'Typical change',
    contrast: 'Opposite trends',
    coverage: 'Coverage',
    witness: 'Second witness',
  },
  sortedBy: (phrase: string, order: string) => `Sorted by ${phrase}, ${order}.`,
  orderLargest: 'largest first',
  orderSmallest: 'smallest first',

  magnitudeTooltip: 'standard deviations per decade, median over significant cells',

  contrastNone: 'one direction',
  contrastMostly: 'mostly one direction',
  contrastMixed: 'mixed directions',

  witnessConfirmed: (percent: string) => `${percent} of significant area confirmed`,

  headlineNoCells: (domainLabel: string) => `No cells were evaluated in ${domainLabel} for this period.`,
  headlineNone: (percent: number, domainLabel: string) =>
    `No variable shows significant change over more than ${percent}% of ${domainLabel} in this period.`,
  headlineSome: (broad: number, evaluated: number, percent: number, domainLabel: string) =>
    `${broad} of ${evaluated} variables show significant change over more than ${percent}% of ${domainLabel}.`,

  // "How to read this list"
  howToRead: 'How to read this list',
  readSignificant: (q: number) =>
    `“Significant” means a trend whose FDR-adjusted q-value is below ${q}. The test is the Hamed–Rao modified Mann–Kendall test, corrected for autocorrelation and for testing thousands of grid cells.`,
  readAreas: (magnitudeTooltip: string) =>
    `Area fractions are area-weighted over evaluated cells. The bar is the evaluated land: the cool part from the left is significant decrease, the warm part from the right is significant increase, and the grey between is everything else. The increase colour uses each variable's own meaning. Typical change is ${magnitudeTooltip}.`,
  readOpposite:
    'The “opposite trends” score is near 0 when one direction dominates and near 0.5 when increase and decrease cover similar area. Coverage is the valid fraction of months in the window; below 70% is called out.',
  readShiftBefore:
    'Small maps show the full global trend grid and are not cropped to the selected domain. A ',
  readShiftStrong: 'sudden shift',
  readShiftAfter:
    ' flag means a step fits slightly better than a straight line: it could be a real climate jump or a data artefact. Code 2 marks a shift during a documented GLDAS input change (2008–2012), so read the trend with caution.',
  readWitnessBefore: 'The ',
  readWitnessStrong: 'second dataset',
  readWitnessAfter:
    ' chip reports the share of the significant area where an independent NASA dataset is also significant in the same direction. A high contradicted share is a warning to read the trend with caution, not a verdict.',

  // Row card
  significantAreaMissing: 'Significant area: —',
  decrease: 'decrease',
  suddenShiftTitle:
    'Sudden shift: a step fits slightly better than a straight line. It could be a real climate jump or a data artefact; read the evidence.',
  suddenShiftFlagged: 'Sudden shift flagged',
  witnessChipBefore: 'Second dataset:',
  witnessChipAfter: 'confirmed',
  highDisagreement: 'High disagreement',
  highDisagreementTitle:
    'A second dataset contradicts a substantial share of the significant area. Read the trend with caution; this is not a verdict.',
  coverageLow: 'Coverage below 70%',
  moreMetrics: 'More metrics',
  typicalChange: 'Typical change',
  oppositeTrends: 'Opposite trends',
  contrastOfBefore: '(',
  contrastOfAfter: ' of 0.5)',
  coverage: 'Coverage',
  suddenShift: 'Sudden shift',
  flaggedAreaAfter: ' of area flagged',
  alsoFlaggedBefore: '; ',
  alsoFlaggedAfter: ' of significant area also flagged',
  noSuddenShift: 'No sudden shift detected',
  secondWitness: 'Second witness',
  noWitnessValue: 'No witness value',
  contradictedAfter: ' contradicted',
  cellsEvaluated: 'Cells evaluated',
  unitAndSource: 'Unit and source',
  sourceBadge: { model: 'model', satellite: 'satellite', reanalysis: 'reanalysis' } as Record<string, string>,
  openMap: 'Open the map',
  wholeDomain: 'the whole domain',
  openEvidence: (target: string) => `Open the evidence for ${target}`,
  openMapFor: (label: string) => `Open the map for ${label}`,

  // One sentence per row for assistive technology
  rowDecreaseIncrease: (decrease: string, increase: string, means: string) =>
    `${decrease} significant decrease, ${increase} significant increase (${means}).`,
  rowAreaUnavailable: 'Significant area not available.',
  rowShiftFlagged: (percent: string) => `Sudden shift flagged over ${percent} of area.`,
  rowSecondDataset: (confirmed: string) => `Second dataset: ${confirmed}.`,

  // Thumbnail
  thumbAria: (label: string, means: string) =>
    `Global trend map for ${label}. Not cropped to the selected domain. Significant increase means ${means}. Other cells are a significant decrease, not significant, insufficient data, or outside the domain.`,
  thumbLoading: 'Loading map…',
  thumbError: 'Could not draw this map.',
  thumbOpen: 'Open map',
}

type ScreenerStrings = typeof en

const vi: ScreenerStrings = {
  eyebrow: 'Xếp hạng bằng chứng',
  title: 'Bảng sàng lọc biến',
  promise: 'Biến nào đang thay đổi, trên bao nhiêu diện tích, mạnh đến đâu, và ở đâu các hướng thay đổi trái ngược nhau.',
  period: (start, end, q) =>
    end == null ? `Giai đoạn ${start} · FDR q < ${q}` : `Giai đoạn ${start} đến ${end} · FDR q < ${q}`,
  domain: 'Phạm vi',
  globalLand: 'Đất liền toàn cầu',
  globalLandLower: 'đất liền toàn cầu',
  searchPlaceholder: 'Tìm một quốc gia hoặc vùng',
  sortBy: 'Sắp xếp theo',
  dirAscAria: 'Thứ tự: nhỏ nhất trước. Bấm để chuyển sang lớn nhất trước',
  dirDescAria: 'Thứ tự: lớn nhất trước. Bấm để chuyển sang nhỏ nhất trước',
  dirAscText: '↑ Nhỏ nhất trước',
  dirDescText: '↓ Lớn nhất trước',
  loadingDomains: 'Đang tải danh sách phạm vi…',
  domainsError: (message) => `Không tải được danh sách phạm vi. ${message}`,
  loadingRanking: (domainLabel) => `Đang tải bảng xếp hạng cho ${domainLabel}…`,
  domainError: (message) => `Không tải được phạm vi này. ${message}`,
  missingLast: 'Giá trị bị thiếu được xếp cuối cùng.',
  emptyDomain: (domainLabel) =>
    `Không có ô lưới nào được đánh giá ở ${domainLabel} trong giai đoạn này, nên chưa có gì để xếp hạng.`,
  categoryVariables: (category) => `Các biến thuộc nhóm ${category}`,
  categories: { temperature: 'nhiệt độ', water: 'nước', atmosphere: 'khí quyển' },

  sort: {
    significantArea: 'Diện tích có thay đổi có ý nghĩa thống kê (tăng + giảm)',
    magnitude: 'Mức thay đổi điển hình',
    contrast: 'Xu hướng trái chiều',
    coverage: 'Độ phủ dữ liệu',
    witness: 'Bộ dữ liệu NASA thứ hai',
  },
  sortedBy: (phrase, order) => `Đang sắp xếp theo ${phrase}, ${order}.`,
  orderLargest: 'lớn nhất trước',
  orderSmallest: 'nhỏ nhất trước',

  magnitudeTooltip: 'độ lệch chuẩn mỗi thập kỷ, lấy trung vị trên các ô có ý nghĩa thống kê',

  contrastNone: 'một hướng',
  contrastMostly: 'chủ yếu một hướng',
  contrastMixed: 'nhiều hướng trái chiều',

  witnessConfirmed: (percent) => `${percent} diện tích có ý nghĩa thống kê được xác nhận`,

  headlineNoCells: (domainLabel) => `Không có ô lưới nào được đánh giá ở ${domainLabel} trong giai đoạn này.`,
  headlineNone: (percent, domainLabel) =>
    `Không có biến nào thay đổi có ý nghĩa thống kê trên quá ${percent}% diện tích ${domainLabel} trong giai đoạn này.`,
  headlineSome: (broad, evaluated, percent, domainLabel) =>
    `${broad} trên ${evaluated} biến thay đổi có ý nghĩa thống kê trên quá ${percent}% diện tích ${domainLabel}.`,

  howToRead: 'Cách đọc danh sách này',
  readSignificant: (q) =>
    `“Có ý nghĩa thống kê” nghĩa là xu hướng có giá trị q đã hiệu chỉnh FDR nhỏ hơn ${q}. Phép kiểm định là Hamed–Rao modified Mann–Kendall, có hiệu chỉnh cho tự tương quan và cho việc kiểm định hàng nghìn ô lưới.`,
  readAreas: (magnitudeTooltip) =>
    `Tỷ lệ diện tích được tính theo trọng số diện tích trên các ô đã được đánh giá. Thanh biểu diễn phần đất liền đã đánh giá: phần màu lạnh từ bên trái là diện tích giảm có ý nghĩa thống kê, phần màu ấm từ bên phải là diện tích tăng có ý nghĩa thống kê, và phần màu xám ở giữa là mọi thứ còn lại. Màu của phần tăng theo ý nghĩa riêng của từng biến. Mức thay đổi điển hình là ${magnitudeTooltip}.`,
  readOpposite:
    'Điểm “xu hướng trái chiều” gần 0 khi một hướng chiếm ưu thế và gần 0.5 khi diện tích tăng và diện tích giảm xấp xỉ nhau. Độ phủ dữ liệu là tỷ lệ tháng hợp lệ trong giai đoạn; mức dưới 70% sẽ được nêu rõ.',
  readShiftBefore:
    'Các bản đồ nhỏ hiển thị toàn bộ lưới xu hướng toàn cầu và không được cắt theo phạm vi đã chọn. Cờ ',
  readShiftStrong: 'bước nhảy đột ngột',
  readShiftAfter:
    ' nghĩa là một bước nhảy khớp với dữ liệu tốt hơn đôi chút so với một đường thẳng: đó có thể là một biến động khí hậu có thật hoặc là sai lệch của dữ liệu. Mã 2 đánh dấu bước nhảy xảy ra trong lúc dữ liệu đầu vào của GLDAS có thay đổi đã được ghi nhận (2008–2012), vì vậy hãy đọc xu hướng một cách thận trọng.',
  readWitnessBefore: 'Nhãn ',
  readWitnessStrong: 'bộ dữ liệu NASA thứ hai',
  readWitnessAfter:
    ' cho biết tỷ lệ diện tích có ý nghĩa thống kê mà một bộ dữ liệu NASA độc lập cũng cho kết quả có ý nghĩa thống kê theo cùng hướng. Tỷ lệ bị phản bác cao là lời cảnh báo để đọc xu hướng một cách thận trọng, không phải một phán quyết.',

  significantAreaMissing: 'Diện tích có ý nghĩa thống kê: —',
  decrease: 'giảm',
  suddenShiftTitle:
    'Bước nhảy đột ngột: một bước nhảy khớp với dữ liệu tốt hơn đôi chút so với một đường thẳng. Đó có thể là một biến động khí hậu có thật hoặc là sai lệch của dữ liệu; hãy xem bằng chứng.',
  suddenShiftFlagged: 'Đã gắn cờ bước nhảy đột ngột',
  witnessChipBefore: 'Bộ dữ liệu NASA thứ hai:',
  witnessChipAfter: 'được xác nhận',
  highDisagreement: 'Bất đồng cao',
  highDisagreementTitle:
    'Một bộ dữ liệu NASA thứ hai phản bác một phần đáng kể diện tích có ý nghĩa thống kê. Hãy đọc xu hướng một cách thận trọng; đây không phải một phán quyết.',
  coverageLow: 'Độ phủ dữ liệu dưới 70%',
  moreMetrics: 'Xem thêm chỉ số',
  typicalChange: 'Mức thay đổi điển hình',
  oppositeTrends: 'Xu hướng trái chiều',
  contrastOfBefore: '(',
  contrastOfAfter: ' trên 0.5)',
  coverage: 'Độ phủ dữ liệu',
  suddenShift: 'Bước nhảy đột ngột',
  flaggedAreaAfter: ' diện tích bị gắn cờ',
  alsoFlaggedBefore: '; ',
  alsoFlaggedAfter: ' diện tích có ý nghĩa thống kê cũng bị gắn cờ',
  noSuddenShift: 'Không phát hiện bước nhảy đột ngột',
  secondWitness: 'Bộ dữ liệu NASA thứ hai',
  noWitnessValue: 'Không có giá trị từ bộ dữ liệu thứ hai',
  contradictedAfter: ' bị phản bác',
  cellsEvaluated: 'Số ô lưới đã đánh giá',
  unitAndSource: 'Đơn vị và nguồn',
  sourceBadge: { model: 'mô hình', satellite: 'vệ tinh', reanalysis: 'tái phân tích' },
  openMap: 'Mở bản đồ',
  wholeDomain: 'toàn bộ phạm vi',
  openEvidence: (target) => `Mở bằng chứng cho ${target}`,
  openMapFor: (label) => `Mở bản đồ của ${label}`,

  rowDecreaseIncrease: (decrease, increase, means) =>
    `${decrease} giảm có ý nghĩa thống kê, ${increase} tăng có ý nghĩa thống kê (${means}).`,
  rowAreaUnavailable: 'Chưa có diện tích có ý nghĩa thống kê.',
  rowShiftFlagged: (percent) => `Đã gắn cờ bước nhảy đột ngột trên ${percent} diện tích.`,
  rowSecondDataset: (confirmed) => `Bộ dữ liệu NASA thứ hai: ${confirmed}.`,

  thumbAria: (label, means) =>
    `Bản đồ xu hướng toàn cầu của ${label}. Không cắt theo phạm vi đã chọn. Tăng có ý nghĩa thống kê nghĩa là ${means}. Các ô còn lại là giảm có ý nghĩa thống kê, chưa có ý nghĩa thống kê, thiếu dữ liệu hoặc nằm ngoài phạm vi.`,
  thumbLoading: 'Đang tải bản đồ…',
  thumbError: 'Không vẽ được bản đồ này.',
  thumbOpen: 'Mở bản đồ',
}

export const SCREENER_STRINGS = defineStrings<ScreenerStrings>(en, vi)

/** What "increase" means for each variable. The published text is English; this is its Vietnamese form. */
export const INCREASE_MEANS_VI: Record<string, string> = {
  warmer: 'ấm lên',
  wetter: 'ẩm hơn',
  'more evaporation': 'bốc hơi nhiều hơn',
  'more humid': 'không khí ẩm hơn',
  'more water vapour': 'nhiều hơi nước hơn',
  'more ozone': 'nhiều ô-dôn hơn',
}

/** One-sentence variable descriptions in Vietnamese, keyed by variable id. English comes from the index. */
export const VARIABLE_DESCRIPTION_VI: Record<string, string> = {
  surface_skin_temperature: 'Nhiệt độ của chính bề mặt đất (lớp da bề mặt), lấy trung bình theo tháng.',
  root_zone_soil_moisture: 'Lượng nước trong các lớp đất mà rễ cây hút, lấy trung bình theo tháng.',
  precipitation: 'Tổng lượng mưa theo tháng, từ ước tính đa vệ tinh GPM IMERG.',
  air_temperature: 'Nhiệt độ không khí gần mặt đất, lấy trung bình theo tháng.',
  surface_soil_moisture: 'Lượng nước trong lớp đất dày 10 cm trên cùng, lấy trung bình theo tháng.',
  evapotranspiration: 'Lượng nước từ đất và cây trả lại cho không khí, tính tổng theo tháng.',
  specific_humidity: 'Khối lượng hơi nước trên mỗi đơn vị khối lượng không khí gần mặt đất, lấy trung bình theo tháng.',
  air_temperature_850hpa: 'Nhiệt độ không khí ở mực áp suất 850 hPa (cao khoảng 1.5 km), lấy trung bình theo tháng.',
  air_temperature_500hpa: 'Nhiệt độ không khí ở mực áp suất 500 hPa (cao khoảng 5.5 km), lấy trung bình theo tháng.',
  column_water_vapor:
    'Tổng lượng hơi nước có thể kết tủa: toàn bộ hơi nước trong một cột không khí phía trên mỗi nơi, lấy trung bình theo tháng.',
  total_ozone: 'Tổng lượng ô-dôn trong cột khí quyển: toàn bộ ô-dôn trong một cột không khí phía trên mỗi nơi, lấy trung bình theo tháng.',
}

/** Group name (temperature, water, atmosphere) in the chosen language; unknown names pass through. */
export function categoryName(category: string, table: ScreenerStrings): string {
  return table.categories[category] ?? category
}
