import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNavigation } from './MobileNavigation';
import { ChildDrawer } from './ChildDrawer';
import { useParams, Outlet, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils';
import type { Child } from '../data/mockData';

type LayoutProps = {
  childrenData: Child[];
  selectedOfficeId: string;
  offices: { id: string, name: string }[];
  onOfficeChange: (id: string) => void;
};

export const Layout: React.FC<LayoutProps> = ({ 
  childrenData, 
  selectedOfficeId, 
  offices, 
  onOfficeChange 
}) => {
  const { childId } = useParams();
  const location = useLocation();
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // ドロワーが実際に開いているモバイル画面のときだけ背面をロック
  const isLocked = isDrawerOpen && window.innerWidth < 768;

  useEffect(() => {
    // 書類編集画面（dashboard以外の詳細画面）に遷移したらサイドバーを閉じる
    const isDocumentPage = location.pathname.includes('/support-plan') ||
                           location.pathname.includes('/assessment') ||
                           location.pathname.includes('/force-sheet');
    if (isDocumentPage && window.innerWidth >= 768) {
      setIsSidebarExpanded(false);
    }
  }, [location.pathname]);

  useEffect(() => {
    return () => {
      document.body.classList.remove('overflow-hidden', 'touch-none');
    };
  }, []);

  const getTitle = () => {
    const path = window.location.pathname;
    if (path.includes('/support-plan')) return '専門的支援実施計画';
    if (path.includes('/assessment'))  return 'アセスメントシート';
    if (path.includes('/force-sheet')) return '強行シート';
    if (path.includes('/edit'))        return '児童情報を編集';
    if (path.includes('/new'))         return '新規児童登録';
    if (childId)                       return '書類を選択';
    if (path.includes('/settings'))    return '設定';
    return '書類管理システム';
  };

  return (
    <div className="flex h-[100dvh] overflow-hidden relative">
      <Sidebar
        childrenData={childrenData}
        selectedChildId={childId ?? null}
        isExpanded={isSidebarExpanded}
        onToggle={() => setIsSidebarExpanded(!isSidebarExpanded)}
        selectedOfficeId={selectedOfficeId}
        offices={offices}
        onOfficeChange={onOfficeChange}
      />

      <main
        className={`flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden ml-0 ${isSidebarExpanded ? 'md:ml-sidebar-expanded' : 'md:ml-sidebar-collapsed'} transition-[margin] duration-normal relative`}
      >
        {isLocked && (
          <div
            className="fixed inset-0 z-40 bg-black/5 md:hidden touch-none"
            onClick={() => setIsDrawerOpen(false)}
          />
        )}

        <Header
          title={getTitle()}
          onOpenDrawer={() => setIsDrawerOpen(true)}
        />

        {/* スクロールコンテナ
            - pb-20 md:pb-8: モバイル底部ナビ(80px)分の余白をここで確保
            - overscrollBehavior contain: 親へのスクロール連鎖を防ぐ */}
        <div
          className={cn(
            'flex-1 overflow-y-auto min-h-0 p-4 md:p-8 pb-20 md:pb-8 transition-all',
            isLocked ? 'overflow-hidden touch-none brightness-95' : ''
          )}
          style={{ overscrollBehavior: 'contain' }}
        >
          <Outlet />
        </div>
      </main>

      {/* 下部ナビゲーション（モバイルのみ） */}
      <MobileNavigation
        childrenData={childrenData}
        isSheetOpen={isDrawerOpen}
        onOpenChange={(open) => setIsDrawerOpen(open)}
      />

      <ChildDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        childrenData={childrenData}
        selectedChildId={childId ?? null}
        selectedOfficeId={selectedOfficeId}
        offices={offices}
        onOfficeChange={onOfficeChange}
      />
    </div>
  );
};
