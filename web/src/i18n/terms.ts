// Shared Vietnamese wording. Every page uses these names so one idea has one name in
// the whole app. English names are NOT defined here: English keeps coming from the
// published data (index.json) and from the existing code, unchanged.

import type { Lang } from './index'

/** Vietnamese names of the published variables, keyed by variable id in index.json. */
export const VARIABLE_VI: Record<string, string> = {
  surface_skin_temperature: 'Nhiệt độ bề mặt',
  root_zone_soil_moisture: 'Độ ẩm đất tầng rễ',
  precipitation: 'Lượng mưa',
  air_temperature: 'Nhiệt độ không khí gần mặt đất',
  surface_soil_moisture: 'Độ ẩm đất bề mặt (0-10 cm)',
  evapotranspiration: 'Bốc thoát hơi nước',
  specific_humidity: 'Độ ẩm riêng',
  air_temperature_850hpa: 'Nhiệt độ không khí ở mực 850 hPa',
  air_temperature_500hpa: 'Nhiệt độ không khí ở mực 500 hPa',
  column_water_vapor: 'Hơi nước cột khí quyển',
  total_ozone: 'Tổng lượng ô-dôn cột khí quyển',
}

/** Name of a variable in the chosen language; falls back to the published English label. */
export function variableLabel(variable: { id: string; label: string }, lang: Lang): string {
  if (lang === 'vi') return VARIABLE_VI[variable.id] ?? variable.label
  return variable.label
}

/**
 * Fixed Vietnamese terms. Use exactly these words in every Vietnamese string.
 * (Reference list for whoever writes a Vietnamese table; also usable in code.)
 */
export const TERMS_VI = {
  trend: 'xu hướng',
  rate_of_change: 'tốc độ thay đổi',
  per_decade: 'mỗi thập kỷ',
  significant: 'có ý nghĩa thống kê',
  not_significant: 'chưa có ý nghĩa thống kê',
  confidence_interval: 'khoảng tin cậy 95%',
  anomaly: 'độ lệch so với mức trung bình',
  baseline: 'giai đoạn cơ sở',
  data_quality_flag: 'cờ chất lượng dữ liệu',
  sudden_shift: 'bước nhảy đột ngột',
  second_dataset: 'bộ dữ liệu NASA thứ hai',
  corroborated: 'được xác nhận',
  contradicted: 'bị phản bác',
  not_compared: 'chưa đối chiếu',
  read_with_caution: 'ĐỌC THẬN TRỌNG',
  verdict: 'phán quyết',
  case_file: 'hồ sơ vụ việc',
  cross_examination: 'thẩm vấn',
  evidence: 'bằng chứng',
  reanalysis: 'tái phân tích',
  coverage: 'độ phủ dữ liệu',
  land: 'đất liền',
  warming: 'ấm lên',
  cooling: 'lạnh đi',
  wetter: 'ẩm hơn',
  drier: 'khô hơn',
  region: 'vùng',
  country: 'quốc gia',
  grid_cell: 'ô lưới',
  window: 'giai đoạn',
  variable: 'biến',
  screener: 'bảng sàng lọc biến',
  years_to_detect: 'số năm dữ liệu cần thêm',
  false_discovery: 'kiểm soát tỷ lệ phát hiện giả (FDR)',
} as const

/** Vietnamese titles of the published detective cases, keyed by case id in cases.json. */
export const CASE_TITLE_VI: Record<string, string> = {
  'case-01': 'Lượng mưa đo bằng vệ tinh đang tăng trên khắp Trung Quốc và Nga',
  'case-02': 'Lượng mưa đo bằng vệ tinh đang giảm trên khắp Brazil và Bolivia',
  'case-03': 'Ấm lên và khô đi cùng lúc trên khắp An-giê-ri và Ma-rốc',
  'case-04': 'Việt Nam đang ấm lên, nhưng hãy kiểm tra bước nhảy năm 2012',
  'case-05': 'Không khí có đang khô đi không? Bộ dữ liệu NASA thứ hai nói là không',
}

/** Title of a case in the chosen language; falls back to the published English title. */
export function caseTitle(item: { id: string; title: string }, lang: Lang): string {
  if (lang === 'vi') return CASE_TITLE_VI[item.id] ?? item.title
  return item.title
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

/** Description of a variable in the chosen language; falls back to the published English text. */
export function variableDescription(variable: { id: string; description?: string }, lang: Lang): string {
  if (lang === 'vi') return VARIABLE_DESCRIPTION_VI[variable.id] ?? variable.description ?? ''
  return variable.description ?? ''
}
