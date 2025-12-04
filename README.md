### 說明
本文件旨在詳細介紹日誌(LOG)系統的設計理念、架構演進、核心組件功能以及實際操作指南。文件內容涵蓋從舊版單體架構到新版基於 RabbitMQ 的微服務架構的轉變，並提供開發者完整的程式碼範例與運行說明，幫助團隊快速理解系統運作原理，確保生產環境的高可靠性與監控能力。

#### **修訂歷史**
* **v1.4 (2025-12-04)**： 修正不適當的比喻，整合參數段落，修正Telegram 配置說明，刪除附錄及文句部分微調。
* **v1.3 (2025-12-01)**： 提取新日誌系統部分單獨介紹，移除圖表改用文字表示並再次修正格式。
* **v1.2 (2025-11-27)**： 全面優化文件格式與排版，統一結構標準，提升可讀性與專業度。
* **v1.1 (2025-11-19)**： 大改版，優化文件結構，更符合技術文檔需求，整合系統概述、架構圖、核心組件、程式碼範例與運行說明。
* **v1.0 (2025-11-13)**： 初版發布，包含舊版與新版 LOG 系統的完整使用說明。

---

# **日誌系統技術文件**

**版本：1.3 (2025-12-04)**  
**最後更新：2025-12-04**

### 1. 系統概述

本章目的：介紹日誌系統的基本概念，幫助新人快速理解系統的目的和運作原理。

#### 1.1. 什麼是 LOG 系統?

LOG 系統是一套**日誌管理和通知系統**，負責記錄應用程式運行時的各種事件，並在需要時發送通知。

#### 1.2. 系統的主要功能

* **記錄日誌**
    * 記錄 API 運行時的資訊、錯誤、除錯訊息
    * 將日誌統一發送到 LogBeacon 伺服器儲存
    * 方便後續查詢和分析

* **發送通知**
    * 當發生錯誤時，自動發送 Telegram 通知
    * 區分開發者通知和客戶通知
    * 即時掌握系統異常狀況

* **非阻塞處理**
    * 日誌處理不會影響 API 的回應速度
    * 使用非同步機制，將日誌發送工作移到背景處理
    * 確保使用者體驗不受影響

#### 1.3. 為什麼需要日誌系統?

在開發和維運過程中，我們需要：

* **追蹤問題**：當用戶回報錯誤時，可以從日誌中找到發生了什麼
* **監控系統**：了解系統運行狀況，及早發現潛在問題
* **通知告警**：重要錯誤發生時，能立即通知相關人員處理
* **數據分析**：收集日誌數據，分析系統使用情況和效能瓶頸

#### 1.4. 這套系統要解決什麼問題?
* **日誌散落各處**
    * 以前：日誌可能只輸出到終端，重啟後就消失
    * 現在：統一發送到 LogBeacon 伺服器，集中管理

* **錯誤不易察覺**
    * 以前：錯誤發生時，可能沒人注意到
    * 現在：重要錯誤會自動發送 Telegram 通知

* **日誌發送影響效能**
    * 以前：如果直接在 API 中發送日誌，會拖慢回應速度
    * 現在：使用佇列機制，非阻塞處理

#### 1.5. 核心概念：生產者、佇列、消費者

LOG 系統採用**生產者-消費者模式**，這是一種常見的架構模式。

* **什麼是生產者-消費者模式?**

    * 用郵局比喻：
```
寄信人寫信 (生產者)
    ↓
信件/包裹 (訊息)
    ↓
郵筒或集貨籃 (佇列/Queue)
    ↓
郵務人員分類與投遞 (消費者)
    ↓
送達收件人手中 (目標)
```

* **關鍵點：**

    * 發送訊息的程式不用等待處理結果，可以繼續執行下一行程式碼(非阻塞)
    * 佇列確保資料在被處理前是安全的，能應對突發流量(持久化)
    * 當資料量變大時，可以輕易增加處理程式的數量來加快速度(可擴展)
    * 生產資料的系統與處理資料的系統互不影響，降低系統複雜度(解耦)

#### 1.6. 在日誌系統中的三個角色

#### 1.6.1. 生產者 (Producer)

* **是什麼：**

    * 產生日誌訊息的程式
    * 在我們的系統中，就是 API 主程式

* **做什麼：**

    * 當 API 需要記錄日誌時，呼叫日誌函數
    * 將日誌包裝成訊息
    * 放入佇列中

* **舉例：**
```python
# API 處理訂單時發生錯誤
await logsys.log(
    level=9,                    # 錯誤級別
    def_name="process_order",   # 哪個函數
    message="訂單處理失敗",      # 錯誤訊息
    extra_info={"order_id": 123}  # 額外資訊
)
# 呼叫後立即返回，不會等待發送完成
```

#### 1.6.2. 佇列 (Queue)

* **是什麼：**

    * 暫存訊息的地方
    * 就像郵筒或集貨籃

* **做什麼：**

    * 接收生產者放入的訊息
    * 保存訊息直到消費者來取
    * 確保訊息不會遺失

* **兩種實作：**

    * **舊版**：使用 `asyncio.Queue` (記憶體佇列)
    * **新版**：使用 RabbitMQ (獨立的佇列服務)

#### 1.6.3. 消費者 (Consumer)

* **是什麼：**

    * 處理訊息的程式
    * 就像郵務人員分類與投遞

* **做什麼：**

    * 持續監聽佇列
    * 取出訊息
    * 執行實際的發送工作 (HTTP POST 到 LogBeacon 或 Telegram)
    * 回報處理結果

* **舉例：**

    * `send_logbeacon.py`：從佇列取出日誌，發送到 LogBeacon 伺服器
    * `send_tg.py`：從佇列取出通知，發送到 Telegram

#### 1.7. 為什麼要用這種模式?

* **解耦 (Decoupling)**

    * 生產者不需要知道消費者在哪裡
    * 消費者不需要知道生產者是誰
    * 兩者可以獨立開發和部署

* **非阻塞 (Non-blocking)**

    * API 放入訊息後立即返回
    * 不需要等待日誌實際發送完成
    * 回應速度快

* **可靠性 (Reliability)**

    * 訊息存在佇列中，不會因為程式重啟而遺失
    * 消費者暫時離線，訊息會累積在佇列中
    * 消費者重新上線後繼續處理

* **可擴展 (Scalability)**

    * 日誌量大時，可以啟動多個消費者平行處理
    * 不需要修改生產者的程式碼

#### 1.8. 系統切換

在 `config_api.py` 中提供了開關，可以在兩套系統間切換：
```python
# 控制使用哪套日誌系統
USE_NEW_LOGSYS = True   # True： 使用新版，False： 使用舊版
```

### 2. 日誌系統組件及訊息流向

本章目的：幫助讀者快速理解日誌系統的整體架構和訊息流向。

#### 2.1. 組件配置：

* **API 主程序 (生產者)**
    * example_api.py：API 主程式
    * logsys_mq：日誌系統核心類別

* **RabbitMQ (訊息佇列)**
    * `logbeacon` 佇列：存放 LogBeacon 日誌
    * `tg` 佇列：存放 Telegram 通知

* **Workers (消費者)**
    * send_logbeacon.py：處理 LogBeacon 佇列
    * send_tg.py：處理 Telegram 佇列

* **目標端點**
    * LogBeacon 伺服器：接收日誌
    * Telegram Bot API：接收通知

* **特點：**

    * 各組件獨立運行
    * 透過 RabbitMQ 通訊
    * 可以獨立部署和擴展

#### 2.2. 日誌系統訊息流向

說明：詳細說明訊息在系統中的完整流轉過程。

```
步驟 1： API 產生日誌
    ↓
FastAPI 處理請求時需要記錄日誌
    ↓
呼叫 logsys.log(level, def_name, message, extra_info)
    ↓
步驟 2： 決定目標佇列
    ↓
LogSysMQ 根據 level 決定發送到哪些佇列：
  - level 1， 9， 11， 91 → 發送到 logbeacon 佇列
  - level 9， 91 → 發送到 tg 佇列(開發者)
  - level 11， 91 → 發送到 tg 佇列(客戶)
    ↓
步驟 3： 發送到 RabbitMQ
    ↓
訊息被序列化成 JSON 並發送到對應佇列：
  - logbeacon 佇列
  - tg 佇列
    ↓
訊息持久化到磁碟
    ↓
API 返回(非阻塞)
    ↓
步驟 4： Workers 消費訊息
    ↓
send_logbeacon.py 監聽 logbeacon 佇列
    ↓
從佇列取出訊息
    ↓
HTTP POST 到 LogBeacon API
    ↓
  成功：ACK(確認訊息)
  失敗：NACK(拒絕訊息)   
send_tg.py 監聽 tg 佇列
    ↓
從佇列取出訊息
    ↓
HTTP POST 到 Telegram Bot API
    ↓
  成功：ACK
  失敗：NACK
    ↓
完成
```

* **關鍵點：**

    * API、RabbitMQ、Workers 是三個獨立的程式
    * 訊息持久化在 RabbitMQ 中，重啟不會遺失
    * Workers 可以獨立重啟，不影響 API
    * 透過 ACK/NACK 機制確保訊息不會遺失

#### 2.3. 新版系統的備援機制

當 RabbitMQ 無法連線時，新版系統會自動啟動備援模式：
```
API 嘗試發送訊息到 RabbitMQ
    ↓
RabbitMQ 連線失敗
    ↓
LogSysMQ 偵測到連線失敗
    ↓
自動切換到備援模式
    ↓
直接呼叫目標 API：
  - LogBeacon 日誌 → 直接 HTTP POST 到 LogBeacon API
  - Telegram 通知 → 直接 HTTP POST 到 Telegram Bot API
    ↓
背景任務持續嘗試重連 RabbitMQ
    ↓
重連成功後恢復使用 RabbitMQ
```

這確保了即使 RabbitMQ 暫時離線，重要的錯誤日誌和通知仍然能夠送達。

### 3. 系統環境配置

本章目的：介紹系統運作所需的所有環境變數與參數配置。

#### 3.1. Telegram 配置

說明：以下是有關於 Telegram 相關的配置。

```python
DEV_TG_CHATID = ""
DEV_TG_TOKEN = ""
```

#### 3.1.1. DEV_TG_CHATID

說明：開發者 Telegram 群組的 Chat ID。

* **取得方式：**

    * 建立 Telegram 聊天室，將你的帳號和 Bot 加入同一個房間
    * 使用電腦瀏覽器登入 [Telegram Web](https://web.telegram.org/)
    * 點擊進入該群組，查看瀏覽器網址列 # 符號後面的數字
    * 填入規則：
        * 若網址顯示為負數 (如 -506...)：直接複製使用 (普通群組)
        * 若網址顯示為正數：請在前方加上 -100 (超級群組)

#### 3.1.2. DEV_TG_TOKEN

說明：開發者 Telegram Bot 的 API Token。

* **取得方式：**

    * 開啟 Telegram 並搜尋 @BotFather
    * 輸入指令 /newbot 創建一個新的Bot 或者 /mybot 選擇你擁有的Bot
    * 選擇你要使用的 Bot
    * 點選 API Token 選項
    * 複製顯示的 Token

#### 3.2. MySQL 連接池配置

說明：以下是有關於 MySQL 連接池相關的配置。

```python
MYSQL_DB = ""
MYSQL_HOST = ""
MYSQL_USER = ""
MYSQL_PASSWD = ""
MYSQL_PORT = 0000
```

   * 設定方式： 請參照 STK 測試環境資料 中的 MySQL 配置填入對應欄位

       * MYSQL_DB：資料庫名稱 (請登入 phpMyAdmin 確認左側列表中的名稱)
       * MYSQL_HOST：主機位址 (請使用 外網連線 (透過 SSH 端口轉發))
       * MYSQL_USER / MYSQL_PASSWD：請填入 MySQL 通用帳號與密碼
       * MYSQL_PORT：資料庫端口 (請填寫您分配到的 個人外部連接端口)

#### 3.3. Redis 配置

說明：以下是有關於 Redis 相關的配置。

```python
REDIS_HOST = ""
REDIS_PASSWD = ""
REDIS_PORT = 0000
```
   * 設定方式： 請參照 STK 測試環境資料 中的 Redis 配置填入對應欄位

       * REDIS_HOST：主機位址 (請使用 外網連線 (透過 SSH 端口轉發))
       * REDIS_PASSWD：請填入 Redis 通用密碼
       * REDIS_PORT：伺服器端口 (請填寫您分配到的 個人外部連接端口)

#### 3.4. RabbitMQ 配置

說明：以下是有關於RabbitMQ 相關的配置。

```python
# 服務連線設定
MALLMQUSER = ""
MALLMQPASS = ""
MALLMQHOST = ""
MALLMQPORT = 0

# 管理介面 (Web UI/API) 設定
APIMQPROTO = "https"
APIMQHOST = ""
APIMQPORT = 443
```

   * 設定方式： 請參照 STK 測試環境資料 中的 RabbitMQ 配置填入對應欄位

       * MALLMQUSER / MALLMQPASS：請填入 RabbitMQ 管理介面 (Web UI) 的帳號與密碼
       * MALLMQHOST：主機位址 (請使用 外網連線 (透過 SSH 端口轉發))
       * MALLMQPORT：服務端口 (請填寫您分配到的 個人外部連接端口)
       * APIMQHOST：管理介面主機位址 (請參照 Web UI 網址)
       * APIMQPROTO / APIMQPORT：管理介面協定與端口 (預設分別為 "https" 與 443)

#### 3.5. 日誌系統配置

說明：日誌系統版本切換開關。

```python
USE_NEW_LOGSYS = True
```
   * `True`：使用新版日誌系統 (基於 RabbitMQ)
   * `False`：使用舊版日誌系統 (基於 asyncio.Queue)

#### 3.6. DOMAIN_NAME

說明：服務域名，用於區分不同服務的日誌佇列。

```python
DOMAIN_NAME = ""
```

### 4. 日誌系統架構詳解

本章目的：說明日誌系統的運作原理、組件互動方式與佇列設計。

#### 4.1. 架構概覽

說明：將日誌系統解構成獨立組件，使用 RabbitMQ 作為訊息佇列，提升可靠性和擴展性。

* **核心檔案概覽**

| 檔案 | 角色 | 功能 |
|------|------|------|
| **logsys_mq.py** | 生產者 | 產生日誌並發送到 RabbitMQ |
| **send_logbeacon.py** | 消費者 | 消費 logbeacon 佇列，發送到 LogBeacon 伺服器 |
| **send_tg.py** | 消費者 | 消費 telegram 佇列，發送到 Telegram Bot |

#### 4.2. logsys_mq.py (生產者)

說明：LogSystem 類別負責產生日誌並推送到 RabbitMQ，是新版日誌系統的核心生產者。

* **主要功能：**

#### 4.2.1. 初始化連線
   * 建立 RabbitMQ 連線 (使用 aio_pika)
   * 宣告兩個佇列：`{domain}_logbeacon` 和 `{domain}_tg`
   * 連線失敗時啟用備援模式

#### 4.2.2. 接收日誌
   * 提供 `log()` 方法接收日誌參數
   * 根據 level 決定發送到哪些佇列
   * 包裝成對應格式的訊息

#### 4.2.3. 發送到 MQ
   * 將訊息序列化成 JSON
   * 發送到對應的 RabbitMQ 佇列
   * 訊息設定為持久化 (durable)

#### 4.2.4. 訊息格式範例

* **LogBeacon 佇列訊息**
```json
{
  "domain": "example.com",
  "program_name": "api_server",
  "level": "Error",
  "def_name": "process_order",
  "message": "訂單處理失敗",
  "extra_info": "訂單編號： 12345",
  "timestamp": "2025-11-26 10：30：00",
  "hash": "abc123"
}
```

* **Telegram 佇列訊息**
```json
{
  "tg_token": "1234567890：ABC...",
  "tg_chatid": "-1002017182237",
  "notify_msg": "錯誤時間：2025-11-26 10：30：00 ...",
  "type": "developer",
  "timestamp": "2025-11-26 10：30：00",
  "hash": "abc123"
}
```

* **關鍵機制：**

    * **重連監控**：背景任務持續監控 MQ 連線狀態，斷線時自動重連
    * **備援模式**：MQ 無法連線時，自動切換為直接呼叫目標 API
    * **優雅關閉**：確保所有進行中的發送任務完成後才關閉

#### 4.3. send_logbeacon.py (LogBeacon 消費者)

說明：獨立運行的 Worker 程式，專門消費 `{domain}_logbeacon` 佇列，將日誌發送到 LogBeacon 伺服器。

* **工作流程：**

    1. 連線到 RabbitMQ (使用 config_api.py 中的 LOG_MQ_CONFIG)
    2. 宣告並監聽 `{domain}_logbeacon` 佇列
    3. 從佇列取出訊息 (一次取一個，prefetch_count=1)
    4. 解析 JSON 訊息內容
    5. 發送 HTTP POST 到 LogBeacon API
    6. 根據發送結果進行訊息確認：
        * 成功：`message.ack()` (從佇列移除)
        * 失敗：`message.nack(requeue=False)` (標記失敗，不重新排隊)

* **關鍵機制：**

    * **重試機制**：發送失敗時自動重試最多 3 次，每次間隔 5 秒
    * **訊息確認 (ACK/NACK)**：確保訊息處理狀態被 RabbitMQ 記錄
    * **健康檢查**：每 60 秒顯示佇列狀態和待處理訊息數量
    * **優雅關閉**：收到停止信號時，處理完當前訊息才退出
    * **自動重連**：連線失敗時自動重新連線，最多重試 5 次

* **啟動方式：**

說明：在終端機中執行以下指令來啟動發送訊息至LogBeacon的worker。

```bash
python send_logbeacon.py
```

#### 4.4. send_tg.py (Telegram 消費者)

說明：獨立運行的 Worker 程式，專門消費 `{domain}_tg` 佇列，將通知發送到 Telegram。

* **工作流程：**

    1. 連線到 RabbitMQ
    2. 宣告並監聽 `{domain}_tg` 佇列
    3. 從佇列取出訊息
    4. 解析 JSON 訊息 (提取 tg_token、tg_chatid、notify_msg)
    5. 發送 HTTP POST 到 Telegram Bot API (`https：//api.telegram.org/bot{token}/sendMessage`)
    6. 根據發送結果進行訊息確認

* **關鍵機制：**

    * **重試機制**：失敗時重試最多 3 次，間隔 30 秒 (考慮 Telegram API 速率限制)
    * **訊息確認 (ACK/NACK)**
    * **健康檢查**：定期顯示佇列狀態
    * **優雅關閉**：處理完當前訊息才退出
    * **自動重連**：連線失敗時自動重連

* **Telegram API 限制：**

    * 每秒最多 30 次請求
    * 每分鐘對同一對象最多 20 次請求

* **啟動方式：**

說明：在終端機中執行以下指令來啟動發送訊息至Telegram的worker。

```bash
python send_tg.py
```

#### 4.5. RabbitMQ (訊息佇列)

說明：獨立運行的訊息佇列服務，負責暫存和分發日誌訊息，共有兩個佇列。

#### 4.5.1. `{domain}_logbeacon` 佇列
   * 用途：存放要發送到 LogBeacon 伺服器的日誌
   * 消費者：send_logbeacon.py

#### 4.5.2. `{domain}_tg` 佇列
   * 用途：存放要發送到 Telegram 的通知
   * 消費者：send_tg.py

* **佇列命名範例：**

| DOMAIN_NAME | LogBeacon 佇列 | Telegram 佇列 |
|-------------|---------------|--------------|
| example.com | example.com_logbeacon | example.com_tg |
| 24hrpay | 24hrpay_logbeacon | 24hrpay_tg |

這樣的設計讓多個服務可以共用同一個 RabbitMQ 伺服器，透過不同的佇列名稱區隔日誌。

* **RabbitMQ 特性：**

    * **訊息持久化**：訊息存儲在磁碟上，重啟不會遺失
    * **解耦架構**：生產者和消費者獨立運行
    * **可擴展性**：可以啟動多個 Workers 平行處理同一個佇列
    * **可靠性**：透過 ACK/NACK 機制確保訊息不會遺失

### 5. 程式碼範例解析

本章目的：透過 example_api.py 中的真實範例，說明如何在程式中使用日誌系統。

#### 5.1. 日誌級別說明 (LEVEL_MAP)

說明：系統提供六種日誌級別，對應不同的使用場景和通知方式。

#### 5.1.1. 日誌級別對照表

| Level | 名稱 | 用途 | 終端輸出 | LogBeacon | 開發者 TG | 客戶 TG | 使用時機 |
|-------|------|------|---------|-----------|----------|---------|----------|
| **0** | Debug | 除錯訊息 | ✅ | ❌ | ❌ | ❌ | 開發階段追蹤程式流程、變數狀態 |
| **1** | Info | 一般資訊 | ✅ | ✅ | ❌ | ❌ | 正常操作記錄，如查詢成功、操作完成 |
| **9** | Error | 錯誤訊息 | ✅ | ✅ | ✅ | ❌ | 系統錯誤、異常情況，需要開發者關注 |
| **11** | Info_CTG | 客戶資訊 | ✅ | ✅ | ❌ | ✅ | 需要通知客戶的一般資訊 |
| **91** | Error_CTG | 客戶錯誤 | ✅ | ✅ | ✅ | ✅ | 需要同時通知開發者和客戶的錯誤 |
| **99** | Monitor | 監控訊息 | ✅ | ❌ | ❌ | ❌ | 系統監控、效能追蹤等特殊用途 |

#### 5.1.2. 使用原則

   * **Level 0 (Debug)**：開發時使用，追蹤細節，不發送到外部
   * **Level 1 (Info)**：生產環境記錄正常操作，發送到 LogBeacon 儲存
   * **Level 9 (Error)**：發生錯誤時使用，會通知開發者處理
   * **Level 11/91**：涉及客戶時使用，CTG = Customer Telegram Group
   * **Level 99 (Monitor)**：特殊監控用途，通常用於效能追蹤

#### 5.2. 使用範例

說明：從 example_api.py 中截取真實的使用案例，展示不同情境下的日誌記錄方式。

#### 5.2.1. 範例：記錄除錯訊息 (Level 0)

* **情境：** WebSocket 連線時，記錄心跳檢測訊息
```python
# 收到客戶端的 ping 訊息，回覆 pong
if data.strip().lower() == "ping"：
    last_ping_time = datetime.datetime.utcnow()
    await websocket.send_text("pong")
    await logsys(0, "s2u_websocket_endpoint", f"收到 ping，回 pong 給 {user_id}", "")
```

* **這會發生什麼：**

    * ✅ 在終端輸出藍色的除錯訊息
    * ❌ 不發送到 LogBeacon
    * ❌ 不發送 Telegram 通知

* **用途：** 開發時追蹤 WebSocket 連線狀態，了解心跳是否正常運作。

#### 5.2.2. 範例：記錄一般操作 (Level 1)

* **情境：** 查詢用戶通知列表後，記錄返回結果
```python
# 查詢成功，返回通知列表
formatted_notifications = [...]  # 格式化通知資料

await logsys(1, def_name, f"返回 {len(formatted_notifications)} 條通知給 {db_user_id}", "")
return formatted_notifications
```

* **這會發生什麼：**

    * ✅ 在終端輸出綠色的資訊訊息
    * ✅ 發送到 LogBeacon 伺服器儲存
    * ❌ 不發送 Telegram 通知

* **用途：** 記錄正常的業務操作，方便後續追蹤和分析用戶行為。

#### 5.2.3. 範例：記錄錯誤 (Level 9)

* **情境：** 資料庫查詢失敗時記錄錯誤
```python
try:
    # 查詢或更新補償事件
    notifications, conn, cur = await mysql_exec(...)
except Exception as e:
    traceback.print_exc()
    await logsys(9, def_name, "查詢或更新補償事件失敗", str(e))
    return JSONResponse(status_code=500, content={"error", str(e)})
```

* **這會發生什麼：**

    * ✅ 在終端輸出紅色的錯誤訊息
    * ✅ 發送到 LogBeacon 伺服器儲存
    * ✅ 發送 Telegram 通知給開發者群組
    * ❌ 不通知客戶

* **用途：** 記錄系統錯誤，並立即通知開發者處理。

#### 5.2.4. 範例：無效輸入 (Level 9)

* **情境：** 用戶提供了無效的 user_id 格式
```python
# 驗證 user_id 格式
if isinstance(user_id, str) and user_id.startswith("user_from_"):
    db_user_id = int(user_id.replace("user_from_", ""))
elif isinstance(user_id, int):
    db_user_id = user_id
else:
    await logsys(9, def_name, "無效的 user_id 格式", str(user_id))
    return JSONResponse(status_code=400, content={"error": "Invalid user_id format"})
```

* **這會發生什麼：**

    * 記錄錯誤到 LogBeacon
    * 通知開發者有異常的輸入
    * 返回 400 錯誤給客戶端

* **用途：** 追蹤不正常的 API 使用情況，可能是前端錯誤或惡意請求。

#### 5.3. 使用時的注意事項

說明：使用日誌系統時的一些建議和注意事項。

#### 5.3.1. 參數說明

說明：logsys() 函數接收四個參數。
```python
await logsys(
    level,        # int： 日誌級別 (0， 1， 9， 11， 91， 99)
    def_name,     # str： 函數或方法名稱 (建議使用 __name__ 或手動指定)
    message,      # str： 主要訊息內容
    extra_info    # Any： 額外資訊 (可以是字串、字典、列表等)
)
```

#### 5.3.2. 最佳實踐

* **def_name 要清楚**
```python
# ✅ 好的做法
def_name = "get_user_notifications"
await logsys(1, def_name, "查詢成功", "")

# ❌ 不好的做法
await logsys(1, "func", "成功", "")  # 不知道是哪個函數
```

* **message 要簡潔明瞭**
```python
# ✅ 好的做法
await logsys(9, def_name, "資料庫連線失敗", str(e))

# ❌ 不好的做法
await logsys(9, def_name, "發生了一個錯誤", "")  # 不夠具體
```

* **extra_info 提供詳細資訊**
```python
# ✅ 好的做法 - 提供上下文
await logsys(9, def_name, "訂單處理失敗", {"order_id": 123, "user_id": 456})

# ✅ 也可以 - 使用異常訊息
except Exception as e:
    await logsys(9, def_name, "未預期的錯誤", str(e))
```

* **選擇適當的 level**
```python
# ✅ 開發時追蹤
await logsys(0, def_name, "進入函數", f"參數: {params}")

# ✅ 正常操作記錄
await logsys(1, def_name, "用戶登入成功", user_id)

# ✅ 錯誤需要處理
await logsys(9, def_name, "支付失敗", error_message)
```

#### 5.3.3. 常見模式

* **在 try-except 中使用：**
```python
try:
    result = await some_operation()
    await logsys(1, def_name, "操作成功", result)
except Exception as e:
    traceback.print_exc()  # 在終端顯示完整錯誤堆疊
    await logsys(9, def_name, "操作失敗", str(e))
    raise  # 或返回錯誤回應
```

* **在函數入口記錄：**
```python
async def process_order(order_id: int):
    def_name = "process_order"
    await logsys(0, def_name, f"開始處理訂單 {order_id}", "")
    
    # ... 處理邏輯
    
    await logsys(1, def_name, f"訂單 {order_id} 處理完成", "")
```

### 6. 運行說明

本章目的：說明如何啟動和運行日誌系統的各個組件。

#### 6.1. 啟動主程序 (API)

說明：主程序是整個系統的核心，包含 FastAPI 應用程式和日誌生產者。

* **啟動指令**

    * **使用 uvicorn 啟動 API：**
```bash
# 開發模式 (單一 worker，支援熱重載)
uvicorn example_api:app --host 0.0.0.0 --port 8866 --reload

# 生產模式 (多個 workers)
uvicorn example_api:app --host 0.0.0.0 --port 8866 --workers 4
```

* **參數說明：**

    * `example_api:app`：模組名稱和 FastAPI 應用程式物件
    * `--host 0.0.0.0`：監聽所有網路介面
    * `--port 8866`：API 監聽的端口
    * `--reload`：檔案變更時自動重載 (僅開發用)
    * `--workers 4`：啟動 4 個工作程序 (生產環境)

#### 6.2. 主程序啟動流程

當 API 啟動時，會依序執行以下初始化步驟。

#### 6.2.1. 初始化資料庫連線池
```
啟動 FastAPI 應用程式
    ↓
建立 MySQL 連線池 (asyncmy)
    - 最小連線數：40
    - 最大連線數：200
    ↓
建立 Redis 連線池
```

#### 6.2.2. 初始化日誌系統
```
呼叫 init_logsys(PROGRAM_NAME)
    ↓
建立 RabbitMQ 連線
    - 連線到 MQ 伺服器
    - 設定心跳檢測 (600 秒)
    ↓
建立 LogSystem 實例
    - 宣告 logbeacon 佇列
    - 宣告 telegram 佇列
    ↓
啟動背景重連監控任務
    - 監控 MQ 連線狀態
    - 斷線時自動重連
```

#### 6.2.3. 啟動 API 服務
```
註冊所有 API 路由
    ↓
啟動中間件 (CORS、認證等)
    ↓
開始監聽 HTTP 請求
    ↓
輸出啟動成功日誌：
await logsys(1, PROGRAM_NAME, "程式啟動成功", "")
```

#### 6.3. LogSystem 的生命週期

* **初始化階段：**

    * 建立 RabbitMQ 連線
    * 宣告持久化佇列
    * 如果連線失敗，自動啟用備援模式

* **運行階段：**

    * 接收 API 產生的日誌
    * 根據 level 決定發送到哪些佇列
    * 將訊息發送到 RabbitMQ
    * 背景任務持續監控連線狀態

* **關閉階段：**

    * 收到 SIGTERM 或 SIGINT 信號
    * 等待所有進行中的日誌發送完成
    * 關閉 RabbitMQ 連線
    * 關閉資料庫連線池

#### 6.4. 預期看到的日誌

* **新版系統啟動成功：**
```
20XX-01-01 11：59：59 - [日誌系統] 初始化建立 MQ 連線成功： stktestssh.stkcpu.cc：5673
20XX-01-01 12：00：00 - api名稱 - 程式啟動成功 - 附加信息： 
INFO：     Started server process [12345]
INFO：     Waiting for application startup.
INFO：     Application startup complete.
INFO：     Uvicorn running on http：//0.0.0.0：8866 (Press CTRL+C to quit)
```

* **新版系統 MQ 連線失敗 (自動備援)：**
```
20XX-01-01 11：59：59 - [日誌系統] 初始化建立 MQ 連線失敗： Connection refused，使用備援模式
20XX-01-01 12：00：00 - api名稱 - 程式啟動成功 - 附加信息： 
INFO：     Application startup complete.
```

(系統會繼續運作，但日誌會直接發送到 LogBeacon/Telegram API)

#### 6.5. 啟動 Workers

說明：Workers 是新版系統的消費者，負責從 RabbitMQ 取出訊息並發送到目標端點。

#### 6.5.1. LogBeacon Worker

說明：LogBeacon Worker的啟動指令、流程與預期結果。

* **啟動指令：**
```bash
python send_logbeacon.py
```

* **啟動流程：**
```
連線到 RabbitMQ
    ↓
宣告 {domain}_logbeacon 佇列
    ↓
設定 QoS (prefetch_count=1)
    ↓
開始監聽佇列
    ↓
顯示待處理訊息數量
```

* **預期看到的日誌：**
```
20XX-01-01 11：59：59 - 連接到 RabbitMQ： stktestssh.stkcpu.cc：5673
==================================================
LogBeacon Worker 已啟動 (服務： example.com)
==================================================
✓ 開始監聽： example.com_logbeacon
  待處理訊息： 0
[Telegram] 佇列目前是空的，等待新訊息...
```

* **處理訊息時的日誌：**
```
✅ 發送成功 [LogBeacon] 訂單處理失敗 | Hash： abc123
✅ 發送成功 [LogBeacon] 用戶登入成功
```

* **發送失敗時的日誌：**
```
[LogBeacon] 發送失敗 (嘗試 1/3)
[LogBeacon] 等待 5 秒後重試...
[LogBeacon] 發送失敗 (嘗試 2/3)
❌ 發送失敗 [LogBeacon] 訂單處理失敗 | Hash： abc123
[LogBeacon] 已達最大重試次數，放棄發送
```

#### 6.5.2. Telegram Worker

說明：Telegram Worker的啟動指令、流程與預期結果。

* **啟動指令：**
```bash
python send_tg.py
```

* **啟動流程與 LogBeacon Worker 類似：**
```
連線到 RabbitMQ
    ↓
宣告 {domain}_tg 佇列
    ↓
設定 QoS (prefetch_count=1)
    ↓
開始監聽佇列
    ↓
顯示待處理訊息數量
```

* **預期看到的日誌：**
```
20XX-01-01 11：59：59 - 連接到 RabbitMQ： stktestssh.stkcpu.cc：5673
==================================================
Telegram Worker 已啟動 (服務： example.com)
==================================================
✓ 開始監聽： example.com_tg
  待處理訊息： 0
[Telegram] 佇列目前是空的，等待新訊息...
```

* **處理訊息時的日誌：**
```
✅ 發送成功 [TG-developer] 錯誤時間：2025-11-26 10：30：00 商城名稱：example.com...
✅ 發送成功 [TG-customer] 系統通知 - example.com： 訂單已確認
```

#### 6.6. Workers 運行建議

* **開發環境：**
```bash
# 在不同的終端視窗分別啟動
# Terminal 1
python send_logbeacon.py

# Terminal 2
python send_tg.py
```

* **生產環境：**

建議使用 systemd 或 supervisor 管理 Workers，確保程式意外終止時能自動重啟。

* **使用 nohup 背景執行：**
```bash
# 背景執行並將日誌輸出到檔案
nohup python send_logbeacon.py > logbeacon_worker.log 2>&1 &
nohup python send_tg.py > tg_worker.log 2>&1 &

# 查看日誌
tail -f logbeacon_worker.log
tail -f tg_worker.log
```
