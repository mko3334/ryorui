import { useState } from 'react';
import { Layout } from './components/Layout';
import { ChildList } from './pages/ChildList';
import { ChildForm } from './pages/ChildForm';
import { mockChildrenData } from './data/mockData';
import './index.css';

function App() {
  const [currentPath, setCurrentPath] = useState('children');
  const [viewMode, setViewMode] = useState<'by-child' | 'by-document'>('by-child');
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
    // 児童詳細以外の画面に遷移した場合は選択を解除
    if (path !== 'child-form') {
      setSelectedChildId(null);
    }
  };

  const handleChildSelect = (childId: string | null) => {
    setSelectedChildId(childId);
    setCurrentPath('child-form');
  };

  const renderContent = () => {
    switch (currentPath) {
      case 'children':
        return <ChildList onSelectChild={handleChildSelect} onNewChild={() => handleChildSelect(null)} />;
      case 'child-form':
        return <ChildForm 
                  childId={selectedChildId} 
                  onBack={() => handleNavigate('children')} 
               />;
      default:
        return (
          <div className="flex items-center justify-center h-full">
            <h2 className="text-slate-400 text-xl font-medium italic tracking-wide">
              現在、本画面は開発中です
            </h2>
          </div>
        );
    }
  };

  return (
    <Layout 
      currentPath={currentPath} 
      onNavigate={handleNavigate}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      childrenData={mockChildrenData}
      selectedChildId={selectedChildId}
      onSelectChild={handleChildSelect}
    >
      {renderContent()}
    </Layout>
  );
}

export default App;
