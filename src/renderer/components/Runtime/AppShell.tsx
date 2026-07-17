import React from 'react';

const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="app-shell app-shell-polished" style={{ height: '100vh', overflow: 'hidden', position: 'relative' }}>
    {children}
  </div>
);

export default AppShell;
