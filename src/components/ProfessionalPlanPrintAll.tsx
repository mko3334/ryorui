import React from 'react';
import type { ProfessionalPlanDoc, ServiceHoursPlan } from '../types/professionalPlan';
import type { Child } from '../data/mockData';

type ProfessionalPlanPrintAllProps = {
  draftPlan: ProfessionalPlanDoc;
  finalPlan: ProfessionalPlanDoc;
  hoursPlan: ServiceHoursPlan;
  selectedChild: Child;
  officeName: string;
};

const ProfessionalPlanPaper: React.FC<{
  plan: ProfessionalPlanDoc;
  selectedChild: Child;
  officeName: string;
}> = ({ plan, selectedChild, officeName }) => {
  const [cy, cm, cd] = plan.createdAt ? plan.createdAt.split('-') : ['', '', ''];
  const [sy, sm, sd] = plan.signDate ? plan.signDate.split('-') : ['', '', ''];

  const FIVE_AREAS = ['健康・生活', '運動・感覚', '認知・行動', '言語・コミュニケーション', '人間関係・社会性'];

  return (
    <div className="bg-white p-6 print:p-0 print:border-0" style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-baseline gap-1 text-sm">
          <span>利用児氏名：</span>
          <div className="border-b border-slate-400 min-w-[160px] px-1 font-bold text-base">
            {selectedChild.fullName}
          </div>
          <span>様</span>
        </div>
        <div className="text-center flex-1">
          <h1 className="text-xl font-black tracking-wide">
            個別支援計画書　<span className="font-normal text-base">({officeName})</span>
            <span className="text-sm font-bold text-slate-500 ml-2">
              {plan.status === 'draft' ? '【案】' : '【本案】'}
            </span>
          </h1>
        </div>
        <div className="text-sm flex items-baseline gap-1 whitespace-nowrap">
          <span>作成年月日：</span>
          <span className="border-b border-slate-400 px-2 font-bold">{cy || '　'}</span><span>年</span>
          <span className="border-b border-slate-400 px-1 font-bold">{cm || '　'}</span><span>月</span>
          <span className="border-b border-slate-400 px-1 font-bold">{cd || '　'}</span><span>日</span>
        </div>
      </div>
      
      {/* 枠線テーブル */}
      <table className="w-full border-collapse text-sm" style={{ borderLeft: '1.5px solid #374151', borderTop: '1.5px solid #374151' }}>
        <tbody>
          <tr>
            <td className="bg-slate-100 text-center align-middle font-medium text-[13px] p-2 leading-tight" style={{ border: '1.5px solid #374151', width: '16%' }}>
              利用児及び家族の<br />生活に対する意向
            </td>
            <td style={{ border: '1.5px solid #374151' }} colSpan={3} className="p-2 align-top">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed min-h-[3em]">{plan.familyIntention}</p>
            </td>
          </tr>
          <tr><td colSpan={4} style={{ height: '6px', border: 'none' }} /></tr>
          <tr>
            <td className="bg-slate-100 text-center align-middle font-medium text-[13px] p-2" style={{ border: '1.5px solid #374151' }}>
              総合的な支援の方針
            </td>
            <td style={{ border: '1.5px solid #374151' }} colSpan={3} className="p-2 align-top">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed min-h-[3em]">{plan.overallPolicy}</p>
            </td>
          </tr>
          <tr><td colSpan={4} style={{ height: '6px', border: 'none' }} /></tr>
          <tr>
            <td className="bg-slate-100 text-center align-middle font-medium text-[13px] p-2 leading-tight" style={{ border: '1.5px solid #374151' }}>
              長期目標<br /><span className="text-[11px]">（内容・期間等）</span>
            </td>
            <td style={{ border: '1.5px solid #374151', width: '54%' }} className="p-2 align-top">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed min-h-[2.5em]">{plan.longTermGoal}</p>
            </td>
            <td className="bg-slate-100 text-center align-middle font-medium text-[12px] p-2 leading-tight" style={{ border: '1.5px solid #374151', width: '16%' }} rowSpan={2}>
              支援の標準的な提供時間等<br /><span className="text-[10px]">（曜日・頻度・時間）</span>
            </td>
            <td style={{ border: '1.5px solid #374151', width: '14%' }} rowSpan={2} className="p-2 align-top">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed min-h-[5.5em]">{plan.serviceHours}</p>
            </td>
          </tr>
          <tr>
            <td className="bg-slate-100 text-center align-middle font-medium text-[13px] p-2 leading-tight" style={{ border: '1.5px solid #374151' }}>
              短期目標<br /><span className="text-[11px]">（内容・期間等）</span>
            </td>
            <td style={{ border: '1.5px solid #374151' }} className="p-2 align-top">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed min-h-[2.5em]">{plan.shortTermGoal}</p>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-3 mb-1 text-[13px] font-medium">○支援目標及び具体的な支援内容等</div>
      <table className="w-full border-collapse text-[12px]" style={{ borderLeft: '1.5px solid #374151', borderTop: '1.5px solid #374151' }}>
        <thead>
          <tr className="bg-slate-100 text-center text-[12px]">
            <th style={{ border: '1.5px solid #374151', width: '7%' }} className="p-2 align-middle">項　目</th>
            <th style={{ border: '1.5px solid #374151', width: '15%' }} className="p-2 align-middle leading-tight">支援目標<br /><span className="text-[10px] font-normal">（具体的な到達目標）</span></th>
            <th style={{ border: '1.5px solid #374151' }} className="p-2 align-middle leading-tight">支援内容<br /><span className="text-[10px] font-normal">（内容・支援の提供上のポイント・5領域（※）との関連性等）</span></th>
            <th style={{ border: '1.5px solid #374151', width: '7%' }} className="p-2 align-middle leading-tight">達成<br />時期</th>
            <th style={{ border: '1.5px solid #374151', width: '11%' }} className="p-2 align-middle leading-tight">担当者<br />提供機関</th>
            <th style={{ border: '1.5px solid #374151', width: '17%' }} className="p-2 align-middle leading-tight">留意事項<br /><span className="text-[10px] font-normal">（本人の役割を含む）</span></th>
            <th style={{ border: '1.5px solid #374151', width: '5%' }} className="p-2 align-middle leading-tight">優先<br />順位</th>
          </tr>
        </thead>
        <tbody>
          {plan.supportRows.map((row, idx) => {
            const isFirstInCategory = idx === 0 || plan.supportRows[idx - 1].category !== row.category;
            const categoryCount = plan.supportRows.filter((r) => r.category === row.category).length;
            return (
              <tr key={row.id} className="align-top">
                {isFirstInCategory && (
                  <td className="text-center font-medium align-middle bg-slate-50 text-[12px]" style={{ border: '1.5px solid #374151' }} rowSpan={categoryCount}>
                    {row.category}
                  </td>
                )}
                <td style={{ border: '1.5px solid #374151' }} className="p-2">
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed min-h-[3em]">{row.supportGoal}</p>
                </td>
                <td style={{ border: '1.5px solid #374151' }} className="p-2">
                  <div className="flex gap-2">
                    <p className="whitespace-pre-wrap text-[11px] leading-relaxed flex-1 min-h-[3em]">{row.supportContent}</p>
                    {row.category === '本人支援' && (
                      <div className="border-l border-slate-200 pl-2 flex-shrink-0 flex flex-col gap-0.5 text-[9px]">
                        {FIVE_AREAS.map((area) => (
                          <label key={area} className="flex items-center gap-1">
                            <input type="checkbox" className="w-2.5 h-2.5" checked={row.fiveAreas.includes(area)} disabled />
                            <span className="leading-tight">{area}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </td>
                <td style={{ border: '1.5px solid #374151' }} className="p-2 text-center align-middle text-[11px]">
                  {row.achievementPeriod}
                </td>
                <td style={{ border: '1.5px solid #374151' }} className="p-2 text-center align-middle text-[11px] whitespace-pre-wrap">
                  {row.provider}
                </td>
                <td style={{ border: '1.5px solid #374151' }} className="p-2">
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed min-h-[3em]">{row.notes}</p>
                </td>
                <td style={{ border: '1.5px solid #374151' }} className="p-2 text-center align-middle text-[11px] font-bold">
                  {row.priority}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-2 text-[10px] text-right font-medium text-slate-500">
        ※ 5領域の視点「健康・生活」、「運動・感覚」、「認知・行動」、「言語・コミュニケーション」、「人間関係・社会性」
      </div>

      {/* 確認事項 & 署名 */}
      <table className="w-full mt-3 border-collapse text-[12px]" style={{ border: '1.5px solid #374151' }}>
        <tbody>
          <tr className="align-top">
            <td className="bg-slate-100 text-center font-medium p-2 align-middle w-[60px]" style={{ borderRight: '1.5px solid #374151' }}>
              確認事項
            </td>
            <td className="p-2 leading-relaxed">
              <p className="whitespace-pre-wrap text-[11px]">{plan.confirmation}</p>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 flex justify-between items-end text-xs print:text-[11px]">
        <div className="leading-loose">
          提供する支援内容について、本計画書に基づき説明しました。<br />
          児童発達支援管理責任者氏名：
          <span className="border-b border-slate-400 font-bold text-sm px-2 py-0.5 ml-1 inline-block min-w-[150px] text-center">
            {plan.managerName}
          </span>
          <span className="ml-2 font-semibold">印</span>
        </div>
        <div className="leading-loose text-right">
          本計画書に基づき支援の説明を受け、内容に同意しました。<br />
          保護者署名：
          <span className="border-b border-slate-400 font-bold text-sm px-2 py-0.5 ml-1 inline-block min-w-[200px]">
            {plan.guardianName}
          </span>
          <span className="ml-2 font-semibold">印</span>
          <div className="mt-1 flex items-baseline justify-end gap-1 text-[11px] whitespace-nowrap">
            <span className="border-b border-slate-400 px-2 font-bold">{sy || '　'}</span><span>年</span>
            <span className="border-b border-slate-400 px-1 font-bold">{sm || '　'}</span><span>月</span>
            <span className="border-b border-slate-400 px-1 font-bold">{sd || '　'}</span><span>日</span>
            <span>（保護者署名）</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const ServiceHoursPlanPaper: React.FC<{
  hoursPlan: ServiceHoursPlan;
  selectedChild: Child;
  officeName: string;
}> = ({ hoursPlan, selectedChild, officeName }) => {
  const [cy, cm, cd] = hoursPlan.createdAt ? hoursPlan.createdAt.split('-') : ['', '', ''];
  const daysOfWeek = ['月', '火', '水', '木', '金', '土', '日'];

  const formatMinutes = (mins: number) => {
    if (!mins) return '0時間00分';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}時間${m.toString().padStart(2, '0')}分`;
  };

  return (
    <div className="bg-white p-6 print:p-0 print:border-0" style={{ fontFamily: "'Noto Sans JP', sans-serif" }}>
      {/* ヘッダー */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-baseline gap-1 text-sm">
          <span>利用児氏名：</span>
          <div className="border-b border-slate-400 min-w-[160px] px-1 font-bold text-base">
            {selectedChild.fullName}
          </div>
          <span>様</span>
        </div>
        <div className="text-center flex-1">
          <h1 className="text-xl font-black tracking-wide">
            個別支援計画別表 (利用時間)　<span className="font-normal text-base">({officeName})</span>
          </h1>
        </div>
        <div className="text-sm flex items-baseline gap-1 whitespace-nowrap">
          <span>作成年月日：</span>
          <span className="border-b border-slate-400 px-2 font-bold">{cy || '　'}</span><span>年</span>
          <span className="border-b border-slate-400 px-1 font-bold">{cm || '　'}</span><span>月</span>
          <span className="border-b border-slate-400 px-1 font-bold">{cd || '　'}</span><span>日</span>
        </div>
      </div>

      {/* スケジュールテーブル */}
      <table className="w-full border-collapse text-sm print:text-xs" style={{ borderLeft: '1.5px solid #374151', borderTop: '1.5px solid #374151' }}>
        <thead>
          <tr className="bg-slate-100 text-center font-bold">
            <th style={{ border: '1.5px solid #374151', width: '12%' }} className="p-2">項目</th>
            {daysOfWeek.map(d => (
              <th key={d} style={{ border: '1.5px solid #374151', width: '12%' }} className="p-2">{d}曜日</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* 提供時間 */}
          <tr className="align-middle text-center">
            <td className="bg-slate-100 font-medium p-2 leading-tight" style={{ border: '1.5px solid #374151' }}>
              提供時間
            </td>
            {daysOfWeek.map(d => {
              const h = hoursPlan.weeklyHours[d];
              return (
                <td key={d} style={{ border: '1.5px solid #374151' }} className="p-2">
                  <div className="font-bold text-[11px] min-h-[1.5em]">
                    {h?.startTime && h?.endTime ? `${h.startTime} ~ ${h.endTime}` : '─'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {h?.totalMinutes ? formatMinutes(h.totalMinutes) : '0時間00分'}
                  </div>
                </td>
              );
            })}
          </tr>
          {/* 支援前延長 */}
          <tr className="align-middle text-center">
            <td className="bg-slate-50 font-medium p-2 leading-tight" style={{ border: '1.5px solid #374151' }}>
              【支援前】<br />延長支援時間
            </td>
            {daysOfWeek.map(d => {
              const h = hoursPlan.weeklyHours[d];
              return (
                <td key={d} style={{ border: '1.5px solid #374151' }} className="p-2 bg-slate-50/20">
                  <div className="font-bold text-[11px] min-h-[1.5em]">
                    {h?.beforeExtStartTime && h?.beforeExtEndTime ? `${h.beforeExtStartTime} ~ ${h.beforeExtEndTime}` : '─'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {h?.beforeExtMinutes ? `${h.beforeExtMinutes}分` : '0分'}
                  </div>
                </td>
              );
            })}
          </tr>
          {/* 支援後延長 */}
          <tr className="align-middle text-center">
            <td className="bg-slate-50 font-medium p-2 leading-tight" style={{ border: '1.5px solid #374151' }}>
              【支援後】<br />延長支援時間
            </td>
            {daysOfWeek.map(d => {
              const h = hoursPlan.weeklyHours[d];
              return (
                <td key={d} style={{ border: '1.5px solid #374151' }} className="p-2 bg-slate-50/20">
                  <div className="font-bold text-[11px] min-h-[1.5em]">
                    {h?.afterExtStartTime && h?.afterExtEndTime ? `${h.afterExtStartTime} ~ ${h.afterExtEndTime}` : '─'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {h?.afterExtMinutes ? `${h.afterExtMinutes}分` : '0分'}
                  </div>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>

      {/* 延長の理由 & 特記事項 */}
      <table className="w-full mt-4 border-collapse text-[12px] print:text-[11px]" style={{ border: '1.5px solid #374151' }}>
        <tbody>
          <tr className="align-top">
            <td className="bg-slate-100 text-center font-medium p-2 align-middle w-[15%]" style={{ borderRight: '1.5px solid #374151', borderBottom: '1.5px solid #374151' }}>
              延長を必要とする理由
            </td>
            <td className="p-2 leading-relaxed" style={{ borderBottom: '1.5px solid #374151' }}>
              <p className="whitespace-pre-wrap min-h-[4em]">{hoursPlan.extReason || '─'}</p>
            </td>
          </tr>
          <tr className="align-top">
            <td className="bg-slate-100 text-center font-medium p-2 align-middle w-[15%]" style={{ borderRight: '1.5px solid #374151' }}>
              特記事項
            </td>
            <td className="p-2 leading-relaxed">
              <p className="whitespace-pre-wrap min-h-[4em]">{hoursPlan.notes || '─'}</p>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

export const ProfessionalPlanPrintAll: React.FC<ProfessionalPlanPrintAllProps> = ({
  draftPlan,
  finalPlan,
  hoursPlan,
  selectedChild,
  officeName,
}) => {
  return (
    <div id="prof-plan-print-all" className="hidden print:block">
      <div className="print-pagebreak-after">
        <ProfessionalPlanPaper plan={draftPlan} selectedChild={selectedChild} officeName={officeName} />
      </div>
      <div className="print-pagebreak-after">
        <ProfessionalPlanPaper plan={finalPlan} selectedChild={selectedChild} officeName={officeName} />
      </div>
      <div>
        <ServiceHoursPlanPaper hoursPlan={hoursPlan} selectedChild={selectedChild} officeName={officeName} />
      </div>
    </div>
  );
};
