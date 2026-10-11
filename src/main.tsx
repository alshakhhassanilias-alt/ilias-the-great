import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import '@fontsource/cinzel/latin-600.css';
import '@fontsource/cinzel/latin-ext-600.css';
import '@fontsource/cormorant-garamond/latin-600-italic.css';
import '@fontsource/cormorant-garamond/latin-ext-600-italic.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
