import { doc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export interface PlanGoalSnapshot {
  docId: string;
  hadExistingGoals: boolean;
  goals: string;
}

export interface DailyReportSnapshot {
  id: string;
  isNew: boolean;
  data?: any;
}

export interface TreeCommSnapshot {
  childId: string;
  dateKey: string;
  prefDocId: string;
  hadExisting: boolean;
  futurePlan: string;
}

export interface ImportHistoryAction {
  id: string;
  timestamp: string;
  summary: string;
  officeId: string;
  officeName: string;
  actionType?: 'import' | 'delete';
  deletedRows?: any[]; // 削除された行の完全なオブジェクト配列
  deletedPlanMeta?: any; // 削除された支援目標メタ情報
  
  before: {
    supportPlans: PlanGoalSnapshot[];
    dailyReports: DailyReportSnapshot[];
    createdDailyReportIds: string[];
    treeComms: TreeCommSnapshot[];
  };

  after: {
    supportPlans: Array<{ docId: string; payload: any }>;
    dailyReports: Array<{ id: string; isNew: boolean; payload: any }>;
    treeComms: Array<{ childId: string; dateKey: string; prefDocId: string; payload: any }>;
  };
}

/**
 * アンドゥ（元に戻す）を実行する
 */
export async function performUndo(action: ImportHistoryAction): Promise<void> {
  let currentBatch = writeBatch(db);
  let opCount = 0;
  const MAX_BATCH_OPS = 250;

  const addBatchOp = async (fn: (b: any) => void) => {
    fn(currentBatch);
    opCount++;
    if (opCount >= MAX_BATCH_OPS) {
      await currentBatch.commit();
      currentBatch = writeBatch(db);
      opCount = 0;
    }
  };

  if (action.actionType === 'delete') {
    const officeTag = action.officeId === 'LNrWc8f6G703aUYRZ5e2' ? 'サーチ' : action.officeId === 'nWioUcWXUskreYjmSL8p' ? 'ホーム' : '';

    // 1. 削除された日報レコード（daily_reports）を正規化フォーマットで完全に復元
    if (action.deletedRows && action.deletedRows.length > 0) {
      for (const row of action.deletedRows) {
        if (!row.id) continue;
        const dRef = doc(db, 'daily_reports', row.id);

        // 日付の正規化 (例: "4月1日" -> "2026-04-01")
        let formattedDate = "";
        const mMatch = row.date?.match(/(\d+)月/);
        const dMatch = row.date?.match(/(\d+)日/);
        if (mMatch && dMatch && row.planMonth) {
          const [yStr] = row.planMonth.split('-');
          formattedDate = `${yStr}-${mMatch[1].padStart(2, '0')}-${dMatch[1].padStart(2, '0')}`;
        }

        const payload: any = {
          childId: row.childId,
          planMonth: row.planMonth,
          date: formattedDate || row.date,
          staffId: row.staffId || "",
          staffName: row.staffId || "",
          type: row.type || 'tree_report',
          content: {
            externalInfo: row.content?.externalInfo || "",
            supportContent: row.content?.supportContent || [],
            resultInfo: row.content?.resultInfo || "",
            futurePlan: row.content?.futurePlan || "",
            isVerified: row.content?.isVerified || false,
          },
          externalInfo: row.content?.externalInfo || "",
          archived: row.archived || false,
          officeId: action.officeId,
          updatedAt: serverTimestamp(),
        };
        await addBatchOp((b) => b.set(dRef, payload));

        // ツリー通信（tree_communications）の復元
        if (formattedDate && row.childId) {
          const treePayload = {
            name: "",
            tree_comm_text: row.content?.externalInfo || "",
            future_plan: row.content?.futurePlan || "",
            pickupLocation: "",
            endTime: "",
            transportTime: "",
            notes: "",
            officeId: action.officeId,
            office: officeTag,
            updatedAt: new Date().toISOString()
          };
          const prefRef = doc(db, `children/${row.childId}/app_categories/書類管理/tree_communications`, `${action.officeId}_${formattedDate}`);
          const noPrefRef = doc(db, `children/${row.childId}/app_categories/書類管理/tree_communications`, formattedDate);
          await addBatchOp((b) => b.set(prefRef, treePayload, { merge: true }));
          await addBatchOp((b) => b.set(noPrefRef, treePayload, { merge: true }));
        }
      }
    }

    // 2. 削除された支援目標（supportPlans）を復元
    if (action.deletedPlanMeta) {
      const meta = action.deletedPlanMeta;
      if (meta.childId && meta.month) {
        const prefDocId = `${action.officeId}_${meta.childId}_${meta.month}`;
        const noPrefDocId = `${meta.childId}_${meta.month}`;
        await addBatchOp((b) => b.set(doc(db, 'supportPlans', prefDocId), { ...meta, officeId: action.officeId, updatedAt: serverTimestamp() }, { merge: true }));
        await addBatchOp((b) => b.set(doc(db, 'supportPlans', noPrefDocId), { ...meta, officeId: action.officeId, updatedAt: serverTimestamp() }, { merge: true }));
      }
    }

    if (opCount > 0) {
      await currentBatch.commit();
    }
    return;
  }

  // ==== インポート時のアンドゥ ====
  // 1. 新規作成された日報レコードを削除
  for (const newId of action.before.createdDailyReportIds) {
    const dRef = doc(db, 'daily_reports', newId);
    await addBatchOp((b) => b.delete(dRef));
  }

  // 2. 上書きされた日報レコードを元の状態に復元
  for (const item of action.before.dailyReports) {
    if (!item.isNew && item.data) {
      const dRef = doc(db, 'daily_reports', item.id);
      await addBatchOp((b) => b.set(dRef, {
        ...item.data,
        updatedAt: serverTimestamp()
      }, { merge: true }));
    }
  }

  // 3. 支援目標（supportPlans）を元の状態に復元
  for (const plan of action.before.supportPlans) {
    const pRef = doc(db, 'supportPlans', plan.docId);
    if (plan.hadExistingGoals) {
      await addBatchOp((b) => b.update(pRef, {
        goals: plan.goals,
        updatedAt: serverTimestamp()
      }));
    } else {
      await addBatchOp((b) => b.update(pRef, {
        goals: '',
        updatedAt: serverTimestamp()
      }));
    }
  }

  // 4. ツリー通信（tree_communications）の復元（既存の予定があった場合のみ元に戻す。空文字での消去は行わない）
  for (const tree of action.before.treeComms) {
    const prefRef = doc(db, `children/${tree.childId}/app_categories/書類管理/tree_communications`, tree.prefDocId);
    const noPrefRef = doc(db, `children/${tree.childId}/app_categories/書類管理/tree_communications`, tree.dateKey);

    if (tree.hadExisting && tree.futurePlan) {
      await addBatchOp((b) => b.set(prefRef, {
        future_plan: tree.futurePlan,
        updatedAt: new Date().toISOString()
      }, { merge: true }));
      await addBatchOp((b) => b.set(noPrefRef, {
        future_plan: tree.futurePlan,
        updatedAt: new Date().toISOString()
      }, { merge: true }));
    }
  }

  if (opCount > 0) {
    await currentBatch.commit();
  }
}

/**
 * リドゥ（やり直す）を実行する
 */
export async function performRedo(action: ImportHistoryAction): Promise<void> {
  let currentBatch = writeBatch(db);
  let opCount = 0;
  const MAX_BATCH_OPS = 250;

  const addBatchOp = async (fn: (b: any) => void) => {
    fn(currentBatch);
    opCount++;
    if (opCount >= MAX_BATCH_OPS) {
      await currentBatch.commit();
      currentBatch = writeBatch(db);
      opCount = 0;
    }
  };

  if (action.actionType === 'delete') {
    // 1. 日報レコードの再削除（他アプリの tree_communications には触らない）
    if (action.deletedRows && action.deletedRows.length > 0) {
      for (const row of action.deletedRows) {
        if (row.id) {
          const dRef = doc(db, 'daily_reports', row.id);
          await addBatchOp((b) => b.delete(dRef));
        }
      }
    }

    // 2. 支援目標の再削除
    if (action.deletedPlanMeta) {
      const meta = action.deletedPlanMeta;
      if (meta.childId && meta.month) {
        const prefDocId = `${action.officeId}_${meta.childId}_${meta.month}`;
        const noPrefDocId = `${meta.childId}_${meta.month}`;
        await addBatchOp((b) => b.delete(doc(db, 'supportPlans', prefDocId)));
        await addBatchOp((b) => b.delete(doc(db, 'supportPlans', noPrefDocId)));
      }
    }

    if (opCount > 0) {
      await currentBatch.commit();
    }
    return;
  }

  // ==== インポート時のリドゥ ====
  // 1. 支援目標（supportPlans）を再適用
  for (const plan of action.after.supportPlans) {
    const pRef = doc(db, 'supportPlans', plan.docId);
    await addBatchOp((b) => b.set(pRef, {
      ...plan.payload,
      updatedAt: serverTimestamp()
    }, { merge: true }));
  }

  // 2. 日報（daily_reports）を再適用
  for (const rec of action.after.dailyReports) {
    const dRef = doc(db, 'daily_reports', rec.id);
    await addBatchOp((b) => b.set(dRef, {
      ...rec.payload,
      updatedAt: serverTimestamp()
    }, { merge: true }));
  }

  // 3. ツリー通信を再適用
  for (const tree of action.after.treeComms) {
    const prefRef = doc(db, `children/${tree.childId}/app_categories/書類管理/tree_communications`, tree.prefDocId);
    const noPrefRef = doc(db, `children/${tree.childId}/app_categories/書類管理/tree_communications`, tree.dateKey);

    await addBatchOp((b) => b.set(prefRef, {
      ...tree.payload,
      updatedAt: new Date().toISOString()
    }, { merge: true }));
    await addBatchOp((b) => b.set(noPrefRef, {
      ...tree.payload,
      updatedAt: new Date().toISOString()
    }, { merge: true }));
  }

  if (opCount > 0) {
    await currentBatch.commit();
  }
}
