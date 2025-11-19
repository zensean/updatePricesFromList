### 說明

本文件為基於 RabbitMQ 的分散式日誌系統完整使用指南，涵蓋系統架構、配置方法、使用範例及常見問題處理。文件旨在協助開發人員快速理解並正確使用日誌系統，包含從初始化、日誌記錄、Worker 程序管理到備援機制的完整說明。

#### **修訂歷史**

* **v1.1 (2025-11-19)**: 大改版，更符合文檔需求而非使用手冊。
* **v1.0 (2025-11-13)**: 初版發布,包含舊版與新版 LOG 系統的完整使用說明。

---

# **日誌系統使用指南**

**版本：1.1 (2025-11-19)**

**最後更新：2025-11-19**

### 目錄

1. 系統概述
2. 系統架構
3. 日誌級別說明
4. config_api.py配置項目說明
5. 使用方法
6. Worker 程序
7. 備援機制
8. 常見問題
9. 進階使用

### 1. 系統概述

這是一個基於 RabbitMQ 的分散式日誌系統，提供以下功能：

* **多通道日誌輸出**: 本地控制台、LogBeacon API、Telegram 通知
* **非同步處理**: 不阻塞主程序運行
* **自動備援**: MQ 斷線時自動切換為直接發送模式
* **自動重連**: 背景監控 MQ 連線狀態並自動重連
* **多重試機制**: 發送失敗時自動重試
* **API Key 自動更新**: LogBeacon API Key 無縫更新

### 2. 系統架構

系統架構圖如下：

```
     ┌─────────────────┐
     │   應用程式      │
     │   (FastAPI)     │
     └────────┬────────┘
              │
              │ 呼叫 logsys()
              ▼
     ┌─────────────────────────────┐
     │      LogSystem    2.1.1     │
     │  (logsys_mq.py)             │
     ├─────────────────────────────┤
     │ • 本地日誌輸出 (彩色)        │
     │ • 訊息格式化與驗證           │
     │ • MQ 連線管理與重連          │
     │ • 備援模式自動切換           │
     └────┬────────────────────┬───┘
          │                    │
          │ MQ 可用            │ MQ 不可用
          ▼                    ▼
┌──────────────────┐    ┌──────────────┐
│    RabbitMQ      │    │  直接發送     │
│     佇列系統      │    │  (備援模式)  │
└──┬────────────┬──┘    └──┬───────┬───┘
   │            │          │       │
   │            │          │       │
   ▼            ▼          ▼       ▼
┌─────────┐ ┌────────┐   ┌────┐ ┌────┐
│LB-Worker│ │   TG   │   │ LB │ │ TG │
│         │ │        │   │API │ │API │
│  2.1.2  │ │  2.1.3 │   │    │ │    │
│         │ |        │   │    │ │    │   
└────┬────┘ └───┬────┘   └─┬──┘ └─┬──┘
     │          │          │      │
     ▼          ▼          ▼      ▼
┌──────────────────────────────────────┐
│  LogBeacon              Telegram     │
│     API               (開發者/客戶)   │
└──────────────────────────────────────┘
```
#### 2.1. 核心組件

系統包含以下核心組件：

1. **logsys_mq.py** - 日誌系統核心
    * `LogSystem` 類: 主要日誌處理邏輯
    * `init_logsys()`: 初始化函數
    * `logsys()`: 全域日誌函數

2. **send_logbeacon.py** - LogBeacon Worker
    * 消費 LogBeacon 佇列
    * 發送日誌到 LogBeacon API
    * 管理 API Key 快取

3. **send_tg.py** - Telegram Worker
    * 消費 Telegram 佇列
    * 發送通知到 Telegram

4. **config_api.py** - 配置文件
    * MQ 連線配置
    * Telegram 配置
    * LogBeacon URL



### 3. 日誌級別說明

系統提供六個日誌級別，各級別的行為如下：

| Level | 名稱 | 說明 | 本地輸出 | LogBeacon | 開發者 TG | 客戶 TG |
|-------|------|------|----------|-----------|-----------|---------|
| 0 | Debug | 調試訊息 | ✓ (青色) | ✗ | ✗ | ✗ |
| 1 | Info | 一般訊息 | ✓ (綠色) | ✓ | ✗ | ✗ |
| 9 | Error | 錯誤訊息 | ✓ (紅色) | ✓ | ✓ | ✗ |
| 11 | Info_CTG | 客戶通知訊息 | ✓ (綠色) | ✓ | ✗ | ✓ |
| 91 | Error_CTG | 客戶錯誤通知 | ✓ (紅色) | ✓ | ✓ | ✓ |
| 99 | Monitor | 監控訊息 | ✓ (綠底) | ✗ | ✗ | ✗ |

#### 3.1. 級別選擇建議

* **Level 0 (Debug)**: 開發調試用，僅本地輸出
* **Level 1 (Info)**: 重要操作記錄，會送到 LogBeacon
* **Level 9 (Error)**: 系統錯誤，會通知開發者
* **Level 11 (Info_CTG)**: 需要通知客戶的一般訊息
* **Level 91 (Error_CTG)**: 需要通知客戶的錯誤訊息
* **Level 99 (Monitor)**: 性能監控訊息，僅本地輸出

### 4. config_api.py配置項目說明

關於配置項目，大部分會需要的資訊都可以去STK 測試環境中尋找，裡面會提供第一次運行測試時，你所需要的包括但不限於帳號、密碼、Host、Port等資訊。

#### 4.1. 系統切換開關 (最重要的配置)
該配置在config_api.py程式碼中最下方的位置，負責切換是否需使用新版日誌系統

```python
# 日誌系統使用版本：True 使用新版本，False 使用舊有程式內建 log_worker 函數，此為預防前期新系統有異常時可以快速切換
USE_NEW_LOGSYS = True
```

#### 4.2. RabbitMQ的設定

```python
# RabbitMQ的設定
MALLMQUSER = 'admin' 
MALLMQPASS = 'b8be25bb' #aaPanel=>app store=>RabbitMQ(如果沒有就去下載)欄位的setting=>Admin auth 區塊查看
MALLMQHOST = 'david5672.stkcpu.cc' #此處應更換成'stktestssh.stkcpu.cc'
MALLMQPORT = 5672 #應更換成你在OP上被發配的RabbitMQ的PORT
APIMQPROTO = 'https'
APIMQHOST = 'david15672.stkcpu.cc' #更改英文名,數字無須更改.ex 'sean15672.stkcpu.cc'
APIMQPORT = 443
REPORT_PATH = 'C:/Users/stk-3707/Desktop/' # windows 用
# REPORT_PATH  = '/tmp/' # liunx 用

# 日誌系統 MQ 配置
LOG_MQ_CONFIG = {
    'USER': 'admin',  
    'PASS': 'b6fb1153', #同MALLMQPASS
    'HOST': 'stktestssh.stkcpu.cc',  
    'PORT': 5673, #應更換成你在OP上被發配的RabbitMQ的PORT
```

#### 4.3. MySQL 連接池的設定

```python
# MySQL 連接池
MYSQL_MAXSIZE = 200  # 最大
MYSQL_MINSIZE = 40   # 最小
LOGBEACON_URL = "https://logbeacon.shutokou.cc/log/"
MONITOR_API_TIME = True
MONITOR_API_TIME_THRESHOLD = 2
MYSQL_DB = 'stktest' #此處須注意,你的mySQL實際上有沒有該名稱的DB不然會跳錯
MYSQL_HOST = 'stktestssh.stkcpu.cc' #使用外網連接
MYSQL_PASSWD = '!ZzZ3345678' #公司預設密碼
MYSQL_PORT = 13312 #注意需更改成你的muSQL個人外部連接端口
MYSQL_USER = 'stktest' #你登入mySQL時用的帳號
```
#### 4.4. redis的設定

```python
# redis的設定
REDIS_HOST = "stktestssh.stkcpu.cc" #使用外網連接
REDIS_PASSWD = "!ZzZ3345678" #公司預設密碼
REDIS_PORT = 16379 #注意更改成你的redis個人外部連接端口
```

### 5. 使用方法

#### 5.1. 基本使用範例

```python
from logsys_mq import logsys

# 1. Debug 訊息 (只在本地顯示)
await logsys(0, "test_function", "調試訊息", "debug info")

# 2. Info 訊息 (本地 + LogBeacon)
await logsys(1, "user_login", "用戶登入成功", f"user_id: {user_id}")

# 3. Error 訊息 (本地 + LogBeacon + 開發者 TG)
await logsys(9, "payment_failed", "支付失敗", f"訂單號: {order_id}, 錯誤: {error}")

# 4. 客戶通知訊息 (本地 + LogBeacon + 客戶 TG)
await logsys(11, "order_status", "訂單已出貨", f"訂單號: {order_id}")

# 5. 客戶錯誤通知 (本地 + LogBeacon + 開發者 TG + 客戶 TG)
await logsys(91, "service_error", "服務暫時無法使用", "資料庫連線失敗")

# 6. 監控訊息 (只在本地顯示,綠底)
await logsys(99, "api_monitor", f"API 響應時間: {response_time}ms", "")
```


### 6. Worker 程序

#### 6.1. LogBeacon Worker (send_logbeacon.py)

**功能:**

* 消費 `{domain_name}_logbeacon` 佇列
* 發送日誌到 LogBeacon API
* 自動管理 API Key (讀取/更新)
* 失敗重試機制

**API Key 管理:**

* 檔案格式: `api_key-{domain}-{program_name}-logbeacon.txt`
* 啟動時自動載入所有 API Key 到記憶體
* LogBeacon 回應新 Key 時自動更新

**啟動方式:**

```bash
python send_logbeacon.py
```

**日誌輸出範例:**

```
✅ 發送成功 [LogBeacon-Info] function_name - 操作成功 - 附加信息: 詳細資訊
❌ 發送失敗 [LogBeacon-Error] function_name - 操作失敗 - 附加信息: 錯誤訊息
```

#### 6.2. Telegram Worker (send_tg.py)

**功能:**

* 消費 `{domain_name}_tg` 佇列
* 發送通知到 Telegram
* 區分開發者/客戶通知
* 失敗重試機制

**啟動方式:**

```bash
python send_tg.py
```

**日誌輸出範例:**

```
✅ 發送成功 [TG-developer] 錯誤時間:2025-01-15 10:30:00 商城名稱:example.com...
✅ 發送成功 [TG-customer] 系統通知 - example.com: 訂單已出貨
```

#### 6.3. 健康檢查

兩個 Worker 都有內建健康檢查機制：

* 每 60 秒輸出佇列狀態
* 監控 MQ 連線狀態
* 連續失敗 5 次後自動退出

```
[待命中] 目前無訊息處理 (LogBeacon: 0)
[處理中] 待處理訊息 (LogBeacon: 15)
```

### 7. 備援機制

#### 7.1. 自動備援流程

當 RabbitMQ 無法連線時，系統會自動切換到備援模式：

```
正常模式: 應用 → MQ → Worker → API/TG
備援模式: 應用 → 直接呼叫 API/TG
```

#### 7.2. 備援模式觸發條件

1. 初始化時 MQ 連線失敗
2. 發送訊息時 MQ 斷線
3. Channel 創建失敗

#### 7.3. 備援模式行為

```python
# LogBeacon 備援
if not mq_connected:
    # 直接發送到 LogBeacon API
    success = await self._send_logbeacon_directly(logbeacon_data)

# Telegram 備援
if not mq_connected:
    # 直接發送到 Telegram API
    success = await self._send_telegram_directly(token, chat_id, message)
```

#### 7.4. 自動重連機制

系統有背景重連監控任務：

```python
async def _reconnect_monitor(self):
    while not self._stop_flag:
        # 檢測到 MQ 斷線
        if not self._reconnect_event.is_set():
            # 嘗試重連 (最多 3 次)
            for attempt in range(3):
                await self._reconnect_mq()
                if success:
                    break
                await asyncio.sleep(10)  # 等待後重試

            # 重連失敗,等待 30 秒後再次嘗試
            if not success:
                await asyncio.sleep(30)
```

**重連策略:**

* 檢測到斷線立即嘗試重連
* 最多重試 3 次，每次間隔 10 秒
* 全部失敗後等待 30 秒再重新開始
* 重連成功後自動恢復正常模式

#### 7.5. 優雅關閉

```python
# 應用關閉時
await log_system.close()

# 內部行為:
# 1. 設置關閉標誌,拒絕新的日誌
# 2. 等待所有進行中的發送完成 (最多 5 秒)
# 3. 停止背景重連任務
# 4. 關閉 MQ 連線
```

### 8. 常見問題

#### Q1: 如何確認日誌系統是否正常運作?

**A:** 檢查以下幾點：

1. 本地控制台有彩色日誌輸出
2. Worker 程序正在運行
3. RabbitMQ 佇列有訊息流動

```bash
# 檢查佇列狀態
rabbitmqctl list_queues
```

#### Q2: MQ 斷線後日誌會丟失嗎?

**A:** 不會。系統有三層保護：

1. **自動備援**: MQ 斷線時自動切換為直接發送
2. **重試機制**: 發送失敗會自動重試
3. **背景重連**: 持續嘗試恢復 MQ 連線

#### Q3: API Key 如何管理?

**A:** 完全自動化：

1. Worker 啟動時自動載入所有 API Key 到記憶體
2. LogBeacon 回應新 Key 時自動寫入檔案和記憶體
3. 檔案格式: `api_key-{domain}-{program_name}-logbeacon.txt`

#### Q4: 如何控制日誌輸出量?

**A:** 合理使用日誌級別：

* 開發環境: 可以多用 Level 0 (Debug)
* 生產環境: 主要用 Level 1 (Info) 和 Level 9 (Error)
* 避免在循環中使用高級別日誌

#### Q5: Telegram 通知太頻繁怎麼辦?

**A:** 幾個方法：

1. 提高錯誤日誌的級別門檻
2. 實作訊息聚合 (例如: 相同錯誤只通知一次)
3. 使用 Level 1 取代 Level 9 來減少 TG 通知
4. 調整 `RETRY_DELAY` 參數

#### Q6: 如何追蹤特定事件?

**A:** 使用 hash_value 參數：

```python
# 生成唯一 hash
import hashlib
event_hash = hashlib.md5(f"{user_id}_{order_id}".encode()).hexdigest()

# 在多個地方使用相同 hash 記錄
await logsys(1, "order_create", "訂單創建", order_data, hash_value=event_hash)
await logsys(1, "payment_process", "支付處理", payment_data, hash_value=event_hash)
await logsys(1, "order_complete", "訂單完成", "", hash_value=event_hash)

# 在 LogBeacon 系統中可以用 hash 搜尋完整流程
```

#### Q7: Worker 程序掛掉了怎麼辦?

**A:** 系統仍會正常運作：

1. 應用程式會自動切換為備援模式
2. 訊息會暫存在 MQ 佇列中 (durable=True)
3. Worker 重啟後會自動處理積壓的訊息

建議使用 supervisor 或 systemd 管理 Worker 程序自動重啟。

#### Q8: 如何在多個程序中使用?

**A:** 每個程序獨立初始化：

```python
# 程序 A
await init_logsys(program_name="api_server")

# 程序 B
await init_logsys(program_name="background_worker")

# 程序 C
await init_logsys(program_name="scheduler")
```

各程序的日誌會在 LogBeacon 中以 `program_name` 區分。

#### Q9: 日誌訊息太長會怎樣?

**A:** 系統會自動截斷：

* `extra_info` 超過 3000 字元會截斷並加上 "...(已截斷)"
* LogBeacon 響應超過 500 字元會截斷並加上 "...(響應過長已截斷)"

#### Q10: 如何測試日誌系統?

**A:** 簡單的測試腳本：

```python
import asyncio
from logsys_mq import init_logsys, logsys

async def test_log_system():
    # 初始化
    await init_logsys(program_name="test_program")

    # 測試各級別
    await logsys(0, "test", "Debug 測試", "debug info")
    await logsys(1, "test", "Info 測試", "info data")
    await logsys(9, "test", "Error 測試", "error details")
    await logsys(99, "test", "Monitor 測試", "metrics")

    print("測試完成,請檢查:")
    print("1. 控制台彩色輸出")
    print("2. LogBeacon 是否收到訊息")
    print("3. Telegram 是否收到錯誤通知")

    # 等待處理完成
    await asyncio.sleep(5)

if __name__ == "__main__":
    asyncio.run(test_log_system())
```

### 9. 進階使用

#### 9.1. 自訂日誌格式

如果需要自訂日誌格式，可以繼承 `LogSystem` 類：

```python
from logsys_mq import LogSystem

class CustomLogSystem(LogSystem):
    def _format_message(self, level: int, def_name: str, message: str, extra_info: Any) -> str:
        # 自訂格式
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        return f"[{timestamp}] [{self.config.LEVEL_MAP[level]}] {def_name} | {message} | {extra_info}"
```

#### 9.2. 擴展發送目標

可以覆寫 `log()` 方法來增加其他發送目標：

```python
class ExtendedLogSystem(LogSystem):
    async def log(self, level: int, def_name: str, message: str, extra_info: Any = "", hash_value: str = ""):
        # 呼叫父類方法
        await super().log(level, def_name, message, extra_info, hash_value)

        # 額外發送到其他服務
        if level == 9:  # 錯誤時發送到監控系統
            await self.send_to_monitoring_system(message, extra_info)
```

### 總結

這個日誌系統提供了：

* **可靠性**: 多重備援機制確保日誌不丟失
* **效能**: 非同步處理不阻塞主程序
* **靈活性**: 多級別、多通道輸出
* **自動化**: API Key 管理、重連、備援全自動
* **可維護性**: 彩色輸出、清晰的日誌級別
* **可擴展性**: 易於添加新的發送目標

對於新人來說，只需要記住：

1. 啟動時呼叫 `init_logsys()`
2. 需要記錄時呼叫 `await logsys(level, def_name, message, extra_info)`
3. 啟動 Worker 程序
4. 其他的交給系統自動處理

有任何問題請參考本文檔或聯繫開發團隊。
