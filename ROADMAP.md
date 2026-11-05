# Lộ trình

[English](ROADMAP.en.md) · Tiếng Việt

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

Hai bản của một game giả (`sandbox/node.mjs`: vàng, cấp, ngọc; đồng hồ ngày giả lập), chỉ có đồ giả, chạy toàn bộ giao thức. `npm run sandbox` chạy 1 lần sạch, 5 lần gian lận và 2 kịch bản hợp đồng.

- [x] Rate card, ticket, 5 thông điệp, hold/burn/grant, refund, log `entries.jsonl` + `checkpoint.json` (chạy local, trong bộ nhớ)
- [x] Commit hằng ngày, audit (§8), làm nhân chứng cho nhau (nhân chứng tự bắt fork khi ký chéo)
- [x] Hạn mức tuần (R5), vesting 20% + thu hồi khi có fraud proof
- [x] **Auditor** (`npm run audit -- <origin>…`): đọc mọi log, kiểm R1, R2, R7 (hứa mà không cấp, fork), kiểm lại mọi fraud proof R3/R4 game khác đã ghi
- [x] 5 kiểu gian lận cài sẵn, bắt đủ cả 5: vượt trần giờ (R2), đốt mà vẫn giữ (R4), tăng vượt pace (R3), fork log (R7), nhận cam kết mà không cấp (R7). Đã thử phá luật thì demo báo đỏ đúng chỗ
- [x] Tìm thêm lỗ khi làm: ticket công khai không được coi là sự đồng ý cho audit (SPEC §8, §13)
- [x] Đưa lên mạng: https://gnl-endless.web.app và https://gnl-sandbox.web.app (Firebase Functions sau Hosting, lưu Firestore, mỗi ngày tự commit, ký chéo, audit)
- [x] Neo hằng ngày bằng OpenTimestamps (Bitcoin)
- [x] Neo hằng ngày lên Ronin Saigon từ cloud (key là secret `GNL_SAIGON_KEY` owner đặt): tx đầu tiên từ cloud 2026-11-04, block 57264240
- [x] Trang cho người xem ở `/` của mỗi node: rate card, nhật ký dễ đọc, hợp đồng, link neo (Ronin, file .ots), và tự kiểm chữ ký + gốc Merkle ngay trong trình duyệt
- [x] Conformance test (`npm run conform -- <origin>`): pass cả 2 sandbox. Nó bắt được một lỗ SSRF (offer từ origin lạ làm server fetch bừa), đã vá: chỉ nhận offer từ đối tác
- [x] `AGENTS.md` + MCP server (`mcp/server.mjs`, chỉ đọc): agent của game khác tự đọc SPEC, thử sandbox, chạy conformance và audit
- [x] Endless Run (https://endless-run.web.app) cắm vào node, làm **sandbox thứ hai** (không phải game đối tác thật, 2026-11-05): coin mỗi lượt vào ví ở `gnl-endless`, nút "Carry them to Sandbox" ngay trên màn game over. Hai sandbox để dễ thử và dễ lộ bug

**Xong khi:** một lần chuyển đầy đủ chạy được cả hai chiều; auditor bắt đủ 5 kiểu gian lận; conformance test pass trên sandbox.

## Giai đoạn 2: Res World tham gia (beta, 2026-11-04)

Res World là một node: https://resworld.web.app/.well-known/gio-no-luc.json (code trong repo của game: `functions/gnlNode.js`, `functions/crossover.js`, thư viện này vendor vào `functions/gnl/`).

- [x] Đo tốc độ thật từ lịch sử save đã verify (trung vị tăng mỗi giờ chơi), đóng băng cùng rate card
- [x] Xuất: Coin Cash (theo nghìn), Linh Thạch, tu vi **của tầng hiện tại** (2026-11-05: không còn tụt cảnh giới, vì tụt làm mất rồi kích hoạt lại nhiệm vụ); bản save mới phải qua `checkSnapshot`
- [x] Nhập: CC hoặc Linh Thạch tuỳ người chơi chọn, 20% ngay, phần còn lại mở theo giờ chơi
- [x] Trong game: Tài khoản → "Mang nỗ lực sang game khác"; trang wiki Giờ Nổ Lực
- [x] Trần giờ 16 h/ngày (game 18+ từ v0.11.38)
- [x] Chạy thật trên tài khoản test: Sandbox → RW, RW → Endless Run (CC), RW → Sandbox (tu vi), auditor sạch trên cả 3 game
- [x] Lỗ tìm ra khi test: khôi phục save cũ sau khi đốt làm nhân đôi đồ. Vá lần 1 bằng pace thì vẫn lọt sau đủ nhiều giờ (2026-11-05). Vá lần 2: server đếm số lần chuyển vào chính save, save đếm ít hơn tài khoản thì từ chối vĩnh viễn; đã chạy lại tấn công, bị chặn. SPEC §13
- [x] Nhập tu vi: vào thanh của tầng đang tu, đầy thì chờ, không tự đột phá (2026-11-05)
- [x] MCP: `gnl_rates`, `gnl_effort` (chỉ đọc) trên `resworldMcp`
- [x] Hết định giá cao do làm tròn: CC tính theo nghìn (100 CC chỉ đáng 0.33 cgnl mà bị làm tròn lên 1), tầng tu vi nào 1% chưa tới 1 cgnl thì không xuất. Cả hai có lợi cho đối tác nên có hiệu lực ngay (SPEC §4)
- [x] Neo Ronin cho Res World, gián tiếp: hai sandbox ký xác nhận checkpoint của Res World mỗi ngày, và checkpoint của chúng lên Ronin Saigon mỗi ngày. Không thêm thư viện chain vào game. Neo trực tiếp khi lên mainnet
- [ ] Mở beta cho mọi người chơi

## Hợp đồng và bỏ phiếu (2026-11-05)

- [x] Hợp đồng theo tháng giữa từng cặp game (SPEC §5.1): mỗi bên ký vào log của mình; gia hạn trong 7 ngày cuối tháng; tuần đó chưa đủ hai chữ ký cho tháng sau thì cấm chuyển; không gia hạn là hết. Đã có trong `game.mjs`, demo có kịch bản hết hạn và gia hạn, conformance kiểm cửa sổ ký
- [x] Hạn mức tuần (R5) nhân đôi mỗi tháng gia hạn liền mạch
- [x] Giá đổi được mỗi tuần, có hiệu lực từ thứ Hai cách ít nhất 7 ngày sau khi ghi log; đổi có lợi cho đối tác thì có hiệu lực ngay (SPEC §4). Mỗi bản rate card mới được ghi vào log
- [x] Luật bỏ phiếu (SPEC §14): host 50, cộng đồng 50, cần 55; người chơi đủ điều kiện là đã có trong cam kết hằng ngày ≥ 30 ngày và chơi ≥ 10 giờ trong 30 ngày; phiếu ẩn danh một lần, có bằng chứng Merkle; game dưới 30 người đủ điều kiện thì host tự quyết và ghi rõ. `tally()` trong `ref/gnl.js`
- [x] Hội đồng host (SPEC §14): danh sách công khai trong rate card, mỗi thành viên có tài khoản trong game và khoá riêng, phiếu ký công khai; 50 chia đều theo đầu người, hội đồng chỉ tự chặn được khi cả hội đồng phản đối
- [x] Game đẻ ra để cày giờ (SPEC §13.1): R9 cấm chuyển tiếp cái đã nhận (demo `relay`), hạn mức ròng 90 ngày (R5) đã chạy thật, auditor có báo cáo dòng chảy (`npm run audit`, MCP `gnl_flows`), danh sách việc phải kiểm trước khi ký đối tác mới (§5.1)
- [x] Hội đồng là bên vận hành, không bầu: vào/ra ghi log (người vào phải tự ký đồng ý), hội đồng của một đợt bầu bị đóng băng lúc mở phiếu, người vào sau 7 ngày mới tính, người rời trong 7 ngày trước vẫn giữ một ghế phiếu chống
- [x] Quyết định nới rủi ro (ký mới, tăng hạn mức, đổi cách định giá) mới cần bỏ phiếu; thu hẹp (không gia hạn, dừng, hạ hạn mức) host tự làm; gia hạn cùng điều khoản không cần bầu lại
- [x] R10: một nguồn cho mỗi tài khoản nhận (mỗi game đối tác), trần nhận theo số ngày có mặt (demo `sources`)
- [x] Huỷ và phạt (SPEC §8.1): game gửi huỷ lần chuyển khi có bằng chứng; cả tài khoản gửi và nhận nợ 100% số giờ, trả nợ trước mọi thứ (demo `void`)
- [x] `JOINING.md` / `JOINING.en.md`, mẫu issue "Xin gia nhập" và "Tôi tìm ra cách lừa"
- [x] Master (SPEC §14): một người mỗi game, bình thường một ghế, quyết khi kết quả sát nút (50–60) nhưng không vượt được mức 10% cộng đồng; mọi thay đổi hội đồng/master chờ 7 ngày mới tính phiếu. Res World: master là chủ game, khoá và chữ ký đồng ý tạo trên máy bằng `npm run council`
- [x] R10 nới: một nguồn cùng lúc, huỷ liên kết rồi chờ 7 ngày (demo `sources`)
- [x] Bảng công sức chuẩn `/gnl/effort.json` (SPEC §4.1), trang trạng thái hiện nó; Res World có trang ở https://resworld.web.app/gnl/
- [x] Số ngày đối tác tối thiểu là tham số của từng game (`policy.partnerMinDays`): Res World 7, tăng dần tới 30
- [x] `examples/your-game.mjs`; bot tự chạy conformance + audit dưới mỗi issue xin gia nhập
- [x] Res World: giá nhập tu vi theo tốc độ ngồi thiền nếu chậm hơn số đo (trước đó rẻ gấp ~15 lần); Sandbox chỉ cho tài khoản test; UI chia 3 tab
- [x] Hội đồng quyết thay master (SPEC §14): hội đồng một người thì master tự quyết; từ hai người, mọi việc riêng của game là `order` có quá nửa số ghế ký (việc chỉ giảm rủi ro: hoà thì theo master; ghế và master không bao giờ quyết bằng hoà); master một mình chỉ `pause` tối đa 7 ngày. `POST /gnl/order`, `npm run order`, `orderOk()`; conformance kiểm từng lệnh (demo `council`)
- [x] Thu phần chưa trao (SPEC §8.2, `cut`): game nhận tự sửa lỗi giá của mình, không ai nợ. Res World thu phần chưa mở của Bọ Chét từ Sandbox (lệnh của master)
- [x] R10 ghi log: `link` on/off, mỗi accept ghi `holder`; `links()` kiểm từ log, auditor đối chiếu với offer của game gửi, conformance kiểm
- [x] Endless Run là sandbox thứ hai: tài khoản thật của Res World không chuyển với sandbox nào
- [ ] Res World: màn bỏ phiếu trong game, ghi `proposal` / `tally` vào log (backlog #368)
- [ ] Bỏ phiếu cấp giao thức: mỗi game thành viên ghi `proposal` cho một PR của SPEC, gộp bằng `tallyProtocol()`

## Giai đoạn 3: Công bố

- [x] Đẩy repo lên GitHub công khai (https://github.com/HaiDangVo/gnl)
- [x] Bản tiếng Anh: `README.en.md`, `ROADMAP.en.md`, trang trạng thái hai thứ tiếng (mặc định tiếng Việt)
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
- Mỗi bản SPEC mới qua bỏ phiếu cấp giao thức (§14), rồi mới merge
