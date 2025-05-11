import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from '@src/App';
import '@src/App.scss';

const FullPage = () => {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // 确保扩展已完全加载
    setIsLoaded(true);
  }, []);

  return (
    <div className="App">
      {isLoaded && <App />}
    </div>
  );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<FullPage />);
