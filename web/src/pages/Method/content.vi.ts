// Vietnamese version of content.ts. Same exported names, same types, same ids, same order,
// same links and the same numbers. Only the wording is translated.

import {
  CHECK_TOOLS as CHECK_TOOLS_EN,
  type ChallengeRow,
  type MethodDocLink,
  type MethodStep,
  type ToolLink,
} from './content'

export const METHOD_STEPS: readonly MethodStep[] = [
  {
    id: 'data',
    title: 'Dữ liệu',
    technical: 'các sản phẩm theo tháng đã được hài hòa',
    body:
      'Chúng tôi tải các sản phẩm NASA theo tháng và đưa về cùng một lưới 1°, một mặt nạ đất liền và một trục thời gian. ' +
      'Mọi sản phẩm dùng cùng các tháng và cùng giai đoạn cơ sở 2001–2020, nên những khác biệt về sau không đến từ việc lịch dữ liệu không khớp nhau.',
    why: 'Đầu vào có thể so sánh được là nền tảng của mọi phép kiểm định phía sau.',
  },
  {
    id: 'anomalies',
    title: 'Độ lệch so với mức trung bình',
    technical: 'độ lệch hằng tháng so với mức trung bình',
    body:
      'Chúng tôi trừ mức trung bình theo tháng của giai đoạn 2001–2020 khỏi từng ô lưới, để lại một độ lệch cho mỗi tháng. ' +
      'Bước này loại bỏ chu kỳ theo mùa thông thường, nên một xu hướng nghĩa là có thay đổi vượt ra ngoài nhịp điệu thường niên.',
    why: 'Nếu bỏ bước này, mùa hè nào cũng trông như một xu hướng tăng.',
  },
  {
    id: 'trend',
    title: 'Xu hướng và ý nghĩa thống kê',
    technical: "Sen's slope + Hamed–Rao MK",
    body:
      "Độ dốc Sen (Sen's slope) là trung vị của mọi độ dốc giữa từng cặp điểm và ít bị ảnh hưởng bởi một giá trị ngoại lai đơn lẻ. " +
      'Kiểm định Mann–Kendall hiệu chỉnh của Hamed–Rao hỏi liệu một xu hướng đơn điệu có khó xảy ra khi không có thay đổi nào hay không, đồng thời tính đến tự tương quan.',
    why: 'Chỉ có độ dốc là chưa đủ; ta còn cần biết nó có thể chỉ là nhiễu hay không.',
  },
  {
    id: 'fdr',
    title: 'Kiểm định nhiều lần',
    technical: 'Benjamini–Hochberg FDR',
    body:
      'Kiểm định hàng nghìn ô lưới sẽ tạo ra các phát hiện giả do ngẫu nhiên. ' +
      'Hiệu chỉnh Benjamini–Hochberg kiểm soát tỷ lệ phát hiện giả (FDR) trên các ô đã được đánh giá trong mỗi bản đồ.',
    why: 'Bước này giữ cho “có ý nghĩa thống kê” vẫn có giá trị khi nhiều ô được kiểm định cùng lúc.',
  },
  {
    id: 'quality',
    title: 'Kiểm tra chất lượng',
    technical: 'Pettitt step test + ΔBIC',
    body:
      'Kiểm định điểm thay đổi Pettitt cùng với phép so sánh giữa mô hình bước nhảy và mô hình đường thẳng cho biết liệu một bước nhảy đột ngột có khớp dữ liệu hơn một xu hướng từ từ hay không. ' +
      'Kết quả là lời cảnh báo để đọc kỹ bằng chứng, không phải phán quyết về việc bước nhảy đó có thật hay không.',
    why: 'Một số xu hướng có vẻ có thật thực ra do dữ liệu đầu vào thay đổi chứ không phải do khí hậu.',
  },
  {
    id: 'witness',
    title: 'Bộ dữ liệu NASA thứ hai',
    technical: 'sản phẩm NASA độc lập',
    body:
      'Cùng một phép kiểm định xu hướng được lặp lại trên một sản phẩm NASA độc lập cho cùng một đại lượng vật lý. ' +
      'Kết quả trùng khớp là sự xác nhận, không phải chuẩn đối chiếu tuyệt đối: MERRA-2 cũng là một bộ tái phân tích và GPCP dùng chung dữ liệu từ các trạm đo mưa với IMERG.',
    why: 'Một bộ dữ liệu thứ hai làm câu chuyện điều tra thuyết phục hơn, nhưng không thay thế được sự cân nhắc của chính bạn.',
  },
  {
    id: 'region',
    title: 'Trung bình theo vùng',
    technical: 'chuỗi trung bình có trọng số theo diện tích',
    body:
      'Với một quốc gia, một vùng hoặc một khung do bạn chọn, chúng tôi lấy trung bình độ lệch của các ô lưới thành một chuỗi theo tháng, mỗi ô có trọng số theo diện tích của nó. ' +
      'Sau đó phép kiểm định xu hướng chỉ chạy một lần trên chuỗi này, bằng kiểm định Mann–Kendall hiệu chỉnh của Hamed–Rao và không có hiệu chỉnh tỷ lệ phát hiện giả.',
    why: 'Một phép kiểm định trên một chuỗi thì dễ lặp lại, nhưng giá trị trung bình có thể che đi những ô thay đổi theo hướng ngược nhau.',
  },
  {
    id: 'interval',
    title: 'Tốc độ thay đổi và khoảng tin cậy 95%',
    technical: 'tốc độ thay đổi kèm khoảng tin cậy',
    body:
      'Chúng tôi báo cáo tốc độ thay đổi cùng với khoảng tin cậy 95%, là khoảng có khả năng chứa tốc độ thật. ' +
      'Nếu khoảng này chứa số 0 thì hướng thay đổi vẫn chưa được chứng minh, và một chuỗi dữ liệu dài hơn có thể thay đổi điều đó.',
    why: 'Một khoảng tin cậy cho thấy ta chắc chắn đến đâu, điều mà một con số đơn lẻ không làm được.',
  },
]

export const METHOD_LIMITATIONS: readonly string[] = [
  'Dữ liệu cưỡng bức đầu vào của GLDAS-2.1 không đồng nhất theo thời gian: bức xạ được tính lại từ năm 2008 và có một bước lệch chưa được hiệu chỉnh sau năm 2011. Một phần xu hướng của GLDAS có thể là sai lệch của dữ liệu.',
  'Một xu hướng có ý nghĩa thống kê là bằng chứng để xem xét, không phải bằng chứng đã chứng minh nguyên nhân. FDR kiểm soát các phát hiện giả nhưng không biến một xu hướng thành quan hệ nhân quả.',
  'Greenland và các ô băng tuyết vĩnh cửu bị che đi vì mô hình đất liền không có mô hình sông băng hay chỏm băng.',
  'Các giai đoạn 12 năm có ít khả năng phát hiện bước nhảy đột ngột hơn; khi đã có kiểm tra chất lượng đầy đủ trên 24 năm, kết quả đó được dùng cho các giai đoạn ngắn hơn.',
  'MERRA-2 là một bộ tái phân tích và GPCP dùng chung dữ liệu từ các trạm đo mưa với IMERG; bộ dữ liệu thứ hai chỉ là sự xác nhận, không phải chuẩn đối chiếu tuyệt đối.',
  'Tương quan và các xu hướng cùng xuất hiện ở một nơi không phải là quan hệ nhân quả.',
]

export const METHOD_DOC_LINKS: readonly MethodDocLink[] = [
  {
    label: 'Phương pháp khoa học',
    href: '../docs/SCIENTIFIC_METHODOLOGY.md',
    description: 'Phương pháp đầy đủ, giai đoạn cơ sở và ghi chú kiểm chứng.',
  },
  {
    label: 'Hạn chế',
    href: '../docs/LIMITATIONS.md',
    description: 'Dữ liệu có thể và không thể chứng minh điều gì.',
  },
  {
    label: 'Hợp đồng dữ liệu',
    href: '../docs/DATA_CONTRACT.md',
    description: 'Lưới, cấu trúc tệp và mọi trường được công bố.',
  },
]

export const CHALLENGE_ROWS: readonly ChallengeRow[] = [
  {
    id: 'variables',
    kind: 'Objective',
    phrase: 'các biến quan tâm',
    where: 'Trang Biến xếp hạng mọi biến đã công bố theo mức độ phần đất liền có xu hướng.',
    page: 'screener',
    linkLabel: 'Mở trang Biến',
  },
  {
    id: 'region',
    kind: 'Objective',
    phrase: 'một vùng cụ thể',
    where: 'Chọn một quốc gia, một vùng hoặc một khung do bạn tự vẽ ở trang Vùng.',
    page: 'region',
    linkLabel: 'Mở trang Vùng',
  },
  {
    id: 'series',
    kind: 'Objective',
    phrase: 'một chuỗi thời gian',
    where: 'Trang Vùng vẽ chuỗi theo tháng cho nơi bạn chọn và cho phép bạn đổi giai đoạn.',
    page: 'region',
    linkLabel: 'Mở trang Vùng',
  },
  {
    id: 'rate',
    kind: 'Objective',
    phrase: 'kiểm định Mann-Kendall hoặc khoảng tin cậy',
    where: 'Trang Vùng đưa ra tốc độ thay đổi kèm khoảng tin cậy 95% và một kiểm định Mann–Kendall của Hamed–Rao.',
    page: 'region',
    linkLabel: 'Mở trang Vùng',
  },
  {
    id: 'definitions',
    kind: 'Consideration',
    phrase: 'định nghĩa đơn giản của các biến',
    where: 'Bản đồ hiển thị định nghĩa một câu của biến đã chọn, và các nút “?” giải thích từng thuật ngữ.',
    page: 'discovery',
    linkLabel: 'Mở Bản đồ',
  },
  {
    id: 'questions',
    kind: 'Consideration',
    phrase: 'một loạt câu hỏi ngắn',
    where: 'Trang Điều tra hỏi ở đâu, cái gì và khi nào, rồi hiển thị các biến phù hợp.',
    page: 'investigate',
    linkLabel: 'Mở trang Điều tra',
  },
  {
    id: 'demos',
    kind: 'Consideration',
    phrase: 'các ví dụ minh họa',
    where: 'Trang Các vụ việc dẫn bạn đi qua từng bước của các hồ sơ vụ việc điều tra đã công bố.',
    page: 'story',
    linkLabel: 'Mở trang Các vụ việc',
  },
  {
    id: 'not-significant',
    kind: 'Consideration',
    phrase: 'vẫn thú vị dù chưa đạt mức có ý nghĩa',
    where: 'Một xu hướng yếu được hiển thị là “có hướng, chưa có ý nghĩa thống kê”, không bao giờ là “không thay đổi”.',
    page: 'investigate',
    linkLabel: 'Mở trang Điều tra',
  },
  {
    id: 'seasonal',
    kind: 'Consideration',
    phrase: 'sau khi đã loại bỏ chu kỳ theo mùa',
    where: 'Mọi biểu đồ và phép kiểm định đều dùng độ lệch hằng tháng so với mức trung bình, nên nhịp điệu thường niên đã được loại bỏ.',
    page: 'region',
    linkLabel: 'Mở trang Vùng',
  },
]

/** Tool names and links are the same in both languages. */
export const CHECK_TOOLS: readonly ToolLink[] = CHECK_TOOLS_EN

export const CHECK_TOOLS_SENTENCE =
  'Các công cụ này vẽ và kiểm định từng chuỗi một. EarthPulse bổ sung việc sàng lọc nhiều biến, hiệu chỉnh cho nhiều phép kiểm định, các cờ chất lượng dữ liệu và một bộ dữ liệu NASA thứ hai.'
