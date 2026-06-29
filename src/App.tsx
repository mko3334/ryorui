import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import type { User } from 'firebase/auth';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs, query } from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { Layout } from './components/Layout';
import { ChildList } from './pages/ChildList';
import { ChildDashboard } from './pages/ChildDashboard';
import { SupportImplementation } from './pages/SupportImplementation';
import { ProfessionalPerspective } from './pages/ProfessionalPerspective';
import { Settings } from './pages/Settings';
import { Login } from './pages/Login';
import type { Child } from './data/mockData';
import { mockChildrenData } from './data/mockData';
import './index.css';

const COLLECTION_NAME = 'children';

// ---- 開発中プレースホルダー ----
function UnderDevelopment({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 glass-panel">
      <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-full uppercase tracking-wider">開発中</span>
      <h2 className="text-slate-500 text-xl font-medium">{title}</h2>
      <p className="text-sm text-slate-400">この画面は現在開発中です。</p>
    </div>
  );
}

// ---- 認証済みアプリ本体 ----
function AppContent({ user }: { user: User }) {
  const [selectedOfficeId, setSelectedOfficeId] = useState<string>('LNrWc8f6G703aUYRZ5e2'); // デフォルト: Search
  const [offices, setOffices] = useState<{ id: string, name: string }[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [allPlans, setAllPlans] = useState<any[]>([]);

  // 初期ロード：事業所一覧の取得と、ログインスタッフの所属事業所を初期選択とする
  useEffect(() => {
    const initOffice = async () => {
      try {
        const oSnap = await getDocs(query(collection(db, 'offices')));
        const oList = oSnap.docs.map(d => ({ id: d.id, name: d.data().name }));
        setOffices(oList);

        if (user) {
          const staffDoc = await getDocs(query(collection(db, 'staff')));
          let foundStaffOfficeId = '';
          staffDoc.forEach(d => {
            if (d.id === user.uid) {
              foundStaffOfficeId = d.data().officeId || '';
            }
          });
          if (foundStaffOfficeId) {
            setSelectedOfficeId(foundStaffOfficeId);
          }
        }
      } catch (err) {
        console.error("Failed to init office data:", err);
      }
    };
    initOffice();
  }, [user]);

  const fetchChildrenAndPlans = useCallback(async () => {
    try {
      const q = query(collection(db, COLLECTION_NAME));
      const snapshot = await getDocs(q);
      const childList = snapshot.docs.map(d => {
        const fd = d.data();
        return {
          id: d.id,
          fullName: fd.fullName || fd.name || '(名前なし)',
          nameKana: fd.nameKana || '',
          age: Number(fd.age) || 0,
          grade: fd.grade || '',
          schoolName: fd.schoolName || '',
          address: fd.address || '',
          phoneNumberHome: fd.phoneNumberHome || '',
          phoneNumberEmergency: fd.phoneNumberEmergency || '',
          parentWorkplaceContact: fd.parentWorkplaceContact || '',
          familyStructure: fd.familyStructure || '',
          features: fd.features || [],
          imageKey: fd.imageKey || (fd.fullName ? fd.fullName[0] : (fd.name ? fd.name[0] : '?')),
          offices: fd.offices || [],
          currentPlanEndMonth: fd.currentPlanEndMonth || '',
        };
      }) as Child[];

      const planSnap = await getDocs(query(collection(db, 'professionalPlans')));
      const planList = planSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      setChildren(childList.length === 0 ? mockChildrenData : childList);
      setAllPlans(planList);
    } catch (error) {
      console.error('[AppContent] Fetch error:', error);
      setChildren(mockChildrenData);
    }
  }, []);

  useEffect(() => {
    fetchChildrenAndPlans();
  }, [fetchChildrenAndPlans]);

  // 事業所ごとの児童フィルタ
  const getOfficeTag = (officeId: string): string => {
    if (officeId === 'LNrWc8f6G703aUYRZ5e2') return 'サーチ';
    if (officeId === 'nWioUcWXUskreYjmSL8p') return 'ホーム';
    return '';
  };

  const currentOfficeTag = getOfficeTag(selectedOfficeId);

  // モニタリング通知判定ヘルパー
  const checkNeedsMonitoring = (childId: string) => {
    const childPlans = allPlans.filter(p => p.childId === childId && p.officeId === selectedOfficeId && p.archived !== true);
    if (childPlans.length === 0) return false;

    const months = childPlans.map(p => p.startMonth).filter(Boolean).sort();
    if (months.length === 0) return false;

    const latestStartMonth = months[months.length - 1];
    const today = new Date();
    const curYear = today.getFullYear();
    const curMonth = today.getMonth() + 1;

    const [startYear, startMonthVal] = latestStartMonth.split('-').map(Number);
    if (!startYear || !startMonthVal) return false;

    const diffMonths = (curYear - startYear) * 12 + (curMonth - startMonthVal);

    if (diffMonths >= 5) {
      const hasNextPeriod = childPlans.some(p => {
        const pMonth = p.startMonth;
        if (!pMonth) return false;
        const [py, pm] = pMonth.split('-').map(Number);
        const pDiff = (py - startYear) * 12 + (pm - startMonthVal);
        return pDiff >= 6;
      });
      return !hasNextPeriod;
    }
    return false;
  };

  const filteredChildren = children
    .filter(child => {
      const childOffices = child.offices;
      if (!childOffices) {
        return selectedOfficeId === 'LNrWc8f6G703aUYRZ5e2';
      }
      if (Array.isArray(childOffices)) {
        if (childOffices.length === 0) {
          return selectedOfficeId === 'LNrWc8f6G703aUYRZ5e2';
        }
        return childOffices.includes(currentOfficeTag);
      }
      if (typeof childOffices === 'string') {
        return childOffices === currentOfficeTag;
      }
      return false;
    })
    .map(child => ({
      ...child,
      needsMonitoring: child.id ? checkNeedsMonitoring(child.id) : false
    }));

  return (
    <Routes>
      <Route element={
        <Layout 
          childrenData={filteredChildren} 
          selectedOfficeId={selectedOfficeId}
          offices={offices}
          onOfficeChange={setSelectedOfficeId}
        />
      }>
        <Route path="/" element={<ChildList />} />
        <Route path="/children/:childId" element={
          <ChildDashboard 
            childrenData={filteredChildren} 
          />
        } />
        <Route path="/children/:childId/professional-perspective" element={
          <ProfessionalPerspective 
            childrenData={filteredChildren} 
            selectedOfficeId={selectedOfficeId} 
            offices={offices}
            onReload={fetchChildrenAndPlans}
          />
        } />
        <Route path="/children/:childId/support-plan/:month?" element={
          <SupportImplementation 
            childrenData={filteredChildren} 
            selectedOfficeId={selectedOfficeId} 
            offices={offices}
          />
        } />
        <Route path="/children/:childId/force-sheet" element={<UnderDevelopment title="強行シート" />} />
        <Route path="/settings" element={<Settings childrenData={filteredChildren} />} />

      </Route>

      {/* 未マッチはトップへ */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// ---- ルートコンポーネント（認証ゲート） ----
function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <AppContent user={user} />;
}

export default App;
