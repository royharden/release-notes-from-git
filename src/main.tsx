import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App.tsx';
import './ui/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing.');
ReactDOM.createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
