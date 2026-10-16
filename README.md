# REGARD

> 看見影像的本質，定義更高的標準。

本機優先的影片審片工具。在瀏覽器裡載入影片，在時間點上標記修改、截圖標註、附上參考資料，再匯出一份可以直接寄給客戶或後製的 **PDF / Excel 審片報告**。

所有處理都在你的電腦本機完成 —— **影片不上傳、不經過任何伺服器**。

[English](./README.en.md) · [線上使用](https://kane1a.github.io/REGARD/regard.html)

![REGARD 主畫面](docs/screenshots/hero.png)

## 功能

- **時間點標記** — 播到要改的地方按 `M`（或點「修改此時間點」），時間碼精確到影格（`HH:MM:SS:FF`，自動偵測影片影格率）
- **J/K/L＋逐幀** — `J` 倒退 10 秒、`K` 播放暫停、`L` 前進 10 秒，`,`／`.` 逐幀移動
- **常用片語** — 一鍵帶入常用備註（字幕錯字、音樂突然斷掉…）
- **分類標籤** — 字幕／聲音／畫面／剪輯／調色／其他，匯出報告自動帶上
- **截圖標註** — 畫筆、箭頭、直線、矩形、橢圓，自訂顏色（SV 色盤＋色碼），筆畫粗細四段
- **嚴重度分級** — 必須修改／建議修改／僅提醒，清單上可直接切換
- **參考資料** — 每筆修改可附網址連結（按 Enter 加入）或上傳參考圖片
- **匯出 PDF** — 內嵌 Noto Sans TC＋Inter 字型，中文不亂碼、文字可選取／搜尋，截圖與參考圖自動排版
- **匯出 Excel** — 截圖、參考圖直接嵌在儲存格裡，附篩選與 severity 色塊
- **影片資訊** — 檔名、封裝、編碼、解析度、影格率、位元率、音訊軌一覽；MP4/MOV 可深入解析 moov
- **隱私優先** — 免安裝、免註冊、免上傳；離線也能開（雙擊 `regard.html` 即可）
- **中英雙語＋明暗主題** — 右上角一鍵切換；手機版自動切換精簡選單

| 修改視窗 | 截圖標註 |
|---|---|
| ![修改視窗](docs/screenshots/mark-dialog.png) | ![截圖標註](docs/screenshots/annotate.png) |

| 淺色主題 | 手機版 |
|---|---|
| ![淺色主題](docs/screenshots/light.png) | ![手機版](docs/screenshots/mobile.png) |

### 匯出範例（PDF）

![PDF 匯出範例](docs/screenshots/pdf-sample.png)

## 使用方式

1. 開啟 [REGARD](https://kane1a.github.io/REGARD/regard.html)（或下載後雙擊 `regard.html`）
2. 把影片拖進來，或點「選擇影片檔案」（支援 mp4 / mov / webm 等常見格式）
3. 播到要改的位置，按 `M` 標記時間點：寫備註、選嚴重度
4. 需要畫面證據時，點「標註」在截圖上圈出問題
5. 左上角填專案名稱，點「匯出報告」→ 選 PDF 或 Excel

### 快捷鍵

| 按鍵 | 動作 |
|---|---|
| `Space` | 播放／暫停 |
| `←` `→` | 倒退／前進 5 秒 |
| `J` `K` `L` | 倒退 10 秒／播放暫停／前進 10 秒 |
| `,` `.` | 逐幀倒退／前進 |
| `M` | 在此時間點加入修改 |
| `Shift`+`<` `>` | 降低／提高播放速度 |
| `I` | 影片資訊 |
| `Alt`+`E` | 開啟匯出選單 |
| `Alt`+`N` | 開啟新影片（有未儲存修改時會先確認） |
| `?` | 快捷鍵一覽 |
| `Esc` | 關閉視窗 |

## 隱私

- 影片只透過瀏覽器的 blob URL 讀取，**不會上傳到任何地方**（可開飛航模式驗證）
- jsPDF、ExcelJS、字型檔全部放在 `lib/`、`fonts/`，**沒有任何外部請求**
- 修改紀錄只存在記憶體裡，關掉分頁就消失；不寫 cookie、不打追蹤碼

## 常見問題

**Q：專業格式（ProRes、XAVC、HEVC 10bit、MXF）播不出來？**
瀏覽器不支援這些編碼的預覽。App 會提示你先轉一條 H.264 MP4 代理檔再審片：
`ffmpeg -i 原始檔 -c:v libx264 -crf 20 -c:a aac proxy.mp4`

**Q：PDF 中文亂碼？**
PDF 需要 `fonts/fonts.js`（Noto Sans TC）。如果是自行部署，請確認 `fonts/` 目錄完整；字型會在首次匯出 PDF 時才載入，不影響開啟速度。

**Q：可以離線用嗎？**
可以。把整個資料夾下載下來，雙擊 `regard.html` 即可，匯出功能一樣正常。

## 檔案結構

```
REGARD/
├── regard.html          # 主程式（單檔，免建置）
├── lib/
│   ├── jspdf.umd.min.js # PDF 產生（本地）
│   └── exceljs.min.js   # Excel 產生（本地）
├── fonts/
│   └── fonts.js         # Noto Sans TC + Inter（PDF 內嵌用，延遲載入）
└── docs/screenshots/    # README 截圖
```

## 授權

MIT © kane1a
