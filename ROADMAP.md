# Lộ trình

Mỗi giai đoạn có "xong khi". Chưa xong thì không sang giai đoạn sau. Ưu tiên theo thứ tự: **công bằng, minh bạch**, rồi **chi phí gần 0**.

## Giai đoạn 0: Bản nháp (đang làm)

- [x] Repo, SPEC `gnl/0`, README, giấy phép
- [x] Code tham chiếu: canonical JSON, Ed25519, cây Merkle + inclusion proof, luật R2/R8, có self-check
- [x] Script neo checkpoint lên Ronin (Saigon/mainnet). Phí đo được trên mainnet ~0.00048 RON/lần, tức khoảng $0.01 cho một năm neo mỗi ngày
- [x] Neo thử một checkpoint lên Saigon: [tx 0xfba4…7d86](https://saigon-explorer.roninchain.com/tx/0xfba4184255ae1028f502e355ea77d12199df1bbb8206894de9fb669ca2737d86), 22 440 gas, 0.00047124 RON (L1 fee không đáng kể), `npm run anchor -- verify` khớp
- [x] JSON Schema cho rate card, thông điệp, log (`schemas/gnl.schema.json`)
- [x] Tự đóng vai kẻ gian lần 1 (SPEC §13). Vá 2 lỗ: ticket lộ liên kết tài khoản giữa các game (giờ dùng `sub` một lần) và audit bắt chạy code của đối tác (giờ `pace` là dữ liệu). Còn mở: mức `lineCap` mặc định
- [ ] Code tham chiếu dùng schema để kiểm thông điệp (khi có sandbox)

**Xong khi:** SPEC không còn lỗ hổng nào mình tự tìm ra; schema và code tham chiếu khớp SPEC.

## Giai đoạn 1: Sandbox

Hai bản của một game giả (`sandbox/node.mjs`: vàng, cấp, ngọc; đồng hồ ngày giả lập), chỉ có đồ giả, chạy toàn bộ giao thức. `npm run sandbox` chạy 1 lần sạch + 5 lần gian lận.

- [x] Rate card, ticket, 5 thông điệp, hold/burn/grant, refund, log `entries.jsonl` + `checkpoint.json` (chạy local, trong bộ nhớ)
- [x] Commit hằng ngày, audit (§8), làm nhân chứng cho nhau (nhân chứng tự bắt fork khi ký chéo)
- [x] Hạn mức tuần (R5, chưa tự tăng), vesting 20% + thu hồi khi có fraud proof
- [x] **Auditor** (`npm run audit -- <origin>…`): đọc mọi log, kiểm R1, R2, R7 (hứa mà không cấp, fork), kiểm lại mọi fraud proof R3/R4 game khác đã ghi
- [x] 5 kiểu gian lận cài sẵn, bắt đủ cả 5: vượt trần giờ (R2), đốt mà vẫn giữ (R4), tăng vượt pace (R3), fork log (R7), nhận cam kết mà không cấp (R7). Đã thử phá luật thì demo báo đỏ đúng chỗ
- [x] Tìm thêm lỗ khi làm: ticket công khai không được coi là sự đồng ý cho audit (SPEC §8, §13)
- [x] Đưa lên mạng: https://gnl-endless.web.app và https://gnl-sandbox.web.app (Firebase Functions sau Hosting, lưu Firestore, mỗi ngày tự commit, ký chéo, audit)
- [x] Neo hằng ngày bằng OpenTimestamps (Bitcoin)
- [x] Neo hằng ngày lên Ronin Saigon từ cloud (key là secret `GNL_SAIGON_KEY` owner đặt): tx đầu tiên từ cloud 2026-11-04, block 57264240
- [x] Trang cho người xem ở `/` của mỗi node: rate card, nhật ký dễ đọc, link neo (Ronin, file .ots), và tự kiểm chữ ký + gốc Merkle ngay trong trình duyệt
- [x] Conformance test (`npm run conform -- <origin>`): pass cả 2 sandbox. Nó bắt được một lỗ SSRF (offer từ origin lạ làm server fetch bừa), đã vá: chỉ nhận offer từ đối tác
- [x] `AGENTS.md` + MCP server (`mcp/server.mjs`, chỉ đọc): agent của game khác tự đọc SPEC, thử sandbox, chạy conformance và audit
- [x] Một game thật cắm vào node: Endless Run (https://endless-run.web.app). Coin mỗi lượt vào ví ở `gnl-endless`, nút "Carry them to Sandbox" ngay trên màn game over

**Xong khi:** một lần chuyển đầy đủ chạy được cả hai chiều; auditor bắt đủ 5 kiểu gian lận; conformance test pass trên sandbox.

## Giai đoạn 2: Res World tham gia (beta, 2026-11-04)

Res World là một node: https://resworld.web.app/.well-known/gio-no-luc.json (code trong repo của game: `functions/gnlNode.js`, `functions/crossover.js`, thư viện này vendor vào `functions/gnl/`).

- [x] Đo tốc độ thật từ lịch sử save đã verify (trung vị tăng mỗi giờ chơi), đóng băng cùng rate card
- [x] Xuất: Coin Cash, Linh Thạch, tu vi từ trên xuống (cảnh giới tụt kéo theo thiên phú, hình thức 2, phi hành, đồ đang mặc); bản save mới phải qua `checkSnapshot`
- [x] Nhập: CC hoặc Linh Thạch tuỳ người chơi chọn, 20% ngay, phần còn lại mở theo giờ chơi
- [x] Trong game: Tài khoản → "Mang nỗ lực sang game khác"; trang wiki Giờ Nổ Lực
- [x] Trần giờ 16 h/ngày (game 18+ từ v0.11.38)
- [x] Chạy thật trên tài khoản test: Sandbox → RW, RW → Endless Run (CC), RW → Sandbox (tu vi), auditor sạch trên cả 3 game
- [x] Lỗ tìm ra khi test: khôi phục save cũ sau khi đốt làm nhân đôi đồ. Đã vá (save vượt pace ở thứ đã rời đi bị từ chối 30 ngày sau khi chuyển), SPEC §13
- [ ] Định giá tu vi chính xác hơn: tầng thấp đang bị làm tròn lên 1 cgnl mỗi 1% tầng (định giá cao). Đổi sang đơn vị "giờ tu vi", báo trước 30 ngày theo SPEC §4
- [ ] Nhập tu vi (hiện chỉ nhập CC/Linh Thạch)
- [ ] Neo Ronin cho Res World (hiện chỉ Bitcoin/OpenTimestamps)
- [ ] MCP: tool đọc Giờ Nổ Lực trên `resworldMcp`
- [ ] Mở beta cho mọi người chơi

## Giai đoạn 3: Công bố

- [ ] Đẩy repo lên GitHub công khai, có issue template "tôi tìm ra cách lừa"
- [ ] Bài forum: vấn đề, ý tưởng, vì sao không ai lừa được ai, sandbox để thử ngay, mời tham gia
- [ ] Gom góp ý, ra SPEC `gnl/0.1`

**Xong khi:** có ít nhất một dev ngoài chạy conformance test với game của họ.

## Giai đoạn 4: Đối tác đầu tiên, người chơi thật

- [ ] Hạn mức nhỏ (`lineStart`), vesting bật, hai bên làm nhân chứng cho nhau
- [ ] Tool MCP `gnl_propose`: agent chỉ nháp vào inbox, người chơi bấm xác nhận trong game
- [ ] Trang công khai: các lần chuyển (ẩn danh), hạn mức, fraud proof nếu có

**Xong khi:** một tháng chạy thật không sự cố, hoặc có sự cố và giao thức xử lý đúng như SPEC.

## Giai đoạn 5: On-chain (khi có từ 3 game trở lên)

Đưa danh sách game, hạn mức và fraud proof lên một contract trên Ronin, **không có admin key**. Khi đó không game nào, kể cả Res World, bẻ được luật.

- [ ] Contract: `register`, `setLine`, `offer/accept/burn/grant` (chỉ hash), `proveFraud` (tự kiểm bằng chứng, tự đình chỉ)
- [ ] Chạy trên Saigon vài tháng cùng các đối tác; có người ngoài review
- [ ] Lên mainnet. Mỗi game một ví, giữ ít RON để trả phí

**Xong khi:** các game đọc trạng thái đình chỉ và hạn mức từ chain thay vì từ repo.

## Chi phí dự kiến

| Thứ | Chi phí |
|---|---|
| Log, rate card, API | File tĩnh + function: nằm trong free tier của mỗi game |
| OpenTimestamps (Bitcoin) | 0 |
| Neo Ronin mainnet mỗi ngày | ~0.18 RON/năm (~$0.01 theo giá 11/2026) |
| Giai đoạn 5, mỗi lần chuyển | vài lệnh gọi contract, mỗi lệnh cỡ phần nghìn RON. Đo trên Saigon trước khi hứa con số |
| Ronin testnet | 0 (faucet, 5 lần/ngày) |

## Việc của người chạy repo

- Trả lời issue, nhất là issue "tìm ra cách lừa"
- Giữ khoá ký của sandbox và khoá ví Saigon (`.secrets/`, không bao giờ commit)
- Mỗi bản SPEC mới đều được log và có hiệu lực sau 30 ngày (§4)
