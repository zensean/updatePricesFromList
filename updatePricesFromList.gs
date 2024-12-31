// 批量調整遊戲價格

// 使用方式
// 將老闆貼出的調整價格貼到"更新清單"表單中的A1欄位
// 選擇所有A欄, 資料 => 將文字分割成不同欄位 => 分隔符 選擇 空白
// 執行本程序

function updatePricesFromList() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("庫存"); // 庫存表 主表.getActiveSheet()
  const updateSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("更新清單"); // 更新清單表

  // 讀取更新清單
  const updates = updateSheet.getDataRange().getValues();
  const updateMap = {};
  updates.forEach(row => {
    if (row[0] && row[1]) { // 確保有遊戲名稱和新價格
      updateMap[row[0]] = row[1];
    }
  });

  // 獲取主表的資料
  const data = sheet.getDataRange().getValues();
  const gameNameColumn = 1; // B欄
  const priceColumn = 3; // D欄

  // 用來記錄更新的遊戲資訊
  let updatedGames = [];
  let updateCount = 0;

  // 用來記錄更新失敗的遊戲資訊
  let failedGames = [];
  let failCount = 0;

  // 遍歷主表進行更新
  for (let i = 0; i < data.length; i++) {
    const gameName = data[i][gameNameColumn];
    if (updateMap[gameName] !== undefined) {
      const newPrice = updateMap[gameName];
      sheet.getRange(i + 1, priceColumn + 1).setValue(newPrice); // 更新價格
      updateCount++;
      updatedGames.push(`欄位 ${i + 1} ${gameName} ${newPrice}`); // 記錄更新資訊
    }
  }

  // 檢查更新清單中未匹配到的遊戲
  Object.keys(updateMap).forEach(gameName => {
    const match = data.some(row => row[gameNameColumn] === gameName);
    if (!match) {
      failCount++;
      failedGames.push(`${gameName} ${updateMap[gameName]}`); // 記錄失敗的資訊
    }
  });

  // 打印結果到執行紀錄 (Logs)
  console.log(`更新的遊戲總數: ${updateCount}`);
  updatedGames.forEach(info => console.log(info));

  console.log(`更新失敗的總數: ${failCount}`);
  failedGames.forEach(info => console.log(info));

  // 顯示更新結果在彈窗中
  const resultMessage =
    `更新的遊戲總數: ${updateCount}\n` +
    updatedGames.join("\n") +
    `\n\n更新失敗的總數: ${failCount}\n` +
    failedGames.join("\n");
  SpreadsheetApp.getUi().alert(resultMessage);
}
