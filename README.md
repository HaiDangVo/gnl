# Giờ Nổ Lực

**Mang công sức của mình từ game này sang game khác: minh bạch, công bằng, gần như miễn phí.**

Bạn đã cày 300 giờ ở một game. Giờ muốn thử game khác mà không phải bắt đầu lại từ số 0? Với Giờ Nổ Lực, game cũ quy đổi những gì bạn đã đạt được (tiền, đồ, cấp, tu vi…) ra **giờ nỗ lực**. Bạn chọn mang đi một phần hoặc toàn bộ. Game mới tặng bạn một khởi đầu tương xứng, theo luật của chính nó. Đồ ở game cũ chỉ mất khi game mới đã ký cam kết nhận.

Đây là **giao thức mở**: game nào, studio nào, server nào cũng tham gia được. Không token, không coin, không sàn, không ai đứng giữa ăn phí.

> Trạng thái: **bản nháp 0** (11/2026). Chưa chạy với người chơi thật. Mời góp ý.

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

Ngoài ra, game nhận **không bao giờ thấy món đồ của game kia**, chỉ thấy số giờ, và tự định giá đồ của mình. Thanh kiếm rác từ game rác không thể biến thành thanh kiếm xịn ở game hot.

Chi tiết: [SPEC.md](SPEC.md). Lộ trình: [ROADMAP.md](ROADMAP.md).

## Repo này có gì

| | |
|---|---|
| `SPEC.md` | Giao thức `gnl/0`: rate card, 5 thông điệp, log, các luật R1–R8, API, bảo mật, pháp lý |
| `ROADMAP.md` | Lộ trình cụ thể từng giai đoạn |
| `schemas/gnl.schema.json` | JSON Schema cho rate card, các thông điệp và log |
| `ref/gnl.js` | Code tham chiếu (chỉ dùng `node:crypto`): canonical JSON (RFC 8785), ký/kiểm Ed25519, cây Merkle của log (RFC 9162), luật R2, R3 và R8 |
| `chain/` | Neo checkpoint lên Ronin (Saigon testnet / mainnet) |
| `sandbox/` | Game sandbox nói `gnl/0` (`node.mjs`), auditor ai cũng chạy được (`auditor.mjs`), demo 1 lần sạch + 5 kiểu gian lận (`demo.mjs`) |

```sh
npm install
npm run check                # tự kiểm code tham chiếu
npm run wallet               # tạo ví Saigon, xem số dư (lấy RON test: https://faucet.roninchain.com)
npm run anchor               # neo một checkpoint mẫu lên Saigon
npm run anchor -- verify <tx hash>
npm run sandbox              # 2 game sandbox: 1 lần chuyển sạch + 5 kiểu gian lận, auditor phải bắt đủ
```

## Tham gia

- Đọc `SPEC.md`, mở issue nếu thấy chỗ nào để lừa được. Đây là phần góp ý quý nhất.
- Muốn cho game của bạn tham gia: làm theo SPEC, chạy thử với **game sandbox** (sắp có, xem ROADMAP), rồi mở issue để được thêm vào danh sách đối tác.
- Mỗi game tự chịu trách nhiệm về pháp luật nơi mình hoạt động (SPEC §12).

## Giấy phép

Code: MIT ([LICENSE](LICENSE)). Văn bản giao thức (SPEC.md): CC BY 4.0.

---

**English, briefly.** Giờ Nổ Lực ("effort hours") is an open protocol that lets a player carry the effort they put into one game over to another. The first game retires what the player chooses to give up and signs what it was worth in hours. The second game grants its own things under its own rules. There is no token and no middleman. Each game keeps its own public, append-only log, witnessed by the other games and timestamped in Bitcoin. Lies are detected mechanically and cut off automatically, and every game caps its own exposure. See SPEC.md.
