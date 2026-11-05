# Giờ Nổ Lực

[English](README.en.md) · Tiếng Việt

**Mang công sức của mình từ game này sang game khác: minh bạch, công bằng, gần như miễn phí.**

Bạn đã cày 300 giờ ở một game. Giờ muốn thử game khác mà không phải bắt đầu lại từ số 0? Với Giờ Nổ Lực, game cũ quy đổi những gì bạn đã đạt được (tiền, đồ, cấp, tu vi…) ra **giờ nỗ lực**. Bạn chọn mang đi một phần hoặc toàn bộ. Game mới tặng bạn một khởi đầu tương xứng, theo luật của chính nó. Đồ ở game cũ chỉ mất khi game mới đã ký cam kết nhận.

Đây là **giao thức mở**: game nào, studio nào, server nào cũng tham gia được. Không token, không coin, không sàn, không ai đứng giữa ăn phí.

> Trạng thái: **bản nháp 0** (11/2026). Res World (https://resworld.web.app) là game thật đầu tiên chạy giao thức, đang beta. Mời góp ý.

## Vì sao không ai lừa được ai

Không giao thức nào bắt một game *không thể* nói dối về dữ liệu của chính nó. Giờ Nổ Lực làm ba việc thay vào đó:

1. **Mọi lời hứa đều có chữ ký và công khai.** Mỗi game ghi mọi bước vào nhật ký (log) công khai của mình. Các game khác làm nhân chứng, lưu bản sao. Mỗi ngày, log được đóng dấu thời gian vào Bitcoin (OpenTimestamps, miễn phí), có thể neo thêm lên Ronin. Không ai sửa lén được, không ai ghi lùi ngày được.
2. **Lời nói dối nào quan trọng cũng bị máy bắt được:**
   - Tài khoản mới tạo hôm qua không thể mang đi 500 giờ (trần giờ mỗi ngày theo luật nước sở tại).
   - Tăng nhanh hơn luật của chính game đó là có bằng chứng.
   - Đã ký đốt mà đồ vẫn còn là có bằng chứng.
   - Đã nhận cam kết mà không cấp là có bằng chứng.
3. **Phần kẻ gian lấy được là nhỏ, và do bên chịu rủi ro tự chọn trước:**
   - Game mới chỉ nhận một hạn mức nhỏ mỗi tuần từ game lạ. Hạn mức chỉ tăng theo công thức khi hai bên làm ăn sạch.
   - Đồ nhận được mở dần theo giờ chơi thật ở game mới.
   - Có bằng chứng gian lận thì mọi game tự động cắt và thu hồi phần chưa mở.
4. **Hợp đồng theo tháng.** Hai game chỉ chuyển qua lại khi cả hai đã ký hợp đồng cho tháng đó, mỗi bên ký vào log của mình. Muốn tiếp tục thì gia hạn trong 7 ngày cuối tháng; trong tuần đó, chưa đủ hai chữ ký cho tháng sau thì không chuyển được. Không gia hạn là hết hợp đồng. Giá quy đổi đổi được mỗi tuần, báo trước một tuần. Mỗi tháng gia hạn liền mạch thì hạn mức tuần nhân đôi.
5. **Không ai tự quyết.** Mọi quyết định công khai (ký, gia hạn, kết thúc hợp đồng, đổi cách định giá, sửa giao thức) đều bỏ phiếu: host của game 50, cộng đồng người chơi 50, cần 55 để thông qua. Host nhiều người thì là một hội đồng công khai: mỗi thành viên có tài khoản trong chính game, ký phiếu bằng khoá riêng, phiếu công khai, và 50 chia đều theo đầu người. Hội đồng chỉ chặn được một mình khi **cả hội đồng** cùng phản đối. Chi tiết SPEC §14.
6. **Game đẻ ra chỉ để cày giờ?** Không log nào chứng minh được giờ đó là giả, nên giao thức làm cho nó không đáng công: mỗi tuần chỉ nhận một hạn mức nhỏ, chảy một chiều thì 90 ngày tối đa 4 hạn mức, phần nhận chỉ mở theo giờ chơi thật ở game nhận, và **cái đã nhận không bao giờ chuyển đi tiếp** (R9), nên không rửa qua game uy tín được. Dòng chảy giữa các game công khai, auditor chỉ ra game nào đáng nghi trước khi ký. Chi tiết SPEC §13.1.

Ngoài ra, game nhận **không bao giờ thấy món đồ của game kia**, chỉ thấy số giờ, và tự định giá đồ của mình. Thanh kiếm rác từ game rác không thể biến thành thanh kiếm xịn ở game hot.

Chi tiết: [SPEC.md](SPEC.md). Lộ trình: [ROADMAP.md](ROADMAP.md).

## Repo này có gì

| | |
|---|---|
| `SPEC.md` | Giao thức `gnl/0` (tiếng Anh): rate card, 5 thông điệp, hợp đồng, log, các luật R1–R8, API, bảo mật, pháp lý, bỏ phiếu |
| `ROADMAP.md` | Lộ trình cụ thể từng giai đoạn |
| `schemas/gnl.schema.json` | JSON Schema cho rate card, các thông điệp và log |
| `ref/gnl.js` | Code tham chiếu (chỉ dùng `node:crypto`): canonical JSON (RFC 8785), ký/kiểm Ed25519, cây Merkle của log (RFC 9162), luật R2, R3 và R8, cửa sổ hợp đồng, kiểm phiếu |
| `chain/` | Neo checkpoint lên Ronin (Saigon testnet / mainnet) |
| `sandbox/` | Game sandbox nói `gnl/0` (`game.mjs`), auditor ai cũng chạy được (`auditor.mjs`), conformance test (`conform.mjs`), demo 1 lần sạch + 5 kiểu gian lận + 2 kịch bản hợp đồng (`demo.mjs`) |
| `cloud/` | Hai sandbox đang chạy thật (Firebase) |
| `mcp/server.mjs` | MCP server cho agent: đọc SPEC, xem rate card, chạy conformance, audit, kiểm envelope. Chỉ đọc, không giữ bí mật |
| `AGENTS.md` | Hướng dẫn cho AI agent: giúp một game tham gia, luật khi sửa repo |

```sh
npm install
npm run check                # tự kiểm code tham chiếu
npm run wallet               # tạo ví Saigon, xem số dư (lấy RON test: https://faucet.roninchain.com)
npm run anchor               # neo một checkpoint mẫu lên Saigon
npm run anchor -- verify <tx hash>
npm run sandbox              # 2 game sandbox: 1 lần chuyển sạch + 5 kiểu gian lận (auditor phải bắt đủ) + hợp đồng hết hạn / gia hạn
npm run conform -- <origin>  # conformance test vào game của bạn
npm run audit -- <origin>…   # auditor trên log công khai của các game
```

## Sandbox đang chạy

Đồ giả, không cần đăng nhập, ai cũng thử được:

- https://gnl-endless.web.app: ví coin của game Endless Run
- https://gnl-sandbox.web.app: game đồ chơi (vàng, cấp, ngọc)

Mở thẳng hai link trên là thấy trang cho người xem: bảng quy đổi, nhật ký công khai, hợp đồng, các mốc neo (Ronin, Bitcoin), và trình duyệt của bạn tự kiểm chữ ký cùng gốc Merkle, không cần tin server. Mỗi ngày hai game tự commit, ký xác nhận log của nhau và neo checkpoint vào Bitcoin (OpenTimestamps) và Ronin Saigon. Các bước thử bằng curl: xem `AGENTS.md`, hoặc tool MCP `gnl_sandboxes`.

## Cho AI agent

Đọc [AGENTS.md](AGENTS.md). Gắn MCP: `claude mcp add gnl -- node /path/to/gnl/mcp/server.mjs`.

## Tham gia

- Đọc `SPEC.md`, mở issue nếu thấy chỗ nào để lừa được. Đây là phần góp ý quý nhất.
- Muốn cho game của bạn tham gia: làm theo SPEC, chạy thử với hai sandbox ở trên, chạy conformance test, rồi mở issue để ký hợp đồng với các game đang chạy.
- Mỗi game tự chịu trách nhiệm về pháp luật nơi mình hoạt động (SPEC §12).

## Giấy phép

Code: MIT ([LICENSE](LICENSE)). Văn bản giao thức (SPEC.md): CC BY 4.0.

