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
import { MonthlySummary } from './pages/MonthlySummary';
import { ForceSheet } from './pages/ForceSheet';
import type { Child } from './data/mockData';
import { mockChildrenData } from './data/mockData';
import { matchesOffice } from './lib/officeUtils';
import './index.css';

const COLLECTION_NAME = 'children';


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

        // 姓名の解決 (旧形式: fullName, name / 新形式: lastName, firstName)
        let resolvedName = '';
        if (fd.fullName && typeof fd.fullName === 'string' && fd.fullName.trim()) {
          resolvedName = fd.fullName.trim();
        } else if (fd.name && typeof fd.name === 'string' && fd.name.trim()) {
          resolvedName = fd.name.trim();
        } else if (fd.lastName || fd.firstName) {
          resolvedName = `${fd.lastName || ''} ${fd.firstName || ''}`.trim();
        }

        // ふりがなの解決 (旧形式: nameKana, nameFurigana / 新形式: lastNameFurigana, firstNameFurigana)
        let resolvedKana = '';
        if (fd.nameKana && typeof fd.nameKana === 'string' && fd.nameKana.trim()) {
          resolvedKana = fd.nameKana.trim();
        } else if (fd.nameFurigana && typeof fd.nameFurigana === 'string' && fd.nameFurigana.trim()) {
          resolvedKana = fd.nameFurigana.trim();
        } else if (fd.lastNameFurigana || fd.firstNameFurigana) {
          resolvedKana = `${fd.lastNameFurigana || ''} ${fd.firstNameFurigana || ''}`.trim();
        }

        // 年齢の解決 (age または birthDate / birthdate からの算出)
        let resolvedAge = Number(fd.age) || 0;
        const bDateStr = fd.birthDate || fd.birthdate;
        if (!resolvedAge && bDateStr) {
          const birth = new Date(bDateStr);
          if (!isNaN(birth.getTime())) {
            const today = new Date();
            let calcAge = today.getFullYear() - birth.getFullYear();
            const m = today.getMonth() - birth.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
              calcAge--;
            }
            resolvedAge = calcAge > 0 ? calcAge : 0;
          }
        }

        // 保護者勤務先の解決
        const workplaceInfo = [
          fd.workplace1Name ? `${fd.workplace1Name}${fd.workplace1Contact ? ` (${fd.workplace1Contact})` : ''}` : '',
          fd.workplace2Name ? `${fd.workplace2Name}${fd.workplace2Contact ? ` (${fd.workplace2Contact})` : ''}` : ''
        ].filter(Boolean).join(' / ');

        return {
          id: d.id,
          fullName: resolvedName || '(名前なし)',
          nameKana: resolvedKana,
          age: resolvedAge,
          grade: fd.grade || fd.schoolGrade || '',
          schoolName: fd.schoolName || fd.school || '',
          address: fd.address || '',
          phoneNumberHome: fd.phoneNumberHome || fd.phoneNumber || '',
          phoneNumberEmergency: fd.phoneNumberEmergency || fd.contact1Phone || fd.contact2Phone || '',
          parentWorkplaceContact: fd.parentWorkplaceContact || workplaceInfo,
          familyStructure: fd.familyStructure || '',
          features: fd.features || [],
          imageKey: fd.imageKey || (resolvedName ? resolvedName[0] : '?'),
          offices: Array.from(new Set([
            ...(Array.isArray(fd.offices) ? fd.offices : fd.offices ? [fd.offices] : []),
            ...(Array.isArray(fd.tags) ? fd.tags : fd.tags ? [fd.tags] : []),
            ...(Array.isArray(fd.officeTags) ? fd.officeTags : fd.officeTags ? [fd.officeTags] : []),
            ...(fd.office ? [fd.office] : []),
            ...(fd.officeId ? [fd.officeId] : []),
          ].map(String).filter(Boolean))),
          currentPlanEndMonth: fd.currentPlanEndMonth || '',
          serviceType: fd.serviceType || '',
          serviceCategory: fd.serviceCategory || '',
          isHoukagoDay: typeof fd.isHoukagoDay === 'boolean' ? fd.isHoukagoDay : undefined,
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
      if (!childOffices || (Array.isArray(childOffices) && childOffices.length === 0)) {
        return selectedOfficeId === 'LNrWc8f6G703aUYRZ5e2';
      }
      return matchesOffice(selectedOfficeId, childOffices);
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
        <Route path="/monthly-summary" element={
          <MonthlySummary 
            childrenData={filteredChildren} 
            selectedOfficeId={selectedOfficeId} 
            offices={offices} 
          />
        } />
        <Route path="/children/:childId" element={
          <ChildDashboard 
            childrenData={children} 
            selectedOfficeId={selectedOfficeId}
            onOfficeChange={setSelectedOfficeId}
            offices={offices}
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
        <Route path="/children/:childId/force-sheet" element={
          <ForceSheet 
            childrenData={filteredChildren} 
            selectedOfficeId={selectedOfficeId} 
            offices={offices} 
          />
        } />
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
