import * as XLSX from 'xlsx';

/**
 * Excelファイルをダウンロードするユーティリティ
 */
export const downloadExcel = (data: any[], fileName: string, sheetName: string = 'Sheet1') => {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

/**
 * 専門的支援実施計画のエクスポート用データ作成
 */
export const exportSupportImplementation = (
  childName: string,
  month: string,
  goals: string,
  rows: any[],
  fileName: string
) => {
  const data = [
    { '項目': '利用児氏名', '内容': childName },
    { '項目': '対象年月', '内容': month },
    { '項目': '支援目標', '内容': goals },
    {}, // 空行
    { '日付': '日付', '療育内容': '療育内容', '療育を行った結果': '療育を行った結果', '今後の予定': '今後の予定', 'ツリー通信': 'ツリー通信' }
  ];

  rows.forEach(row => {
    if (!row.archived) {
      data.push({
        '日付': row.date,
        '療育内容': (row.content.supportContent || []).join(', '),
        '療育を行った結果': row.content.resultInfo,
        '今後の予定': row.content.futurePlan,
        'ツリー通信': row.content.externalInfo
      });
    }
  });

  const worksheet = XLSX.utils.json_to_sheet(data, { skipHeader: true });
  
  // 列幅の調整
  worksheet['!cols'] = [
    { wch: 15 }, // 日付/項目
    { wch: 30 }, // 療育内容
    { wch: 50 }, // 内容/結果
    { wch: 40 }, // 今後の予定
    { wch: 50 }  // ツリー通信
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '実施計画');
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};

/**
 * 専門的支援計画のエクスポート用データ作成
 */
export const exportProfessionalPlan = (
  childName: string,
  plan: any,
  fileName: string
) => {
  const data = [
    { '項目': '利用児氏名', '内容': childName },
    { '項目': '作成年月日', '内容': plan.createdAt },
    { '項目': '生活に対する意向', '内容': plan.familyIntention },
    { '項目': '総合的な支援の方針', '内容': plan.overallPolicy },
    { '項目': '長期目標', '内容': plan.longTermGoal },
    { '項目': '短期目標', '内容': plan.shortTermGoal },
    { '項目': '支援の提供時間等', '内容': plan.serviceHours },
    {}, // 空行
    { 
      'カテゴリ': 'カテゴリ', 
      '支援目標': '支援目標', 
      '支援内容': '支援内容', 
      '5領域': '5領域', 
      '達成時期': '達成時期', 
      '担当者': '担当者', 
      '留意事項': '留意事項', 
      '優先順位': '優先順位' 
    }
  ];

  plan.supportRows.forEach((row: any) => {
    data.push({
      'カテゴリ': row.category,
      '支援目標': row.supportGoal,
      '支援内容': row.supportContent,
      '5領域': row.fiveAreas.join(', '),
      '達成時期': row.achievementPeriod,
      '担当者': row.provider,
      '留意事項': row.notes,
      '優先順位': row.priority
    });
  });

  const worksheet = XLSX.utils.json_to_sheet(data, { skipHeader: true });

  // 列幅の調整
  worksheet['!cols'] = [
    { wch: 12 }, // カテゴリ
    { wch: 30 }, // 支援目標
    { wch: 40 }, // 支援内容
    { wch: 25 }, // 5領域
    { wch: 12 }, // 達成時期
    { wch: 20 }, // 担当者
    { wch: 30 }, // 留意事項
    { wch: 10 }  // 優先順位
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '支援計画');
  XLSX.writeFile(workbook, `${fileName}.xlsx`);
};
