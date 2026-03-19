import { useState } from 'react';
import { Layout } from './components/Layout';
import { ChildList } from './pages/ChildList';
import { ChildForm } from './pages/ChildForm';
import './index.css';

function App() {
  const [currentPath, setCurrentPath] = useState('children');
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);

  const handleNavigate = (path: string) => {
    setCurrentPath(path);
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
          <div className="flex-center" style={{ height: '100%' }}>
            <h2 className="text-muted">現在開発中です</h2>
          </div>
        );
    }
  };

  return (
    <Layout currentPath={currentPath} onNavigate={handleNavigate}>
      {renderContent()}
    </Layout>
  );
}

export default App;
