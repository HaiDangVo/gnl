# Gia nhập mạng lưới

[English](JOINING.en.md) · Tiếng Việt

Cho người làm game (và AI agent của họ) muốn game mình nối vào Giờ Nổ Lực, và ký hợp đồng với các game đang chạy như Res World. AI agent đọc thêm [AGENTS.md](AGENTS.md).

## Game của bạn cần có gì

1. **Server giữ dữ liệu thật.** Thứ người chơi mang đi phải nằm trên server, server đốt được và cấp được. Game tin save từ máy người chơi thì không đốt chắc được: người chơi gửi lại save cũ là đồ quay về (SPEC §13; Res World đã vấp lỗi này hai lần).
2. **Một địa chỉ HTTPS** (origin) làm danh tính của game, và một khoá ký Ed25519 trong kho bí mật.
3. **Node giao thức**, bắt đầu ở giai đoạn sandbox (SPEC §5.2): đồ là đồ chơi, thử thoải mái với hai sandbox của mạng, rồi mới lên live. Không cần viết từ đầu: `sandbox/game.mjs` là thư viện đầy đủ (rate card, log, cam kết mỗi ngày, hai chiều chuyển, audit, hợp đồng, huỷ và phạt). Bạn chỉ viết:
   - `players`: đọc thứ mang đi được của một tài khoản, đốt, cấp, thu hồi.
   - `days`: lưu cam kết mỗi ngày (bảng bất kỳ).
   - cấu hình: tên, thứ xuất/nhập và giá, `pace`.
   Ví dụ: `examples/your-game.mjs` (ít code nhất, chạy được ngay, thay Map bằng database của bạn), `cloud/index.mjs` (hai sandbox trên Firebase), Res World `functions/gnlNode.js` (game thật, Firestore).
   Bảng công sức `/gnl/effort.json` (SPEC §4.1): mỗi thứ cày thế nào, giá dựa vào đâu (đo, thiết kế, tự khai hay ước đoán).
4. **Giá đo từ người chơi thật**: trung vị lượng tăng mỗi giờ chơi, công bố cách đo. Không đoán.
5. **Một trang trong game** để người chơi tự chọn mang đi và tự bấm xác nhận, đã đăng nhập. AI không được chuyển hộ (SPEC §10).
6. **Quà, đền bù, đồ nạp tiền** ghi vào log là `issue` (SPEC §4.2): không bao giờ mang ra, không bị tính là gian lận.
7. **Người chịu trách nhiệm**: một master (chủ game) và hội đồng vận hành công khai; mỗi người tự tạo khoá và ký đồng ý trên máy mình bằng `npm run council` (SPEC §14). Từ hai người trở lên, mọi thay đổi hội đồng và việc riêng của game là lệnh có quá nửa hội đồng ký (`npm run order`).

## Các bước và thời gian

| Bước | Làm gì | Bao lâu |
|---|---|---|
| 1 | Chạy local: `npm install && npm run sandbox` để xem toàn bộ luật chạy, rồi gắn node vào game của bạn với `stage: "sandbox"` (SPEC §5.2) | 1–2 ngày cho một AI agent, nếu game đã có server và database |
| 2 | Đưa lên mạng, vẫn là sandbox; `npm run conform -- https://game-cua-ban` đến khi không còn FAIL | trong ngày |
| 3 | Mở issue **"Xin gia nhập"** trên GitHub (mẫu có sẵn). Bot tự chạy conformance và audit rồi đăng kết quả dưới issue; hai sandbox của mạng thêm bạn làm đối tác và ký hợp đồng trong ngày; hai sandbox và Res World làm nhân chứng, giữ bản sao log của bạn | 1 ngày |
| 3b | **Thử thật với hai sandbox**: chuyển đi và nhận về ít nhất một lần mỗi chiều, sửa lỗi đến khi chạy trơn. Ở giai đoạn sandbox đồ là đồ chơi, được làm lại từ đầu (khoá mới, log mới) mà không bị tính là gian lận | tuỳ bạn |
| 3c | **Lên live**: đổi `stage: "live"` (một lần, không quay lại; log giữ nguyên). Conformance kiểm: đã thử đủ hai chiều khi còn là sandbox, và từ nay mọi lần chuyển với sandbox là tài khoản test đã đăng ký (`tester`, tối đa 20, test mãi mãi, không bao giờ chuyển với game live). Sau đó: bug chưa đụng log thì deploy; đã ghi sai thì sửa tiến (`pause`, `cut`, `void`, card mới). Staging (bản sandbox cùng code, `staging`/`stagingOf`) là tuỳ chọn, không bắt buộc | ngay |
| 4 | Chạy đủ số ngày có cam kết liên tục mà game kia yêu cầu (`policy.partnerMinDays` trong rate card của họ). Res World hiện cần **7 ngày**, sẽ tăng dần tới 30 khi mạng lưới lớn lên (SPEC §5.1) | 7 ngày |
| 5 | Game thật xem xét: tuổi log, rate card, dòng chảy (`npm run audit`), người chịu trách nhiệm, rồi bỏ phiếu (SPEC §14) | vài ngày |
| 6 | Hai bên ghi `contract` của tháng vào log của mình. **Có hiệu lực ngay khi đủ hai chữ ký**, hết tháng thì gia hạn trong 7 ngày cuối | ngay |

Tháng đầu, mỗi game chỉ nhận của bạn tối đa 100 giờ nỗ lực mỗi tuần; mỗi tháng gia hạn liền mạch thì nhân đôi.

## Res World cần gì ở bạn

Ghi trong issue "Xin gia nhập":

- origin, tên game, master và hội đồng (tên, tài khoản trong game, link hồ sơ công khai);
- bảng công sức `/gnl/effort.json`;
- kết quả `npm run conform` và `npm run audit` (cả phần dòng chảy);
- cách bạn đo giá, và số liệu đã đo;
- quốc gia, độ tuổi người chơi, trần giờ mỗi ngày theo luật nơi bạn chạy;
- cam kết: không đổi ra tiền, không cho người chơi mua bán thứ nhận được (SPEC §12).

Hiện Res World chưa có màn bỏ phiếu trong game, và cộng đồng chưa đủ 30 người đủ điều kiện, nên chủ game quyết và ghi rõ trong log (SPEC §14, "game nhỏ").

## Thông tin chính thức ở đâu

| Cho ai | Ở đâu |
|---|---|
| Người đọc | Repo https://github.com/HaiDangVo/gnl: `README.md`, `SPEC.md` (giao thức), `ROADMAP.md`, file này. Có bản tiếng Anh |
| AI agent | `AGENTS.md` (hướng dẫn từng bước, luật khi sửa repo) và MCP server `mcp/server.mjs`: `gnl_spec`, `gnl_sandboxes`, `gnl_card`, `gnl_conform`, `gnl_audit`, `gnl_flows`, `gnl_verify`. Gắn: `claude mcp add gnl -- node /path/to/gnl/mcp/server.mjs` |
| Ai cũng xem | Trang trạng thái tự kiểm trong trình duyệt: https://gnl-sandbox.web.app, https://gnl-endless.web.app, https://resworld.web.app/gnl/ (bảng quy đổi, bảng công sức, hội đồng, hợp đồng, nhật ký, neo) |
| Hỏi, xin gia nhập, báo lỗ | GitHub Issues của repo, có mẫu cho từng việc. Chủ repo được GitHub báo (email, app) mỗi khi có issue mới |
