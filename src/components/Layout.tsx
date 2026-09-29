import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
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

        {/* スクロールコンテナ
            - pb-20 md:pb-5: モバイル底部ナビ分の余白を確保しつつ画面を広く活用 */}
        <div
          className={cn(
            'flex-1 overflow-y-auto min-h-0 p-3 md:p-5 pb-20 md:pb-5 transition-all',
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
