import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { seedSkills, reseedSkillContents } from './db';

// Initialize the skills database before the render
seedSkills()
  .then(() => reseedSkillContents())
  .catch(err => {
    console.error('Failed to seed skills database:', err);
  });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
