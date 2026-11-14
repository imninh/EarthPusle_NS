// Vietnamese forms of the shared text helpers: the glossary, the verdict words and the
// unit words. The English forms stay in glossary.ts, verdict.ts and units.ts, unchanged.
// Method names (Hamed–Rao, Mann–Kendall, Benjamini–Hochberg, Pettitt, Sen's slope) keep
// their original form inside Vietnamese sentences; symbols (°C, mm, kg/m², hPa, DU) never change.

import type { GlossaryEntry, TermId } from './glossary'

export const GLOSSARY_VI: Record<TermId, GlossaryEntry> = {
  significant: {
    term: 'Có ý nghĩa thống kê',
    plain:
      'Một thay đổi được gọi là có ý nghĩa thống kê khi khó có khả năng chỉ do dao động ngẫu nhiên thông thường giữa các năm tạo ra.',
    technical:
      'Phép kiểm định Mann–Kendall hiệu chỉnh theo Hamed–Rao, có kiểm soát tỷ lệ phát hiện giả (FDR) theo Benjamini–Hochberg.',
  },
  trend: {
    term: 'Xu hướng',
    plain: 'Một hướng thay đổi đều đặn theo thời gian, chẳng hạn tăng, giảm, dày lên hoặc mỏng đi.',
    technical: 'Xu hướng đơn điệu của các độ lệch so với mức trung bình theo tháng trong giai đoạn phân tích.',
  },
  rate_of_change: {
    term: 'Tốc độ thay đổi',
    plain:
      'Đại lượng được đo thay đổi bao nhiêu trong một năm điển hình; cũng được hiển thị mỗi thập kỷ để các con số nhỏ dễ so sánh hơn.',
    technical: "Sen's slope (trung vị của mọi độ dốc giữa từng cặp tháng).",
  },
  anomaly: {
    term: 'Độ lệch so với mức trung bình',
    plain: 'Chênh lệch so với giá trị thường thấy của tháng đó, sau khi đã loại bỏ nhịp mùa thông thường.',
    technical:
      'Độ lệch theo tháng so với giá trị khí hậu trung bình của từng tháng trong giai đoạn cơ sở 2001–2020.',
  },
  q_value: {
    term: 'Giá trị q',
    plain:
      'Một con số đo độ mạnh của bằng chứng, đã tính đến việc kiểm định hàng nghìn nơi cùng lúc; càng nhỏ thì bằng chứng càng mạnh.',
    technical: 'Giá trị p đã hiệu chỉnh theo kiểm soát tỷ lệ phát hiện giả của Benjamini–Hochberg.',
  },
  coverage: {
    term: 'Độ phủ dữ liệu',
    plain: 'Tỷ lệ các tháng trong giai đoạn có dữ liệu dùng được cho biến và địa điểm này.',
    technical: 'Tỷ lệ các quan sát theo tháng hợp lệ trong giai đoạn phân tích.',
  },
  sudden_shift: {
    term: 'Bước nhảy đột ngột',
    plain:
      'Một bước nhảy kiểu bậc thang trong dữ liệu thay vì một xu hướng đều đặn; đó có thể là một biến động có thật của khí hậu hoặc là sai lệch của dữ liệu.',
    technical:
      'Kiểm định điểm thay đổi Pettitt, kèm so sánh ΔBIC giữa mô hình bậc thang và mô hình đường thẳng (contract §12); mã 2 đánh dấu một bước nhảy xảy ra trong lúc dữ liệu đầu vào GLDAS thay đổi (2008–2012), điều đã được ghi nhận.',
  },
  second_witness: {
    term: 'Bộ dữ liệu NASA thứ hai',
    plain:
      'Một bộ dữ liệu NASA thứ hai, độc lập, được kiểm định theo cùng một cách; nếu hai bộ cho kết quả khớp nhau thì bằng chứng mạnh hơn.',
    technical:
      "Cùng phép tính Sen's slope, kiểm định Mann–Kendall hiệu chỉnh theo Hamed–Rao và kiểm soát FDR Benjamini–Hochberg, trên một sản phẩm NASA độc lập (contract §13).",
  },
  confidence_interval: {
    term: 'Khoảng tin cậy 95%',
    plain:
      'Một khoảng có nhiều khả năng chứa tốc độ thay đổi thật; nếu khoảng này chứa số không thì chưa chứng minh được hướng thay đổi.',
    technical: "Khoảng tin cậy 95% dựa trên thứ hạng cho Sen's slope (Sen 1968; Gilbert 1987).",
  },
  not_yet_significant: {
    term: 'Chưa có ý nghĩa thống kê',
    plain:
      'Đã thấy một hướng thay đổi, nhưng bằng chứng chưa đủ mạnh; một chuỗi dữ liệu dài hơn có thể làm kết luận này thay đổi.',
    technical: 'Xu hướng không vượt ngưỡng kiểm soát tỷ lệ phát hiện giả (q ≥ 0.05).',
  },
  variable: {
    term: 'Biến',
    plain:
      'Một đại lượng của Trái Đất được đo hoặc mô hình hóa, chẳng hạn nhiệt độ không khí hay độ ẩm đất, được theo dõi từng tháng một.',
    technical: 'Một mục trong danh mục index.json, với một sản phẩm, một đơn vị và một loại nguồn.',
  },
  contrast: {
    term: 'Xu hướng trái chiều',
    plain:
      'Điểm gần 0 nghĩa là một hướng chiếm ưu thế, còn điểm gần 0.5 nghĩa là diện tích tăng và diện tích giảm xấp xỉ nhau.',
    technical:
      'Độ trái chiều theo vùng: sự cân bằng tỷ lệ diện tích giữa phần tăng có ý nghĩa thống kê và phần giảm có ý nghĩa thống kê (contract §6).',
  },
  standardized_change: {
    term: 'Thay đổi chuẩn hóa',
    plain:
      'Thay đổi trong cả giai đoạn chia cho mức dao động điển hình giữa các năm, nên giá trị gần 1 nghĩa là thay đổi xấp xỉ một độ lệch chuẩn tự nhiên.',
    technical:
      "Sen's slope mỗi thập kỷ chia cho độ lệch chuẩn của các phần dư so với đường Sen (contract §6).",
  },
  data_quality: {
    term: 'Chất lượng dữ liệu',
    plain:
      'Phép kiểm tra xem dữ liệu có bước nhảy đột ngột hay không; bước nhảy đó có thể là biến động có thật của khí hậu hoặc là điểm gãy trong chuỗi đo.',
    technical: 'Kiểm định điểm thay đổi Pettitt, kèm so sánh ΔBIC giữa mô hình bậc thang và mô hình đường thẳng (contract §12).',
  },
  kendall_tau: {
    term: 'Kendall τ',
    plain:
      'Một số từ -1 đến 1 cho biết một chuỗi dữ liệu tăng hoặc giảm theo thời gian một cách nhất quán đến mức nào.',
    technical:
      'Hệ số tương quan thứ hạng Kendall τ của các độ lệch theo tháng, S / (n(n-1)/2), từ kiểm định Mann–Kendall.',
  },
  years_to_detect: {
    term: 'Số năm dữ liệu cần thêm',
    plain:
      'Ước tính cần bao nhiêu năm dữ liệu để một xu hướng cỡ này nổi bật so với dao động tự nhiên, nếu tốc độ hiện tại tiếp tục; đây không phải là dự báo.',
    technical:
      'Công thức AR(1) của Weatherhead và cộng sự (1998) (contract §16), độ tin cậy 95% và công suất kiểm định 90%; luôn hiển thị kèm một khoảng.',
  },
  screened_only: {
    term: 'Chỉ sàng lọc',
    plain: 'Chỉ sàng lọc nghĩa là phép kiểm định xu hướng đã chạy, nhưng chưa có bộ dữ liệu thứ hai để đối chiếu.',
    technical:
      "Bậc danh mục (contract §14): cùng phép kiểm định Sen's slope, Mann–Kendall hiệu chỉnh theo Hamed–Rao và kiểm soát FDR; không có cờ chất lượng và không có bộ dữ liệu thứ hai.",
  },
}

/**
 * Vietnamese verdict labels, keyed like VERDICT_LABELS in verdict.ts. The words match the
 * Investigate page. `rising` and `falling` take the variable's own direction word (see
 * VERDICT_DIRECTION_VI) when it is known.
 */
export const VERDICT_LABELS_VI = {
  rising: 'Tăng, bằng chứng mạnh',
  falling: 'Giảm, bằng chứng mạnh',
  notYet: 'Có một hướng thay đổi, chưa có ý nghĩa thống kê',
  noClear: 'Chưa thấy xu hướng rõ ràng',
  caution: 'ĐỌC THẬN TRỌNG',
  notEnough: 'Chưa đủ dữ liệu',
} as const

export const STRONG_EVIDENCE_VI = 'bằng chứng mạnh'

/** Vietnamese direction phrases keyed by the registry's `increase_means` (same as the Investigate page). */
export const VERDICT_DIRECTION_VI: Record<string, { up: string; down: string }> = {
  warmer: { up: 'ấm lên', down: 'lạnh đi' },
  wetter: { up: 'ẩm hơn', down: 'khô hơn' },
  'more humid': { up: 'ẩm hơn', down: 'khô hơn' },
  'more ozone': { up: 'nhiều ô-dôn hơn', down: 'ít ô-dôn hơn' },
  'more water vapour': { up: 'nhiều hơi nước hơn', down: 'ít hơi nước hơn' },
  'more evaporation': { up: 'bốc hơi nhiều hơn', down: 'bốc hơi ít hơn' },
}

/** The words inside unit text that are not symbols. */
export const UNIT_WORDS_VI = {
  perDecade: 'mỗi thập kỷ',
  perYear: 'mỗi năm',
  perMonth: 'mỗi tháng',
  fraction: 'tỷ lệ (0-1)',
} as const
